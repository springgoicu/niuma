import { describe, expect, it } from 'bun:test';
import { BUILTIN_LEXICON } from '@niuma/shared-types';
import { auditLexicon, loadModerationFilter } from './moderation';

describe('auditLexicon', () => {
  it('数组替换整类，对象追加到内置表', () => {
    const audit = auditLexicon({
      political: ['甲'],
      profanity: { mode: 'append', words: ['乙'] },
    });

    expect(audit.counts.political).toBe(1);
    expect(audit.lexicon.profanity).toContain('乙');
    expect(audit.lexicon.profanity).toHaveLength(BUILTIN_LEXICON.profanity.length + 1);
    expect(audit.issues).toEqual([]);
  });

  it('未声明的类别沿用内置表', () => {
    const audit = auditLexicon({ profanity: ['丙'] });
    expect(audit.lexicon.political).toEqual(BUILTIN_LEXICON.political);
  });

  it('剔除非法词条并逐条记账，不回显词条内容', () => {
    const audit = auditLexicon({ political: [1, '  ', '超'.repeat(33), '合法'] });

    expect(audit.lexicon.political).toEqual(['合法']);
    expect(audit.issues).toHaveLength(3);
    expect(audit.issues.join('\n')).not.toContain('超超');
  });

  it('根节点格式错误时整体退回内置', () => {
    const audit = auditLexicon([]);
    expect(audit.lexicon.political).toEqual(BUILTIN_LEXICON.political);
    expect(audit.issues[0]).toContain('root');
  });

  it('单类格式错误只影响该类', () => {
    const audit = auditLexicon({ political: '不是数组', profanity: ['丁'] });

    expect(audit.lexicon.political).toEqual(BUILTIN_LEXICON.political);
    expect(audit.lexicon.profanity).toEqual(['丁']);
    expect(audit.issues).toHaveLength(1);
  });

  it('同一类里重复词条只保留一份', () => {
    const audit = auditLexicon({ political: ['甲', '甲'] });
    expect(audit.lexicon.political).toEqual(['甲']);
  });
});

describe('loadModerationFilter', () => {
  it('路径为空时用内置词库', () => {
    const filter = loadModerationFilter('');
    expect(filter.counts.political).toBe(BUILTIN_LEXICON.political.length);
    expect(filter.counts.profanity).toBe(BUILTIN_LEXICON.profanity.length);
  });

  it('文件缺失时退回内置词库而不是抛错', () => {
    const filter = loadModerationFilter('/definitely/not/here/lexicon.json');
    expect(filter.counts.political).toBe(BUILTIN_LEXICON.political.length);
  });
});
