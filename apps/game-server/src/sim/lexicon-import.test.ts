import { describe, expect, it } from 'bun:test';
import { MODERATION_CATEGORY } from '@niuma/shared-types';
import { classifySource, importLexicon, parseWordList, serializeLexicon } from './lexicon-import';

describe('parseWordList', () => {
  it('每行一词', () => {
    expect(parseWordList('甲\n乙\n\n丙\n')).toEqual(['甲', '乙', '丙']);
  });

  it('整表逗号分隔，中英文逗号与竖线、制表符都认', () => {
    expect(parseWordList('甲,乙，丙|丁\t戊')).toEqual(['甲', '乙', '丙', '丁', '戊']);
  });

  it('去 BOM、跳过注释行与空行', () => {
    expect(parseWordList('\ufeff# 注释\n// 另一行\n甲\n  \n')).toEqual(['甲']);
  });

  it('剔除超长词条与控制字符', () => {
    const tooLong = '长'.repeat(33);
    expect(parseWordList(`甲\n${tooLong}\n乙\u0000`)).toEqual(['甲']);
  });
});

describe('classifySource', () => {
  it('按文件名判定政治类与低俗类', () => {
    expect(classifySource('政治类.txt')).toBe(MODERATION_CATEGORY.Political);
    expect(classifySource('涉枪涉爆违法信息关键词.txt')).toBe(MODERATION_CATEGORY.Political);
    expect(classifySource('低俗辱骂.txt')).toBe(MODERATION_CATEGORY.Profanity);
  });

  it('判不出来的一律 null，不猜', () => {
    expect(classifySource('色情类.txt')).toBeNull();
    expect(classifySource('sensitive-lexicon.txt')).toBeNull();
    expect(classifySource('广告.txt')).toBeNull();
  });
});

describe('importLexicon', () => {
  it('多份来源合并、同类别去重', () => {
    const report = importLexicon([
      { name: '政治类.txt', text: '甲\n乙' },
      { name: '涉枪涉爆.txt', text: '乙\n丙' },
    ]);

    expect(report.lexicon.political).toEqual(['甲', '乙', '丙']);
    expect(report.counts).toEqual({ political: 3, profanity: 0 });
    // 没有内容的类别不写进文件，服务端才会继续用内置表
    expect(report.lexicon.profanity).toBeUndefined();
  });

  it('显式类别覆盖文件名推断', () => {
    const report = importLexicon([
      { name: 'sensitive-lexicon.txt', text: '甲', category: MODERATION_CATEGORY.Political },
    ]);
    expect(report.lexicon.political).toEqual(['甲']);
    expect(report.skipped).toEqual([]);
  });

  it('判不出类别的来源被跳过并说明原因', () => {
    const report = importLexicon([{ name: '色情类.txt', text: '甲' }]);
    expect(report.counts).toEqual({ political: 0, profanity: 0 });
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toContain('--political');
  });

  it('疑似非 UTF-8 的词库给出告警但仍然记账', () => {
    const report = importLexicon([{ name: '政治类.txt', text: '甲\n\ufffd\ufffd' }]);
    expect(report.issues.join('\n')).toContain('UTF-8');
    expect(report.counts.political).toBeGreaterThan(0);
  });
});

describe('serializeLexicon', () => {
  it('输出可被 JSON.parse 的 UTF-8 明文，中文不转义', () => {
    const json = serializeLexicon({ political: ['甲'] });
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('甲');
    expect(JSON.parse(json)).toEqual({ political: ['甲'] });
  });
});
