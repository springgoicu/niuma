import { describe, expect, it } from 'bun:test';
import { formatClock, formatFullClock } from '../clock';

describe('聊天时间戳', () => {
  it('输出 24 小时制 HH:MM，时分都补零', () => {
    expect(formatClock(new Date(2026, 10, 11, 9, 5).getTime())).toBe('09:05');
    expect(formatClock(new Date(2026, 10, 11, 15, 42).getTime())).toBe('15:42');
  });

  it('午夜与正午都不走 12 小时制', () => {
    expect(formatClock(new Date(2026, 10, 11, 0, 0).getTime())).toBe('00:00');
    expect(formatClock(new Date(2026, 10, 11, 12, 0).getTime())).toBe('12:00');
  });

  it('非法时间回落到占位符，不给 NaN:NaN', () => {
    expect(formatClock(Number.NaN)).toBe('--:--');
    expect(formatClock(0)).toBe('--:--');
    expect(formatClock(-1)).toBe('--:--');
  });
});

describe('聊天时间戳的悬停全文', () => {
  it('输出本地时区的完整时刻', () => {
    expect(formatFullClock(new Date(2026, 10, 11, 9, 5, 7).getTime())).toBe('2026-11-11 09:05:07');
  });

  it('非法时间给空串，title 上不留 NaN', () => {
    expect(formatFullClock(0)).toBe('');
    expect(formatFullClock(Number.NaN)).toBe('');
  });
});
