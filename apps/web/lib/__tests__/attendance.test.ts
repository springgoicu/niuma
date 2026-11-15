import { describe, expect, it } from 'bun:test';
import {
  ATTENDANCE_KEY,
  AttendanceTracker,
  dayKey,
  formatDuration,
  formatHoursMinutes,
  formatMinutesClock,
  getJobTitle,
  getStampTitle,
  getTodayMinutes,
  getTodayMs,
  getTodayToiletMinutes,
  getTodayToiletMs,
  loadAttendance,
  saveAttendance,
  splitAttendanceInterval,
  splitToiletInterval,
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
    dailyRecords: {},
    dailyToiletRecords: {},
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
  });

  it('工牌与档案用分钟粒度 HH:MM，分钟数不封顶', () => {
    expect(formatHoursMinutes(0)).toBe('00:00');
    expect(formatHoursMinutes(8 * 3_600_000 + 35 * 60_000 + 10_000)).toBe('08:35');
    expect(formatMinutesClock(120 * 60)).toBe('120:00');
    expect(formatMinutesClock(Number.NaN)).toBe('00:00');
  });
});

describe('今日工时与如厕', () => {
  const now = new Date(2026, 3, 1, 12, 0, 0).getTime();

  it('只取本地日桶，跨零点后自然换到新的一天', () => {
    const storage = record({
      dailyRecords: { '2026-03-31': 8 * 3_600_000, '2026-04-01': 3 * 3_600_000 },
      dailyToiletRecords: { '2026-04-01': 20 * 60_000 },
    });
    expect(getTodayMs(storage, now)).toBe(3 * 3_600_000);
    expect(getTodayMinutes(storage, now)).toBe(180);
    expect(getTodayToiletMs(storage, now)).toBe(20 * 60_000);
    expect(getTodayToiletMinutes(storage, now)).toBe(20);
  });

  it('如厕永远不超过工时：坏存档也会被钳住', () => {
    const storage = record({
      dailyRecords: { '2026-04-01': 10 * 60_000 },
      dailyToiletRecords: { '2026-04-01': 60 * 60_000 },
    });
    expect(getTodayToiletMs(storage, now)).toBe(10 * 60_000);
    expect(getTodayToiletMinutes(storage, now)).toBe(10);
  });

  it('负值、NaN 与缺失日期都按 0 处理', () => {
    expect(getTodayMs({ dailyRecords: { '2026-04-01': -1 } }, now)).toBe(0);
    expect(getTodayMs({ dailyRecords: { '2026-04-01': Number.NaN } }, now)).toBe(0);
    expect(getTodayToiletMs({ dailyRecords: {}, dailyToiletRecords: {} }, now)).toBe(0);
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
  it('只按今日工时给红/金印章文案', () => {
    expect(getStampTitle(9)).toBe('全勤特等牲');
    expect(getStampTitle(7)).toBe('模范标兵');
    expect(getStampTitle(3)).toBe('摸鱼练习生');
  });

  it('附加维度按「榜首 > 万步 > 摸鱼宗师 > 过载 > 模范」的优先级盖章', () => {
    expect(getStampTitle(9, { rank: 1 })).toBe('卷王之王');
    expect(getStampTitle(3, { steps: 10_000 })).toBe('万步劳模');
    expect(getStampTitle(3, { slackCount: 50 })).toBe('摸鱼宗师');
    expect(getStampTitle(9, { steps: 10_000 })).toBe('万步劳模');
    expect(getStampTitle(9, { rank: 2, slackCount: 0 })).toBe('全勤特等牲');
  });
});

describe('午夜切分', () => {
  it('跨零点时把在岗区间拆到两天的键上', () => {
    const from = new Date(2026, 2, 30, 23, 59, 30).getTime();
    const to = new Date(2026, 2, 31, 0, 0, 30).getTime();
    const split = splitAttendanceInterval({}, from, to);
    expect(split['2026-03-30']).toBe(30_000);
    expect(split['2026-03-31']).toBe(30_000);
  });

  it('如厕区间走同一套切分，不会把昨天的如厕算进今天', () => {
    const from = new Date(2026, 2, 30, 23, 59, 30).getTime();
    const to = new Date(2026, 2, 31, 0, 0, 30).getTime();
    const split = splitToiletInterval({}, from, to);
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

describe('如厕计时', () => {
  it('坐下只加如厕，在岗仍照常走；离座后如厕停、在岗不停', () => {
    const base = Date.now();
    const storage = memoryStorage();
    const tracker = new AttendanceTracker(base, storage);
    const today = dayKey(base);

    tracker.setToilet(true, base + 1_000);
    let saved = loadAttendance(storage)!;
    let work = saved.dailyRecords[today] ?? 0;
    // 从 base 到 base+1000 只记了在岗，还没开始记如厕
    expect(work).toBeGreaterThanOrEqual(1_000);
    expect(saved.dailyToiletRecords[today] ?? 0).toBe(0);

    tracker.setToilet(false, base + 6_000);
    saved = loadAttendance(storage)!;
    work = saved.dailyRecords[today] ?? 0;
    const toilet = saved.dailyToiletRecords[today] ?? 0;
    expect(work).toBeGreaterThanOrEqual(6_000);
    expect(toilet).toBeGreaterThanOrEqual(5_000);
    expect(toilet).toBeLessThanOrEqual(work);

    // 重复设置同一状态不重复计时，也不反复写盘
    tracker.setToilet(false, base + 9_000);
    expect((loadAttendance(storage)!.dailyToiletRecords[today] ?? 0)).toBe(toilet);
    // 没起 start() 就没有定时器，这里也不调 dispose()（它要碰 document）
  });

  it('两个标签页的如厕记录取 max，不会把另一页的时长抹掉', () => {
    const now = Date.now();
    const storage = memoryStorage();
    const today = dayKey(now);
    saveAttendance(
      record({
        firstJoinDate: today,
        dailyRecords: { [today]: 600_000 },
        dailyToiletRecords: { [today]: 120_000 },
      }),
      storage,
    );
    const tracker = new AttendanceTracker(now, storage);

    // 另一个标签页刚写了 20 分钟工时、8 分钟如厕
    saveAttendance(
      record({
        firstJoinDate: today,
        dailyRecords: { [today]: 1_200_000 },
        dailyToiletRecords: { [today]: 480_000 },
      }),
      storage,
    );
    tracker.flush();

    const saved = loadAttendance(storage)!;
    expect(saved.dailyRecords[today]!).toBeGreaterThanOrEqual(1_200_000);
    expect(saved.dailyToiletRecords[today]!).toBeGreaterThanOrEqual(480_000);
    expect(saved.dailyToiletRecords[today]!).toBeLessThanOrEqual(saved.dailyRecords[today]!);
  });
});

describe('本地存档', () => {
  it('round-trip 只保留今日字段，旧版累计/会话字段被忽略', () => {
    const storage = memoryStorage();
    saveAttendance(
      record({
        firstJoinDate: '2026-03-30',
        dailyRecords: { '2026-03-30': 12_345 },
        dailyToiletRecords: { '2026-03-30': 3_456 },
      }),
      storage,
    );
    expect(storage.getItem(ATTENDANCE_KEY)).toContain('2026-03-30');
    expect(loadAttendance(storage)).toEqual({
      firstJoinDate: '2026-03-30',
      dailyRecords: { '2026-03-30': 12_345 },
      dailyToiletRecords: { '2026-03-30': 3_456 },
    });

    // 旧存档多出来的 totalOnlineMs / sessionStartTime 不再被读进来
    storage.setItem(
      ATTENDANCE_KEY,
      JSON.stringify({
        firstJoinDate: '2026-03-30',
        totalOnlineMs: 99_999,
        sessionStartTime: 1_772_000_000_000,
        dailyRecords: { '2026-03-30': 12_345 },
      }),
    );
    expect(loadAttendance(storage)).toEqual({
      firstJoinDate: '2026-03-30',
      dailyRecords: { '2026-03-30': 12_345 },
      dailyToiletRecords: {},
    });

    storage.setItem(ATTENDANCE_KEY, '{broken');
    expect(loadAttendance(storage)).toBeNull();
  });

  it('丢弃非法日期键与负数，保留合法日桶', () => {
    const storage = memoryStorage();
    storage.setItem(
      ATTENDANCE_KEY,
      JSON.stringify({
        firstJoinDate: '2026-03-30',
        dailyRecords: { '2026-03-30': -1, 'not-a-date': 100, '2026-03-31': 1_000 },
        dailyToiletRecords: { '2026-03-31': 200, '2026-04-01': -5 },
      }),
    );
    expect(loadAttendance(storage)).toEqual({
      firstJoinDate: '2026-03-30',
      dailyRecords: { '2026-03-31': 1_000 },
      dailyToiletRecords: { '2026-03-31': 200 },
    });
  });
});
