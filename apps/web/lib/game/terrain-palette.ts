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

  /** 中央石砖圆庭（ADR-0047）：暖灰石底 + 同色相压暗的砖缝 */
  stoneBase: 0xbbb2a0,
  stoneAlt: 0xc6bdaa,
  stoneLight: 0xd8cfbb,
  stoneSeam: 0x8f8574,
  stoneEdge: 0x6f6656,
  /** 广场外圈路缘：深缝压外沿，石色面层向内收 */
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

  /** 边界外林地（ADR-0064）：比草地压暗两档的深绿，只做四边密林的脚下底色 */
  wildBase: 0x2b4a34,
  wildMid: 0x34573c,
  wildCrest: 0x3f6746,

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
  /** 林间落叶：琥珀 / 熟褐 / 浅金三档，与金盏同色系但不抢花海 */
  leafAmber: 0xd8a04a,
  leafRust: 0xa8724a,
  leafGold: 0xe8c47a,
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
  /** 竹笋（ADR-0061）：笋身两档青绿 + 一档笋壳熟褐，与芦苇同族但更嫩 */
  bambooShoot: 0x9fd07a,
  bambooShootDark: 0x5d9a52,
  bambooHusk: 0x8a6a44,
} as const;

/**
 * 冬季色板（ADR-0046）：只有在 `winter` 为真时才被取用，夏季配色一格不动。
 *
 * 纪律与夏季同一套：雪不是纯白（纯白会把画面拉成一张蒙版、也压不住暖色角色），
 * 暗部不是灰色而是带蓝相的雪影；冰只做细边，不做整片盖水面——
 * 一整片冰会让「水」读成「另一种地面」。
 */
export const WINTER_COLORS = {
  /** 雪面主体：略偏米蓝的暖白，比 #fff 低一档明度才托得住角色 */
  snowBase: 0xe9f0f7,
  /** 受光面：只用于雪堆顶与树冠雪帽 */
  snowLight: 0xf6fafd,
  /** 堆与堆之间的接触暗部 */
  snowShade: 0xd3dfec,
  /** 雪缘齿尖与冰棱根部，不铺大面积 */
  snowDeep: 0xb4c6d9,
  /** 岸边薄冰 */
  iceBase: 0xcbe6f0,
  iceEdge: 0x8fb6c8,
  iceDeep: 0x6f97ac,
  /** 灯串暖光：夜间柔光下浮出来 */
  bulbWarm: 0xffd08a,
  bulbCore: 0xfff3d0,
  /** 脚印：雪面的蓝灰，不是泥色，否则读成「地上有脏点」 */
  footprint: 0xa9bccf,

  /** 冬季水面：更冷更淡，波纹对比压低 */
  waterDeep: 0x5b90a6,
  waterMid: 0x6fa7bb,
  waterCrest: 0x9cc9d6,
  waterFoam: 0xc4e0e8,
  waterEdge: 0x356c80,
  /** 冬季林地：比夏季更冷更暗，雪只落在枝头，林下仍是深色的 */
  wildBase: 0x273a33,
  wildMid: 0x2f453c,
  wildCrest: 0x395347,
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
  stone: TERRAIN_COLORS.stoneEdge,
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
  /** 边界外的密林：小地图先铺这层，岛外不再读成「海」 */
  wild: cssColor(TERRAIN_COLORS.wildBase),
  shore: cssColor(TERRAIN_COLORS.sand),
  ground: cssColor(TERRAIN_COLORS.grassAlt),
  forest: cssColor(TERRAIN_COLORS.forestFloor),
  forestDot: cssColor(TERRAIN_COLORS.canopyMid),
  meadow: cssColor(TERRAIN_COLORS.meadowTint),
  /** 三种花海在主视图里只露几像素，小地图用同色系更亮的点提示 */
  flowerWhite: cssColor(TERRAIN_COLORS.flowerPetal),
  flowerGold: cssColor(TERRAIN_COLORS.petalGold),
  flowerRose: cssColor(TERRAIN_COLORS.petalRose),
  /** 中央石砖圆庭：浅石色填充 + 深缝描边 */
  stone: cssColor(TERRAIN_COLORS.stoneAlt),
  plazaCurb: cssColor(TERRAIN_COLORS.plazaCurb),
  dirt: cssColor(TERRAIN_COLORS.dirtBase),
  sand: cssColor(TERRAIN_COLORS.sandLight),
  water: cssColor(TERRAIN_COLORS.waterMid),
  fence: cssColor(TERRAIN_COLORS.fenceRail),
  self: '#4fe3c1',
  other: '#f4ede1',
} as const;
