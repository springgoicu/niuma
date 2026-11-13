import { describe, expect, it } from 'bun:test';
import {
  CAREER_STORAGE_KEY,
  CareerTracker,
  EMPTY_CAREER_DAY,
  EMPTY_CAREER_STATS,
  buildCareerSummary,
  loadCareerStats,
  saveCareerStats,
  type CareerDayStats,
} from '../career';
import { dayKey } from '../attendance';
import type { StorageLike } from '../../storage';

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

function day(overrides: Partial<CareerDayStats> = {}): CareerDayStats {
  return { ...EMPTY_CAREER_DAY, ...overrides };
}

describe('career storage', () => {
  it('round-trips the daily buckets and falls back on bad JSON', () => {
    const storage = memoryStorage();
    saveCareerStats(
      {
        daily: {
          '2026-04-01': day({
            distancePx: 250.7,
            slackCount: 3,
            ventedCount: 2,
            knockdownCount: 4,
            overtimeCount: 1,
          }),
        },
      },
      storage,
    );
    expect(loadCareerStats(storage)).toEqual({
      daily: {
        '2026-04-01': {
          distancePx: 251,
          slackCount: 3,
          ventedCount: 2,
          knockdownCount: 4,
          overtimeCount: 1,
        },
      },
    });
    storage.setItem(CAREER_STORAGE_KEY, '{broken');
    expect(loadCareerStats(storage)).toBeNull();
  });

  it('drops legacy flat archives instead of seeding today with old totals', () => {
    const storage = memoryStorage();
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify({ distancePx: 500, steps: 50 }));
    expect(loadCareerStats(storage)).toEqual({ daily: {} });
  });

  it('sanitizes negative, non-finite and unknown-day entries', () => {
    const storage = memoryStorage();
    storage.setItem(
      CAREER_STORAGE_KEY,
      JSON.stringify({
        daily: {
          '2026-04-01': {
            distancePx: -5,
            slackCount: Number.NaN,
            ventedCount: 'x',
            overtimeCount: 3,
          },
          nope: { distancePx: 10 },
        },
      }),
    );
    expect(loadCareerStats(storage)).toEqual({
      daily: {
        '2026-04-01': {
          distancePx: 0,
          slackCount: 0,
          ventedCount: 0,
          knockdownCount: 0,
          overtimeCount: 1,
        },
      },
    });
  });
});

describe('career tracker', () => {
  const noon = new Date(2026, 3, 1, 12, 0, 0).getTime();

  it('ignores teleports and writes into the local day bucket', () => {
    const tracker = new CareerTracker(memoryStorage());
    tracker.recordDistance(10, noon);
    tracker.recordDistance(20, noon);
    tracker.recordDistance(300, noon); // 切后台 / 传送：不计入
    expect(tracker.snapshot().daily[dayKey(noon)]?.distancePx).toBe(30);
  });

  it('keeps each local day separate across midnight', () => {
    const tracker = new CareerTracker(memoryStorage());
    const lateNight = new Date(2026, 3, 1, 23, 59, 0).getTime();
    const afterMidnight = new Date(2026, 3, 2, 0, 1, 0).getTime();
    tracker.recordDistance(64, lateNight);
    tracker.recordKnockdown(lateNight);
    tracker.recordDistance(32, afterMidnight);
    expect(tracker.snapshot().daily['2026-04-01']).toMatchObject({
      distancePx: 64,
      knockdownCount: 1,
    });
    expect(tracker.snapshot().daily['2026-04-02']).toMatchObject({
      distancePx: 32,
      knockdownCount: 0,
      slackCount: 0,
    });
  });

  it('counts slack, vented and knockdown events in today', () => {
    const tracker = new CareerTracker(memoryStorage());
    tracker.recordSlack(noon);
    tracker.recordSlack(noon);
    tracker.recordVented(noon);
    tracker.recordKnockdown(noon);
    tracker.recordKnockdown(noon);
    tracker.recordKnockdown(noon);
    const today = tracker.snapshot().daily[dayKey(noon)]!;
    expect(today.slackCount).toBe(2);
    expect(today.ventedCount).toBe(1);
    expect(today.knockdownCount).toBe(3);
  });

  it('counts overtime at most once per local day, only after 21:00', () => {
    const tracker = new CareerTracker(memoryStorage());
    const evening = new Date(2026, 3, 1, 22, 0, 0).getTime();
    const afternoon = new Date(2026, 3, 1, 15, 0, 0).getTime();
    const nextEvening = new Date(2026, 3, 2, 22, 0, 0).getTime();
    tracker.recordOvertime(afternoon);
    expect(tracker.snapshot().daily[dayKey(afternoon)]?.overtimeCount ?? 0).toBe(0);
    tracker.recordOvertime(evening);
    tracker.recordOvertime(evening + 60_000);
    expect(tracker.snapshot().daily[dayKey(evening)]?.overtimeCount).toBe(1);
    tracker.recordOvertime(nextEvening);
    expect(tracker.snapshot().daily[dayKey(nextEvening)]?.overtimeCount).toBe(1);
  });

  it('flushes dirty state to storage without a timer', () => {
    const storage = memoryStorage();
    const tracker = new CareerTracker(storage);
    tracker.recordDistance(160, noon);
    tracker.flush();
    expect(loadCareerStats(storage)?.daily[dayKey(noon)]?.distancePx).toBe(160);
  });
});

describe('career summary', () => {
  const now = new Date(2026, 3, 1, 12, 0, 0).getTime();
  const hour = 3_600_000;

  it('only reports today fields', () => {
    const summary = buildCareerSummary(
      {
        firstJoinDate: '2026-03-30',
        dailyRecords: {
          '2026-03-30': 2 * hour,
          '2026-03-31': 3 * hour,
          '2026-04-01': 0.5 * hour,
        },
        dailyToiletRecords: {
          '2026-03-31': hour,
          '2026-04-01': 20 * 60_000,
        },
      },
      {
        daily: {
          '2026-04-01': day({
            distancePx: 2_500,
            slackCount: 12,
            ventedCount: 3,
            knockdownCount: 5,
            overtimeCount: 1,
          }),
        },
      },
      '浙江',
      now,
    );
    expect(summary).toEqual({
      firstJoinDate: '2026-03-30',
      todayMinutes: 30,
      todayToiletMinutes: 20,
      todaySteps: 156,
      todayKnockdown: 5,
      todayVented: 3,
      todayOvertime: 1,
      province: '浙江',
    });
  });

  it('clamps toilet minutes to today minutes', () => {
    const summary = buildCareerSummary(
      {
        firstJoinDate: '2026-03-30',
        dailyRecords: { '2026-04-01': 10 * 60_000 },
        dailyToiletRecords: { '2026-04-01': 20 * 60_000 },
      },
      EMPTY_CAREER_STATS,
      '',
      now,
    );
    expect(summary.todayMinutes).toBe(10);
    expect(summary.todayToiletMinutes).toBe(10);
  });

  it('degrades to zeros when there is no local attendance', () => {
    const summary = buildCareerSummary(null, EMPTY_CAREER_STATS, '', now);
    expect(summary.todayMinutes).toBe(0);
    expect(summary.todayToiletMinutes).toBe(0);
    expect(summary.firstJoinDate).toBe('');
    expect(summary.province).toBe('');
  });
});
