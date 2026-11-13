/**
 * 游乐园：地图下方西南草坡的糖果色游乐区。
 *
 * 与 campus.ts 同一条纪律：
 * 1) 坐标全部手写整数，禁止 Math.random / Math.sin / Math.cos；
 * 2) 只描述「世界是什么」——碰撞、器械位置与入口位置是双端共用的唯一真相，
 *    像素画、灯泡串与彩旗由 apps/web 的 `park.ts` 决定。
 *
 * 两个入口：
 * - 东门 (3300, 5600)：接南侧休息庭院西侧的树篱缺口与铺装；
 * - 北门 (2780, 5520)：西南支路从涟漪湖东岸一路延伸下来。
 *
 * 本园区是纯静态观赏区：滑梯、秋千、跷跷板、旋转木马、摩天轮、小火车、
 * 沙池与喷泉都只负责「看起来好玩」，不再有可点击/按键的互动。
 */

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
 * 滑梯：纯装饰造型
 *
 * 塔楼在东北角、正对东门；滑道从塔顶向东南弯到落地缓冲区。
 * 折线与端点仍在这里写一次，渲染端只读这份；ADR-0067 起互动入口整体下线，
 * 因此这里不再有 id / 时长 / 交互半径，也不再有插值函数。
 * ------------------------------------------------------------------ */

/** 滑梯端点用可读的对象而不是几何模块的二元组：消费方直接取 .x / .y */
export interface SlidePoint {
  readonly x: number;
  readonly y: number;
}

/** 滑梯造型：只保留画图需要的几何，不表达任何可交互语义 */
export interface SlideArt {
  /** 精灵矩形（塔楼 + 滑道） */
  readonly hit: WorldRect;
  /** 塔顶平台 */
  readonly top: SlidePoint;
  /** 落地缓冲区中心 */
  readonly landing: SlidePoint;
  /** 滑道折线：首点 = top，末点 = landing */
  readonly chute: readonly Point[];
}

export const PARK_SLIDE: SlideArt = {
  hit: { x: 3108, y: 5512, w: 144, h: 178 },
  top: { x: 3170, y: 5570 },
  landing: { x: 3240, y: 5686 },
  chute: [
    [3170, 5570],
    [3186, 5602],
    [3212, 5638],
    [3240, 5686],
  ],
};

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

/* ------------------------------------------------------------------ *
 * 静态大件：摩天轮 / 小火车 / 沙池 / 喷泉（ADR-0067：游乐园转静态观赏区）
 *
 * 位置按「不挡两个门洞、不压滑梯落点、与既有器械留出 20px 以上通道」手排：
 * - 摩天轮占东南角空地，避开南缘长椅与东侧灯柱；
 * - 小火车沿北侧跑，西端让开北门进来的直行通道；
 * - 沙池贴西南围栏，东侧留 148px 草坡通道；
 * - 喷泉居中偏东，北侧留 87px 通往东门的横穿通道。
 * ------------------------------------------------------------------ */

export type ParkAttractionKind = 'ferris' | 'train' | 'sandpit' | 'fountain';

/** 大件器械：`x` / `y` 是精灵包围盒中心，`w` / `h` 是包围盒尺寸 */
export interface ParkAttraction {
  kind: ParkAttractionKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PARK_ATTRACTIONS: ReadonlyArray<ParkAttraction> = [
  { kind: 'ferris', x: 3010, y: 5920, w: 172, h: 182 },
  { kind: 'train', x: 2640, y: 5585, w: 140, h: 60 },
  { kind: 'sandpit', x: 2290, y: 5810, w: 120, h: 64 },
  { kind: 'fountain', x: 2960, y: 5740, w: 106, h: 106 },
];

/** 大件器械的落地底座：只压最下面一条，玩家从正面仍可走到跟前 */
export const PARK_ATTRACTION_SOLIDS: ReadonlyArray<SolidRect> = [
  // 摩天轮：左右两只基座
  { kind: 'prop', x: 2938, y: 5998, w: 44, h: 20 },
  { kind: 'prop', x: 3038, y: 5998, w: 44, h: 20 },
  // 小火车：整条轨道底盘，宽度贴着车头
  { kind: 'prop', x: 2572, y: 5612, w: 136, h: 10 },
  // 沙池：南沿一条矮沿，孩子从北侧走进沙里
  { kind: 'prop', x: 2230, y: 5836, w: 120, h: 8 },
  // 喷泉：水池外缘南侧
  { kind: 'prop', x: 2912, y: 5786, w: 96, h: 8 },
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
