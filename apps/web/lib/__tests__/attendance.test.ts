import { describe, expect, it } from 'bun:test';
import { employeeNumber } from '../game/badge';
import {
  ATTENDANCE_KEY,
  dayKey,
  formatDuration,
  getActiveDays,
  getCurrentSessionDuration,
  getDailyAverageHours,
  getJobTitle,
  getSeniorityDays,
  getStampTitle,
  getStreakDays,
  getWeekMinutes,
  getWeekMs,
  loadAttendance,
  saveAttendance,
  splitAttendanceInterval,
  type AttendanceStorage,
} from '../game/attendance';
import type { StorageLike } from '../storage';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function record(overrides: Partial<AttendanceStorage> = {}): AttendanceStorage {
  return {
    firstJoinDate: '2026-03-30',
    totalOnlineMs: 0,
    dailyRecords: {},
    sessionStartTime: 0,
    ...overrides,
  };
}

describe('走秒格式', () => {
  it('按 HH:MM:SS 输出，小时不封顶', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(2 * 3_600_000 + 35 * 60_000 + 10_000)).toBe('02:35:10');
    expect(formatDuration(120 * 3_600_000)).toBe('120:00:00');
  });

  it('负数与非有限值退化成 00:00:00', () => {
    expect(formatDuration(-1)).toBe('00:00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
    expect(getCurrentSessionDuration(0)).toBe('00:00:00');
  });

  it('本次在岗按打卡时间走秒', () => {
    const start = 1_772_000_000_000;
    expect(getCurrentSessionDuration(start, start + 3_600_000)).toBe('01:00:00');
    expect(getCurrentSessionDuration(start, start - 1_000)).toBe('00:00:00');
  });
});

describe('日均工时', () => {
  it('所有有效日期的毫秒和 ÷ 有效天数，保留一位小数', () => {
    const hours = (h: number) => h * 3_600_000;
    const storage = record({
      dailyRecords: {
        '2026-03-30': hours(7.2),
        '2026-03-31': hours(9.8),
      },
    });
    expect(getDailyAverageHours(storage)).toBe(8.5);
  });

  it('0 毫秒的日期不算有效天数', () => {
    const storage = record({
      dailyRecords: {
        '2026-03-30': 0,
        '2026-03-31': 8 * 3_600_000,
      },
    });
    expect(getDailyAverageHours(storage)).toBe(8);
    expect(getDailyAverageHours(record())).toBe(0);
  });
});

describe('本周工时与连续在岗', () => {
  const hour = 3_600_000;
  // 2026-04-01 是周三；本周从 3 月 30 日（周一）起算
  const now = new Date(2026, 3, 1, 12, 0, 0).getTime();

  it('只累加本周一零点之后的记录', () => {
    const storage = record({
      dailyRecords: {
        '2026-03-29': 5 * hour,
        '2026-03-30': 2 * hour,
        '2026-03-31': 3 * hour,
        '2026-04-01': 1 * hour,
      },
    });
    expect(getWeekMs(storage.dailyRecords, now)).toBe(6 * hour);
    expect(getWeekMinutes(storage, now)).toBe(360);
  });

  it('跨周只算当前这一周，不把上周日算进来', () => {
    const monday = new Date(2026, 2, 30, 0, 0, 0).getTime();
    expect(getWeekMs({ '2026-03-29': 8 * hour }, monday)).toBe(0);
  });

  it('连续在岗从今天往前数；今天还没工时就从昨天起算', () => {
    expect(
      getStreakDays({ '2026-03-30': hour, '2026-03-31': hour, '2026-04-01': hour }, now),
    ).toBe(3);
    const nextDay = new Date(2026, 3, 2, 9, 0, 0).getTime();
    expect(
      getStreakDays({ '2026-03-30': hour, '2026-03-31': hour, '2026-04-01': hour }, nextDay),
    ).toBe(3);
    expect(getStreakDays({}, now)).toBe(0);
  });

  it('有效日期数只统计大于 0 的日期', () => {
    expect(
      getActiveDays({ '2026-03-30': hour, '2026-03-31': 0, '2026-04-01': 1 }),
    ).toBe(2);
  });
});

describe('工龄', () => {
  it('按日期间隔计算，入职当天至少给 1 天', () => {
    expect(getSeniorityDays(dayKey(Date.now()))).toBe(1);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(getSeniorityDays(dayKey(yesterday.getTime()))).toBe(1);
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    expect(getSeniorityDays(dayKey(twoDaysAgo.getTime()))).toBe(2);
  });

  it('坏日期与未来日期都至少给 1 天', () => {
    expect(getSeniorityDays('not-a-date')).toBe(1);
    expect(getSeniorityDays('2099-01-01')).toBe(1);
  });
});

describe('职级边界', () => {
  it('2.0 与 8.0 都算标准牛马', () => {
    expect(getJobTitle(1.9).title).toBe('实习摸鱼生');
    expect(getJobTitle(1.9).color).toBe('text-emerald-400');

    expect(getJobTitle(2).title).toBe('标准牛马');
    expect(getJobTitle(8).title).toBe('标准牛马');
    expect(getJobTitle(8).warning).toBeUndefined();
    expect(getJobTitle(4).color).toBe('text-sky-400');
  });

  it('超过 8 小时带过载警示', () => {
    const title = getJobTitle(8.1);
    expect(title.title).toBe('骨灰级卷王');
    expect(title.color).toBe('text-rose-400');
    expect(title.warning).toContain('严重过载');
  });
});

describe('印章', () => {
  it('按工时与工龄给出红/金印章文案', () => {
    expect(getStampTitle(9, 40)).toBe('终身免下班');
    expect(getStampTitle(9, 3)).toBe('全勤特等牲');
    expect(getStampTitle(7, 3)).toBe('模范标兵');
    expect(getStampTitle(3, 3)).toBe('摸鱼练习生');
  });

  it('附加维度按「榜首 > 万步 > 摸鱼宗师 > 过载 > 连续全勤」的优先级盖章', () => {
    expect(getStampTitle(9, 40, { rank: 1 })).toBe('卷王之王');
    expect(getStampTitle(3, 3, { steps: 10_000 })).toBe('万步劳模');
    expect(getStampTitle(3, 3, { slackCount: 50 })).toBe('摸鱼宗师');
    expect(getStampTitle(9, 3, { streakDays: 7 })).toBe('全勤特等牲');
    expect(getStampTitle(3, 3, { streakDays: 7 })).toBe('全勤铁牛');
  });
});

describe('午夜切分', () => {
  it('跨零点时把区间拆到两天的键上', () => {
    const from = new Date(2026, 2, 30, 23, 59, 30).getTime();
    const to = new Date(2026, 2, 31, 0, 0, 30).getTime();
    const split = splitAttendanceInterval({}, from, to);
    expect(split['2026-03-30']).toBe(30_000);
    expect(split['2026-03-31']).toBe(30_000);
  });

  it('同一天内只累加到当天', () => {
    const from = new Date(2026, 2, 30, 9, 0, 0).getTime();
    const to = new Date(2026, 2, 30, 10, 0, 0).getTime();
    const split = splitAttendanceInterval({ '2026-03-30': 1_000 }, from, to);
    expect(split['2026-03-30']).toBe(3_601_000);
    expect(Object.keys(split)).toHaveLength(1);
  });
});

describe('固定工号', () => {
  it('同一昵称稳定生成 #NM- 加 5 位编号', () => {
    const first = employeeNumber('夜班实习生');
    expect(first).toMatch(/^#NM-\d{5}$/);
    expect(employeeNumber('夜班实习生')).toBe(first);
    expect(employeeNumber('摸鱼老黄牛')).not.toBe(first);
  });
});

describe('本地存档', () => {
  it('round-trip 只保留协议字段，坏 JSON 当作没有', () => {
    const storage = memoryStorage();
    saveAttendance(
      record({
        firstJoinDate: '2026-03-30',
        totalOnlineMs: 12_345,
        dailyRecords: { '2026-03-30': 12_345 },
        sessionStartTime: 1_772_000_000_000,
      }),
      storage,
    );
    expect(storage.getItem(ATTENDANCE_KEY)).toContain('2026-03-30');
    expect(loadAttendance(storage)).toEqual({
      firstJoinDate: '2026-03-30',
      totalOnlineMs: 12_345,
      dailyRecords: { '2026-03-30': 12_345 },
      sessionStartTime: 1_772_000_000_000,
    });

    storage.setItem(ATTENDANCE_KEY, '{broken');
    expect(loadAttendance(storage)).toBeNull();
  });
});
