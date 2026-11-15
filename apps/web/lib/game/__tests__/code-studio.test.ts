import { describe, expect, it } from 'bun:test';
import {
  CODE_STUDIO_FILES,
  CODE_STUDIO_TERMINAL,
  resolveStudioFile,
  tokenizeLine,
} from '../code-studio';

/** 收集一行里的全部着色，方便断言「这段被认成了什么」 */
function tones(line: string, language = 'TypeScript'): string[] {
  return tokenizeLine(line, language).map((token) => token.tone);
}

describe('代码工位内容', () => {
  it('文件 id 唯一，每个文件都有行且按声明顺序排列', () => {
    const ids = CODE_STUDIO_FILES.map((file) => file.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('readme');
    for (const file of CODE_STUDIO_FILES) {
      expect(file.lines.length).toBeGreaterThan(0);
      expect(file.language.length).toBeGreaterThan(0);
      expect(file.path.endsWith(file.name)).toBe(true);
    }
  });

  it('空行用不换行空格占位，渲染出来不会塌成 0 高', () => {
    for (const file of CODE_STUDIO_FILES) {
      for (const line of file.lines) {
        expect(line.length).toBeGreaterThan(0);
        expect(line.every((token) => token.text.includes('\n'))).toBe(false);
      }
    }
  });

  it('未知 id 回落到第一个文件，不返回 undefined', () => {
    expect(resolveStudioFile(CODE_STUDIO_FILES, 'not-exist').id).toBe(CODE_STUDIO_FILES[0].id);
    expect(resolveStudioFile(CODE_STUDIO_FILES, 'boss-hp').id).toBe('boss-hp');
  });

  it('终端日志至少有一行命令与一行收尾', () => {
    expect(CODE_STUDIO_TERMINAL.length).toBeGreaterThanOrEqual(4);
    expect(CODE_STUDIO_TERMINAL[0].text.startsWith('$')).toBe(true);
    const last = CODE_STUDIO_TERMINAL[CODE_STUDIO_TERMINAL.length - 1];
    expect(last.tone).toBe('string');
  });

  it('高亮认得出注释、字符串、关键字、数字与函数名', () => {
    expect(tones('// 加班费按 0 元结算')).toEqual(['comment']);
    expect(tones("const label = '刚好够本';")).toContain('keyword');
    expect(tones("const label = '刚好够本';")).toContain('string');
    expect(tones('if (minutes >= 480) return label;')).toContain('number');
    expect(tones('bookOvertime(hours);')).toContain('function');
    expect(tones('const ticket: OvertimeTicket = value;')).toContain('type');
  });

  it('JSON 的键画成类型色，值仍走字符串色', () => {
    const key = tokenizeLine('  "name": "niuma-park",', 'JSON');
    expect(key.find((token) => token.text === '"name"')?.tone).toBe('type');
    expect(key.find((token) => token.text === '"niuma-park"')?.tone).toBe('string');
  });

  it('Markdown 只把标题与引用上色', () => {
    expect(tones('# 牛马园区 · 工位终端', 'Markdown')).toEqual(['keyword']);
    expect(tones('> 工作写进代码里', 'Markdown')).toEqual(['comment']);
    expect(tones('普通一行正文', 'Markdown')).toEqual(['plain']);
  });
});
