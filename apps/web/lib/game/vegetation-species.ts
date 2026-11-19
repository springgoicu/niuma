'use client';

import { PLAZA_CENTER, WORLD_LAYOUT, type WorldRect } from '@niuma/shared-types';

/**
 * 树种派生（去国风重塑）：把「全岛一种绿」换成五类现代景观树。
 *
 * 为什么是纯函数而不是改布局：
 * `WORLD_LAYOUT.groves / looseTrees` 已有 `variant` 字段，但一套 variant
 * 既要喂给渲染、又要与服务端共享，扩字段会牵动 51KB 的 `layout.ts` 与双端同步。
 * 这里只按坐标派生物种，渲染层照旧按索引取贴图，契约一行未动。
 *
 * 纪律：色板全部带色相，最暗档不是纯黑；五类之间靠色温与轮廓区分，
 * 不靠增加明度档数——地面越花，角色越出不来。
 */

export type TreeSpeciesId = 'ginkgo' | 'holly' | 'maple' | 'pine' | 'willow';

/** 索引顺序 = 图集/贴图数组顺序，只允许尾部追加 */
export const TREE_SPECIES_ORDER: readonly TreeSpeciesId[] = ['ginkgo', 'holly', 'maple', 'pine', 'willow'];

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
  /** 金黄银杏：企业区与中央广场的行道树，秋日暖金的唯一出口 */
  ginkgo: {
    trunk: 0x5c4128,
    trunkLight: 0x8a6544,
    canopyEdge: 0x8a5a24,
    canopyDeep: 0xa8724a,
    canopyMid: 0xd8a04a,
    canopyLight: 0xe8c47a,
    canopyGlow: 0xf2d79a,
  },
  /** 球形冬青：南区生活区的修剪球，深绿压住暖调地面 */
  holly: {
    trunk: 0x4b3a26,
    trunkLight: 0x6f5a3c,
    canopyEdge: 0x24452e,
    canopyDeep: 0x2f5c39,
    canopyMid: 0x3f7647,
    canopyLight: 0x57945b,
    canopyGlow: 0x6fae68,
  },
  /** 羽毛枫：北区娱乐街，红铜低饱和，给霓虹垫一层暖底 */
  maple: {
    trunk: 0x54331f,
    trunkLight: 0x7d4f33,
    canopyEdge: 0x5e2a20,
    canopyDeep: 0x7a3a2a,
    canopyMid: 0xa8543c,
    canopyLight: 0xc97852,
    canopyGlow: 0xdc9a72,
  },
  /** 罗汉松：中庭与茶院的云片状松针，冷墨绿 */
  pine: {
    trunk: 0x4a3a2e,
    trunkLight: 0x6d5945,
    canopyEdge: 0x26382c,
    canopyDeep: 0x354a39,
    canopyMid: 0x49604a,
    canopyLight: 0x6b7f63,
    canopyGlow: 0x8ca184,
  },
  /** 湖畔垂柳：长条垂丝贴着水面，黄绿最亮的一档留给枝条尖端 */
  willow: {
    trunk: 0x584430,
    trunkLight: 0x7f6a4c,
    canopyEdge: 0x3f5c34,
    canopyDeep: 0x5d7f4a,
    canopyMid: 0x7fa863,
    canopyLight: 0xa8c886,
    canopyGlow: 0xc4dca0,
  },
};

/** 湖岸柳带的宽度：柳树只长在离水面这个距离以内，湿地外圈仍是银杏/冬青 */
const WILLOW_BAND = 360;
/** 辖区判定的分界：以广场圆心为基准，五个方向各画一条软边界 */
const DISTRICT_SPLIT = 700;

const LAKES = WORLD_LAYOUT.lakes;

/** 点到矩形的欧氏距离：湖面用矩形粗筛即可，柳带不需要跑 16 点多边形 */
function distanceToRect(rect: WorldRect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/**
 * 坐标 → 树种。判定顺序即优先级：
 * 1. 湖岸柳带（最高，湿地感只在水边成立）；
 * 2. 西侧企业区 → 银杏（冷灰建筑前唯一的暖金）；
 * 3. 北侧娱乐街 → 羽毛枫（红铜压霓虹）；
 * 4. 南侧生活区 → 冬青球（修剪感）；
 * 5. 广场半径内 → 银杏；
 * 6. 其余中庭/林缘 → 罗汉松。
 *
 * 纯函数、无随机、不读时间：同一个坐标永远同一个物种，视口来回移动不会变脸。
 */
export function speciesAt(x: number, y: number): TreeSpeciesId {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'pine';
  for (const lake of LAKES) {
    if (distanceToRect(lake.rect, x, y) <= WILLOW_BAND) return 'willow';
  }
  if (x < PLAZA_CENTER.x - DISTRICT_SPLIT) return 'ginkgo';
  if (y < PLAZA_CENTER.y - DISTRICT_SPLIT) return 'maple';
  if (y > PLAZA_CENTER.y + DISTRICT_SPLIT) return 'holly';
  const dx = x - PLAZA_CENTER.x;
  const dy = y - PLAZA_CENTER.y;
  if (dx * dx + dy * dy < DISTRICT_SPLIT * DISTRICT_SPLIT) return 'ginkgo';
  return 'pine';
}

/** 物种在 `TREE_SPECIES_ORDER` 里的索引，渲染层直接拿去取贴图 */
export function speciesIndexAt(x: number, y: number): number {
  const index = TREE_SPECIES_ORDER.indexOf(speciesAt(x, y));
  return index < 0 ? 0 : index;
}
