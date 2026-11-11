/**
 * 内容审核：昵称与聊天共用的一套匹配引擎（ADR-0028）。
 *
 * 对外只有两个入口：
 * - `inspectText`：内置词库，客户端即时预校验用；
 * - `createModerationFilter`：显式传入词表，服务端加载外部文件后建自己的实例。
 * 规范化、trie、打码区间都藏在这两个入口后面，调用方不需要知道细节。
 */
export * from './types';
export { BUILTIN_LEXICON } from './lexicon';
export { createModerationFilter, getBuiltinFilter, inspectText, type ModerationFilter } from './matcher';
export { normalizeWithMap, type NormalizedText } from './normalize';
