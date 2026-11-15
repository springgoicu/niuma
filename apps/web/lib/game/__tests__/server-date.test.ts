import { describe, expect, it } from 'vitest';
import {
  nextServerMidnight,
  serverClockParts,
  serverDateKey,
  serverDayAtHour,
  serverDayDiff,
  serverHour,
  serverHourFraction,
  serverMonth,
  serverWeekday,
  startOfServerDay,
  startOfServerWeek,
} from '../server-date';

/** 东八区园区：UTC 16:00 就是园区次日 00:00 */
const EAST8 = 480;
/** 西五区园区：UTC 05:00 才是园区当天 00:00 */
const WEST5 = -300;

const DAY_MS = 86_400_000;

describe('serverDateKey', () => {
  it('按园区时区切日，与运行地时区无关', () => {
    const midnight = Date.UTC(2026, 10, 14, 16, 0, 0);
    expect(serverDateKey(midnight, EAST8)).toBe('2026-11-15');
    expect(serverDateKey(midnight - 1_000, EAST8)).toBe('2026-11-14');
  });

  it('西半球偏移同样按园区日算，不会提前一天', () => {
    const midnight = Date.UTC(2026, 10, 15, 5, 0, 0);
    expect(serverDateKey(midnight, WEST5)).toBe('2026-11-15');
    expect(serverDateKey(midnight - 1_000, WEST5)).toBe('2026-11-14');
  });

  it('非法时间戳返回空串，不抛错', () => {
    expect(serverDateKey(Number.NaN, EAST8)).toBe('');
    expect(serverDateKey(Number.POSITIVE_INFINITY, EAST8)).toBe('');
  });
});

describe('startOfServerDay / nextServerMidnight', () => {
  it('归零到园区零点，且与下一天正好差 24 小时', () => {
    const today = Date.UTC(2026, 10, 15, 3, 20, 0);
    const start = startOfServerDay(today, EAST8);
    expect(serverDateKey(start, EAST8)).toBe('2026-11-15');
    expect(serverDateKey(start - 1, EAST8)).toBe('2026-11-14');
    expect(nextServerMidnight(today, EAST8)).toBe(start + DAY_MS);
    expect(nextServerMidnight(start, EAST8)).toBe(start + DAY_MS);
  });

  it('负偏移不会把零点算成前一天', () => {
    const start = startOfServerDay(Date.UTC(2026, 10, 15, 12, 0, 0), WEST5);
    expect(serverDateKey(start, WEST5)).toBe('2026-11-15');
    expect(nextServerMidnight(start, WEST5)).toBe(start + DAY_MS);
  });

  it('非法时间戳返回 NaN', () => {
    expect(Number.isNaN(startOfServerDay(Number.NaN, EAST8))).toBe(true);
    expect(Number.isNaN(nextServerMidnight(Number.NaN, EAST8))).toBe(true);
  });
});

describe('serverDayDiff', () => {
  it('跨零点算一天，不足一天算零', () => {
    const beforeMidnight = Date.UTC(2026, 10, 14, 15, 59, 0);
    const afterMidnight = Date.UTC(2026, 10, 14, 16, 1, 0);
    expect(serverDayDiff(beforeMidnight, afterMidnight, EAST8)).toBe(1);
    expect(serverDayDiff(afterMidnight, afterMidnight + 60_000, EAST8)).toBe(0);
    expect(serverDayDiff(beforeMidnight, beforeMidnight + 3 * DAY_MS, EAST8)).toBe(3);
  });

  it('反向为负，非法输入给 0', () => {
    const day = Date.UTC(2026, 10, 15, 2, 0, 0);
    expect(serverDayDiff(day, day - DAY_MS, EAST8)).toBe(-1);
    expect(serverDayDiff(day, Number.NaN, EAST8)).toBe(0);
  });
});

describe('startOfServerWeek / serverWeekday', () => {
  it('周一开始，周日归属本周第七天', () => {
    // 2026-11-15 是周日
    const sunday = Date.UTC(2026, 10, 15, 10, 0, 0);
    expect(serverWeekday(sunday, EAST8)).toBe(7);
    const monday = startOfServerWeek(sunday, EAST8);
    expect(serverDateKey(monday, EAST8)).toBe('2026-11-09');
    expect(serverWeekday(monday, EAST8)).toBe(1);
    // 周日当天仍在本周内
    expect(serverDayDiff(monday, sunday, EAST8)).toBe(6);
  });

  it('周一的零点就是本周起点', () => {
    const monday = Date.UTC(2026, 10, 9, 2, 0, 0);
    expect(startOfServerWeek(monday, EAST8)).toBe(startOfServerDay(monday, EAST8));
  });
});

describe('serverHour / serverClockParts / serverDayAtHour', () => {
  it('小时与分钟按园区时区读数', () => {
    const at = Date.UTC(2026, 10, 15, 1, 30, 45);
    expect(serverHour(at, EAST8)).toBe(9);
    expect(serverClockParts(at, EAST8)).toEqual({ hour: 9, minute: 30, second: 45 });
    expect(serverHourFraction(at, EAST8)).toBeCloseTo(9.5, 6);
    expect(serverHour(at, WEST5)).toBe(20);
  });

  it('整点叠加不受夏令时影响，恒等 24 小时', () => {
    const start = startOfServerDay(Date.UTC(2026, 10, 15, 2, 0, 0), EAST8);
    expect(serverHour(serverDayAtHour(start, 9), EAST8)).toBe(9);
    expect(serverDayAtHour(start, 24)).toBe(start + DAY_MS);
  });
});

describe('serverMonth', () => {
  it('跨月边界按园区日历读', () => {
    const at = Date.UTC(2026, 10, 30, 17, 0, 0);
    expect(serverMonth(at, EAST8)).toBe(11);
    expect(serverMonth(at, WEST5)).toBe(10);
  });
});
