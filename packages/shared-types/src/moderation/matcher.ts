import { BUILTIN_LEXICON } from './lexicon';
import { normalizeWithMap, type NormalizedText } from './normalize';
import {
  MODERATION_CATEGORY,
  type ModerationCategory,
  type ModerationLexicon,
  type ModerationResult,
} from './types';

/**
 * 单条词条上限：昵称只有 16 个码点，再长的词条永远不可能整段命中，
 * 留在索引里只会拖慢构建。
 */
const MAX_TERM_CHARS = 16;

const CATEGORY_BIT: Readonly<Record<ModerationCategory, number>> = {
  [MODERATION_CATEGORY.Political]: 1,
  [MODERATION_CATEGORY.Profanity]: 2,
};

interface TrieNode {
  /** 叶子用 null 而不是空 Map：数万词条时省下的一半内存不是小数 */
  children: Map<string, TrieNode> | null;
  /** 位掩码：1 政治 / 2 脏话；同一个词可以同时属于两类 */
  categories: number;
}

export interface ModerationFilter {
  inspect(text: string): ModerationResult;
  /** 两类实际参与匹配的词条数，供启动日志与 /health 观察 */
  readonly counts: Readonly<Record<ModerationCategory, number>>;
}

function insert(root: TrieNode, word: string, bit: number): void {
  let node = root;
  for (const ch of word) {
    if (node.children === null) node.children = new Map();
    let child = node.children.get(ch);
    if (!child) {
      child = { children: null, categories: 0 };
      node.children.set(ch, child);
    }
    node = child;
  }
  node.categories |= bit;
}

function buildTrie(lexicon: ModerationLexicon): {
  root: TrieNode;
  counts: Record<ModerationCategory, number>;
} {
  const root: TrieNode = { children: null, categories: 0 };
  const counts: Record<ModerationCategory, number> = { political: 0, profanity: 0 };

  for (const category of [MODERATION_CATEGORY.Political, MODERATION_CATEGORY.Profanity] as const) {
    const seen = new Set<string>();
    for (const raw of lexicon[category] ?? []) {
      const word = normalizeWithMap(raw).value;
      if (word.length === 0 || [...word].length > MAX_TERM_CHARS) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      insert(root, word, CATEGORY_BIT[category]);
    }
    counts[category] = seen.size;
  }

  return { root, counts };
}

/**
 * 把命中区间映射回原文并覆盖成 `*`。
 * 规范化会丢弃字符，所以区间要按 `start` / `end` 回查；相邻区间先合并，
 * 同一段文字被多个词条重复命中时只打一次码。
 */
function maskRanges(
  text: string,
  normalized: NormalizedText,
  flat: number[],
): { text: string; spans: number } {
  const chars = Array.from(text);
  let spanStart = -1;
  let spanEnd = -1;
  let spans = 0;

  const paint = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) chars[k] = '*';
  };

  for (let i = 0; i < flat.length; i += 2) {
    const from = normalized.start[flat[i]!]!;
    const to = normalized.end[flat[i + 1]! - 1]!;
    if (spanStart < 0) {
      spanStart = from;
      spanEnd = to;
      continue;
    }
    if (from <= spanEnd) {
      if (to > spanEnd) spanEnd = to;
      continue;
    }
    paint(spanStart, spanEnd);
    spans += 1;
    spanStart = from;
    spanEnd = to;
  }

  if (spanStart >= 0) {
    paint(spanStart, spanEnd);
    spans += 1;
  }

  return { text: chars.join(''), spans };
}

function inspectWithTrie(root: TrieNode, text: string): ModerationResult {
  const normalized = normalizeWithMap(text);
  const value = normalized.value;
  if (value.length === 0) return { verdict: 'allow', category: null, text, hits: 0 };

  const political = CATEGORY_BIT[MODERATION_CATEGORY.Political];
  const profanity = CATEGORY_BIT[MODERATION_CATEGORY.Profanity];
  const ranges: number[] = [];

  for (let i = 0; i < value.length; i += 1) {
    let node: TrieNode | undefined = root;
    for (let j = i; j < value.length; j += 1) {
      node = node.children?.get(value[j]!);
      if (!node) break;
      // 政治类一旦命中就没有继续扫的意义：整条内容都不会发出去
      if ((node.categories & political) !== 0) {
        return { verdict: 'reject', category: MODERATION_CATEGORY.Political, text, hits: 1 };
      }
      if ((node.categories & profanity) !== 0) ranges.push(i, j + 1);
      if (node.children === null) break;
    }
  }

  if (ranges.length === 0) return { verdict: 'allow', category: null, text, hits: 0 };
  const masked = maskRanges(text, normalized, ranges);
  return {
    verdict: 'mask',
    category: MODERATION_CATEGORY.Profanity,
    text: masked.text,
    hits: masked.spans,
  };
}

/**
 * 用给定词表建一个匹配器。trie 在构建期一次建好，请求路径只做走查，
 * 不分配节点、不查表；服务端在进程启动时建一次，客户端用内置词库的懒加载单例。
 */
export function createModerationFilter(lexicon: ModerationLexicon): ModerationFilter {
  const { root, counts } = buildTrie(lexicon);
  return {
    inspect: (text) => inspectWithTrie(root, text),
    counts,
  };
}

let builtin: ModerationFilter | null = null;

/** 内置词库的匹配器：首次调用时构建，之后复用 */
export function getBuiltinFilter(): ModerationFilter {
  builtin ??= createModerationFilter(BUILTIN_LEXICON);
  return builtin;
}

/** 客户端即时预校验与服务端兜底共用这一个入口 */
export function inspectText(text: string): ModerationResult {
  return getBuiltinFilter().inspect(text);
}
