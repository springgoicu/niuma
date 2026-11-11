/**
 * 内容审核的类别与裁决结果（ADR-0028）。
 *
 * 两类词条对应两种处置，不是同一种「拦截」：
 * - political：政治类，整条内容拒绝——聊天不广播，昵称不允许上岗；
 * - profanity：污言秽语，整条放行，但把命中的原文区间打码成 `*`。
 */
export const MODERATION_CATEGORY = {
  Political: 'political',
  Profanity: 'profanity',
} as const;

export type ModerationCategory = (typeof MODERATION_CATEGORY)[keyof typeof MODERATION_CATEGORY];

/**
 * 词表：两类各一份。内置表在 `lexicon.ts`，
 * 服务端可用外部文件覆盖或追加，最终都收敛成这个结构再建索引。
 */
export type ModerationLexicon = Readonly<Record<ModerationCategory, readonly string[]>>;

/** allow 原样放行 / mask 打码后放行 / reject 整条拒绝 */
export type ModerationVerdict = 'allow' | 'mask' | 'reject';

export interface ModerationResult {
  verdict: ModerationVerdict;
  /** 命中的类别；allow 为 null。同时命中两类时按政治类裁决 */
  category: ModerationCategory | null;
  /** mask 时是打码后的文本，其余情况与入参完全相同 */
  text: string;
  /** 合并后的命中区间数，只用于日志与统计，不携带命中内容 */
  hits: number;
}
