/**
 * 地形调色板：主视图与小小地图共用同一组颜色，避免「缩略图和世界不是同一张图」。
 * 全部走暗色苔绿体系，与现有 HUD / 角色图集保持同一个低饱和基调。
 */

export const TERRAIN_COLORS = {
  grassBase: 0x141d15,
  grassAlt: 0x172117,
  grassTuft: 0x223026,
  grassStone: 0x2c3a2e,

  forestFloor: 0x101a12,
  forestTuft: 0x18251a,

  plazaBase: 0x0f150f,
  plazaAlt: 0x171f18,
  plazaSeam: 0x0a0f0a,
  plazaHighlight: 0x1c261d,
  plazaEdge: 0x22301f,
  plazaCurb: 0x2f3a2d,

  dirtBase: 0x2f2a20,
  dirtAlt: 0x362f24,
  dirtRut: 0x26221a,
  dirtPebble: 0x453d2d,

  sand: 0x4a4232,
  sandLight: 0x5a5140,

  waterDeep: 0x122830,
  waterMid: 0x1a3741,
  waterCrest: 0x23515a,
  waterFoam: 0x2f6870,

  canopyEdge: 0x0a1710,
  canopyDeep: 0x12301b,
  canopyMid: 0x1d4a29,
  canopyLight: 0x2c6538,

  trunkDark: 0x1f1811,
  trunkLight: 0x362a1d,

  fenceDark: 0x24201a,
  fenceRail: 0x5a4a33,
  fenceLight: 0x766443,

  bridgeWood: 0x4a3d2b,
  bridgeSeam: 0x332a1e,
  bridgeRail: 0x6b5a3e,

  rock: 0x3a4238,
  rockLight: 0x55604f,
  reed: 0x3f6b3a,
  reedLight: 0x5c8a4e,
} as const;

/** canvas 2D 只吃 CSS 颜色，小地图统一从这里转换 */
export function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * 小地图提亮版：168px 画布上 1px 的水面与林地如果直接用主视图原色，
 * 会和面板底色糊成一片黑。色相保持一致，只抬明度。
 */
export const MINIMAP_COLORS = {
  ground: '#1a2a1e',
  forest: '#14211a',
  forestDot: '#2f6538',
  plaza: '#39463a',
  plazaEdge: '#4b5a49',
  dirt: cssColor(TERRAIN_COLORS.sand),
  sand: '#7a6a4c',
  water: cssColor(TERRAIN_COLORS.waterMid),
  bridge: '#8a7550',
  fence: '#a08a5e',
  self: '#4fe3c1',
  other: '#9fb0a1',
} as const;
