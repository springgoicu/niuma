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

export const BADGE_IDS = ['none', 'intern', 'dev', 'pm', 'ops', 'boss'] as const;
export const TIE_IDS = ['none', 'crimson', 'navy', 'striped', 'bow'] as const;
export const MOUTH_IDS = ['none', 'coffee', 'grass', 'pen'] as const;
export const BACK_IDS = ['none', 'laptop', 'briefcase'] as const;

export type PatternId = (typeof PATTERN_IDS)[number];
export type SnoutId = (typeof SNOUT_IDS)[number];
export type HornId = (typeof HORN_IDS)[number];
export type ManeId = (typeof MANE_IDS)[number];
export type TailId = (typeof TAIL_IDS)[number];
export type BadgeId = (typeof BADGE_IDS)[number];
export type TieId = (typeof TIE_IDS)[number];
export type MouthId = (typeof MOUTH_IDS)[number];
export type BackId = (typeof BACK_IDS)[number];

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
