import { describe, expect, it } from 'bun:test';
import { WINTER_MONTHS, isWinterDate, isWinterMonth, readSeason } from '../season';

const JULY = new Date(2026, 6, 15, 12, 0, 0);
const JANUARY = new Date(2026, 0, 15, 12, 0, 0);

describe('季节判定', () => {
  it('12 / 1 / 2 月是冬季，其余月份不是', () => {
    expect(WINTER_MONTHS).toEqual([11, 0, 1]);
    for (const month of [11, 0, 1]) expect(isWinterMonth(month)).toBe(true);
    for (const month of [2, 3, 5, 6, 8, 10]) expect(isWinterMonth(month)).toBe(false);
  });

  it('非法月份一律不算冬季：NaN 与小数不会误开', () => {
    expect(isWinterMonth(Number.NaN)).toBe(false);
    expect(isWinterMonth(1.5)).toBe(false);
  });

  it('按本地日期判定，与时刻无关', () => {
    expect(isWinterDate(new Date(2026, 11, 1, 0, 0, 0))).toBe(true);
    expect(isWinterDate(new Date(2026, 1, 28, 23, 59, 59))).toBe(true);
    expect(isWinterDate(new Date(2026, 2, 1, 0, 0, 0))).toBe(false);
  });

  it('没有参数时按日期走，source = date', () => {
    expect(readSeason('', JANUARY)).toEqual({ winter: true, snow: true, source: 'date' });
    expect(readSeason('', JULY)).toEqual({ winter: false, snow: false, source: 'date' });
  });

  it('?season=winter 在 7 月强制入冬', () => {
    expect(readSeason('?season=winter', JULY)).toEqual({ winter: true, snow: true, source: 'url-on' });
  });

  it('?season=off 在 1 月强制退回常夏', () => {
    expect(readSeason('?season=off', JANUARY)).toEqual({ winter: false, snow: false, source: 'url-off' });
  });

  it('?snow=0 只关飘雪粒子，覆雪地面照旧', () => {
    expect(readSeason('?snow=0', JANUARY)).toEqual({ winter: true, snow: false, source: 'date' });
    expect(readSeason('?season=winter&snow=0', JULY)).toEqual({ winter: true, snow: false, source: 'url-on' });
  });

  it('非法参数回落到日期，不会把冬季误开', () => {
    expect(readSeason('?season=autumn', JULY)).toEqual({ winter: false, snow: false, source: 'date' });
    expect(readSeason('?season=', JANUARY)).toEqual({ winter: true, snow: true, source: 'date' });
    expect(readSeason('?season=1', JULY).source).toBe('url-on');
    expect(readSeason('?season=0', JANUARY).source).toBe('url-off');
  });

  it('非冬季时 snow 恒为 false，调用方不必再判一次', () => {
    expect(readSeason('?season=off&snow=1', JANUARY).snow).toBe(false);
  });
});
