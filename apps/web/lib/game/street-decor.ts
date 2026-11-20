'use client';

import {
  APARTMENT_GARDEN,
  APARTMENT_GARDEN_PATH,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  TREE_MIN_GAP,
  WORLD_LAYOUT,
  distanceSqToWater,
  rectContains,
  rectExpanded,
  type WorldRect,
} from '@niuma/shared-types';
import { hashCell } from './decals';
import { isOutdoorGround } from './ground';

/**
 * 过渡带装饰的**纯数据层**：只算落点，不碰 Pixi。
 *
 * 大区之间那几条空草地原本只有 0.24 概率的草贴花，而且贴花层冬季整层不生成
 * （`terrain.ts` 的 `addDecals` 开头就 `return`），于是雪面上出现五条光秃秃的过渡带。
 * 这里补三样东西：灌木、路边小物（邮筒 / 消防栓 / 备用垃圾桶）、路肩碎石与排水篦子。
 *
 * 三条纪律：
 * 1. **不写第二份坐标**：落点全部由既有布局（路网、铺装、树、碰撞体）派生或校验，
 *    不往 `WORLD_LAYOUT` 里加任何东西；
 * 2. **零碰撞**：全部只画不挡，玩家直线行走不受影响；不写 `PROP_FOOTPRINT`、不改协议；
 * 3. **确定性**：用 `Math.imul` 位置哈希（`decals.ts` 的 `hashCell`），不用 `Math.random`，
 *    任何设备、任何时候算出来的园区一模一样。
 *
 * 画法在 `street-decor-art.ts`：分开是为了让本文件能被 `bun:test` 直接导入，
 * 不必为了一条撒点断言去加载 Pixi。
 */

/** 五条过渡带：企业/游乐/生活/服务四区之间的空草地，坐标全部落在既有留白里 */
export const STREET_DECOR_BANDS: ReadonlyArray<WorldRect> = [
  // 北：企业楼东墙外 ↔ 北主路（游乐大街与前庭之间那条空草带）
  { x: 3540, y: 3160, w: 340, h: 300 },
  // 东：服务广场以南 ↔ 摸鱼湖北岸
  { x: 4580, y: 4520, w: 340, h: 460 },
  // 西：企业楼以南 ↔ 涟漪湖北岸（竹林与花海之间的绿带）
  { x: 2580, y: 4030, w: 430, h: 580 },
  // 西南：涟漪湖以南 ↔ 生活大街西端
  { x: 2580, y: 5140, w: 510, h: 500 },
  // 东北：沉思浅塘以南 ↔ 服务广场北缘
  { x: 4860, y: 3180, w: 600, h: 380 },
];

/**
 * 公寓门前的口袋花园（ADR-0101）：小径两侧各一条灌木带。
 *
 * 落点仍走 `propsAllowed`，所以会自动让开石板小径、花圃、树与生活大街路缘；
 * 这里只给「撒点范围」，不写第二份灌木坐标。
 */
export const APARTMENT_GARDEN_BANDS: ReadonlyArray<WorldRect> = [
  // 小径西侧：东沿停在石径左缘外 24px
  {
    x: APARTMENT_GARDEN.x + 16,
    y: APARTMENT_GARDEN.y + 16,
    w: APARTMENT_GARDEN_PATH.x - APARTMENT_GARDEN.x - 40,
    h: APARTMENT_GARDEN.h - 32,
  },
  // 小径东侧：西沿停在石径右缘外 24px，一路铺到花园东沿
  {
    x: APARTMENT_GARDEN_PATH.x + APARTMENT_GARDEN_PATH.w + 24,
    y: APARTMENT_GARDEN.y + 16,
    w: APARTMENT_GARDEN.x + APARTMENT_GARDEN.w - 16 - (APARTMENT_GARDEN_PATH.x + APARTMENT_GARDEN_PATH.w + 24),
    h: APARTMENT_GARDEN.h - 32,
  },
];

/** 立式小物的种类；顺序即纹理帧号，两端只认这一份，只允许尾部追加 */
export const STREET_DECOR_KINDS = [
  'shrub',
  'shrubTall',
  'postbox',
  'hydrant',
  'bin',
  // 现代都市家具（去国风重塑）：二期接单点、施工痕与工业运转细节
  'phoneBooth',
  'cone',
  'acUnit',
  'vending',
] as const;
export type StreetDecorKind = (typeof STREET_DECOR_KINDS)[number];

export const STREET_DECOR_SIZE: Record<StreetDecorKind, { w: number; h: number }> = {
  shrub: { w: 26, h: 18 },
  shrubTall: { w: 22, h: 26 },
  postbox: { w: 16, h: 28 },
  hydrant: { w: 12, h: 20 },
  bin: { w: 14, h: 18 },
  /** 大红色现代玻璃电话亭：顶部冷白 CALL 灯箱，二期接单点 */
  phoneBooth: { w: 24, h: 48 },
  /** 施工安全锥桶：反光环带一圈，压在人行道边缘 */
  cone: { w: 12, h: 16 },
  /** 空调室外机：格栅外壳 + 底部冷凝水渍 */
  acUnit: { w: 28, h: 18 },
  /** 荧光按键饮料贩卖机 */
  vending: { w: 22, h: 38 },
};

/** 地面件的包围尺寸：绘制时逐块写 rect，这里只给裁剪与测试用 */
export const STREET_STEP_SIZE = { w: 9, h: 7 };
export const STREET_GRATE_SIZE = { w: 18, h: 8 };

export interface StreetProps {
  readonly kind: StreetDecorKind;
  readonly x: number;
  readonly y: number;
  readonly variant: 0 | 1;
}

export interface StreetGroundBit {
  /** step：路肩碎石；grate：排水篦子；stone：花园石板小径 */
  readonly kind: 'step' | 'grate' | 'stone';
  readonly x: number;
  readonly y: number;
  readonly variant: 0 | 1;
}

export interface StreetDecorPlan {
  readonly props: ReadonlyArray<StreetProps>;
  readonly ground: ReadonlyArray<StreetGroundBit>;
}

/** 硬化路肩留白：小物离路心至少「半路宽 + 14」，不站在路缘线上 */
const PATH_CLEARANCE = 14;
/** 路肩碎石小径的落点必须落在这条草缘带里：离路心 14–64px */
const STEP_OUTER = 64;
/** 小物与树的最小距离：与布局的 `TREE_MIN_GAP` 同一口径，树冠不会把小物吃掉 */
const TREE_CLEARANCE = TREE_MIN_GAP;
/** 小物与墙体、桌面、道具、花箱的净空 */
const SOLID_CLEARANCE = 28;
const PROP_CLEARANCE = 30;
const PLANTER_CLEARANCE = 34;
/** 离水面：湖岸是细沙带，灌木不能长进沙里 */
const WATER_CLEARANCE = 40;
/** 单条带的路肩碎石上限：撒满整条路缘会读成「石子路」，只在草缘点缀 */
const STEP_BUDGET = 64;
/** 花园石板小径：三列 9×7 石板，列距 10、行距 8，缝宽 1px */
export const GARDEN_PATH_COLS = 3;
/** 花园灌木比过渡带更密：门前是一片小院，不是散点绿化 */
const GARDEN_SHRUB_STEP = 44;

/** 树木缓存：布局是静态的，导入时算一次，撒点时不再重复 flatMap */
const TREES: ReadonlyArray<{ x: number; y: number }> = [
  ...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees),
  ...WORLD_LAYOUT.looseTrees,
];

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * clamped;
  const cy = ay + dy * clamped;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** 点到最近一条道路中心线的距离与那条路的半宽 */
function nearestPath(x: number, y: number): { distance: number; halfWidth: number } {
  let bestSq = Number.POSITIVE_INFINITY;
  let bestHalfWidth = 0;
  for (const path of WORLD_LAYOUT.paths) {
    const points = path.centerline;
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i]!;
      const to = points[i + 1]!;
      const distanceSq = segmentDistanceSq(x, y, from[0], from[1], to[0], to[1]);
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        bestHalfWidth = path.halfWidth;
      }
    }
  }
  return { distance: Math.sqrt(bestSq), halfWidth: bestHalfWidth };
}

function inRect(rect: WorldRect, x: number, y: number, pad: number): boolean {
  return rectContains(rectExpanded(rect, pad), x, y);
}

/**
 * 立式小物的落点是否合法。
 *
 * `minPath` / `maxPath` 是小物与「路面边线」的净空区间：
 * 灌木允许贴着路肩长，邮筒消防栓要退到路肩之外，两者共用这一条判定。
 */
function propsAllowed(x: number, y: number, minPath: number, maxPath = Number.POSITIVE_INFINITY): boolean {
  if (!isOutdoorGround(x, y)) return false;
  const dx = x - PLAZA_CENTER.x;
  const dy = y - PLAZA_CENTER.y;
  if (dx * dx + dy * dy < (PLAZA_RADIUS + 24) * (PLAZA_RADIUS + 24)) return false;
  if (distanceSqToWater(x, y) < WATER_CLEARANCE * WATER_CLEARANCE) return false;
  for (const field of WORLD_LAYOUT.flowerFields) if (inRect(field.rect, x, y, 12)) return false;
  for (const solid of WORLD_LAYOUT.solids) if (inRect(solid, x, y, SOLID_CLEARANCE)) return false;
  for (const prop of WORLD_LAYOUT.props) {
    if (Math.abs(prop.x - x) < PROP_CLEARANCE && Math.abs(prop.y - y) < PROP_CLEARANCE) return false;
  }
  for (const planter of WORLD_LAYOUT.planters) {
    if (Math.abs(planter.x - x) < PLANTER_CLEARANCE && Math.abs(planter.y - y) < PLANTER_CLEARANCE) return false;
  }
  const gapSq = TREE_CLEARANCE * TREE_CLEARANCE;
  for (const tree of TREES) {
    const tx = tree.x - x;
    const ty = tree.y - y;
    if (tx * tx + ty * ty < gapSq) return false;
  }
  const path = nearestPath(x, y);
  const gap = path.distance - path.halfWidth;
  return gap >= minPath && gap <= maxPath;
}

function groundAllowed(x: number, y: number, minPath: number, maxPath: number): boolean {
  if (!isOutdoorGround(x, y)) return false;
  if (distanceSqToWater(x, y) < WATER_CLEARANCE * WATER_CLEARANCE) return false;
  for (const solid of WORLD_LAYOUT.solids) if (inRect(solid, x, y, 10)) return false;
  const path = nearestPath(x, y);
  const gap = path.distance - path.halfWidth;
  return gap >= minPath && gap <= maxPath;
}

/**
 * 手写的路边小物：邮筒 / 消防栓 / 备用垃圾桶。
 *
 * 这几件是「生活感」的锚点，需要有节奏地出现在路口与门前，交给哈希会撒歪，
 * 所以按「街口斜前方一个身位」的位置手写；每一项都过 `propsAllowed` 校验，
 * 校验不过直接丢弃，测试会钉住最终数量与种类，防止静默消失。
 */
export const STREET_ANCHORS: ReadonlyArray<{ kind: StreetDecorKind; x: number; y: number; variant: 0 | 1 }> = [
  // 企业楼前庭东北角：进楼前顺手投一封信
  { kind: 'postbox', x: 3788, y: 3548, variant: 0 },
  // 企业区前庭南侧：消防栓贴着草地，让开 200×200 的铺装
  { kind: 'hydrant', x: 3572, y: 3768, variant: 0 },
  // 服务广场北缘草坪：消防栓守着北部支路（避开东北环岛干线路肩）
  { kind: 'hydrant', x: 4510, y: 3390, variant: 0 },
  // 急救站东侧外缘：备用垃圾桶守着东岸步道
  { kind: 'bin', x: 5480, y: 3880, variant: 1 },
  // 游乐大街西段南缘：邮筒
  { kind: 'postbox', x: 3060, y: 3120, variant: 1 },
  // 生活大街西端：邮筒与垃圾桶成对（避开路缘树冠）
  { kind: 'postbox', x: 3140, y: 5180, variant: 0 },
  { kind: 'bin', x: 3046, y: 5352, variant: 0 },
  // 景观区西带（涟漪湖北岸）：消防栓
  { kind: 'hydrant', x: 2700, y: 4550, variant: 1 },
  // 南主路东侧：垃圾桶守着出口
  { kind: 'bin', x: 4300, y: 4960, variant: 1 },
];

const MODERN_ANCHORS: ReadonlyArray<{ kind: StreetDecorKind; bx: number; by: number; variant: 0 | 1 }> = [
  { kind: 'phoneBooth', bx: 3060, by: 3120, variant: 0 },
  { kind: 'phoneBooth', bx: 4300, by: 4960, variant: 1 },
  { kind: 'cone', bx: 3572, by: 3768, variant: 0 },
  { kind: 'acUnit', bx: 3788, by: 3548, variant: 0 },
  { kind: 'vending', bx: 4500, by: 3400, variant: 0 },
];

/** 就近探测顺序：先横向让开一个身位，再上下错位，最后退回基准点本身兜底 */
const MODERN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [26, 0],
  [-26, 0],
  [0, -24],
  [0, 24],
  [26, -24],
  [-26, -24],
  [26, 24],
  [-26, 24],
  [0, -46],
  [0, 46],
  [0, 0],
];

/** 把基准点解成一个合法落点；全部探测失败时返回 null（不静默塞进计划） */
function resolveModernAnchor(anchor: (typeof MODERN_ANCHORS)[number]): StreetProps | null {
  for (const [dx, dy] of MODERN_OFFSETS) {
    const x = Math.round(anchor.bx + dx);
    const y = Math.round(anchor.by + dy);
    if (!propsAllowed(x, y, PATH_CLEARANCE)) continue;
    return { kind: anchor.kind, x, y, variant: anchor.variant };
  }
  return null;
}

/** 排水篦子：沿五区街面与主路的路缘手写，读起来像「这条路有人维护」 */
export const STREET_GRATE_ANCHORS: ReadonlyArray<{ x: number; y: number; variant: 0 | 1 }> = [
  { x: 3132, y: 3082, variant: 0 },
  { x: 4576, y: 4264, variant: 1 },
  { x: 3560, y: 3704, variant: 0 },
  { x: 4966, y: 3576, variant: 1 },
];

/** 排水篦子允许贴着铺装边：篦子本来就嵌在路缘上，不算「站在路面中间」 */
function nearPaved(x: number, y: number): boolean {
  for (const area of WORLD_LAYOUT.paved) if (inRect(area, x, y, 6)) return true;
  return false;
}

function scatterShrubs(band: WorldRect, index: number, step = 76): StreetProps[] {
  const out: StreetProps[] = [];
  const seed = 0x51de + index * 0x9e37;
  const top = Math.floor(band.y / step);
  const bottom = Math.ceil((band.y + band.h) / step);
  const from = Math.floor(band.x / step);
  const to = Math.ceil((band.x + band.w) / step);
  for (let cy = top; cy < bottom; cy += 1) {
    for (let cx = from; cx < to; cx += 1) {
      if (hashCell(cx, cy, seed) >= 0.42) continue;
      const x = Math.round(cx * step + (0.15 + hashCell(cx, cy, seed + 0x11) * 0.7) * step);
      const y = Math.round(cy * step + (0.2 + hashCell(cx, cy, seed + 0x23) * 0.7) * step);
      if (!rectContains(band, x, y)) continue;
      // 灌木离路肩至少 18：贴着路长，但不长到路面上；草甸深处同样允许
      if (!propsAllowed(x, y, 18)) continue;
      const tall = hashCell(cx, cy, seed + 0x37) > 0.62;
      out.push({
        kind: tall ? 'shrubTall' : 'shrub',
        x,
        y,
        variant: hashCell(cx, cy, seed + 0x4b) > 0.5 ? 1 : 0,
      });
    }
  }
  return out;
}

/** 路肩碎石小径：只在「离路心 14–64px」的草缘带里撒，沿着路自然形成一条旧石径 */
function scatterSteps(band: WorldRect, index: number): StreetGroundBit[] {
  const out: StreetGroundBit[] = [];
  const seed = 0x7a11 + index * 0x85eb;
  const step = 56;
  const top = Math.floor(band.y / step);
  const bottom = Math.ceil((band.y + band.h) / step);
  const from = Math.floor(band.x / step);
  const to = Math.ceil((band.x + band.w) / step);
  let budget = STEP_BUDGET;
  for (let cy = top; cy < bottom && budget > 0; cy += 1) {
    for (let cx = from; cx < to && budget > 0; cx += 1) {
      if (hashCell(cx, cy, seed) >= 0.55) continue;
      const x = Math.round(cx * step + (0.2 + hashCell(cx, cy, seed + 0x11) * 0.6) * step);
      const y = Math.round(cy * step + (0.2 + hashCell(cx, cy, seed + 0x23) * 0.6) * step);
      if (!rectContains(band, x, y)) continue;
      if (!groundAllowed(x, y, PATH_CLEARANCE, PATH_CLEARANCE + STEP_OUTER)) continue;
      out.push({ kind: 'step', x, y, variant: hashCell(cx, cy, seed + 0x37) > 0.5 ? 1 : 0 });
      budget -= 1;
    }
  }
  return out;
}

/**
 * 公寓门前石板小径：沿 `APARTMENT_GARDEN_PATH` 三列密铺，列距 10、行距 8。
 *
 * 纯函数、确定性：错缝只由行号奇偶决定，任何设备算出的落点完全一致。
 * 石板只画不挡，`APARTMENT_GARDEN_PATH` 本身就是花园的中线，踩上去没有任何代价。
 */
export function apartmentGardenPath(): StreetGroundBit[] {
  const out: StreetGroundBit[] = [];
  const { x, y, w, h } = APARTMENT_GARDEN_PATH;
  const colStep = Math.floor((w - 2) / GARDEN_PATH_COLS);
  const rowStep = STREET_STEP_SIZE.h + 1;
  for (let row = 0; row * rowStep + STREET_STEP_SIZE.h + 2 <= h - 2; row += 1) {
    const by = y + 2 + row * rowStep + STREET_STEP_SIZE.h;
    for (let col = 0; col < GARDEN_PATH_COLS; col += 1) {
      const cx = x + 2 + colStep * col + Math.floor(STREET_STEP_SIZE.w / 2);
      out.push({ kind: 'stone', x: cx, y: by, variant: ((row + col) % 2) as 0 | 1 });
    }
  }
  return out;
}

/**
 * 整份装饰计划：纯数据、纯函数，可在 `bun:test` 里逐条断言。
 * 同一份布局在任何设备上算出的结果完全一致，顺序稳定（按 y、x 排序）。
 */
export function streetDecorPlan(): StreetDecorPlan {
  const props: StreetProps[] = [];
  const ground: StreetGroundBit[] = [];

  for (let index = 0; index < STREET_DECOR_BANDS.length; index += 1) {
    const band = STREET_DECOR_BANDS[index]!;
    props.push(...scatterShrubs(band, index));
    ground.push(...scatterSteps(band, index));
  }

  // 公寓门前口袋花园（ADR-0101）：小径两侧灌木 + 三列石板小径
  for (let index = 0; index < APARTMENT_GARDEN_BANDS.length; index += 1) {
    const band = APARTMENT_GARDEN_BANDS[index]!;
    props.push(...scatterShrubs(band, STREET_DECOR_BANDS.length + index, GARDEN_SHRUB_STEP));
  }
  ground.push(...apartmentGardenPath());

  for (const anchor of STREET_ANCHORS) {
    if (!propsAllowed(anchor.x, anchor.y, PATH_CLEARANCE)) continue;
    props.push(anchor);
  }
  // 现代街道家具：电话亭 / 锥桶 / 空调外机 / 贩卖机。
  // 落点由基准点就近探测得出，仍是纯数据、零碰撞、不进共享布局。
  for (const anchor of MODERN_ANCHORS) {
    const resolved = resolveModernAnchor(anchor);
    if (resolved) props.push(resolved);
  }
  for (const anchor of STREET_GRATE_ANCHORS) {
    if (!nearPaved(anchor.x, anchor.y) && !isOutdoorGround(anchor.x, anchor.y)) continue;
    ground.push({ kind: 'grate', x: anchor.x, y: anchor.y, variant: anchor.variant });
  }

  props.sort((left, right) => left.y - right.y || left.x - right.x);
  ground.sort((left, right) => left.y - right.y || left.x - right.x);
  return { props, ground };
}
