/**
 * 地形碰撞：服务端权威结算与客户端本地预测跑的是同一份纯函数，因此双端坐标天然一致。
 *
 * 求解策略（见 ADR-0008 / ADR-0028 / ADR-0030 / ADR-0099）：
 * 1. 障碍按 128px 网格建索引，单次查询只遍历邻近桶；
 * 2. 4px 子步推进，薄隔断（6px 隔断 + 9px 玩家半径）不可能被一步跨过；
 * 3. 整段被挡时退化为单轴移动，贴着墙体与家具走会自然滑行而不是卡死；
 * 4. 两条单轴都被挡时再做 1px 内角侧移：90° 内角上 4px 整步进不去、1px 进得去，
 *    否则斜着贴墙角会直接停死（ADR-0099）。侧移计入位移预算，不会额外提速；
 * 5. 三处景观湖全域可涉水（ADR-0030 / ADR-0047），水不再是障碍；海仍由 `isOnLand` 兜底。
 *
 * 办公区已删除围栏（ADR-0028），软边界树篱不参与碰撞。
 */

import { WORLD_WIDTH } from '../constants';
import {
  distanceSqToPolygon,
  distanceSqToSegment,
  pointInPolygon,
  polygonBounds,
  type Point,
  type WorldRect,
} from './geometry';
import {
  HERO_TREE_TRUNK_RADIUS,
  ISLAND,
  PLANTER_RADIUS,
  TREE_TRUNK_RADIUS,
  WORLD_CENTER,
  WORLD_LAYOUT,
  isOnLand,
  isWaterAt,
} from './layout';

/** 玩家碰撞半径：约等于身体宽度的一半（角色 48 texel 高、躯干 23 宽），墙体与树干的体感由此决定 */
export const PLAYER_RADIUS = 9;
/** 单步最长 4px，小于最薄障碍的有效厚度（6px 隔断 + 9px 半径 = 15），避免高速穿模 */
const MAX_SUBSTEP = 4;
/** 内角辅助滑行的单次侧移（px）：1px 才进得去 90° 内角，4px 整步会被挡 */
const NUDGE_STEP = 1;
/** 单次解算最多侧移几次：同时受位移预算约束，只是兜底上限 */
const MAX_NUDGES = 24;
/** 障碍索引网格边长 */
const GRID_SIZE = 128;
const GRID_COUNT = Math.ceil(WORLD_WIDTH / GRID_SIZE);

type Blocker =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: 'rect'; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
  | {
      readonly kind: 'segment';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly r: number;
    }
  | { readonly kind: 'polygon'; readonly points: ReadonlyArray<Point> };

const blockers: Blocker[] = [];

/**
 * 脚底锚点 → 圆形碰撞体。
 *
 * 树与花箱的精灵都以 (x, y) 为底边中心；碰撞圆若也以此为圆心，
 * 半径有一半落在地面以下，物体南侧就会出现约 12px 的隐形墙。
 * 圆心抬到 `y - r + 1`：圆底边贴着脚底，脚底点本身仍在圆内，不会留下可穿的缝。
 */
function footCircle(x: number, y: number, r: number): Blocker {
  return { kind: 'circle', x, y: y - r + 1, r };
}

// ADR-0028：办公区删除围栏，树篱只做视觉分区（走 props 管线，不产生 blocker）
for (const grove of WORLD_LAYOUT.groves) {
  for (const tree of grove.trees) {
    blockers.push(footCircle(tree.x, tree.y, tree.scale === 1 ? HERO_TREE_TRUNK_RADIUS : TREE_TRUNK_RADIUS));
  }
}
for (const tree of WORLD_LAYOUT.looseTrees) {
  blockers.push(footCircle(tree.x, tree.y, tree.scale === 1 ? HERO_TREE_TRUNK_RADIUS : TREE_TRUNK_RADIUS));
}
for (const planter of WORLD_LAYOUT.planters) {
  blockers.push(footCircle(planter.x, planter.y, PLANTER_RADIUS));
}
for (const solid of WORLD_LAYOUT.solids) {
  const { x, y, w, h } = solid;
  blockers.push({
    kind: 'rect',
    minX: x,
    minY: y,
    maxX: x + w,
    maxY: y + h,
  });
}
// 三湖不再注册为碰撞体：全岛水域可涉水（ADR-0030 / ADR-0047）。海仍由 isOnLand 兜底。

const tempCells = new Map<number, number[]>();

function cellKey(cx: number, cy: number): number {
  return cy * GRID_COUNT + cx;
}

function addToCells(index: number, bounds: WorldRect): void {
  const minCx = Math.max(0, Math.floor(bounds.x / GRID_SIZE));
  const maxCx = Math.min(GRID_COUNT - 1, Math.floor((bounds.x + bounds.w) / GRID_SIZE));
  const minCy = Math.max(0, Math.floor(bounds.y / GRID_SIZE));
  const maxCy = Math.min(GRID_COUNT - 1, Math.floor((bounds.y + bounds.h) / GRID_SIZE));
  for (let cy = minCy; cy <= maxCy; cy += 1) {
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const key = cellKey(cx, cy);
      const list = tempCells.get(key);
      if (list) list.push(index);
      else tempCells.set(key, [index]);
    }
  }
}

function blockerBounds(blocker: Blocker): WorldRect {
  if (blocker.kind === 'circle') {
    return { x: blocker.x - blocker.r, y: blocker.y - blocker.r, w: blocker.r * 2, h: blocker.r * 2 };
  }
  if (blocker.kind === 'rect') {
    return {
      x: blocker.minX,
      y: blocker.minY,
      w: blocker.maxX - blocker.minX,
      h: blocker.maxY - blocker.minY,
    };
  }
  if (blocker.kind === 'polygon') return polygonBounds(blocker.points);
  const minX = Math.min(blocker.x1, blocker.x2) - blocker.r;
  const minY = Math.min(blocker.y1, blocker.y2) - blocker.r;
  const maxX = Math.max(blocker.x1, blocker.x2) + blocker.r;
  const maxY = Math.max(blocker.y1, blocker.y2) + blocker.r;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

blockers.forEach((blocker, index) => addToCells(index, blockerBounds(blocker)));

/** 扁平定长桶表：把 Map<cellKey, number[]> 压成 O(1) 下标访问 + Int32Array，消灭热路径哈希查找 */
const cellGrid: Array<Int32Array | undefined> = new Array(GRID_COUNT * GRID_COUNT);
for (const [key, list] of tempCells) {
  cellGrid[key] = Int32Array.from(list);
}
tempCells.clear();

const seen = new Int32Array(blockers.length);
const candidates: number[] = [];
let stamp = 0;

/** 查询与 (x,y,radius) 可能的障碍；复用同一个候选数组，帧循环不分配 */
function gather(x: number, y: number, radius: number): readonly number[] {
  candidates.length = 0;
  stamp += 1;
  if (stamp >= 0x7ffffffe) {
    seen.fill(0);
    stamp = 1;
  }
  const minCx = Math.max(0, Math.floor((x - radius) / GRID_SIZE));
  const maxCx = Math.min(GRID_COUNT - 1, Math.floor((x + radius) / GRID_SIZE));
  const minCy = Math.max(0, Math.floor((y - radius) / GRID_SIZE));
  const maxCy = Math.min(GRID_COUNT - 1, Math.floor((y + radius) / GRID_SIZE));
  for (let cy = minCy; cy <= maxCy; cy += 1) {
    const rowOffset = cy * GRID_COUNT;
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const list = cellGrid[rowOffset + cx];
      if (!list) continue;
      for (let i = 0; i < list.length; i += 1) {
        const index = list[i]!;
        if (seen[index] === stamp) continue;
        seen[index] = stamp;
        candidates.push(index);
      }
    }
  }
  return candidates;
}

function overlaps(blocker: Blocker, x: number, y: number, radius: number): boolean {
  if (blocker.kind === 'rect') {
    if (radius <= 0) {
      return x >= blocker.minX && x < blocker.maxX && y >= blocker.minY && y < blocker.maxY;
    }
    const cx = x < blocker.minX ? blocker.minX : x > blocker.maxX ? blocker.maxX : x;
    const cy = y < blocker.minY ? blocker.minY : y > blocker.maxY ? blocker.maxY : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy < radius * radius;
  }
  if (blocker.kind === 'circle') {
    const reach = blocker.r + radius;
    const dx = x - blocker.x;
    const dy = y - blocker.y;
    return dx * dx + dy * dy < reach * reach;
  }
  if (blocker.kind === 'segment') {
    const reach = blocker.r + radius;
    return distanceSqToSegment(x, y, blocker.x1, blocker.y1, blocker.x2, blocker.y2) < reach * reach;
  }
  if (pointInPolygon(x, y, blocker.points)) return true;
  return distanceSqToPolygon(x, y, blocker.points) < radius * radius;
}

/**
 * 动态障碍：豪宅锁门时的门栅。
 *
 * 静态布局是模块级常量，锁门却是运行期状态；把门栅塞进静态索引就得重建格子，
 * 而动态障碍至多几道，单独 O(1) AABB 扫一遍比重建索引便宜得多。
 */
let dynamicBlockers: Blocker[] = [];

export function setDynamicSolids(rects: ReadonlyArray<WorldRect>): void {
  if (rects.length === 0 && dynamicBlockers.length === 0) return;
  dynamicBlockers = rects.map((rect) => ({
    kind: 'rect' as const,
    minX: rect.x,
    minY: rect.y,
    maxX: rect.x + rect.w,
    maxY: rect.y + rect.h,
  }));
}

/** 当前动态障碍条数：测试与调试用 */
export function dynamicBlockerCount(): number {
  return dynamicBlockers.length;
}

/** 该点是否与地形相交；非有限坐标视为被挡，避免 NaN 污染权威状态 */
export function isBlocked(
  x: number,
  y: number,
  radius: number = PLAYER_RADIUS,
  includeDynamic = true,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return true;
  // 矩形边界即墙：先判陆地，再查家具与树。湖面可涉水，不再进障碍列表（ADR-0030 / ADR-0064）
  if (!isOnLand(x, y, radius)) return true;
  const list = gather(x, y, radius);
  for (const index of list) {
    if (overlaps(blockers[index]!, x, y, radius)) return true;
  }
  if (includeDynamic) {
    for (const blocker of dynamicBlockers) {
      if (overlaps(blocker, x, y, radius)) return true;
    }
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 陆地边界；世界矩形只是坐标上限，四边密林围出的矩形才是真正的墙（ADR-0064） */
function insideWorld(x: number, y: number, radius: number): boolean {
  return isOnLand(x, y, radius);
}

/** 可作为落脚点的判定：陆地、无碰撞体，按需排除水面 */
function freeAt(x: number, y: number, radius: number, avoidWater: boolean): boolean {
  if (!insideWorld(x, y, radius)) return false;
  if (isBlocked(x, y, radius)) return false;
  if (avoidWater && isWaterAt(x, y)) return false;
  return true;
}

/**
 * 就近找一块空地：出生点兜底、卡进障碍时脱困。
 *
 * `avoidWater` 默认 true：水虽可涉，出生与就近挪位落进湖心观感仍然糟糕。
 * 移动求解的卡死恢复会传 false——岸边狭小时宁可站在浅水里，也不要被兜底送回广场。
 */
export function findFreePoint(
  x: number,
  y: number,
  radius: number = PLAYER_RADIUS,
  avoidWater = true,
): { x: number; y: number } {
  let startX = Number.isFinite(x) ? x : WORLD_CENTER.x;
  let startY = Number.isFinite(y) ? y : WORLD_CENTER.y;
  // 多边形岛界收紧：若起点落在外海/密林湾凹槽之外，先沿连线向岛心逐步拉回陆地再做环搜索
  if (!isOnLand(startX, startY)) {
    const { x: bx, y: by, w, h } = ISLAND.bounds;
    const margin = radius + 1;
    startX = clamp(startX, bx + margin, bx + w - margin);
    startY = clamp(startY, by + margin, by + h - margin);
    if (!isOnLand(startX, startY)) {
      let lo = 0;
      let hi = 1;
      for (let step = 0; step < 16; step += 1) {
        const mid = (lo + hi) * 0.5;
        const px = startX + (WORLD_CENTER.x - startX) * mid;
        const py = startY + (WORLD_CENTER.y - startY) * mid;
        if (isOnLand(px, py)) hi = mid;
        else lo = mid;
      }
      startX = startX + (WORLD_CENTER.x - startX) * hi;
      startY = startY + (WORLD_CENTER.y - startY) * hi;
      if (!isOnLand(startX, startY)) {
        startX = WORLD_CENTER.x;
        startY = WORLD_CENTER.y;
      }
    }
  }
  if (freeAt(startX, startY, radius, avoidWater)) {
    return { x: startX, y: startY };
  }
  for (let ring = 1; ring <= 16; ring += 1) {
    const distance = ring * 24;
    const samples = ring * 6 + 6;
    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2;
      const px = startX + Math.cos(angle) * distance;
      const py = startY + Math.sin(angle) * distance;
      if (freeAt(px, py, radius, avoidWater)) return { x: px, y: py };
    }
  }
  return { x: WORLD_CENTER.x, y: WORLD_CENTER.y };
}

/** 位移解算的输出槽：`resolveMotionInto` 要把结果写回调用方预分配的容器 */
export interface MotionTarget {
  x: number;
  y: number;
}

/**
 * 把一次位移解算到合法位置：先试整段，被挡则退化为单轴滑动。
 * 调用方传入的目标点已经是「限速后」的坐标，这里只负责地形。
 *
 * 返回新对象的版本保留给低频调用与测试；帧循环与服务端移动包请用 `resolveMotionInto`
 * ——那里每秒要跑上万次，每次一个 `{x, y}` 会把 GC 压力堆到服务端 tick 上。
 */
export function resolveMotion(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number = PLAYER_RADIUS,
): MotionTarget {
  const out: MotionTarget = { x: fromX, y: fromY };
  resolveMotionInto(out, fromX, fromY, toX, toY, radius);
  return out;
}

export function resolveMotionInto(
  out: MotionTarget,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number = PLAYER_RADIUS,
): void {
  if (!Number.isFinite(toX) || !Number.isFinite(toY)) {
    out.x = fromX;
    out.y = fromY;
    return;
  }

  let originX = fromX;
  let originY = fromY;
  if (!insideWorld(originX, originY, radius) || isBlocked(originX, originY, radius)) {
    // 脱困不避水：水已可走，岸边狭小时宁可站进浅水，也不要把人送回广场
    const free = findFreePoint(originX, originY, radius, false);
    originX = free.x;
    originY = free.y;
  }

  const dx = toX - originX;
  const dy = toY - originY;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) {
    out.x = originX;
    out.y = originY;
    return;
  }

  // 每一小步都沿「原始方向」推进：若改成朝目标重新瞄准，贴墙滑行会越走越慢，
  // 而且滑动后重新命中的首个空闲点会把角色瞬移过障碍。
  const unitX = dx / distance;
  const unitY = dy / distance;
  let x = originX;
  let y = originY;
  let traveled = 0;
  /** 1px 侧移的次数上限：每侧移一次都从位移预算里扣，因此不会额外提速 */
  let nudges = 0;
  while (traveled < distance) {
    const advance = Math.min(MAX_SUBSTEP, distance - traveled);
    const nx = x + unitX * advance;
    const ny = y + unitY * advance;
    if (!isBlocked(nx, ny, radius)) {
      x = nx;
      y = ny;
      traveled += advance;
      continue;
    }
    const slideX = unitX * advance;
    const slideY = unitY * advance;
    if (Math.abs(slideX) > 0.0001 && !isBlocked(x + slideX, y, radius)) {
      x += slideX;
      traveled += advance;
      continue;
    }
    if (Math.abs(slideY) > 0.0001 && !isBlocked(x, y + slideY, radius)) {
      y += slideY;
      traveled += advance;
      continue;
    }
    // 第三级：内角辅助滑行（ADR-0099）。
    // 90° 内角上斜走时，整步与两条单轴滑行会同时被挡（4px 整步进不去，1px 却进得去），
    // 于是角色顶在墙角停死。这里把整步拆成 1px 的侧移：先试原方向的 1px 微步，
    // 再试垂直于原方向的 1px（两侧都探，优先能多看 1px 空格的那侧）。
    // 侧移同样计入 `traveled`，所以总位移永远不超过调用方给的步长，不会被用来加速。
    if (nudges >= MAX_NUDGES || traveled + NUDGE_STEP > distance) break;
    const stepX = Math.abs(unitX) > 0.0001 ? (unitX > 0 ? NUDGE_STEP : -NUDGE_STEP) : 0;
    const stepY = Math.abs(unitY) > 0.0001 ? (unitY > 0 ? NUDGE_STEP : -NUDGE_STEP) : 0;
    if (stepX !== 0 && !isBlocked(x + stepX, y, radius)) {
      x += stepX;
      traveled += NUDGE_STEP;
      nudges += 1;
      continue;
    }
    if (stepY !== 0 && !isBlocked(x, y + stepY, radius)) {
      y += stepY;
      traveled += NUDGE_STEP;
      nudges += 1;
      continue;
    }
    // 垂直方向：横向被挡就试纵向两侧，反之亦然；2px 探针只用来决定先试哪一侧
    const sideX = stepX !== 0;
    const first = sideX ? NUDGE_STEP : -NUDGE_STEP;
    const other = -first;
    const freeFirst =
      sideX
        ? !isBlocked(x, y + first, radius) && !isBlocked(x, y + first * 2, radius)
        : !isBlocked(x + first, y, radius) && !isBlocked(x + first * 2, y, radius);
    const pick = freeFirst ? first : other;
    const pickFree = sideX ? !isBlocked(x, y + pick, radius) : !isBlocked(x + pick, y, radius);
    if (!pickFree) break;
    if (sideX) y += pick;
    else x += pick;
    traveled += NUDGE_STEP;
    nudges += 1;
  }
  out.x = x;
  out.y = y;
}
