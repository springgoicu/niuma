'use client';

import {
  ISLAND,
  ISLAND_SAND,
  ISLAND_SHALLOW,
  WORLD_HEIGHT,
  WORLD_LAYOUT,
  WORLD_WIDTH,
  distanceSqToPolygon,
  pointInPolygon,
  rectContains,
} from '@niuma/shared-types';
import { contourSignedArea, type ContourPoint } from './autotile';
import { hashCell } from './decals';
import { TERRAIN_COLORS as C, WINTER_COLORS as W } from './terrain-palette';

/**
 * 双网格自适应边缘的纯逻辑层（不依赖 Pixi）。
 *
 * 两条纪律：
 * 1. **材质判定只有这一份**。`materialAt` 是桥压水、水压土、广场压草的唯一真相，
 *    渲染层不许再写第二份 if。
 * 2. **位掩码只驱动边缘，不重建区域几何**。区域轮廓仍是解析的（圆角矩形 / 多边形），
 *    8 邻掩码负责回答「这个点上隔壁是什么、转角该不该发圆弧」。
 *    把轮廓也交给 32px 采样格，土路末端与 120px 门洞会被量化到格点（ADR-0013 否决过）。
 */

/** 材质 ID：数值只用于 Uint8Array 存格，不参与渲染顺序 */
export type MaterialId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MATERIAL = {
  sea: 0,
  shallow: 1,
  sand: 2,
  grass: 3,
  dirt: 4,
  water: 5,
  bridge: 6,
} as const satisfies Record<string, MaterialId>;

/**
 * 绘制顺序 = 优先级从低到高。后画的盖先画的，与 `TerrainView.build()` 的既有层序一致。
 * 边缘层的绘制顺序与它无关：草缘永远最后压上（见 EDGE_DRAW_ORDER）。
 *
 * 广场不是材质（ADR-0017）：办公区地面就是草地，只靠一圈石色路缘与围栏标识。
 */
export const PAINT_ORDER: readonly MaterialId[] = [
  MATERIAL.sea,
  MATERIAL.shallow,
  MATERIAL.grass,
  MATERIAL.sand,
  MATERIAL.dirt,
  MATERIAL.water,
  MATERIAL.bridge,
];

/** 边缘层的绘制顺序：按「被覆盖」的先后，草地相关的边缘最后画 */
export const EDGE_DRAW_ORDER: readonly MaterialId[] = [
  MATERIAL.sand,
  MATERIAL.dirt,
  MATERIAL.water,
  MATERIAL.bridge,
];

/** 双网格采样格：与 autotile.TILE 同值，保证边缘判定与轮廓几何共用一个栅格 */
export const EDGE_TILE = 32;

const BRIDGES = WORLD_LAYOUT.bridges;
const PATHS = WORLD_LAYOUT.paths;
const LAKES = WORLD_LAYOUT.lakes;
const RIVERS = WORLD_LAYOUT.rivers;
const ISLAND_POINTS = ISLAND.points;
const SAND_SQ = ISLAND_SAND * ISLAND_SAND;
const SHALLOW_SQ = ISLAND_SHALLOW * ISLAND_SHALLOW;

/**
 * 某点的材质。顺序即优先级，先命中者胜：
 * 桥 > 水（湖/河）> 土路 > 岸沙带 > 草地 > 浅滩 > 海。
 *
 * 广场不是材质（ADR-0017）：办公区地面就是草地，只靠一圈石色路缘与围栏标识，
 * 判定里不再有 plaza 这一档，草缘与贴花在广场内外完全连续。
 *
 * 为什么水在土路之前：河道穿过土路时水面必须盖住路面（当前布局里只有桥头相交，
 * 但布局一改就会出现真的穿路），而桥又在最前面放行。
 */
export function materialAt(x: number, y: number): MaterialId {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return MATERIAL.sea;

  for (const bridge of BRIDGES) {
    if (rectContains(bridge, x, y)) return MATERIAL.bridge;
  }
  for (const lake of LAKES) {
    // 先过包围盒：湖面判定是 20 点多边形，逐点跑一遍太贵
    if (rectContains(lake.rect, x, y) && pointInPolygon(x, y, lake.points)) return MATERIAL.water;
  }
  for (const river of RIVERS) {
    if (rectContains(river.rect, x, y) && pointInPolygon(x, y, river.polygon)) return MATERIAL.water;
  }
  for (const path of PATHS) {
    if (rectContains(path, x, y)) return MATERIAL.dirt;
  }

  // 岸沙带以海岸线为中线的 26px 带：一半在水里一半在陆地
  const distance = distanceSqToPolygon(x, y, ISLAND_POINTS);
  if (distance <= SAND_SQ) return MATERIAL.sand;
  if (pointInPolygon(x, y, ISLAND_POINTS)) return MATERIAL.grass;
  if (distance <= SHALLOW_SQ) return MATERIAL.shallow;
  return MATERIAL.sea;
}

/* ------------------------------------------------------------------ *
 * 32px 材质网格：构造期扫一遍，之后取材质是 O(1)
 * ------------------------------------------------------------------ */

export interface MaterialGrid {
  readonly tile: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: Uint8Array;
}

export function buildMaterialGrid(tile: number = EDGE_TILE): MaterialGrid {
  const cols = Math.ceil(WORLD_WIDTH / tile);
  const rows = Math.ceil(WORLD_HEIGHT / tile);
  const cells = new Uint8Array(cols * rows);
  const half = tile / 2;
  for (let gy = 0; gy < rows; gy += 1) {
    const y = gy * tile + half;
    const row = gy * cols;
    for (let gx = 0; gx < cols; gx += 1) {
      cells[row + gx] = materialAt(gx * tile + half, y);
    }
  }
  return { tile, cols, rows, cells };
}

export function gridAt(grid: MaterialGrid, gx: number, gy: number): MaterialId {
  if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) return MATERIAL.sea;
  return grid.cells[gy * grid.cols + gx] as MaterialId;
}

/** 世界坐标取格：与构造期采样同相位（格心） */
export function gridSample(grid: MaterialGrid, x: number, y: number): MaterialId {
  const gx = Math.floor(x / grid.tile);
  const gy = Math.floor(y / grid.tile);
  return gridAt(grid, gx, gy);
}

/* ------------------------------------------------------------------ *
 * 8 邻位掩码：N E S W + NE SE SW NW
 * ------------------------------------------------------------------ */

export const EDGE_BIT = {
  n: 1,
  e: 2,
  s: 4,
  w: 8,
  ne: 16,
  se: 32,
  sw: 64,
  nw: 128,
} as const;

/** 八个方向：按位从低到高，顺时针 */
const DIRS: ReadonlyArray<{ bit: number; nx: number; ny: number }> = [
  { bit: EDGE_BIT.n, nx: 0, ny: -1 },
  { bit: EDGE_BIT.e, nx: 1, ny: 0 },
  { bit: EDGE_BIT.s, nx: 0, ny: 1 },
  { bit: EDGE_BIT.w, nx: -1, ny: 0 },
  { bit: EDGE_BIT.ne, nx: 1, ny: -1 },
  { bit: EDGE_BIT.se, nx: 1, ny: 1 },
  { bit: EDGE_BIT.sw, nx: -1, ny: 1 },
  { bit: EDGE_BIT.nw, nx: -1, ny: -1 },
];

/**
 * 8 邻掩码：位为 1 表示该方向相邻格不是 `self`。
 * 这是需求里「边缘判定位运算」的入口：后续所有草尖/圆弧/内凹都由它派生。
 */
export function edgeMaskAt(grid: MaterialGrid, x: number, y: number, self: MaterialId): number {
  const gx = Math.floor(x / grid.tile);
  const gy = Math.floor(y / grid.tile);
  let mask = 0;
  for (const dir of DIRS) {
    if (gridAt(grid, gx + dir.nx, gy + dir.ny) !== self) mask |= dir.bit;
  }
  return mask;
}

/**
 * 孤立斜角归一化：斜角邻居为异类、但两侧正交邻居都是同类时，
 * 这个斜角不构成真实边界（只是对角线擦到另一个区域），清掉。
 * 47 态拼贴里这类状态本来就不存在，不归一化会让状态数虚增。
 */
function normalizeMask(mask: number): number {
  let out = mask;
  const pairs: ReadonlyArray<readonly [number, number, number]> = [
    [EDGE_BIT.ne, EDGE_BIT.n, EDGE_BIT.e],
    [EDGE_BIT.se, EDGE_BIT.s, EDGE_BIT.e],
    [EDGE_BIT.sw, EDGE_BIT.s, EDGE_BIT.w],
    [EDGE_BIT.nw, EDGE_BIT.n, EDGE_BIT.w],
  ];
  for (const [corner, a, b] of pairs) {
    if ((out & corner) !== 0 && (out & a) === 0 && (out & b) === 0) out &= ~corner;
  }
  return out;
}

/** D4 群（4 旋转 × 2 镜像）的 8 个变换查找表，模块加载时一次算好 */
const TRANSFORMS: Uint8Array[] = (() => {
  const tables: Uint8Array[] = [];
  const transforms: Array<(x: number, y: number) => readonly [number, number]> = [
    (x, y) => [x, y],
    (x, y) => [-y, x],
    (x, y) => [-x, -y],
    (x, y) => [y, -x],
    (x, y) => [-x, y],
    (x, y) => [x, -y],
    (x, y) => [y, x],
    (x, y) => [-y, -x],
  ];
  for (const transform of transforms) {
    const table = new Uint8Array(256);
    for (let mask = 0; mask < 256; mask += 1) {
      let mapped = 0;
      for (const dir of DIRS) {
        if ((mask & dir.bit) === 0) continue;
        const [tx, ty] = transform(dir.nx, dir.ny);
        const hit = DIRS.find((candidate) => candidate.nx === tx && candidate.ny === ty);
        if (hit) mapped |= hit.bit;
      }
      table[mask] = mapped;
    }
    tables.push(table);
  }
  return tables;
})();

/**
 * 47 态归一化：先清掉孤立斜角，再把 8 邻掩码按旋转/镜像折叠成同一等价类。
 * 256 种输入收敛到 47 类以内，等价类用最小掩码表示。
 *
 * 注意：这里只做状态归类，**不查 47 张图集**——拼贴块会把材质相位切断（ADR-0013），
 * 边缘图元仍由 `edgeGlyphs` 按解析轮廓逐个生成。
 */
export function canonical47(mask: number): number {
  const normalized = normalizeMask(mask & 0xff);
  let best = normalized;
  for (const table of TRANSFORMS) {
    const value = table[normalized]!;
    if (value < best) best = value;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 边缘图元：全部是整数 rect，禁止 arc/ellipse/stroke 参与锯齿
 * ------------------------------------------------------------------ */

export interface EdgeGlyph {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}

export interface EdgeStyle {
  /** 内缘暗边：取本体色相压暗，禁止纯黑 */
  rim: number;
  rimWidth: 1 | 2;
  /** 齿色；null 表示这个材质不外扩（只有内缘暗边） */
  tooth: number | null;
  toothDeep: number;
  /** 齿长三档，由位置哈希选，奇数长度才有像素画的节奏 */
  toothLen: readonly number[];
  /** 沿轮廓撒齿的步长 */
  step: number;
  /** 外凸圆弧色；null 表示不发圆弧 */
  scallop: number | null;
  scallopEvery: number;
  scallopRadius: number;
}

export const EDGE_STYLE: Record<MaterialId, EdgeStyle> = {
  [MATERIAL.sea]: {
    rim: C.waterEdge,
    rimWidth: 1,
    tooth: null,
    toothDeep: C.seaBase,
    toothLen: [1],
    step: 10,
    scallop: null,
    scallopEvery: 0,
    scallopRadius: 0,
  },
  [MATERIAL.shallow]: {
    rim: C.waterEdge,
    rimWidth: 1,
    tooth: C.shoreShallow,
    toothDeep: C.waterMid,
    toothLen: [2, 3],
    step: 9,
    scallop: null,
    scallopEvery: 0,
    scallopRadius: 0,
  },
  [MATERIAL.sand]: {
    rim: C.sandEdge,
    rimWidth: 1,
    tooth: C.sandLight,
    toothDeep: C.sand,
    toothLen: [2, 3],
    step: 8,
    scallop: null,
    scallopEvery: 0,
    scallopRadius: 0,
  },
  [MATERIAL.grass]: {
    rim: C.grassDeep,
    rimWidth: 2,
    tooth: C.grassTuft,
    toothDeep: C.grassDeep,
    toothLen: [2, 3, 4],
    step: 6,
    scallop: C.grassAlt,
    scallopEvery: 46,
    scallopRadius: 4,
  },
  [MATERIAL.dirt]: {
    rim: C.dirtEdge,
    rimWidth: 2,
    tooth: C.grassTuft,
    toothDeep: C.grassDeep,
    toothLen: [2, 3, 4],
    step: 6,
    scallop: C.grassAlt,
    scallopEvery: 46,
    scallopRadius: 4,
  },
  [MATERIAL.water]: {
    rim: C.waterEdge,
    rimWidth: 2,
    tooth: C.waterFoam,
    toothDeep: C.waterCrest,
    toothLen: [1, 2],
    step: 8,
    scallop: null,
    scallopEvery: 0,
    scallopRadius: 0,
  },
  [MATERIAL.bridge]: {
    rim: C.bridgeSeam,
    rimWidth: 1,
    tooth: null,
    toothDeep: C.fenceLight,
    toothLen: [1],
    step: 10,
    scallop: null,
    scallopEvery: 0,
    scallopRadius: 0,
  },
};

/** 草是被地：只要对面是草，草色齿一律由草来长，不管自己是土、石还是沙 */
const GRASS_FRINGE = EDGE_STYLE[MATERIAL.grass];

/**
 * 冬季边缘（ADR-0046）：雪后的「地被」是雪，不是草。
 *
 * 只改草与土两档：草缘的描边从压暗的草绿换成雪影，齿色换成雪白；
 * 其余材质（水、沙、桥）沿用本体色压暗的夏季节奏——
 * 雪落在水面与沙滩上本来就会被冲淡，不换色反而更像「雪化了一半」。
 */
export const WINTER_EDGE_STYLE: Record<MaterialId, EdgeStyle> = {
  ...EDGE_STYLE,
  [MATERIAL.grass]: {
    ...EDGE_STYLE[MATERIAL.grass],
    rim: W.snowDeep,
    tooth: W.snowBase,
    toothDeep: W.snowShade,
    scallop: W.snowLight,
  },
  [MATERIAL.dirt]: {
    ...EDGE_STYLE[MATERIAL.dirt],
    tooth: W.snowBase,
    toothDeep: W.snowShade,
    scallop: W.snowLight,
  },
};

/** 冬季的「草」：雪从雪面长进土、石、水里 */
export const WINTER_GRASS_FRINGE = WINTER_EDGE_STYLE[MATERIAL.grass];

export interface EdgeGlyphOptions {
  /** 轮廓所属材质 */
  self: MaterialId;
  /** 轮廓外侧的邻居材质：决定齿色归属与外扩方向 */
  other: MaterialId;
  /**
   * 强制齿的生长方向。缺省规则是「对面是草就朝轮廓内侧长」——
   * 岸沙带的陆地侧是唯一的反例：沙在轮廓外侧、草在内侧，齿要朝外才能盖进沙里。
   */
  grow?: 'in' | 'out';
  seed?: number;
  /** 每段轮廓最多产出多少图元，防止病态轮廓把构造期拖爆 */
  cap?: number;
  /** 位掩码来源；缺省时只按几何撒齿，不查邻居 */
  grid?: MaterialGrid;
  /**
   * 齿色覆盖：冬季把「草往对面长」换成「雪往对面长」。
   * 缺省仍是夏季那套 EDGE_STYLE / GRASS_FRINGE，既有调用方与测试零改动。
   */
  fringe?: EdgeStyle;
}

/**
 * 沿轮廓生成草尖与外凸圆弧。
 *
 * 方向规则只有一条：**草往对面的材质里长**。
 * - 对面是草（土路、广场、湖岸、岸沙带）：齿朝轮廓内侧长，草盖住泥/石/水；
 * - 自己是草：齿朝外长；
 * - 其余配对（沙↔浅滩、水↔沙）：齿朝外长，用自己材质的色。
 */
export function edgeGlyphs(contour: readonly ContourPoint[], options: EdgeGlyphOptions): EdgeGlyph[] {
  const { self, other } = options;
  const seed = options.seed ?? 0x51ed270b;
  const cap = options.cap ?? 4096;
  const grid = options.grid;
  if (contour.length < 3) return [];

  const outward: ContourPoint[] = [...contour];
  if (contourSignedArea(contour) <= 0) outward.reverse();
  const fringe = options.fringe ?? (other === MATERIAL.grass ? GRASS_FRINGE : EDGE_STYLE[self]);
  const tooth = fringe.tooth ?? EDGE_STYLE[self].tooth;
  if (tooth === null && fringe.scallop === null) return [];

  const style = fringe;
  const toothDeep = fringe.toothDeep;
  /** 草往对面长 = 沿外法线反向；其余材质往外长 */
  const grow = options.grow ?? (other === MATERIAL.grass ? 'in' : 'out');
  const sign = grow === 'in' ? -1 : 1;
  const glyphs: EdgeGlyph[] = [];

  let lastState = -1;
  let sinceScallop = 0;
  let lastScallopX = Number.NEGATIVE_INFINITY;
  let lastScallopY = Number.NEGATIVE_INFINITY;

  /** 转角与周期可能在同一处各触发一次，12px 内只留一个圆弧，免得堆成瘤 */
  const scallop = (px: number, py: number, gx: number, gy: number, color: number): void => {
    if (Math.abs(px - lastScallopX) + Math.abs(py - lastScallopY) < 12) return;
    lastScallopX = px;
    lastScallopY = py;
    stampScallop(glyphs, px, py, gx, gy, style.scallopRadius, color, cap);
  };

  const visit = (x: number, y: number, nx: number, ny: number): void => {
    if (glyphs.length >= cap) return;
    const px = Math.round(x);
    const py = Math.round(y);

    if (grid) {
      // 探针向两侧各探 3px：只要有一侧是 other，这条边就成立。
      // 用解析材质而不是 32px 网格：网格格心离边界最多 16px，会把贴边的齿全判成异类。
      const outside = materialAt(px + nx * 3, py + ny * 3);
      const inside = materialAt(px - nx * 3, py - ny * 3);
      if (outside !== other && inside !== other) return;
      const state = canonical47(edgeMaskAt(grid, px, py, self));
      if (state !== lastState) {
        lastState = state;
        // 状态变化 = 转角：外侧补一个圆弧，尖角才不扎
        if (style.scallop !== null) {
          scallop(px, py, nx * sign, ny * sign, style.scallop);
          sinceScallop = 0;
        }
      }
    }

    const random = hashCell(px, py, seed);
    const detail = hashCell(px, py, seed ^ 0x9e37);
    const growX = nx * sign;
    const growY = ny * sign;

    sinceScallop += style.step;
    if (style.scallop !== null && style.scallopEvery > 0 && sinceScallop >= style.scallopEvery) {
      sinceScallop = 0;
      scallop(px, py, growX, growY, style.scallop);
    }

    // 三七开：七成探出、三成缩回，全是外突会变成一圈花边
    const outwardTooth = random > 0.28;
    if (!outwardTooth) return;
    if (tooth === null) return;

    const lengths = style.toothLen;
    const length = lengths[Math.floor(detail * lengths.length) % lengths.length]!;
    const color = detail > 0.68 ? toothDeep : tooth;
    // 斜向法线（圆弧段）按主轴取横/竖齿，齿永远落在整数像素上
    if (Math.abs(growY) >= Math.abs(growX)) {
      const top = growY > 0 ? py : py - length + 1;
      glyphs.push({ x: px, y: top, w: 1, h: length, color });
      if (detail > 0.82) {
        // 偶尔来一撮两像素宽的草，边缘才不是整齐的梳子
        const side = px + (detail > 0.9 ? 1 : -1);
        glyphs.push({ x: side, y: growY > 0 ? py : py - length, w: 1, h: length, color });
      }
    } else {
      const left = growX > 0 ? px : px - length + 1;
      glyphs.push({ x: left, y: py, w: length, h: 1, color });
      if (detail > 0.82) {
        const side = py + (detail > 0.9 ? 1 : -1);
        glyphs.push({ x: growX > 0 ? px : px - length, y: side, w: length, h: 1, color });
      }
    }
  };

  walkContour(outward, style.step, visit);
  return glyphs;
}

/** 沿轮廓按弧长等距走一遍，带回外法线（顺时针轮廓的外法线是 (dy, -dx)） */
function walkContour(
  contour: readonly ContourPoint[],
  step: number,
  visit: (x: number, y: number, nx: number, ny: number) => void,
): void {
  let carry = 0;
  for (let i = 0; i < contour.length; i += 1) {
    const a = contour[i]!;
    const b = contour[(i + 1) % contour.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    const nx = dy / len;
    const ny = -dx / len;
    let t = carry;
    while (t < len) {
      visit(a.x + (dx * t) / len, a.y + (dy * t) / len, nx, ny);
      t += step;
    }
    carry = t - len;
  }
}

/** 半圆凸起：贴边一行最宽，往里逐渐收窄，肉眼看就是草边鼓出来一块 */
function stampScallop(
  out: EdgeGlyph[],
  px: number,
  py: number,
  gx: number,
  gy: number,
  radius: number,
  color: number,
  cap: number,
): void {
  if (radius <= 0) return;
  if (Math.abs(gy) >= Math.abs(gx)) {
    const dir = gy > 0 ? 1 : -1;
    for (let row = 0; row < radius; row += 1) {
      const half = Math.round(Math.sqrt(radius * radius - row * row));
      if (half <= 0) continue;
      out.push({ x: px - half, y: py + dir * row, w: half * 2, h: 1, color });
      if (out.length >= cap) return;
    }
    return;
  }
  const dir = gx > 0 ? 1 : -1;
  for (let col = 0; col < radius; col += 1) {
    const half = Math.round(Math.sqrt(radius * radius - col * col));
    if (half <= 0) continue;
    out.push({ x: px + dir * col, y: py - half, w: 1, h: half * 2, color });
    if (out.length >= cap) return;
  }
}
