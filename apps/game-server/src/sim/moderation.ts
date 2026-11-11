import { readFileSync } from 'node:fs';
import {
  BUILTIN_LEXICON,
  createModerationFilter,
  MODERATION_CATEGORY,
  type ModerationCategory,
  type ModerationFilter,
  type ModerationLexicon,
} from '@niuma/shared-types';

/** 单条词条上限：昵称只有 16 个码点，更长的词条永远不可能整段命中 */
const MAX_TERM_CHARS = 32;
/** 单类词条上限：挡住误配的大文件把 trie 撑爆 */
const MAX_TERMS = 20_000;

const CATEGORIES = [MODERATION_CATEGORY.Political, MODERATION_CATEGORY.Profanity] as const;

export interface LexiconAudit {
  /** 合并后的词表：未在文件里出现的类别沿用内置表 */
  lexicon: ModerationLexicon;
  counts: Record<ModerationCategory, number>;
  /** 逐条问题描述：只带类别与序号，不回显词条内容 */
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验并清洗一类词条：非字符串、空串、超长、控制字符一律剔除并记账 */
function sanitizeTerms(category: string, input: readonly unknown[]): { terms: string[]; issues: string[] } {
  const terms: string[] = [];
  const seen = new Set<string>();
  const issues: string[] = [];

  input.forEach((item, index) => {
    if (typeof item !== 'string') {
      issues.push(`${category}[${index}] is not a string`);
      return;
    }
    const term = item.trim();
    if (term.length === 0) {
      issues.push(`${category}[${index}] is empty`);
      return;
    }
    if ([...term].length > MAX_TERM_CHARS) {
      issues.push(`${category}[${index}] exceeds ${MAX_TERM_CHARS} chars`);
      return;
    }
    if (/[\u0000-\u001f\u007f]/.test(term)) {
      issues.push(`${category}[${index}] contains control chars`);
      return;
    }
    if (seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  });

  if (terms.length > MAX_TERMS) {
    issues.push(`${category} truncated to ${MAX_TERMS} terms`);
    terms.length = MAX_TERMS;
  }

  return { terms, issues };
}

function countTerms(lexicon: ModerationLexicon): Record<ModerationCategory, number> {
  return {
    political: lexicon.political.length,
    profanity: lexicon.profanity.length,
  };
}

/**
 * 解析外部词库（纯函数，便于自检脚本与单测复用）。
 *
 * 文件格式：
 * - `["词", "词"]`：整类替换内置表；
 * - `{ "mode": "append", "words": ["词"] }`：在内置表后追加；
 * - `{ "mode": "replace", "words": ["词"] }`：显式替换。
 * 文件里没写的类别继续用内置表；任何一类格式不对只影响该类，不阻断启动。
 */
export function auditLexicon(raw: unknown, base: ModerationLexicon = BUILTIN_LEXICON): LexiconAudit {
  const issues: string[] = [];
  const lexicon: Record<ModerationCategory, readonly string[]> = {
    political: base.political,
    profanity: base.profanity,
  };

  if (!isRecord(raw)) {
    issues.push('root must be an object like { "political": [...], "profanity": [...] }');
    return { lexicon, counts: countTerms(lexicon), issues };
  }

  for (const category of CATEGORIES) {
    const value = raw[category];
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      const { terms, issues: local } = sanitizeTerms(category, value);
      issues.push(...local);
      lexicon[category] = terms;
      continue;
    }

    if (isRecord(value) && (value.mode === 'append' || value.mode === 'replace') && Array.isArray(value.words)) {
      const { terms, issues: local } = sanitizeTerms(category, value.words);
      issues.push(...local);
      lexicon[category] =
        value.mode === 'append' ? [...new Set([...base[category], ...terms])] : terms;
      continue;
    }

    issues.push(`${category} is neither an array nor { mode, words }, keeping builtin list`);
  }

  return { lexicon, counts: countTerms(lexicon), issues };
}

/**
 * 进程启动时建一次过滤器。外部文件缺失、JSON 非法或整份格式错误都退回内置词库——
 * 内容审核不该成为服务器起不来的原因。
 */
export function loadModerationFilter(lexiconPath: string): ModerationFilter {
  if (lexiconPath.length === 0) {
    const filter = createModerationFilter(BUILTIN_LEXICON);
    console.log(
      `[moderation] lexicon source=builtin political=${filter.counts.political} profanity=${filter.counts.profanity}`,
    );
    return filter;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(lexiconPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[moderation] external lexicon unusable (${detail}), fallback to builtin: ${lexiconPath}`);
    return createModerationFilter(BUILTIN_LEXICON);
  }

  const audit = auditLexicon(raw);
  for (const issue of audit.issues) console.warn(`[moderation] ${issue}`);

  const filter = createModerationFilter(audit.lexicon);
  console.log(
    `[moderation] lexicon source=file political=${filter.counts.political} profanity=${filter.counts.profanity} issues=${audit.issues.length}`,
  );
  return filter;
}
