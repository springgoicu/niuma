/**
 * 游乐园：北向主路尽头的糖果色游乐区（ADR-0077）。
 *
 * 与 campus.ts 同一条纪律：
 * 1) 坐标全部手写整数，禁止 Math.random / Math.sin / Math.cos；
 * 2) 只描述「世界是什么」——碰撞、器械位置与入口位置是双端共用的唯一真相，
 *    像素画、灯泡串与彩旗由 apps/web 的 `park.ts` 决定。
 *
 * 两个入口：
 * - 南门 (4096, 3160)：正对北向主路末端，从中央广场一路向北就能走进园区；
 * - 东门 (4636, 2640)：园区东缘的侧门，接岛东侧草地。
 *
 * 本园区是纯静态观赏区：滑梯、秋千、跷跷板、旋转木马、摩天轮、小火车、
 * 沙池与喷泉都只负责「看起来好玩」，不再有可点击/按键的互动。
 */

import type { Point } from './geometry';
import type { BuildingSpec, SolidRect } from './campus';
import type { WorldRect } from './geometry';

/**
 * 游乐园地面：1080×600 的彩色橡胶垫。
 * 北缘离岛北界 148px；南缘正对北向主路末端（3230），东缘离岛东界 120px；
 * 西缘离四角院落西北角 220px。
 */
export const AMUSEMENT_PARK: WorldRect = { x: 3556, y: 2480, w: 1080, h: 600 };

/** 无墙建筑：只借用 BuildingSpec 的地面 / 小地图 / 贴花排除与密度统计 */
export const PARK_BUILDING: BuildingSpec = {
  name: '游乐园',
  rect: AMUSEMENT_PARK,
  floor: 'rubber',
};

/**
 * 南门与东门：`y` 是门的落地线，`gap` 是入口铺装的半宽。
 * ADR-0103 之后游乐园不再围矮栅栏，这两个缺口只用于铺装与导览，不再派生装饰立柱。
 */
export const PARK_SOUTH_GATE = { x: 4096, y: 3080, gap: 44 } as const;
export const PARK_EAST_GATE = { x: 4636, y: 2560, gap: 40 } as const;

/** 南门外的铺装：从北向主路末端接到游乐园橡胶垫 */
export const PARK_GATE_PAVING: WorldRect = { x: 4036, y: 3080, w: 120, h: 80 };

/** 游乐园的灯柱 / 长椅 / 垃圾桶继续走现有 prop；这里只给坐标 */
export const PARK_PROPS: ReadonlyArray<{ kind: 'lamp' | 'bench' | 'bin'; x: number; y: number }> = [
  { kind: 'lamp', x: 3616, y: 2568 },
  { kind: 'lamp', x: 4564, y: 3020 },
  { kind: 'lamp', x: 3616, y: 3020 },
  { kind: 'lamp', x: 4336, y: 2546 },
  { kind: 'bench', x: 3788, y: 3028 },
  { kind: 'bench', x: 4336, y: 3028 },
  { kind: 'bin', x: 4584, y: 2588 },
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
  hit: { x: 4444, y: 2472, w: 144, h: 178 },
  top: { x: 4506, y: 2530 },
  landing: { x: 4576, y: 2646 },
  chute: [
    [4506, 2530],
    [4522, 2562],
    [4548, 2598],
    [4576, 2646],
  ],
};

/* ------------------------------------------------------------------ *
 * 器械底座：只挡落地那一截，滑道与秋千吊索不挡人
 * ------------------------------------------------------------------ */

/** 塔楼底座：44×18，正好压在 top 平台下方 */
const SLIDE_TOWER_SOLID: SolidRect = { kind: 'prop', x: 4484, y: 2512, w: 44, h: 18 };

/** 秋千 / 跷跷板 / 旋转木马的落地底座 */
export const PARK_RIDE_SOLIDS: ReadonlyArray<SolidRect> = [
  SLIDE_TOWER_SOLID,
  { kind: 'prop', x: 3676, y: 2678, w: 60, h: 12 },
  { kind: 'prop', x: 4098, y: 2810, w: 56, h: 10 },
  { kind: 'prop', x: 3858, y: 2876, w: 76, h: 24 },
];

/** 器械中心与朝向：渲染端只读这一份，不另写坐标 */
export interface ParkRide {
  kind: 'swing' | 'seesaw' | 'carousel';
  x: number;
  y: number;
  variant: number;
}

export const PARK_RIDES: ReadonlyArray<ParkRide> = [
  { kind: 'swing', x: 3706, y: 2690, variant: 0 },
  { kind: 'seesaw', x: 4126, y: 2820, variant: 1 },
  { kind: 'carousel', x: 3896, y: 2900, variant: 2 },
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
  { kind: 'ferris', x: 4346, y: 2880, w: 172, h: 182 },
  { kind: 'train', x: 3976, y: 2545, w: 140, h: 60 },
  { kind: 'sandpit', x: 3626, y: 2770, w: 120, h: 64 },
  { kind: 'fountain', x: 4296, y: 2700, w: 106, h: 106 },
];

/** 大件器械的落地底座：只压最下面一条，玩家从正面仍可走到跟前 */
export const PARK_ATTRACTION_SOLIDS: ReadonlyArray<SolidRect> = [
  // 摩天轮：左右两只基座
  { kind: 'prop', x: 4274, y: 2958, w: 44, h: 20 },
  { kind: 'prop', x: 4374, y: 2958, w: 44, h: 20 },
  // 小火车：整条轨道底盘，宽度贴着车头
  { kind: 'prop', x: 3908, y: 2572, w: 136, h: 10 },
  // 沙池：南沿一条矮沿，孩子从北侧走进沙里
  { kind: 'prop', x: 3566, y: 2796, w: 120, h: 8 },
  // 喷泉：水池外缘南侧
  { kind: 'prop', x: 4248, y: 2746, w: 96, h: 8 },
];
