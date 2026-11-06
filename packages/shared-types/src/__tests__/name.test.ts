import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  MAX_NAME_CHARS,
  MAX_NAME_DISPLAY_UNITS,
  clampNameLength,
  decodeHello,
  displayWidth,
  encodeHello,
  truncateToDisplayWidth,
} from '..';

describe('昵称显示宽度', () => {
  it('半角算 1、全角算 2', () => {
    expect(displayWidth('intern')).toBe(6);
    expect(displayWidth('加班牛马')).toBe(8);
    expect(displayWidth('加班ab')).toBe(6);
    expect(displayWidth('')).toBe(0);
  });

  it('emoji 与全角标点按 2 宽计，零宽修饰不占位', () => {
    expect(displayWidth('🐮')).toBe(2);
    expect(displayWidth('，')).toBe(2);
    // 肤色修饰符不额外占位
    expect(displayWidth('👍🏽')).toBe(2);
  });

  it('按码点遍历，不会把代理对切成半个字符', () => {
    const truncated = truncateToDisplayWidth('🐮🐴🐮🐴🐮🐴', 5);
    expect(truncated).toBe('🐮🐴…');
    expect(displayWidth(truncated)).toBeLessThanOrEqual(5);
  });
});

describe('昵称截断', () => {
  it('不超宽时原样返回', () => {
    expect(truncateToDisplayWidth('夜班实习生', MAX_NAME_DISPLAY_UNITS)).toBe('夜班实习生');
    expect(truncateToDisplayWidth('abcdefghijklmnop', MAX_NAME_DISPLAY_UNITS)).toBe('abcdefghijklmnop');
  });

  it('超宽时截断并补省略号，结果宽度不超过预算', () => {
    const long = '加班到天亮的临时工老黄牛';
    const truncated = truncateToDisplayWidth(long, MAX_NAME_DISPLAY_UNITS);
    expect(truncated.endsWith('…')).toBe(true);
    expect(displayWidth(truncated)).toBeLessThanOrEqual(MAX_NAME_DISPLAY_UNITS);
    // 预算内尽量多留字：16 单位扣掉省略号 1，正好 7 个汉字 + 1 个半角
    expect(truncated).toBe('加班到天亮的临…');
  });

  it('预算为 0 时不返回省略号', () => {
    expect(truncateToDisplayWidth('夜班实习生', 0)).toBe('');
  });

  it('肤色修饰符跟着被截下的 emoji 一起保留，不额外占宽', () => {
    const truncated = truncateToDisplayWidth('牛马👍🏽牛马牛马牛马', 7);
    expect(truncated).toBe('牛马👍🏽…');
    expect(displayWidth(truncated)).toBe(7);
  });
});

describe('输入框钳制', () => {
  it('按码点截到 16 个字符，保留正在输入的尾随空格', () => {
    expect(clampNameLength('🐮'.repeat(20))).toBe('🐮'.repeat(16));
    expect([...clampNameLength('夜班实习生 ')]).toHaveLength(6);
    expect(clampNameLength('夜班实习生 ')).toBe('夜班实习生 ');
  });
});

describe('协议钳制', () => {
  it('字符数超过 16 的昵称被截到 16 个字符', () => {
    const hello = decodeHello(encodeHello('一二三四五六七八九十一二三四五六七八', DEFAULT_APPEARANCE.cow));
    expect([...hello.name].length).toBe(MAX_NAME_CHARS);
  });

  it('emoji 昵称不会被切成半个代理对', () => {
    const hello = decodeHello(encodeHello('🐮'.repeat(20), DEFAULT_APPEARANCE.cow));
    for (const ch of hello.name) {
      expect(ch.codePointAt(0)).toBeGreaterThan(0xffff);
    }
  });

  it('字节上限仍然生效：四字节字符不会撑爆 u8 长度字段', () => {
    const hello = decodeHello(encodeHello('🐮'.repeat(20), DEFAULT_APPEARANCE.cow));
    expect(new TextEncoder().encode(hello.name).length).toBeLessThanOrEqual(48);
  });
});
