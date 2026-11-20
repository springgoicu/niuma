'use client';

import {
  PLAZA_CENTER,
  WORLD_LAYOUT,
  type GroveTheme,
  type TreeSpecies,
  type WorldRect,
} from '@niuma/shared-types';
import { cssColor } from './terrain-palette';

/**
 * 9 大景观植物色板与生态地表样式（浮世绘绘本暖调 × 赛博公园分色）。
 *
 * 纪律：
 * - 色板全部带色相，绝不使用纯黑 `0x000000` / 纯白 `0xffffff` / 中性死灰；
 * - 最暗轮廓色向深靛或对应暗色相偏移；
 * - 树种优先读取 `tree.species`，缺失时退回 `speciesAt(x, y)` 区域纯函数。
 */

export type TreeSpeciesId = TreeSpecies;

/** 索引顺序 = 贴图与图集数组顺序（前 5 位兼容旧序，后 4 位为重塑新增） */
export const TREE_SPECIES_ORDER: readonly TreeSpeciesId[] = [
  'ginkgo',
  'holly',
  'maple',
  'pine',
  'willow',
  'sakura',
  'jacaranda',
  'cypress',
  'osmanthus',
] as const;

export interface TreeSpeciesPalette {
  readonly trunk: number;
  readonly trunkLight: number;
  readonly canopyEdge: number;
  readonly canopyDeep: number;
  readonly canopyMid: number;
  readonly canopyLight: number;
  readonly canopyGlow: number;
}

export const TREE_SPECIES: Record<TreeSpeciesId, TreeSpeciesPalette> = {
  /** 金秋银杏：扇形金冠，南生活半岛与西大道暖金出口 */
  ginkgo: {
    trunk: 0x5c4128,
    trunkLight: 0x8a6544,
    canopyEdge: 0x8a5a24,
    canopyDeep: 0xa8724a,
    canopyMid: 0xd8a04a,
    canopyLight: 0xe8c47a,
    canopyGlow: 0xf4dc9f,
  },
  /** 修剪冬青：生活区浓绿圆冠，托起暖砖庭院 */
  holly: {
    trunk: 0x4b3a26,
    trunkLight: 0x6f5a3c,
    canopyEdge: 0x24452e,
    canopyDeep: 0x2f5c39,
    canopyMid: 0x3f7647,
    canopyLight: 0x57945b,
    canopyGlow: 0xd96b63, // 微小红果点缀
  },
  /** 羽毛红枫：西北与西岬枫红，霓虹灯牌前的秋色对比 */
  maple: {
    trunk: 0x54331f,
    trunkLight: 0x7d4f33,
    canopyEdge: 0x5e2a20,
    canopyDeep: 0x7a3a2a,
    canopyMid: 0xa8543c,
    canopyLight: 0xc97852,
    canopyGlow: 0xdf9e75,
  },
  /** 迎客罗汉松：浮世绘云片苍松，墨绿松针间露蜿蜒虬枝 */
  pine: {
    trunk: 0x4a3a2e,
    trunkLight: 0x6d5945,
    canopyEdge: 0x26382c,
    canopyDeep: 0x354a39,
    canopyMid: 0x49604a,
    canopyLight: 0x6b7f63,
    canopyGlow: 0x8ca184,
  },
  /** 湖畔垂柳：细长柳丝低垂掠水，黄绿枝梢带风动感 */
  willow: {
    trunk: 0x584430,
    trunkLight: 0x7f6a4c,
    canopyEdge: 0x3f5c34,
    canopyDeep: 0x5d7f4a,
    canopyMid: 0x7fa863,
    canopyLight: 0xa8c886,
    canopyGlow: 0xc8e0a4,
  },
  /** 染井吉野樱：北游乐岬云团樱花，珊瑚粉瓣配深樱树皮 */
  sakura: {
    trunk: 0x4d3439,
    trunkLight: 0x755258,
    canopyEdge: 0x8c4a60,
    canopyDeep: 0xb56680,
    canopyMid: 0xe396ac,
    canopyLight: 0xf5becd,
    canopyGlow: 0xfbe2e8,
  },
  /** 蓝花楹：东岸半岛梦幻紫云伞冠，冷调紫蓝对话赛博街区 */
  jacaranda: {
    trunk: 0x594a42,
    trunkLight: 0x7f6c61,
    canopyEdge: 0x473a78,
    canopyDeep: 0x5d4f9c,
    canopyMid: 0x7d6ec2,
    canopyLight: 0xa597df,
    canopyGlow: 0xcbc2f0,
  },
  /** 地中海丝柏：修长高耸青黛塔形针冠，破开横向天际线 */
  cypress: {
    trunk: 0x4c3a2d,
    trunkLight: 0x6d5645,
    canopyEdge: 0x1e3832,
    canopyDeep: 0x2a4f44,
    canopyMid: 0x3b6c5a,
    canopyLight: 0x528d74,
    canopyGlow: 0x71ad91,
  },
  /** 八月金桂：油润青绿叶团间点缀蜜金桂簇 */
  osmanthus: {
    trunk: 0x56422c,
    trunkLight: 0x7b6244,
    canopyEdge: 0x334e2a,
    canopyDeep: 0x476838,
    canopyMid: 0x64884b,
    canopyLight: 0xd9a745,
    canopyGlow: 0xf2cf72,
  },
};

export interface GroveFloorThemeStyle {
  readonly fill: number;
  readonly rim: number;
  readonly petalFill: number;
  readonly alpha: number;
}

/** 6 大树丛生态林下地被配色 */
export const GROVE_FLOOR_STYLE: Record<GroveTheme, GroveFloorThemeStyle> = {
  sakura: { fill: 0x6f7f56, rim: 0x5c7246, petalFill: 0xe396ac, alpha: 0.42 },
  ginkgo: { fill: 0x6c7c48, rim: 0x566b3a, petalFill: 0xdca54b, alpha: 0.4 },
  maple: { fill: 0x6b6c46, rim: 0x575b39, petalFill: 0xb85f42, alpha: 0.4 },
  pine: { fill: 0x456b48, rim: 0x345539, petalFill: 0x4d7350, alpha: 0.44 },
  willow: { fill: 0x5a8552, rim: 0x466d42, petalFill: 0x91ba75, alpha: 0.38 },
  jacaranda: { fill: 0x5b6c5c, rim: 0x45584c, petalFill: 0x9888d4, alpha: 0.42 },
};

/** 预计算小地图各树种圆点 CSS 色值，帧内零字符串拼接 */
export const MINIMAP_TREE_COLORS: Record<TreeSpeciesId, string> = {
  ginkgo: cssColor(TREE_SPECIES.ginkgo.canopyMid),
  holly: cssColor(TREE_SPECIES.holly.canopyMid),
  maple: cssColor(TREE_SPECIES.maple.canopyMid),
  pine: cssColor(TREE_SPECIES.pine.canopyMid),
  willow: cssColor(TREE_SPECIES.willow.canopyMid),
  sakura: cssColor(TREE_SPECIES.sakura.canopyMid),
  jacaranda: cssColor(TREE_SPECIES.jacaranda.canopyMid),
  cypress: cssColor(TREE_SPECIES.cypress.canopyMid),
  osmanthus: cssColor(TREE_SPECIES.osmanthus.canopyLight),
};

const WILLOW_BAND = 360;
const DISTRICT_SPLIT = 700;
const LAKES = WORLD_LAYOUT.lakes;

function distanceToRect(rect: WorldRect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/** 坐标 → 默认生态树种（纯函数确定性回退） */
export function speciesAt(x: number, y: number): TreeSpeciesId {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'pine';
  for (const lake of LAKES) {
    if (distanceToRect(lake.rect, x, y) <= WILLOW_BAND) return 'willow';
  }
  if (x > PLAZA_CENTER.x + DISTRICT_SPLIT && y < PLAZA_CENTER.y + 400) return 'jacaranda';
  if (x < PLAZA_CENTER.x - DISTRICT_SPLIT) return y < PLAZA_CENTER.y ? 'maple' : 'cypress';
  if (y < PLAZA_CENTER.y - DISTRICT_SPLIT) return 'sakura';
  if (y > PLAZA_CENTER.y + DISTRICT_SPLIT) return x > PLAZA_CENTER.x + 200 ? 'osmanthus' : 'holly';
  const dx = x - PLAZA_CENTER.x;
  const dy = y - PLAZA_CENTER.y;
  if (dx * dx + dy * dy < DISTRICT_SPLIT * DISTRICT_SPLIT) return 'ginkgo';
  return 'pine';
}

export function speciesIndexOf(species: TreeSpeciesId): number {
  const index = TREE_SPECIES_ORDER.indexOf(species);
  return index < 0 ? 0 : index;
}

/** 物种在 `TREE_SPECIES_ORDER` 里的索引 */
export function speciesIndexAt(x: number, y: number): number {
  return speciesIndexOf(speciesAt(x, y));
}
