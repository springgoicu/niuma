import { MODERATION_CATEGORY, type ModerationCategory } from '@niuma/shared-types';

/**
 * 开源词库导入（ADR-0028 的运维侧工具）。
 *
 * 只做「把外部词表规整成本项目的两类」，不联网、不内置任何词条：
 * 开源词库由使用方自行 clone，词条不经过本仓库。
 */

/** 与 `auditLexicon` 同一条上限：导入时就裁掉，别留到服务端启动日志里 */
export const MAX_IMPORT_TERM_CHARS = 32;
export const MAX_IMPORT_TERMS = 20_000;

/** 文件名里出现这些词就归为政治类 */
const POLITICAL_HINTS = ['政治', '时政', '暴恐', '违禁', '涉枪', '涉爆'];

/** 文件名里出现这些词就归为污言秽语 */
const PROFANITY_HINTS = ['辱骂', '低俗', '脏话', '谩骂', '不文明'];

export interface ImportSource {
  /** 来源文件名，用于分类推断与报告，不参与匹配 */
  name: string;
  text: string;
  /** 显式指定类别；缺省时按文件名推断 */
  category?: ModerationCategory;
}

export interface ImportReport {
  /** 只包含有内容的类别：未提供的类别让服务端继续用内置表 */
  lexicon: Partial<Record<ModerationCategory, string[]>>;
  counts: Record<ModerationCategory, number>;
  /** 无法判定类别而跳过的来源：`文件名：原因` */
  skipped: string[];
  /** 词条级问题计数与来源级问题描述 */
  issues: string[];
}

/**
 * 按文件名推断类别。
 *
 * 刻意保守：只认明确的分类文件名。像 `sensitive-lexicon.txt` 这种混合词库判不出来，
 * 直接跳过并提示用 `--political` / `--profanity` 显式指定——把混合词库整份塞进政治类，
 * 会让脏话也变成「整条拒绝」，体验是坏的。
 */
export function classifySource(name: string): ModerationCategory | null {
  const lower = name.toLowerCase();
  if (POLITICAL_HINTS.some((hint) => name.includes(hint) || lower.includes(hint))) {
    return MODERATION_CATEGORY.Political;
  }
  if (PROFANITY_HINTS.some((hint) => name.includes(hint) || lower.includes(hint))) {
    return MODERATION_CATEGORY.Profanity;
  }
  return null;
}

/** 词条是否可入库：非空、不超长、不含控制字符 */
function isUsableTerm(term: string): boolean {
  if (term.length === 0) return false;
  if ([...term].length > MAX_IMPORT_TERM_CHARS) return false;
  if (/[\u0000-\u001f\u007f]/.test(term)) return false;
  return true;
}

/**
 * 解析一份词表文本。
 *
 * 开源词库两种写法都常见：**每行一词**，或**整表逗号分隔**。这里按行切，
 * 行内再按中英文逗号 / 竖线 / 制表符切——词条本身不会含这些符号。
 */
export function parseWordList(text: string): string[] {
  const out: string[] = [];
  // Windows 编辑器常带 BOM，它会被当成词条的第一个字符，必须先去
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;

    for (const piece of line.split(/[,，|、\t]/)) {
      const term = piece.trim();
      if (isUsableTerm(term)) out.push(term);
    }
  }

  return out;
}

/** 把多份来源合并成 lexicon；同一类别内去重，超出上限截断 */
export function importLexicon(sources: readonly ImportSource[]): ImportReport {
  const buckets = new Map<ModerationCategory, Set<string>>([
    [MODERATION_CATEGORY.Political, new Set()],
    [MODERATION_CATEGORY.Profanity, new Set()],
  ]);
  const skipped: string[] = [];
  const issues: string[] = [];

  for (const source of sources) {
    const category = source.category ?? classifySource(source.name);
    if (!category) {
      skipped.push(`${source.name}: 文件名无法判定类别，请用 --political / --profanity 显式指定`);
      continue;
    }
    // GBK 词库按 UTF-8 读会得到成片的替换字符，宁可不导也别把乱码灌进去
    if (source.text.includes('\ufffd')) {
      issues.push(`${source.name}: 文本含替换字符，可能不是 UTF-8，请先转码`);
    }
    const bucket = buckets.get(category)!;
    for (const term of parseWordList(source.text)) bucket.add(term);
  }

  const lexicon: Partial<Record<ModerationCategory, string[]>> = {};
  const counts: Record<ModerationCategory, number> = { political: 0, profanity: 0 };

  for (const [category, bucket] of buckets) {
    if (bucket.size === 0) continue;
    let terms = [...bucket];
    if (terms.length > MAX_IMPORT_TERMS) {
      issues.push(`${category}: 超过 ${MAX_IMPORT_TERMS} 条，已截断`);
      terms = terms.slice(0, MAX_IMPORT_TERMS);
    }
    lexicon[category] = terms;
    counts[category] = terms.length;
  }

  return { lexicon, counts, skipped, issues };
}

/** 输出服务端 `GAME_MODERATION_LEXICON` 直接可读的 JSON */
export function serializeLexicon(lexicon: Partial<Record<ModerationCategory, string[]>>): string {
  // 中文不转义：词库是要人读、要进 code review 的
  return `${JSON.stringify(lexicon, null, 2)}\n`;
}
