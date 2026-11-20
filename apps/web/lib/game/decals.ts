'use client';

/** 贴花种类与顺序同时决定图集里的帧号，两端只认这一份常量 */
export const DECAL_KINDS = [
  'clover',
  'daisy',
  'grassTip',
  'pebble',
  'bloomWhite',
  'bloomGold',
  'bloomRose',
  'leaf',
  'shoot',
  'bloomLavender',
  'petalPink',
] as const;
export type DecalKind = (typeof DECAL_KINDS)[number];

/** 基础草地层只撒前四种：花只长在花海里与零散点缀层 */
export const GROUND_DECAL_KINDS: readonly number[] = [0, 1, 2, 3];
/** 前三种花海贴花在 DECAL_KINDS 里的起点 */
export const BLOOM_KIND_BASE = 4;
/** 林间落叶：只在树丛半径内单独撒，不混进基础草地层 */
export const LEAF_KINDS: readonly number[] = [DECAL_KINDS.indexOf('leaf')];
/** 落樱瓣：只长在樱林 / 蓝花楹林下 */
export const PETAL_KINDS: readonly number[] = [DECAL_KINDS.indexOf('petalPink')];
/** 竹笋（ADR-0061）：只长在竹林区，别处一株都不冒 */
export const SHOOT_KINDS: readonly number[] = [DECAL_KINDS.indexOf('shoot')];
const LAVENDER_KIND = DECAL_KINDS.indexOf('bloomLavender');
/** 花海贴花在单个花田里的种类：0 白雏菊 / 1 金盏 / 2 暖粉 / 3 熏衣草 */
export function bloomDecalKind(palette: 0 | 1 | 2 | 3): number {
  if (palette === 3) return LAVENDER_KIND;
  return BLOOM_KIND_BASE + palette;
}
/** 全岛零散野花的种类池 */
export const WILDFLOWER_KINDS: readonly number[] = [
  BLOOM_KIND_BASE,
  BLOOM_KIND_BASE + 1,
  BLOOM_KIND_BASE + 2,
  LAVENDER_KIND,
];

/**
 * 贴花撒点：纯放置逻辑，不依赖 Pixi。
 *
 * 三条纪律：
 * 1. 用位置哈希而不是顺序随机——同一格在任何时候算出来的值都一样，
 *    视口来回移动不会让同一片草地的三叶草换位置；
 * 2. 基础层命中概率 0.24（大厅倍率降到 1.5 后视口面积翻四倍，原来的 0.12 会显得草地很秃），
 *    花海与野花层各自覆写概率与种类池；
 * 3. 是否允许生成由调用方注入（岛内、非水面、非土路），
 *    这样地形规则变了不用改这个模块。
 */

/**
 * 栅格边长：与 32px 采样格成整数倍，贴花不会压在 autotile 的草缘上。
 * 加密只动概率不动格距——56 / 72 都不是 32 的倍数，改了要连带重算草缘（ADR-0015）。
 */
export const DECAL_CELL = 64;
export const DECAL_CHANCE = 0.24;

export interface DecalPlacement {
  /** 索引到 DECAL_KINDS */
  kind: number;
  x: number;
  y: number;
  /** 水平镜像：七张贴花靠翻转让同一套图看起来更多 */
  flip: boolean;
}

export interface DecalBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 单格是否允许生成 */
export type DecalField = (x: number, y: number) => boolean;

/**
 * 位置哈希（Wang hash 变体）：只读 (x, y, seed)，不持有状态。
 * 用 Math.imul 而不是浮点乘法，保证各引擎结果逐位一致。
 */
export function hashCell(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function scatterDecals(
  bounds: DecalBounds,
  allow: DecalField,
  seed: number = 0x6d2b79f5,
  chance: number = DECAL_CHANCE,
  kinds: readonly number[] = GROUND_DECAL_KINDS,
): DecalPlacement[] {
  const pool = kinds.length > 0 ? kinds : GROUND_DECAL_KINDS;
  const placements: DecalPlacement[] = [];
  const from = Math.floor(bounds.x / DECAL_CELL);
  const to = Math.ceil((bounds.x + bounds.w) / DECAL_CELL);
  const top = Math.floor(bounds.y / DECAL_CELL);
  const bottom = Math.ceil((bounds.y + bounds.h) / DECAL_CELL);

  for (let cy = top; cy < bottom; cy += 1) {
    for (let cx = from; cx < to; cx += 1) {
      if (hashCell(cx, cy, seed) >= chance) continue;
      // 格内抖动：落在格心附近，贴花不会排成方阵
      const x = Math.round(cx * DECAL_CELL + (0.2 + hashCell(cx, cy, seed + 0x11) * 0.6) * DECAL_CELL);
      const y = Math.round(cy * DECAL_CELL + (0.25 + hashCell(cx, cy, seed + 0x23) * 0.65) * DECAL_CELL);
      if (x < bounds.x || x > bounds.x + bounds.w || y < bounds.y || y > bounds.y + bounds.h) continue;
      if (!allow(x, y)) continue;
      placements.push({
        kind: pool[Math.floor(hashCell(cx, cy, seed + 0x37) * pool.length) % pool.length]!,
        x,
        y,
        flip: hashCell(cx, cy, seed + 0x4b) > 0.5,
      });
    }
  }
  return placements;
}
