/**
 * 地形调色板：主视图、小地图与落地页共用同一组颜色，避免「缩略图和世界不是同一张图」。
 *
 * 色温纪律（ADR-0013）：
 * 1. 全站走暖色低饱和 pastel——奶油草地、沙色土路、浅湖绿水面，不再使用深苔绿暗调；
 * 2. 任何描边 / 暗边都是「本体色相压暗」的结果（见 EDGE_TINT），
 *    禁止 #000000 与不带色相的中性黑；深苔绿、深栗棕、深湖蓝才是允许的最暗档；
 * 3. 明度阶梯只留两到三档：地面越花，角色越出不来。
 */

export const TERRAIN_COLORS = {
  grassBase: 0x6f9b57,
  grassAlt: 0x7aa862,
  grassTuft: 0x8fbd72,
  grassStone: 0xa79c88,
  /** 草缘内侧的压暗档：草与土交界处的第一层，仍带绿相 */
  grassDeep: 0x3d5c33,

  forestFloor: 0x557f4a,
  forestTuft: 0x5a854c,
  /** 花海草甸：比草地亮半档、偏暖，叠在草底上才看得出「一片」 */
  meadowTint: 0x8fb06a,
  meadowShade: 0x79a15c,

  /** 广场不再铺地砖（ADR-0017）：只留一圈石色路缘，深缝压外沿 */
  plazaSeam: 0xb3a284,
  plazaCurb: 0xc9b998,

  /** 土路本体：低饱和粉彩暖棕；带一点灰，近看才不像橘色 */
  dirtBase: 0xc8a27a,
  dirtAlt: 0xd1ae86,
  dirtRut: 0xa8875c,
  dirtPebble: 0xe0c9a3,
  /** 土路内缘的暗边：深栗棕，替代原来的炭黑 */
  dirtEdge: 0x7a5f3c,

  sand: 0xd9c096,
  sandLight: 0xe7d2ac,
  sandEdge: 0x8f7a52,

  waterDeep: 0x4f9fb0,
  waterMid: 0x63b3c2,
  waterCrest: 0x86ccd8,
  waterFoam: 0xa9e0e8,
  waterEdge: 0x2f6f86,

  seaBase: 0x2f6f86,
  seaMid: 0x3d8299,
  seaCrest: 0x55a0b5,
  seaFoam: 0x74bccd,
  shoreShallow: 0x5aa3b6,

  canopyEdge: 0x24452e,
  canopyDeep: 0x2f5c39,
  canopyMid: 0x3f7647,
  canopyLight: 0x57945b,
  canopyGlow: 0x6fae68,

  /** 贴花用色：雏菊的花瓣与花心，同样不带纯白与纯黑 */
  flowerPetal: 0xf2e7cd,
  /** 白花的暗边：暖米灰，压一档明度 */
  petalShade: 0xd6c9ad,
  flowerCore: 0xe8b44a,
  /** 金盏：花瓣比花心亮，暗边是熟褐黄 */
  petalGold: 0xf0cd78,
  petalGoldDeep: 0xc98f38,
  /** 暖粉：花瓣取设计系统的 #E0A9A0，暗边是同色相压暗 */
  petalRose: 0xe0a9a0,
  petalRoseDeep: 0xc4827b,
  decalStone: 0xb9ae99,

  /** 大物件底座投影：冷靛蓝 0x1E2846 @0.2，暖地面上不能落纯黑 */
  propShadow: 0x1e2846,

  trunkDark: 0x5c4128,
  trunkLight: 0x8a6544,

  fenceDark: 0x6b4a30,
  fenceRail: 0xb08a5c,
  fenceLight: 0xcbab7e,

  bridgeWood: 0xa87a4c,
  bridgeSeam: 0x7a5636,
  bridgeRail: 0xd0b184,

  rock: 0xa9a293,
  rockLight: 0xc3baa8,
  reed: 0x7fa863,
  reedLight: 0xa8c886,
} as const;

/**
 * 描边表：每一种材质的边界取本体色的深色混合态。
 * 全部是「色相不变、明度压到 40% 上下」，没有一个中性黑——
 * 纯黑描边会把 warm pastel 拉回廉价马赛克感。
 */
export const EDGE_TINT = {
  grass: TERRAIN_COLORS.grassDeep,
  dirt: TERRAIN_COLORS.dirtEdge,
  sand: TERRAIN_COLORS.sandEdge,
  water: TERRAIN_COLORS.waterEdge,
  canopy: TERRAIN_COLORS.canopyEdge,
  trunk: TERRAIN_COLORS.trunkDark,
  fence: TERRAIN_COLORS.fenceDark,
  bridge: TERRAIN_COLORS.bridgeSeam,
} as const;

/** canvas 2D 只吃 CSS 颜色，小地图统一从这里转换 */
export function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * 小地图专用色：168px 画布上直接用主视图原色会和面板底色糊成一片，
 * 这里保持色相一致、只抬明度，暖色体系下不再需要「提亮版」这层补偿。
 */
export const MINIMAP_COLORS = {
  sea: cssColor(TERRAIN_COLORS.seaBase),
  shore: cssColor(TERRAIN_COLORS.sand),
  ground: cssColor(TERRAIN_COLORS.grassAlt),
  forest: cssColor(TERRAIN_COLORS.forestFloor),
  forestDot: cssColor(TERRAIN_COLORS.canopyMid),
  meadow: cssColor(TERRAIN_COLORS.meadowTint),
  /** 三种花海在主视图里只露几像素，小地图用同色系更亮的点提示 */
  flowerWhite: cssColor(TERRAIN_COLORS.flowerPetal),
  flowerGold: cssColor(TERRAIN_COLORS.petalGold),
  flowerRose: cssColor(TERRAIN_COLORS.petalRose),
  /** 广场只画路缘：小地图与主视图都不能再出现浅色块 */
  plazaCurb: cssColor(TERRAIN_COLORS.plazaCurb),
  dirt: cssColor(TERRAIN_COLORS.dirtBase),
  sand: cssColor(TERRAIN_COLORS.sandLight),
  water: cssColor(TERRAIN_COLORS.waterMid),
  bridge: cssColor(TERRAIN_COLORS.bridgeWood),
  fence: cssColor(TERRAIN_COLORS.fenceRail),
  self: '#4fe3c1',
  other: '#f4ede1',
} as const;
