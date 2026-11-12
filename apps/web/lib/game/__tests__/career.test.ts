import { describe, expect, it } from 'bun:test';
import {
  CAREER_STORAGE_KEY,
  CareerTracker,
  EMPTY_CAREER_STATS,
  buildCareerSummary,
  loadCareerStats,
  saveCareerStats,
  type CareerStats,
} from '../career';
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

function stats(overrides: Partial<CareerStats> = {}): CareerStats {
  return { ...EMPTY_CAREER_STATS, ...overrides };
}

describe('career storage', () => {
  it('round-trips only the protocol fields and falls back on bad JSON', () => {
    const storage = memoryStorage();
    saveCareerStats(
      stats({
        distancePx: 250.7,
        steps: 15,
        slackCount: 3,
        ventedCount: 2,
        knockdownCount: 4,
        overtimeCount: 1,
        lastOvertimeDay: '2026-04-01',
      }),
      storage,
    );
    expect(loadCareerStats(storage)).toEqual({
      distancePx: 251,
      steps: 15,
      slackCount: 3,
      ventedCount: 2,
      knockdownCount: 4,
      overtimeCount: 1,
      lastOvertimeDay: '2026-04-01',
    });
    storage.setItem(CAREER_STORAGE_KEY, '{broken');
    expect(loadCareerStats(storage)).toBeNull();
  });

  it('sanitizes negative and non-finite numbers to zero', () => {
    const storage = memoryStorage();
    storage.setItem(
      CAREER_STORAGE_KEY,
      JSON.stringify({ distancePx: -5, steps: Number.NaN, slackCount: 'x', overtimeCount: 3 }),
    );
    expect(loadCareerStats(storage)).toEqual({
      distancePx: 0,
      steps: 0,
      slackCount: 0,
      ventedCount: 0,
      knockdownCount: 0,
      overtimeCount: 3,
      lastOvertimeDay: '',
    });
  });
});

describe('career tracker', () => {
  it('ignores teleports and derives steps from distance', () => {
    const storage = memoryStorage();
    const tracker = new CareerTracker(storage);
    tracker.recordDistance(10);
    tracker.recordDistance(20);
    tracker.recordDistance(300); // 切后台 / 传送：不计入
    expect(tracker.snapshot().distancePx).toBe(30);
    expect(tracker.snapshot().steps).toBe(1);
  });

  it('counts slack, vented and knockdown events', () => {
    const tracker = new CareerTracker(memoryStorage());
    tracker.recordSlack();
    tracker.recordSlack();
    tracker.recordVented();
    tracker.recordKnockdown();
    tracker.recordKnockdown();
    tracker.recordKnockdown();
    expect(tracker.snapshot().slackCount).toBe(2);
    expect(tracker.snapshot().ventedCount).toBe(1);
    expect(tracker.snapshot().knockdownCount).toBe(3);
  });

  it('counts overtime at most once per local day, only after 21:00', () => {
    const tracker = new CareerTracker(memoryStorage());
    const evening = new Date(2026, 3, 1, 22, 0, 0).getTime();
    const afternoon = new Date(2026, 3, 1, 15, 0, 0).getTime();
    tracker.recordOvertime(afternoon);
    expect(tracker.snapshot().overtimeCount).toBe(0);
    tracker.recordOvertime(evening);
    tracker.recordOvertime(evening + 60_000);
    expect(tracker.snapshot().overtimeCount).toBe(1);
    tracker.recordOvertime(evening + 86_400_000);
    expect(tracker.snapshot().overtimeCount).toBe(2);
  });

  it('flushes dirty state to storage without a timer', () => {
    const storage = memoryStorage();
    const tracker = new CareerTracker(storage);
    tracker.recordDistance(160);
    tracker.flush();
    expect(loadCareerStats(storage)?.steps).toBe(10);
  });
});

describe('career summary', () => {
  it('assembles the fields the server relays', () => {
    const now = new Date(2026, 3, 1, 12, 0, 0).getTime();
    const hour = 3_600_000;
    const summary = buildCareerSummary(
      {
        firstJoinDate: '2026-03-30',
        totalOnlineMs: 6 * hour,
        dailyRecords: {
          '2026-03-30': 2 * hour,
          '2026-03-31': 3 * hour,
          '2026-04-01': 0.5 * hour,
        },
        sessionStartTime: now - hour,
      },
      stats({
        distancePx: 2_500,
        steps: 156,
        slackCount: 12,
        ventedCount: 3,
        knockdownCount: 5,
        overtimeCount: 2,
      }),
      '浙江',
      120,
      now,
    );
    expect(summary.firstJoinDate).toBe('2026-03-30');
    expect(summary.totalOnlineMinutes).toBe(360);
    expect(summary.activeDays).toBe(3);
    expect(summary.todayMinutes).toBe(30);
    expect(summary.weekMinutes).toBe(330);
    expect(summary.streakDays).toBe(3);
    expect(summary.steps).toBe(156);
    expect(summary.distanceM).toBe(100);
    expect(summary.slackCount).toBe(12);
    expect(summary.ventedCount).toBe(3);
    expect(summary.knockdownCount).toBe(5);
    expect(summary.overtimeCount).toBe(2);
    expect(summary.province).toBe('浙江');
    expect(summary.reportedOnlineSec).toBe(120);
  });

  it('degrades to zeros when there is no local attendance', () => {
    const summary = buildCareerSummary(null, EMPTY_CAREER_STATS, '', 0, Date.now());
    expect(summary.totalOnlineMinutes).toBe(0);
    expect(summary.firstJoinDate).toBe('');
    expect(summary.province).toBe('');
  });
});
