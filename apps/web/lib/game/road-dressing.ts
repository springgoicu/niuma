'use client';

import type { Graphics } from 'pixi.js';
import {
  AMUSEMENT_STREET,
  COMPANY_FORECOURT,
  DISTRICTS,
  LIVING_AVENUE,
  PATH_MAIN_HALF_WIDTH,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  SERVICE_SQUARE,
  WORLD_LAYOUT,
  isBlocked,
  isOnPlaza,
  isWaterAt,
  pointInPolygon,
  rectContains,
  type WorldRect,
} from '@niuma/shared-types';
import { TERRAIN_COLORS as C } from './terrain-palette';

/**
 * 路面叙事（ADR-0099）：路口铺砖、斑马线、低饱和指引箭头。
 *
 * 纪律：
 * 1. **纯渲染**：不新增碰撞、不进 `WORLD_LAYOUT.props`，因此树点、席位与协议都不受影响；
 * 2. **不写第二份坐标**：路口与街口全部从 `WORLD_LAYOUT.paths` 的中心线顶点、
 *    `DISTRICTS[].gate` 与街区铺装常量推导；
 * 3. **构造期一次成图**：`paintRoadDressing` 只在 `PropsView.build()` 里调一次，
 *    帧循环零成本；图元全是整数纹素，明度阶梯只有「本体 + 一档缝」；
 * 4. `?flat=1` 整层不画，回到旧的纯平铺画法。
 */

/** 路口铺砖的边长：48 = 4 列 × 6 行 12×6 小砖，正好压住两条支路的交汇 */
export const JUNCTION_SIZE = 48;
/** 砖块：12 宽 × 6 高，隔行错缝 6px */
const BRICK_W = 12;
const BRICK_H = 6;
/** 探四向「有没有路接进来」的距离：半个铺砖 + 8px */
const ARM_PROBE = JUNCTION_SIZE / 2 + 8;
/** 两个路口靠得比这个近就合并：中心线顶点的取整误差在 1px 内 */
const JUNCTION_MERGE = 20;
/** 斑马线：5 道 6px 宽的横条，间距 12 */
const CROSS_BARS = 5;
const CROSS_BAR = 6;
const CROSS_PITCH = 12;
/** 斑马线从街口往广场里退多少：落在石面上，而不是压在土路里 */
const CROSS_INSET = 26;
/** 主路指引箭头的节奏：每 220px 一枚，第一枚离街口 150 */
const ARROW_PITCH = 220;
const ARROW_LEAD = 150;

/** 街区级铺装：整条街一次铺到底的那几片，只在中心铺一块拼花 */
const STREET_AREAS: ReadonlyArray<WorldRect> = [
  COMPANY_FORECOURT,
  AMUSEMENT_STREET,
  SERVICE_SQUARE,
  LIVING_AVENUE,
];

export interface JunctionTile {
  readonly x: number;
  readonly y: number;
  /** 四向是否接路：0 北 / 1 东 / 2 南 / 3 西 */
  readonly arms: readonly [boolean, boolean, boolean, boolean];
}

export interface CrossingStripe {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RoadArrow {
  /** 箭头尖端 */
  readonly x: number;
  readonly y: number;
  /** 单位方向（指向广场） */
  readonly dirX: number;
  readonly dirY: number;
}

export interface RoadDressingPlan {
  readonly junctions: readonly JunctionTile[];
  readonly crossings: readonly CrossingStripe[];
  readonly arrows: readonly RoadArrow[];
}

/** 该点是不是「路面或广场」：路口四向探针读这一份 */
function isRoadOrPlaza(x: number, y: number): boolean {
  if (isOnPlaza(x, y)) return true;
  for (const area of STREET_AREAS) if (rectContains(area, x, y)) return true;
  for (const path of WORLD_LAYOUT.paths) {
    if (!rectContains(path.rect, x, y)) continue;
    if (pointInPolygon(x, y, path.polygon)) return true;
  }
  return false;
}

/** 装饰落点不能踩水、不能落进建筑里 */
function isDressable(x: number, y: number): boolean {
  if (isWaterAt(x, y)) return false;
  for (const building of WORLD_LAYOUT.buildings) {
    if (rectContains(building.rect, x, y)) return false;
  }
  return true;
}

/**
 * 候选路口：中心线顶点 + 五座区门 + 四片街区广场中心。
 *
 * 顶点天然覆盖十字口与拐角；区门补上「街尽头」；街区广场中心补上
 * 生活大街、游乐大街、服务广场这类「整条街一次铺到底」的街面。
 */
function junctionCandidates(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const path of WORLD_LAYOUT.paths) {
    for (const [x, y] of path.centerline) out.push({ x: Math.round(x), y: Math.round(y) });
  }
  for (const district of DISTRICTS) out.push({ x: district.gate.x, y: district.gate.y });
  for (const area of STREET_AREAS) {
    out.push({ x: Math.round(area.x + area.w / 2), y: Math.round(area.y + area.h / 2) });
  }
  return out;
}

function buildJunctions(): JunctionTile[] {
  const tiles: JunctionTile[] = [];
  for (const point of junctionCandidates()) {
    if (!isDressable(point.x, point.y)) continue;
    // 广场里已经有整片石砖，不再叠一块拼花
    if (isOnPlaza(point.x, point.y)) continue;
    let merged = false;
    for (const tile of tiles) {
      if (Math.abs(tile.x - point.x) <= JUNCTION_MERGE && Math.abs(tile.y - point.y) <= JUNCTION_MERGE) {
        merged = true;
        break;
      }
    }
    if (merged) continue;
    tiles.push({
      x: point.x,
      y: point.y,
      arms: [
        isRoadOrPlaza(point.x, point.y - ARM_PROBE),
        isRoadOrPlaza(point.x + ARM_PROBE, point.y),
        isRoadOrPlaza(point.x, point.y + ARM_PROBE),
        isRoadOrPlaza(point.x - ARM_PROBE, point.y),
      ],
    });
  }
  return tiles;
}

/**
 * 五向街口：从广场中心射出去、起点落在圆庭内（含圆上）的那几条路的第一个顶点。
 *
 * 顶点正好落在半径上（四条主街）时直接用；起点还在圆内（西北企业区前庭）时，
 * 沿中心线步进到第一次穿出圆庭，得到斜向街口。
 */
function mouths(): Array<{ x: number; y: number; dirX: number; dirY: number; halfWidth: number }> {
  const out: Array<{ x: number; y: number; dirX: number; dirY: number; halfWidth: number }> = [];
  for (const path of WORLD_LAYOUT.paths) {
    const first = path.centerline[0];
    const second = path.centerline[1];
    if (!first || !second) continue;
    const dx0 = first[0] - PLAZA_CENTER.x;
    const dy0 = first[1] - PLAZA_CENTER.y;
    if (dx0 * dx0 + dy0 * dy0 > PLAZA_RADIUS * PLAZA_RADIUS + 1) continue;
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const dirX = dx / length;
    const dirY = dy / length;
    let mx = first[0];
    let my = first[1];
    for (let step = 0; step <= Math.ceil(length); step += 1) {
      mx = Math.round(first[0] + dirX * step);
      my = Math.round(first[1] + dirY * step);
      const dx1 = mx - PLAZA_CENTER.x;
      const dy1 = my - PLAZA_CENTER.y;
      if (dx1 * dx1 + dy1 * dy1 >= PLAZA_RADIUS * PLAZA_RADIUS) break;
    }
    out.push({ x: mx, y: my, dirX, dirY, halfWidth: path.halfWidth });
  }
  return out;
}

/** 斑马线：横条永远垂直于行进方向，整组从街口往广场里退 `CROSS_INSET` */
function buildCrossings(): CrossingStripe[] {
  const stripes: CrossingStripe[] = [];
  for (const mouth of mouths()) {
    const alongX = Math.abs(mouth.dirX) >= Math.abs(mouth.dirY);
    const span = mouth.halfWidth * 2;
    for (let i = 0; i < CROSS_BARS; i += 1) {
      const offset = CROSS_INSET + i * CROSS_PITCH;
      if (alongX) {
        // 路是东西向：横条长在 y 上，沿 x 排开
        const x = Math.round(mouth.x - mouth.dirX * offset);
        const y = Math.round(mouth.y);
        stripes.push({ x, y: y - span / 2, w: CROSS_BAR, h: span });
      } else {
        const x = Math.round(mouth.x);
        const y = Math.round(mouth.y - mouth.dirY * offset);
        stripes.push({ x: x - span / 2, y, w: span, h: CROSS_BAR });
      }
    }
  }
  return stripes;
}

/** 主路指引箭头：沿中心线每 220px 一枚，指向广场（中心线的起点端） */
function buildArrows(): RoadArrow[] {
  const arrows: RoadArrow[] = [];
  for (const path of WORLD_LAYOUT.paths) {
    if (path.halfWidth !== PATH_MAIN_HALF_WIDTH) continue;
    const points = path.centerline;
    let distanceToNext = ARROW_LEAD;
    for (let i = points.length - 1; i > 0; i -= 1) {
      // 从远离广场的一端往回走，箭头方向就是「往回走」的方向
      const [x0, y0] = points[i]!;
      const [x1, y1] = points[i - 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const dirX = dx / length;
      const dirY = dy / length;
      let walked = 0;
      while (walked + distanceToNext <= length) {
        walked += distanceToNext;
        distanceToNext = ARROW_PITCH;
        const px = Math.round(x0 + dirX * walked);
        const py = Math.round(y0 + dirY * walked);
        if (!isDressable(px, py) || isOnPlaza(px, py)) continue;
        arrows.push({ x: px, y: py, dirX, dirY });
      }
      distanceToNext -= length - walked;
      if (distanceToNext < 0) distanceToNext = ARROW_PITCH;
    }
  }
  return arrows;
}

let cached: RoadDressingPlan | null = null;

/** 一次算好整份路面装饰；纯函数、可单测，不进帧循环 */
export function roadDressingPlan(): RoadDressingPlan {
  cached ??= { junctions: buildJunctions(), crossings: buildCrossings(), arrows: buildArrows() };
  return cached;
}

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  g.rect(x, y, w, h).fill({ color, alpha });
}

/** 一块路口拼花：48×48 石砖 + 隔行错缝 + 没接路的那几面压 2px 路缘 */
function paintJunction(g: Graphics, tile: JunctionTile): void {
  const left = tile.x - JUNCTION_SIZE / 2;
  const top = tile.y - JUNCTION_SIZE / 2;
  rect(g, left, top, JUNCTION_SIZE, JUNCTION_SIZE, C.stoneAlt);
  // 错缝砖：只动明度一档，缝比砖暗
  for (let row = 0; row < JUNCTION_SIZE / BRICK_H; row += 1) {
    const y = top + row * BRICK_H;
    const offset = (row % 2) * (BRICK_W / 2);
    for (let x = left + offset; x < left + JUNCTION_SIZE; x += BRICK_W) {
      if (x > left) rect(g, x, y, 1, BRICK_H, C.stoneSeam);
    }
    rect(g, left, y, JUNCTION_SIZE, 1, C.stoneSeam);
  }
  // 四向：接路的边留空，没接路的那几面压路缘石
  const r = JUNCTION_SIZE - 2;
  if (!tile.arms[0]) rect(g, left, top, JUNCTION_SIZE, 2, C.plazaCurb);
  if (!tile.arms[1]) rect(g, left + r, top, 2, JUNCTION_SIZE, C.plazaCurb);
  if (!tile.arms[2]) rect(g, left, top + r, JUNCTION_SIZE, 2, C.plazaCurb);
  if (!tile.arms[3]) rect(g, left, top, 2, JUNCTION_SIZE, C.plazaCurb);
  // 外沿 1px 深缝：路缘石才有厚度，不会糊成一块浅色斑
  rect(g, left, top, JUNCTION_SIZE, 1, C.stoneSeam, 0.55);
  rect(g, left, top + JUNCTION_SIZE - 1, JUNCTION_SIZE, 1, C.stoneSeam, 0.55);
}

/** 一枚路面箭头：4 像素的三角头 + 一根短尾杆，朝向由单位方向逐像素取整 */
function paintArrow(g: Graphics, arrow: RoadArrow): void {
  const tipX = Math.round(arrow.x + arrow.dirX * 6);
  const tipY = Math.round(arrow.y + arrow.dirY * 6);
  const backX = Math.round(arrow.x - arrow.dirX * 2);
  const backY = Math.round(arrow.y - arrow.dirY * 2);
  // 屏幕坐标下 (x, y) 的法线是 (-y, x)
  const nx = -arrow.dirY;
  const ny = arrow.dirX;
  const wing = 4;
  g.poly([
    tipX,
    tipY,
    Math.round(backX + nx * wing),
    Math.round(backY + ny * wing),
    Math.round(backX - nx * wing),
    Math.round(backY - ny * wing),
  ]).fill({ color: C.dirtRut, alpha: 0.42 });
  // 尾杆：2px 宽的短线，让方向读起来是「一条路」而不是一个点
  const tailX = Math.round(arrow.x - arrow.dirX * 12);
  const tailY = Math.round(arrow.y - arrow.dirY * 12);
  const x = Math.min(tailX, backX);
  const y = Math.min(tailY, backY);
  const w = Math.abs(backX - tailX) + 2;
  const h = Math.abs(backY - tailY) + 2;
  rect(g, x, y, w, h, C.dirtRut, 0.24);
}

/**
 * 把整份路面装饰画进地面层（`PropsView` 的 `ground`）。
 *
 * 顺序：先铺砖、再斑马线、最后箭头——箭头压在斑马线之上仍然读得出方向。
 * `?flat=1` 时调用方跳过本函数（回到旧的纯平铺画法）。
 */
export function paintRoadDressing(g: Graphics): void {
  const plan = roadDressingPlan();
  for (const tile of plan.junctions) paintJunction(g, tile);
  for (const stripe of plan.crossings) {
    rect(g, stripe.x, stripe.y, stripe.w, stripe.h, C.stoneLight, 0.3);
  }
  for (const arrow of plan.arrows) paintArrow(g, arrow);
}

/* ------------------------------------------------------------------ *
 * 路侧指示桩（ADR-0099）
 * ------------------------------------------------------------------ */

export interface RoadPost {
  readonly x: number;
  readonly y: number;
  /** 牌面上的区色：取自 `DISTRICTS[].color`，与区门、门牌同一套 */
  readonly color: number;
}

/** 桩子离路缘多远：退到路肩外的草地上，不站在路面里 */
const POST_OFFSET = 22;

/** 离这个点最近的大区色：桩子立在哪个区的街口，就挂哪个区的颜色 */
function nearestDistrictColor(x: number, y: number): number {
  let best = DISTRICTS[0]!.color;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const district of DISTRICTS) {
    const dx = district.gate.x - x;
    const dy = district.gate.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestSq) {
      bestSq = distance;
      best = district.color;
    }
  }
  return best;
}

/** 桩位能不能站：不落水、不进楼、不与墙/树/家具重叠 */
function postAllowed(x: number, y: number): boolean {
  if (!isDressable(x, y)) return false;
  return !isBlocked(x, y);
}

let cachedPosts: readonly RoadPost[] | null = null;

/**
 * 九根指示桩：五座街口各一根（沿街方向的右侧路肩），
 * 四条主路的中点各一根。全部是纯装饰，不进 `WORLD_LAYOUT.props`。
 *
 * 落点用「街口坐标 + 半路宽 + 22」推出来，因此改路宽或挪街口都会自动跟随。
 */
export function roadPostPlan(): readonly RoadPost[] {
  if (cachedPosts) return cachedPosts;
  const posts: RoadPost[] = [];
  const push = (x: number, y: number): void => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!postAllowed(px, py)) return;
    for (const post of posts) {
      if (Math.abs(post.x - px) < 40 && Math.abs(post.y - py) < 40) return;
    }
    posts.push({ x: px, y: py, color: nearestDistrictColor(px, py) });
  };

  // 街口：沿行进方向的右侧路肩（屏幕坐标下右手法线是 (-dy, dx)）
  for (const mouth of mouths()) {
    const offset = mouth.halfWidth + POST_OFFSET;
    push(mouth.x - mouth.dirY * offset, mouth.y + mouth.dirX * offset);
  }

  // 主路中点：让长直路段走到一半也有参照物
  for (const path of WORLD_LAYOUT.paths) {
    if (path.halfWidth !== PATH_MAIN_HALF_WIDTH) continue;
    const points = path.centerline;
    const middle = points[Math.floor(points.length / 2)];
    const next = points[Math.min(points.length - 1, Math.floor(points.length / 2) + 1)];
    if (!middle || !next) continue;
    const dx = next[0] - middle[0];
    const dy = next[1] - middle[1];
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const offset = path.halfWidth + POST_OFFSET;
    push(middle[0] - (dy / length) * offset, middle[1] + (dx / length) * offset);
  }

  cachedPosts = posts;
  return posts;
}
