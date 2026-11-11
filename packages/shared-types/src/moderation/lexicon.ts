import type { ModerationLexicon } from './types';

/**
 * 内置词库（ADR-0028）。
 *
 * **政治类只放中性占位条目。** 真实词条必须由合规清单提供，由运维写成
 * `GAME_MODERATION_LEXICON` 指向的 JSON 注入——仓库不内置真实条目，词库来源才可审计。
 * 占位条目的作用只有一个：让匹配链路在联调与单测里可验证。
 *
 * 词条写正常写法即可，不需要手写「傻 逼」「傻*逼」这类变体：
 * 匹配前会先做 NFKC、去噪、叠字折叠与数字替换（见 `normalize.ts`）。
 */
export const BUILTIN_LEXICON: ModerationLexicon = {
  political: ['示例敏感词甲', '示例敏感词乙'],
  profanity: [
    // 起步词表，按线上误报逐步调整；外置文件可以整体替换或追加
    '傻逼',
    '沙比',
    '煞笔',
    '脑残',
    '智障',
    '白痴',
    '狗东西',
    '贱人',
    '草泥马',
    '滚蛋',
    '去死',
    'fuck',
    'shit',
    'bitch',
  ],
};
