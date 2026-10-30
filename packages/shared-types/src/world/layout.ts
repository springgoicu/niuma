/**
 * 静态世界布局：服务端碰撞、客户端渲染、小地图三方共用的唯一真相。
 *
 * 两条纪律：
 * 1) 坐标全部手写，或由 `Math.imul` 派生的 mulberry32 生成；禁止 Math.random / Math.sin / Math.cos，
 *    否则 Bun(JSC) 与浏览器(V8) 可能给出不同结果，双端会各画各的地图。
 * 2) 只描述「世界是什么」，不依赖 Pixi / Bun / DOM。渲染尺寸、贴图与配色由各自的消费方决定。
 */

import { WORLD_HEIGHT, WORLD_WIDTH } from '../constants';
import {
  distanceSqToPolygon,
  pointInPolygon,
  polygonBounds,
  rectContains,
  rectExpanded,
  type Point,
  type WorldRect,
} from './geometry';

export interface LakeShape {
  points: Point[];
  /** 包围盒，供网格索引与纹理裁切使用 */
  rect: WorldRect;
}

export interface TreeInstance {
  x: number;
  y: number;
  /** 0..3，对应四套树形 */
  variant: number;
}

export interface ForestPatch {
  rect: WorldRect;
  trees: TreeInstance[];
}

export interface RiverSegment {
  rect: WorldRect;
  flow: 'north' | 'south';
}

export interface FenceSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  side: 'north' | 'south' | 'east' | 'west';
}

export interface RegionSpec {
  name: string;
  rect: WorldRect;
}

export interface PlanterInstance {
  x: number;
  y: number;
}

export interface WorldLayout {
  plaza: WorldRect;
  fence: { rect: WorldRect; segments: FenceSegment[] };
  paths: WorldRect[];
  lakes: LakeShape[];
  rivers: RiverSegment[];
  bridges: WorldRect[];
  forests: ForestPatch[];
  planters: PlanterInstance[];
  /** 按优先级排列，先命中者胜 */
  regions: RegionSpec[];
}

export const WORLD_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 } as const;

/** 出生点散布上限，与服务端 config.spawnRadius 默认值一致 */
export const SPAWN_RADIUS = 240;

/** 门洞宽度：南北门沿 x，东西门沿 y */
export const GATE_WIDTH = 80;

/** 树干碰撞半径：>2 才挡得住人，<12 才能从树缝里穿过去 */
export const TREE_TRUNK_RADIUS = 9;

export const FALLBACK_REGION = '园区野地';

/** 办公广场：冷灰绿地砖，出生点全部落在里面；与围栏同以世界中心为心 */
const PLAZA: WorldRect = { x: 3646, y: 3721, w: 900, h: 750 };

const FENCE_RECT: WorldRect = { x: 3396, y: 3546, w: 1400, h: 1100 };

const GATE_MIN = WORLD_CENTER.x - GATE_WIDTH / 2;
const GATE_MAX = WORLD_CENTER.x + GATE_WIDTH / 2;

function horizontal(label: 'north' | 'south', y: number): FenceSegment[] {
  return [
    { x1: FENCE_RECT.x, y1: y, x2: GATE_MIN, y2: y, side: label },
    { x1: GATE_MAX, y1: y, x2: FENCE_RECT.x + FENCE_RECT.w, y2: y, side: label },
  ];
}

function vertical(label: 'west' | 'east', x: number): FenceSegment[] {
  return [
    { x1: x, y1: FENCE_RECT.y, x2: x, y2: GATE_MIN, side: label },
    { x1: x, y1: GATE_MAX, x2: x, y2: FENCE_RECT.y + FENCE_RECT.h, side: label },
  ];
}

const FENCE_SEGMENTS: FenceSegment[] = [
  ...horizontal('north', FENCE_RECT.y),
  ...horizontal('south', FENCE_RECT.y + FENCE_RECT.h),
  ...vertical('west', FENCE_RECT.x),
  ...vertical('east', FENCE_RECT.x + FENCE_RECT.w),
];

/** 土路：四个门洞向外延伸到林地与桥头 */
const PATHS: WorldRect[] = [
  { x: 4048, y: 4646, w: 96, h: 900 },
  { x: 4048, y: 2946, w: 96, h: 600 },
  { x: 4796, y: 4048, w: 520, h: 96 },
  { x: 2900, y: 4048, w: 496, h: 96 },
  { x: 2600, y: 4048, w: 120, h: 96 },
];

/**
 * 湖面轮廓：以 (5700, 5300) 为中心、650×420 的椭圆，20 个顶点手写，
 * 保证双端顶点完全一致（用三角函数生成会引入引擎间末位差异）。
 */
const LAKE_POINTS: Point[] = [
  [6350, 5300],
  [6318, 5430],
  [6226, 5547],
  [6082, 5640],
  [5901, 5699],
  [5700, 5720],
  [5499, 5699],
  [5318, 5640],
  [5174, 5547],
  [5082, 5430],
  [5050, 5300],
  [5082, 5170],
  [5174, 5053],
  [5318, 4960],
  [5499, 4901],
  [5700, 4880],
  [5901, 4901],
  [6082, 4960],
  [6226, 5053],
  [6318, 5170],
];

/** 岸线宽度：只影响渲染，碰撞边界仍是水面轮廓 */
export const LAKE_SHORE = 18;

/** 河流：西侧自北向南的阶梯矩形，保证所有边都落在像素栅格上 */
const RIVERS: RiverSegment[] = [
  { rect: { x: 2900, y: 1200, w: 180, h: 1500 }, flow: 'south' },
  { rect: { x: 2720, y: 2700, w: 360, h: 180 }, flow: 'south' },
  { rect: { x: 2720, y: 2880, w: 180, h: 1600 }, flow: 'south' },
  { rect: { x: 2720, y: 4480, w: 360, h: 180 }, flow: 'south' },
  { rect: { x: 2900, y: 4660, w: 180, h: 1800 }, flow: 'south' },
];

/**
 * 木桥：整段盖住河面，是河流唯一的通行口。
 * 两端各比河岸外扩 32px——放行判定看的是角色中心点，
 * 桥面若刚好从水面开始，人会被「离岸 7px」的碰撞半径挡在桥头。
 */
const BRIDGES: WorldRect[] = [{ x: 2688, y: 4024, w: 244, h: 144 }];

/** 花箱碰撞半径：比视觉尺寸略小，擦身而过不会觉得黏 */
export const PLANTER_RADIUS = 10;

/** 广场四角的景观花箱：出生点四周就有「会被挡住」的实物，走两步就能看出 y 排序 */
const PLANTERS: PlanterInstance[] = [
  { x: 3996, y: 3996 },
  { x: 4196, y: 3996 },
  { x: 3996, y: 4196 },
  { x: 4196, y: 4196 },
];

const FOREST_RECTS: WorldRect[] = [
  { x: 1500, y: 1000, w: 1150, h: 1700 },
  { x: 5000, y: 1100, w: 1900, h: 1900 },
  { x: 4300, y: 5600, w: 2500, h: 1500 },
];

const LAKE: LakeShape = { points: LAKE_POINTS, rect: polygonBounds(LAKE_POINTS) };

const REGIONS: RegionSpec[] = [
  { name: '摸鱼湖', rect: rectExpanded(LAKE.rect, 40) },
  { name: '周报河', rect: { x: 2640, y: 1160, w: 500, h: 5340 } },
  ...FOREST_RECTS.map((rect) => ({ name: '加班林', rect })),
  { name: '办公区', rect: FENCE_RECT },
];

/** 撒树：给每个格心一次投骰，再抖动位置，比纯随机更像自然林 */
const TREE_CELL = 96;
const TREE_CHANCE = 0.6;
const TREE_JITTER = 26;
/** 必须大于 TREE_JITTER，否则抖动会把树推出森林矩形 */
const TREE_MARGIN = 32;
const TREE_VARIANTS = 4;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 树不能长进水里、路上、广场上，也不能贴到围栏上 */
function isPlantable(x: number, y: number): boolean {
  if (x < 120 || y < 120 || x > WORLD_WIDTH - 120 || y > WORLD_HEIGHT - 120) return false;
  if (rectContains(rectExpanded(PLAZA, 48), x, y)) return false;
  if (rectContains(rectExpanded(FENCE_RECT, 56), x, y)) return false;
  for (const path of PATHS) if (rectContains(rectExpanded(path, 44), x, y)) return false;
  for (const river of RIVERS) if (rectContains(rectExpanded(river.rect, 52), x, y)) return false;
  for (const bridge of BRIDGES) if (rectContains(rectExpanded(bridge, 40), x, y)) return false;
  if (rectContains(rectExpanded(LAKE.rect, 56), x, y)) {
    const shore = 56 * 56;
    if (pointInPolygon(x, y, LAKE.points) || distanceSqToPolygon(x, y, LAKE.points) < shore) return false;
  }
  return true;
}

function scatterTrees(rect: WorldRect, seed: number, variantBase: number): TreeInstance[] {
  const random = mulberry32(seed);
  const trees: TreeInstance[] = [];
  for (let y = rect.y + TREE_MARGIN; y < rect.y + rect.h - TREE_MARGIN; y += TREE_CELL) {
    for (let x = rect.x + TREE_MARGIN; x < rect.x + rect.w - TREE_MARGIN; x += TREE_CELL) {
      const roll = random();
      const jitterX = Math.round((random() - 0.5) * 2 * TREE_JITTER);
      const jitterY = Math.round((random() - 0.5) * 2 * TREE_JITTER);
      const px = x + jitterX;
      const py = y + jitterY;
      if (roll > TREE_CHANCE) continue;
      if (!isPlantable(px, py)) continue;
      const variant = (variantBase + (random() * TREE_VARIANTS | 0)) % TREE_VARIANTS;
      trees.push({ x: px, y: py, variant });
    }
  }
  return trees;
}

const FORESTS: ForestPatch[] = FOREST_RECTS.map((rect, index) => ({
  rect,
  trees: scatterTrees(rect, 0x9e3779 + index * 0x85ebca, index),
}));

export const WORLD_LAYOUT: WorldLayout = {
  plaza: PLAZA,
  fence: { rect: FENCE_RECT, segments: FENCE_SEGMENTS },
  paths: PATHS,
  lakes: [LAKE],
  rivers: RIVERS,
  bridges: BRIDGES,
  forests: FORESTS,
  planters: PLANTERS,
  regions: REGIONS,
};

/** 玩家所在区域名：区域表按优先级排列，未命中则落到野地 */
export function regionAt(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return FALLBACK_REGION;
  for (const region of REGIONS) {
    if (rectContains(region.rect, x, y)) return region.name;
  }
  return FALLBACK_REGION;
}

/** 桥面：水域在这里放行 */
export function isOnBridge(x: number, y: number): boolean {
  for (const bridge of BRIDGES) {
    if (rectContains(bridge, x, y)) return true;
  }
  return false;
}
