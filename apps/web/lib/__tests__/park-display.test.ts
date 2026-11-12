import { describe, expect, it } from 'vitest';
import { displayOnline } from '../park-display';

describe('选园页在线人数展示', () => {
  it('按 1.5 倍放大', () => {
    expect(displayOnline(10, 90)).toBe(15);
    expect(displayOnline(42, 90)).toBe(63);
  });

  it('放大后不超过容量', () => {
    expect(displayOnline(80, 90)).toBe(90);
    expect(displayOnline(90, 90)).toBe(90);
  });

  it('空园与非法输入回落到 0', () => {
    expect(displayOnline(0, 90)).toBe(0);
    expect(displayOnline(Number.NaN, 90)).toBe(0);
    expect(displayOnline(-3, 90)).toBe(0);
  });

  it('容量未知时只放大不夹紧', () => {
    expect(displayOnline(10, 0)).toBe(15);
  });
});
