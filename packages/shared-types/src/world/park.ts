/**
 * 游乐园（本轮新增）：地图下方西南草坡的糖果色游乐区。
 *
 * 与 campus.ts 同一条纪律：
 * 1) 坐标全部手写整数，禁止 Math.random / Math.sin / Math.cos；
 * 2) 只描述「世界是什么」——碰撞、滑梯折线与入口位置是双端共用的唯一真相，
 *    像素画、灯泡串与彩旗由 apps/web 的 `park.ts` 决定。
 *
 * 两个入口：
 * - 东门 (3300, 5600)：接南侧休息庭院西侧的树篱缺口与铺装；
 * - 北门 (2780, 5520)：西南支路从涟漪湖东岸一路延伸下来。
 */

import { DIRECTION, type Direction } from '../constants';
import type { Point } from './geometry';
import type { BuildingSpec, SolidRect } from './campus';
import type { WorldRect } from './geometry';

/**
 * 游乐园地面：1080×600 的彩色橡胶垫。
 * 北缘离涟漪湖南岸约 80px；南缘离岛南岸（y=6168）48px；
 * 西缘离西侧海岸 74px，东缘与南庭院只隔 36px 草带。
 */
export const AMUSEMENT_PARK: WorldRect = { x: 2220, y: 5520, w: 1080, h: 600 };

/** 无墙建筑：只借用 BuildingSpec 的地面 / 小地图 / 贴花排除与密度统计 */
export const PARK_BUILDING: BuildingSpec = {
  name: '游乐园',
  rect: AMUSEMENT_PARK,
  floor: 'rubber',
};

/** 东门与北门：`y` 是门的落地线，`gap` 是围栏缺口半宽 */
export const PARK_EAST_GATE = { x: 3300, y: 5600, gap: 44 } as const;
export const PARK_NORTH_GATE = { x: 2780, y: 5520, gap: 40 } as const;

/** 东门外的铺装：从树篱缺口接到游乐园橡胶垫 */
export const PARK_GATE_PAVING: WorldRect = { x: 3288, y: 5560, w: 92, h: 80 };

/** 游乐园的灯柱 / 长椅 / 垃圾桶继续走现有 prop；这里只给坐标 */
export const PARK_PROPS: ReadonlyArray<{ kind: 'lamp' | 'bench' | 'bin'; x: number; y: number }> = [
  { kind: 'lamp', x: 2280, y: 5608 },
  { kind: 'lamp', x: 3228, y: 6060 },
  { kind: 'lamp', x: 2280, y: 6060 },
  { kind: 'lamp', x: 3000, y: 5586 },
  { kind: 'bench', x: 2452, y: 6068 },
  { kind: 'bench', x: 3000, y: 6068 },
  { kind: 'bin', x: 3248, y: 5628 },
];

/* ------------------------------------------------------------------ *
 * 滑梯：入口处的可点击设施
 *
 * 塔楼在东北角、正对东门；滑道从塔顶向东南弯到落地缓冲区。
 * 玩家站在 landing 附近点击滑道（或按 F），服务端把角色放到 top，
 * 再沿 chute 折线推进到 landing——路径只在这里写一次。
 * ------------------------------------------------------------------ */

/** 滑梯端点用可读的对象而不是几何模块的二元组：消费方直接取 .x / .y */
export interface SlidePoint {
  readonly x: number;
  readonly y: number;
}

export interface SlideSpec {
  readonly id: number;
  /** 点击命中的整块精灵矩形（塔楼 + 滑道） */
  readonly hit: WorldRect;
  /** 塔顶平台：服务端开始滑行时把角色放到这里 */
  readonly top: SlidePoint;
  /** 落地点：滑行结束与服务端校验「人是否站在滑梯旁」都用它 */
  readonly landing: SlidePoint;
  /** 滑道折线：首点 = top，末点 = landing；只允许 2–5 个点 */
  readonly chute: readonly Point[];
  /** 一次滑行的时长（毫秒） */
  readonly rideMs: number;
}

export const PARK_SLIDE: SlideSpec = {
  id: 1,
  hit: { x: 3108, y: 5512, w: 144, h: 178 },
  top: { x: 3170, y: 5570 },
  landing: { x: 3240, y: 5686 },
  chute: [
    [3170, 5570],
    [3186, 5602],
    [3212, 5638],
    [3240, 5686],
  ],
  rideMs: 1000,
};

export const SLIDES: ReadonlyArray<SlideSpec> = [PARK_SLIDE];

/** 滑梯互动的距离门：站在落地缓冲区旁边即可 */
export const SLIDE_INTERACT_RANGE = 76;
/** 两次滑行的最小间隔：挡住连点与伪造包 */
export const SLIDE_COOLDOWN_MS = 1200;

export function slideById(id: number): SlideSpec | undefined {
  if (!Number.isInteger(id)) return undefined;
  return SLIDES.find((slide) => slide.id === id);
}

/** 滑道折线的累计长度：构造期一次算好，滑行时只做标量插值 */
function chuteLengths(slide: SlideSpec): { cumulative: number[]; total: number } {
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < slide.chute.length; i += 1) {
    const a = slide.chute[i - 1]!;
    const b = slide.chute[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    total += Math.sqrt(dx * dx + dy * dy);
    cumulative.push(total);
  }
  return { cumulative, total };
}

const SLIDE_RUNS = new Map<number, { cumulative: number[]; total: number }>(
  SLIDES.map((slide) => [slide.id, chuteLengths(slide)]),
);

function directionOf(dx: number, dy: number): Direction {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? DIRECTION.Left : DIRECTION.Right;
  return dy < 0 ? DIRECTION.Up : DIRECTION.Down;
}

/**
 * 把滑行进度 `t`（0..1）写成世界坐标，返回该段朝向。
 *
 * 复用调用方的 `out` 槽位：服务端每 Tick 每位乘客调用一次，
 * 客户端每帧一次，任何一次 `{x,y}` 字面量都会变成稳态垃圾。
 */
export function slidePointInto(
  out: { x: number; y: number },
  slideId: number,
  t: number,
): Direction {
  const slide = slideById(slideId);
  const run = SLIDE_RUNS.get(slideId);
  if (!slide || !run || run.total <= 0) {
    out.x = 0;
    out.y = 0;
    return DIRECTION.Down;
  }
  const clamped = Number.isFinite(t) ? (t < 0 ? 0 : t > 1 ? 1 : t) : 0;
  const distance = clamped * run.total;
  let index = 1;
  while (index < run.cumulative.length - 1 && distance > run.cumulative[index]!) index += 1;
  const from = slide.chute[index - 1]!;
  const to = slide.chute[index]!;
  const segmentStart = run.cumulative[index - 1]!;
  const segmentLength = run.cumulative[index]! - segmentStart;
  const f = segmentLength > 0 ? (distance - segmentStart) / segmentLength : 0;
  out.x = from[0] + (to[0] - from[0]) * f;
  out.y = from[1] + (to[1] - from[1]) * f;
  return directionOf(to[0] - from[0], to[1] - from[1]);
}

/* ------------------------------------------------------------------ *
 * 器械底座：只挡落地那一截，滑道与秋千吊索不挡人
 * ------------------------------------------------------------------ */

/** 塔楼底座：44×18，正好压在 top 平台下方 */
const SLIDE_TOWER_SOLID: SolidRect = { kind: 'prop', x: 3148, y: 5552, w: 44, h: 18 };

/** 秋千 / 跷跷板 / 旋转木马的落地底座 */
export const PARK_RIDE_SOLIDS: ReadonlyArray<SolidRect> = [
  SLIDE_TOWER_SOLID,
  { kind: 'prop', x: 2340, y: 5718, w: 60, h: 12 },
  { kind: 'prop', x: 2762, y: 5850, w: 56, h: 10 },
  { kind: 'prop', x: 2522, y: 5916, w: 76, h: 24 },
];

/** 器械中心与朝向：渲染端只读这一份，不另写坐标 */
export interface ParkRide {
  kind: 'swing' | 'seesaw' | 'carousel';
  x: number;
  y: number;
  variant: number;
}

export const PARK_RIDES: ReadonlyArray<ParkRide> = [
  { kind: 'swing', x: 2370, y: 5730, variant: 0 },
  { kind: 'seesaw', x: 2790, y: 5860, variant: 1 },
  { kind: 'carousel', x: 2560, y: 5940, variant: 2 },
];

/** 围栏缺口之外仍然围一圈矮栅栏：纯装饰，不参与碰撞 */
export function parkFencePosts(): Array<{ x: number; y: number }> {
  const posts: Array<{ x: number; y: number }> = [];
  const { x, y, w, h } = AMUSEMENT_PARK;
  const step = 48;
  for (let px = x + 24; px <= x + w - 24; px += step) {
    if (Math.abs(px - PARK_EAST_GATE.x) < PARK_EAST_GATE.gap) continue;
    if (Math.abs(px - PARK_NORTH_GATE.x) < PARK_NORTH_GATE.gap) continue;
    posts.push({ x: px, y: y + 6 });
    posts.push({ x: px, y: y + h - 6 });
  }
  for (let py = y + 24; py <= y + h - 24; py += step) {
    if (Math.abs(py - PARK_EAST_GATE.y) < PARK_EAST_GATE.gap) continue;
    if (Math.abs(py - PARK_NORTH_GATE.y) < PARK_NORTH_GATE.gap) continue;
    posts.push({ x: x + 6, y: py });
    posts.push({ x: x + w - 6, y: py });
  }
  return posts;
}
