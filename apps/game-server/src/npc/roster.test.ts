import { describe, expect, it } from 'bun:test';
import { MAX_NAME_CHARS, MAX_NAME_DISPLAY_UNITS } from '@niuma/shared-types';
import { createRng } from './rng';
import { buildNpcAppearance, buildNpcCareer, buildNpcRoster } from './roster';

const NOW = 1_700_000_000_000;
const SPEED = { min: 0.62, max: 0.95 };

/** 与客户端同一把显示宽尺子：全角 2、半角 1 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += (char.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
  return width;
}

describe('NPC 名册', () => {
  it('同一颗种子生成同一批同事：名字、步速与出生时刻都可复现', () => {
    const first = buildNpcRoster(createRng(42), 10, { speed: SPEED, now: NOW });
    const second = buildNpcRoster(createRng(42), 10, { speed: SPEED, now: NOW });
    expect(first.map((profile) => profile.name)).toEqual(second.map((profile) => profile.name));
    expect(first.map((profile) => profile.speedFactor)).toEqual(second.map((profile) => profile.speedFactor));
    expect(first.map((profile) => profile.joinedAt)).toEqual(second.map((profile) => profile.joinedAt));
  });

  it('10 个名字互不重复，字符数与显示宽度都合法', () => {
    const roster = buildNpcRoster(createRng(7), 10, { speed: SPEED, now: NOW });
    expect(new Set(roster.map((profile) => profile.name)).size).toBe(10);
    for (const profile of roster) {
      expect([...profile.name].length).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(displayWidth(profile.name)).toBeLessThanOrEqual(MAX_NAME_DISPLAY_UNITS);
      expect(profile.name.length).toBeGreaterThan(0);
    }
  });

  it('外观经 sanitize：物种、色槽与部件都在合法范围', () => {
    const rng = createRng(11);
    for (let index = 0; index < 80; index += 1) {
      const appearance = buildNpcAppearance(rng);
      expect(appearance.species === 'cow' || appearance.species === 'horse').toBe(true);
      for (const color of Object.values(appearance.colors)) {
        expect(Number.isInteger(color)).toBe(true);
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
      expect(appearance.parts.patternId).toBeGreaterThanOrEqual(0);
      expect(appearance.parts.patternId).toBeLessThanOrEqual(2);
      expect(appearance.parts.snoutId).toBeGreaterThanOrEqual(0);
      expect(appearance.parts.snoutId).toBeLessThanOrEqual(1);
      expect(appearance.parts.tailId).toBeGreaterThanOrEqual(0);
      expect(appearance.parts.tailId).toBeLessThanOrEqual(1);
      if (appearance.species === 'cow') {
        expect(appearance.parts.hornId).toBeGreaterThanOrEqual(0);
        expect(appearance.parts.hornId).toBeLessThanOrEqual(3);
        expect(appearance.parts.maneId).toBeUndefined();
      } else {
        expect(appearance.parts.maneId).toBeGreaterThanOrEqual(0);
        expect(appearance.parts.maneId).toBeLessThanOrEqual(2);
        expect(appearance.parts.hornId).toBeUndefined();
      }
    }
  });

  it('合成考勤落在协议上限内，日期是真实日历日', () => {
    const rng = createRng(3);
    for (let index = 0; index < 100; index += 1) {
      const career = buildNpcCareer(rng, NOW);
      expect(career.firstJoinDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${career.firstJoinDate}T00:00:00Z`))).toBe(false);
      expect(career.totalOnlineMinutes).toBeGreaterThanOrEqual(0);
      expect(career.totalOnlineMinutes).toBeLessThanOrEqual(60 * 24 * 365 * 100);
      expect(career.activeDays).toBeGreaterThan(0);
      expect(career.todayMinutes).toBeLessThanOrEqual(1_440);
      expect(career.weekMinutes).toBeLessThanOrEqual(10_080);
      expect(career.streakDays).toBeLessThanOrEqual(36_500);
      expect(career.steps).toBeLessThanOrEqual(100_000_000);
      expect(career.province.length).toBeGreaterThan(0);
      expect(career.province.length).toBeLessThanOrEqual(10);
      expect(career.reportedOnlineSec).toBe(0);
    }
  });

  it('步速有快有慢，且永不越过真人速度', () => {
    const roster = buildNpcRoster(createRng(5), 10, { speed: SPEED, now: NOW });
    for (const profile of roster) {
      expect(profile.speedFactor).toBeGreaterThanOrEqual(SPEED.min);
      expect(profile.speedFactor).toBeLessThanOrEqual(SPEED.max);
    }
    expect(new Set(roster.map((profile) => profile.speedFactor)).size).toBeGreaterThan(1);
  });

  it('入场时刻早于当下 30 分钟到 6 小时：工牌看起来已经上了一阵班', () => {
    const roster = buildNpcRoster(createRng(9), 10, { speed: SPEED, now: NOW });
    for (const profile of roster) {
      const elapsed = NOW - profile.joinedAt;
      expect(elapsed).toBeGreaterThanOrEqual(1_800_000);
      expect(elapsed).toBeLessThanOrEqual(21_600_000);
    }
  });

  it('数量超过名字池时允许重名，但不会少生成或崩溃', () => {
    const roster = buildNpcRoster(createRng(13), 64, { speed: SPEED, now: NOW });
    expect(roster.length).toBe(64);
    expect(roster.every((profile) => profile.name.length > 0)).toBe(true);
  });
});
