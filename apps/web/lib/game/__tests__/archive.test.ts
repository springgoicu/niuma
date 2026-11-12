import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, EMPTY_CAREER, POSE } from '@niuma/shared-types';
import { buildRemoteArchive, buildSelfArchive, toShareCardData } from '../archive';
import type { PlayerBadge } from '../badge';

const NOW = new Date(2026, 3, 1, 12, 0, 0).getTime();
const HOUR = 3_600_000;

function selfInput() {
  return {
    name: '夜班实习生',
    species: 'cow' as const,
    appearance: DEFAULT_APPEARANCE.cow,
    status: '摸鱼中',
    region: '工作区',
    geo: { region: '浙江', city: '杭州', isp: '电信' },
    attendance: {
      firstJoinDate: '2026-03-30',
      totalOnlineMs: 10 * HOUR,
      dailyRecords: {
        '2026-03-30': 2 * HOUR,
        '2026-03-31': 3 * HOUR,
        '2026-04-01': 1 * HOUR,
      },
      sessionStartTime: NOW - HOUR,
    },
    stats: {
      distancePx: 2_500,
      steps: 156,
      slackCount: 12,
      ventedCount: 3,
      knockdownCount: 9,
      overtimeCount: 2,
      lastOvertimeDay: '2026-03-31',
    },
    pose: POSE.Sit,
    seated: true,
    seatKind: 'chair' as const,
    board: [{ id: 1, name: '夜班实习生', weekMinutes: 360, self: true }],
    rank: 1,
    onlineSec: 3_600,
    now: NOW,
  };
}

function remoteBadge(overrides: Partial<PlayerBadge> = {}): PlayerBadge {
  return {
    id: 7,
    name: '夜班实习生',
    species: 'cow',
    appearance: DEFAULT_APPEARANCE.cow,
    status: '摸鱼中',
    region: '工作区',
    onlineSec: 180,
    pose: POSE.Sit,
    moving: false,
    seated: true,
    seatKind: 'chair',
    career: {
      ...EMPTY_CAREER,
      firstJoinDate: '2026-03-01',
      totalOnlineMinutes: 600,
      activeDays: 10,
      todayMinutes: 60,
      weekMinutes: 120,
      streakDays: 4,
      steps: 5_000,
      distanceM: 200,
      slackCount: 9,
      ventedCount: 2,
      knockdownCount: 6,
      overtimeCount: 1,
      province: '江苏',
      reportedOnlineSec: 60,
    },
    board: [{ id: 7, name: '夜班实习生', weekMinutes: 180, self: false }],
    rank: 1,
    ...overrides,
  };
}

describe('self archive', () => {
  it('formats local attendance, activity and full location', () => {
    const archive = buildSelfArchive(selfInput());
    expect(archive.isSelf).toBe(true);
    expect(archive.hasCareer).toBe(true);
    expect(archive.location).toBe('中国 · 浙江 · 杭州');
    expect(archive.weekHours).toBe(6);
    expect(archive.todayDuration).toBe('01:00:00');
    expect(archive.sessionDuration).toBe('01:00:00');
    expect(archive.dailyAverageHours).toBe(2);
    expect(archive.totalHours).toBe('10.0');
    expect(archive.activity.distanceM).toBe(100);
    expect(archive.activity.steps).toBe(156);
    expect(archive.activity.knockdownCount).toBe(9);
    expect(archive.pose).toBe('入座摸鱼');
    expect(archive.seat).toBe('工位椅');
    expect(archive.employeeNo).toMatch(/^#NM-\d{5}$/);
    expect(archive.rank).toBe(1);
    expect(archive.stamp).toBe('卷王之王');
  });
});

describe('remote archive', () => {
  it('adds only the session delta and hides the city', () => {
    const archive = buildRemoteArchive(remoteBadge(), NOW);
    expect(archive.isSelf).toBe(false);
    expect(archive.hasCareer).toBe(true);
    expect(archive.location).toBe('中国 · 江苏');
    expect(archive.sessionDuration).toBe('00:03:00');
    // 上报时 60 分钟 + 2 分钟会话增量（180s - 60s，向下取整到分钟）
    expect(archive.todayDuration).toBe('01:02:00');
    expect(archive.weekHours).toBe(2);
    expect(archive.firstJoinDate).toBe('2026-03-01');
    expect(archive.activity.knockdownCount).toBe(6);
    expect(archive.rank).toBe(1);
    expect(archive.stamp).toBe('卷王之王');
    expect(archive.board).toHaveLength(1);
  });

  it('shows 未上报 instead of zeros when the peer did not report', () => {
    const archive = buildRemoteArchive(remoteBadge({ career: undefined, rank: null }), NOW);
    expect(archive.hasCareer).toBe(false);
    expect(archive.location).toBe('未上报');
    expect(archive.jobTitle).toBe('未上报');
    expect(archive.todayDuration).toBe('未上报');
    expect(archive.totalHours).toBe('未上报');
    expect(archive.firstJoinDate).toBe('未上报');
    expect(archive.stamp).toBe('未上报');
    expect(archive.rank).toBeNull();
    expect(archive.sessionDuration).toBe('00:03:00');
  });
});

describe('share data', () => {
  it('carries the archive identity and 代打 flag', () => {
    const data = toShareCardData(buildRemoteArchive(remoteBadge(), NOW));
    expect(data.isSelf).toBe(false);
    expect(data.weekHours).toBe(2);
    expect(data.department).toBeTruthy();
    expect(data.shift).toBeTruthy();
    expect(data.activity?.steps).toBe(5_000);
    expect(data.rank).toBe(1);
    expect(data.hasCareer).toBe(true);
  });
});
