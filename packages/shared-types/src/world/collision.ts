/**
 * 地形碰撞：服务端权威结算与客户端本地预测跑的是同一份纯函数，因此双端坐标天然一致。
 *
 * 求解策略（见 ADR-0008）：
 * 1. 障碍按 128px 网格建索引，单次查询只遍历邻近桶；
 * 2. 4px 子步推进，薄栏板（2px 栏板 + 7px 玩家半径）不可能被一步跨过；
 * 3. 整段被挡时退化为单轴移动，贴着围栏走会自然滑行而不是卡死；
 * 4. 桥面是水域放行区，其余水面一律不可涉。
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
import { ISLAND, PLANTER_RADIUS, TREE_TRUNK_RADIUS, WORLD_CENTER, WORLD_LAYOUT, isOnBridge, isOnLand } from './layout';

/** 玩家碰撞半径：约等于身体宽度的一半（角色 48 texel 高、躯干 23 宽），围栏与树干的体感由此决定 */
export const PLAYER_RADIUS = 9;
/** 单步最长 4px，小于最薄障碍的有效厚度（3px 栏板 + 9px 半径 = 15），避免高速穿模 */
const MAX_SUBSTEP = 4;
/** 障碍索引网格边长 */
const GRID_SIZE = 128;
const GRID_COUNT = Math.ceil(WORLD_WIDTH / GRID_SIZE);

type Blocker =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number; readonly water: boolean }
  | {
      readonly kind: 'segment';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly r: number;
      readonly water: boolean;
    }
  | { readonly kind: 'polygon'; readonly points: ReadonlyArray<Point>; readonly water: boolean };

const blockers: Blocker[] = [];

for (const segment of WORLD_LAYOUT.fence.segments) {
  blockers.push({
    kind: 'segment',
    x1: segment.x1,
    y1: segment.y1,
    x2: segment.x2,
    y2: segment.y2,
    // 栏板视觉厚度 5px，碰撞半径取一半
    r: 3,
    water: false,
  });
}
for (const forest of WORLD_LAYOUT.forests) {
  for (const tree of forest.trees) {
    blockers.push({ kind: 'circle', x: tree.x, y: tree.y, r: TREE_TRUNK_RADIUS, water: false });
  }
}
for (const tree of WORLD_LAYOUT.wildTrees) {
  blockers.push({ kind: 'circle', x: tree.x, y: tree.y, r: TREE_TRUNK_RADIUS, water: false });
}
for (const planter of WORLD_LAYOUT.planters) {
  blockers.push({ kind: 'circle', x: planter.x, y: planter.y, r: PLANTER_RADIUS, water: false });
}
for (const solid of WORLD_LAYOUT.solids) {
  const { x, y, w, h } = solid;
  blockers.push({
    kind: 'polygon',
    points: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    water: false,
  });
}
for (const lake of WORLD_LAYOUT.lakes) {
  blockers.push({ kind: 'polygon', points: lake.points, water: true });
}
for (const river of WORLD_LAYOUT.rivers) {
  blockers.push({ kind: 'polygon', points: river.polygon, water: true });
}

const cells = new Map<number, number[]>();

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
      const list = cells.get(key);
      if (list) list.push(index);
      else cells.set(key, [index]);
    }
  }
}

function blockerBounds(blocker: Blocker): WorldRect {
  if (blocker.kind === 'circle') {
    return { x: blocker.x - blocker.r, y: blocker.y - blocker.r, w: blocker.r * 2, h: blocker.r * 2 };
  }
  if (blocker.kind === 'polygon') return polygonBounds(blocker.points);
  const minX = Math.min(blocker.x1, blocker.x2) - blocker.r;
  const minY = Math.min(blocker.y1, blocker.y2) - blocker.r;
  const maxX = Math.max(blocker.x1, blocker.x2) + blocker.r;
  const maxY = Math.max(blocker.y1, blocker.y2) + blocker.r;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

blockers.forEach((blocker, index) => addToCells(index, blockerBounds(blocker)));

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
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const list = cells.get(cellKey(cx, cy));
      if (!list) continue;
      for (const index of list) {
        if (seen[index] === stamp) continue;
        seen[index] = stamp;
        candidates.push(index);
      }
    }
  }
  return candidates;
}

function overlaps(blocker: Blocker, x: number, y: number, radius: number): boolean {
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

/** 该点是否与地形相交；非有限坐标视为被挡，避免 NaN 污染权威状态 */
export function isBlocked(x: number, y: number, radius: number = PLAYER_RADIUS): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return true;
  // 海即边界：先判陆地，再查围栏/树/水。顺序反了会让「站在海里但没碰到障碍」被放行
  if (!isOnLand(x, y, radius)) return true;
  const onBridge = isOnBridge(x, y);
  const list = gather(x, y, radius);
  for (const index of list) {
    const blocker = blockers[index]!;
    if (blocker.water && onBridge) continue;
    if (overlaps(blocker, x, y, radius)) return true;
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 陆地边界；世界矩形只是坐标上限，海才是真正的墙 */
function insideWorld(x: number, y: number, radius: number): boolean {
  return isOnLand(x, y, radius);
}

/** 就近找一块空地：出生点兜底、卡进障碍时脱困 */
export function findFreePoint(x: number, y: number, radius: number = PLAYER_RADIUS): { x: number; y: number } {
  let startX = Number.isFinite(x) ? x : WORLD_CENTER.x;
  let startY = Number.isFinite(y) ? y : WORLD_CENTER.y;
  // 压测会把出生半径放大到 3000，采样点会落进海里：先夹回陆地包围盒再就近搜。
  // 只判「在不在陆地」，不判半径——贴岸的点保留原点，环搜索会自己往内陆走。
  if (!isOnLand(startX, startY)) {
    const { x: bx, y: by, w, h } = ISLAND.bounds;
    const margin = radius + 1;
    startX = clamp(startX, bx + margin, bx + w - margin);
    startY = clamp(startY, by + margin, by + h - margin);
  }
  if (insideWorld(startX, startY, radius) && !isBlocked(startX, startY, radius)) {
    return { x: startX, y: startY };
  }
  for (let ring = 1; ring <= 16; ring += 1) {
    const distance = ring * 24;
    const samples = ring * 6 + 6;
    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2;
      const px = startX + Math.cos(angle) * distance;
      const py = startY + Math.sin(angle) * distance;
      if (!insideWorld(px, py, radius)) continue;
      if (!isBlocked(px, py, radius)) return { x: px, y: py };
    }
  }
  return { x: WORLD_CENTER.x, y: WORLD_CENTER.y };
}

/**
 * 把一次位移解算到合法位置：先试整段，被挡则退化为单轴滑动。
 * 调用方传入的目标点已经是「限速后」的坐标，这里只负责地形。
 */
export function resolveMotion(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number = PLAYER_RADIUS,
): { x: number; y: number } {
  if (!Number.isFinite(toX) || !Number.isFinite(toY)) return { x: fromX, y: fromY };

  let originX = fromX;
  let originY = fromY;
  if (!insideWorld(originX, originY, radius) || isBlocked(originX, originY, radius)) {
    const free = findFreePoint(originX, originY, radius);
    originX = free.x;
    originY = free.y;
  }

  const dx = toX - originX;
  const dy = toY - originY;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return { x: originX, y: originY };

  // 每一小步都沿「原始方向」推进：若改成朝目标重新瞄准，贴墙滑行会越走越慢，
  // 而且滑动后重新命中的首个空闲点会把角色瞬移过障碍。
  const unitX = dx / distance;
  const unitY = dy / distance;
  let x = originX;
  let y = originY;
  let traveled = 0;
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
    break;
  }
  return { x, y };
}
