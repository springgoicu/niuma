import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, EMPTY_CAREER, POSE } from '@niuma/shared-types';
import { buildRemoteArchive, buildSelfArchive, toShareCardData } from '../archive';
import type { PlayerBadge } from '../badge';
import { EMPTY_CAREER_DAY } from '../career';

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
      dailyRecords: {
        '2026-03-30': 2 * HOUR,
        '2026-03-31': 3 * HOUR,
        '2026-04-01': 2 * HOUR,
      },
      dailyToiletRecords: {
        '2026-03-31': HOUR,
        '2026-04-01': 30 * 60_000,
      },
    },
    stats: {
      daily: {
        '2026-04-01': {
          ...EMPTY_CAREER_DAY,
          distancePx: 2_500,
          knockdownCount: 9,
          ventedCount: 3,
          ringGold: 1,
        },
      },
    },
    pose: POSE.Sit,
    seated: true,
    seatKind: 'chair' as const,
    board: [{ id: 1, name: '夜班实习生', todayMinutes: 120, self: true }],
    rank: 1,
    likes: 5,
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
    pose: POSE.Sit,
    moving: false,
    seated: true,
    seatKind: 'chair',
    career: {
      ...EMPTY_CAREER,
      firstJoinDate: '2026-03-01',
      todayMinutes: 60,
      todayToiletMinutes: 15,
      todaySteps: 5_000,
      todayKnockdown: 6,
      todayVented: 2,
      todayOvertime: 1,
      ringGold: 2,
      ringSilver: 1,
      ringBronze: 0,
      province: '江苏',
    },
    board: [{ id: 7, name: '夜班实习生', todayMinutes: 60, self: false }],
    rank: 1,
    likes: 8,
    liked: true,
    ...overrides,
  };
}

describe('self archive', () => {
  it('formats local today attendance, toilet share and activity', () => {
    const archive = buildSelfArchive(selfInput());
    expect(archive.isSelf).toBe(true);
    expect(archive.hasCareer).toBe(true);
    expect(archive.likes).toBe(5);
    expect(archive.liked).toBe(false);
    expect(archive.location).toBe('中国 · 浙江 · 杭州');
    expect(archive.todayDuration).toBe('02:00');
    expect(archive.todayToiletMinutes).toBe(30);
    expect(archive.todayToiletRatio).toBe(0.25);
    expect(archive.firstJoinDate).toBe('2026-03-30');
    expect(archive.activity.distanceM).toBe(100);
    expect(archive.activity.steps).toBe(156);
    expect(archive.activity.knockdownCount).toBe(9);
    expect(archive.activity.ringGold).toBe(1);
    expect(archive.activity.ringSilver).toBe(0);
    expect(archive.pose).toBe('入座摸鱼');
    expect(archive.seat).toBe('工位椅');
    expect(archive.rank).toBe(1);
    expect(archive.stamp).toBe('卷王之王');
  });
});

describe('remote archive', () => {
  it('reads today fields only and hides the city', () => {
    const archive = buildRemoteArchive(remoteBadge(), NOW);
    expect(archive.isSelf).toBe(false);
    expect(archive.hasCareer).toBe(true);
    expect(archive.likes).toBe(8);
    expect(archive.liked).toBe(true);
    expect(archive.location).toBe('中国 · 江苏');
    expect(archive.todayDuration).toBe('01:00');
    expect(archive.todayToiletMinutes).toBe(15);
    expect(archive.firstJoinDate).toBe('2026-03-01');
    expect(archive.activity.knockdownCount).toBe(6);
    expect(archive.activity.ringGold).toBe(2);
    expect(archive.activity.ringSilver).toBe(1);
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
    expect(archive.todayToiletMinutes).toBe(0);
    expect(archive.firstJoinDate).toBe('未上报');
    expect(archive.stamp).toBe('未上报');
    expect(archive.rank).toBeNull();
  });
});

describe('share data', () => {
  it('carries the archive identity, today toilet and 代打 flag', () => {
    const data = toShareCardData(buildRemoteArchive(remoteBadge(), NOW));
    expect(data.isSelf).toBe(false);
    expect(data.todayDuration).toBe('01:00');
    expect(data.todayToiletMinutes).toBe(15);
    expect(data.activity?.steps).toBe(5_000);
    expect(data.rank).toBe(1);
    expect(data.hasCareer).toBe(true);
  });
});
