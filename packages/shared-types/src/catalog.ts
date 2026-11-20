import type { Species } from './types';

/**
 * 目录用于把语义化字符串压成 1 字节索引。
 * 新增条目只允许追加，禁止插入或重排，否则破坏历史包语义。
 */
export const PATTERN_IDS = ['none', 'spots', 'socks'] as const;
export const SNOUT_IDS = ['wide', 'long'] as const;
export const HORN_IDS = ['none', 'spike', 'curve', 'broken'] as const;
export const MANE_IDS = ['short', 'long', 'mohawk'] as const;
export const TAIL_IDS = ['tuft', 'long'] as const;

/**
 * 配件目录：18 年是「工牌 / 领带 / 嘴里叼着」，48px 的大头小身下胸口只剩 16×5 格，
 * 这三处怎么摆都读不出来，ADR-0007 换成头顶、眼线、颈线三处承载。
 * 顺序与旧目录对齐（intern→grad / dev→cap / pm→beret / ops→helmet / boss→top），
 * 旧档的字节值会落到语义相近的帽子上，而不是随机一件。
 *
 * ADR-0011：原本挂在身后的背包（laptop / briefcase）在大头比例下完全被躯干挡住，
 * 槽位改画发型；字节编号仍是 [30]，旧档的 1/2 会落到寸头 / 齐刘海。
 */
/**
 * ADR-0061：国风件全部追加在末尾。
 * 头饰 6→9、颈饰 3→5、发型 5→7；字节编号仍是 `[27..30]` 各一字节，
 * 32 字节外观编码不需要改协议，旧档的字节值语义保持原样。
 *
 * 警用件（保安专用）继续追加在末尾：头饰 9、颈饰 6；护士帽（ADR-0084）头饰 10。
 * 捏人界面会过滤掉这三件，只有服务端 NPC 的保安 / 护士档案会使用它们。
 */
export const HEADWEAR_IDS = [
  'none',
  'grad',
  'cap',
  'beret',
  'helmet',
  'top',
  'god_of_wealth',
  'bamboo_hat',
  'curse_hoop',
  'police_cap',
  // 护士帽（ADR-0084）同样只给服务端 NPC 用，追加在末尾避免旧档字节漂移
  'nurse_cap',
  // ADR-0088：黄金安全帽 / 皇冠（只许追加，旧档字节值语义不变）
  'golden_helmet',
  'crown',
  // Stage 1：秃头假发 / 外卖头盔（只许追加）
  'balding_wig',
  'delivery_helmet',
] as const;
export const EYEWEAR_IDS = [
  'none',
  'round',
  'sun',
  'monocle',
  // ADR-0088：赛博墨镜 / 金丝眼镜
  'cyber_shades',
  'gold_rim_glasses',
] as const;
export const NECKWEAR_IDS = [
  'none',
  'scarf',
  'collar',
  'phones',
  'chinese_knot',
  'jade_pendant',
  'epaulette',
  // ADR-0088：大金链 / 红围巾
  'gold_chain',
  'red_scarf',
] as const;
export const HAIR_IDS = ['none', 'buzz', 'bangs', 'ponytail', 'afro', 'slick', 'topknot', 'braid'] as const;

export type PatternId = (typeof PATTERN_IDS)[number];
export type SnoutId = (typeof SNOUT_IDS)[number];
export type HornId = (typeof HORN_IDS)[number];
export type ManeId = (typeof MANE_IDS)[number];
export type TailId = (typeof TAIL_IDS)[number];
export type HeadwearId = (typeof HEADWEAR_IDS)[number];
export type EyewearId = (typeof EYEWEAR_IDS)[number];
export type NeckwearId = (typeof NECKWEAR_IDS)[number];
export type HairId = (typeof HAIR_IDS)[number];

export function catalogIndexOf(catalog: readonly string[], value: string | undefined): number {
  if (!value) return 0;
  const idx = catalog.indexOf(value);
  return idx < 0 ? 0 : idx;
}

export function catalogValue(catalog: readonly string[], index: number): string {
  return catalog[index] ?? catalog[0]!;
}

/** 牛角 / 鬃毛共用一个字节槽，按物种解释 */
export function extraCatalogFor(species: Species): readonly string[] {
  return species === 'cow' ? HORN_IDS : MANE_IDS;
}

/** 每个物种可选的斑纹 / 口鼻 / 尾巴数量，服务端钳制用 */
export const SPECIES_LIMITS: Record<
  Species,
  { patterns: number; snouts: number; extras: number; tails: number }
> = {
  cow: { patterns: PATTERN_IDS.length, snouts: SNOUT_IDS.length, extras: HORN_IDS.length, tails: TAIL_IDS.length },
  horse: { patterns: PATTERN_IDS.length, snouts: SNOUT_IDS.length, extras: MANE_IDS.length, tails: TAIL_IDS.length },
};
