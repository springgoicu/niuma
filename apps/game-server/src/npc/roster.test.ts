import { describe, expect, it } from 'bun:test';
import { MAX_NAME_CHARS, MAX_NAME_DISPLAY_UNITS } from '@niuma/shared-types';
import { createRng } from './rng';
import {
  GUARD_NAME,
  NPC_ROLE_GUARD,
  NPC_ROLE_WORKER,
  buildNpcAppearance,
  buildNpcCareer,
  buildNpcRoster,
} from './roster';

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
    const counts = { workers: 2, guards: 3 };
    const first = buildNpcRoster(createRng(42), counts, { speed: SPEED, now: NOW });
    const second = buildNpcRoster(createRng(42), counts, { speed: SPEED, now: NOW });
    expect(first.map((profile) => profile.name)).toEqual(second.map((profile) => profile.name));
    expect(first.map((profile) => profile.speedFactor)).toEqual(second.map((profile) => profile.speedFactor));
    expect(first.map((profile) => profile.joinedAt)).toEqual(second.map((profile) => profile.joinedAt));
  });

  it('同事名字互不重复，3 位保安统一显示「园区保安」且宽度合法', () => {
    const roster = buildNpcRoster(createRng(7), { workers: 2, guards: 3 }, { speed: SPEED, now: NOW });
    expect(roster.length).toBe(5);

    const workers = roster.filter((profile) => profile.role === NPC_ROLE_WORKER);
    expect(workers.length).toBe(2);
    expect(new Set(workers.map((profile) => profile.name)).size).toBe(workers.length);
    for (const profile of workers) {
      const chars = [...profile.name].length;
      expect(chars).toBeGreaterThanOrEqual(2);
      expect(chars).toBeLessThanOrEqual(3);
      expect(chars).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(displayWidth(profile.name)).toBeLessThanOrEqual(MAX_NAME_DISPLAY_UNITS);
    }

    const guards = roster.filter((profile) => profile.role === NPC_ROLE_GUARD);
    expect(guards.length).toBe(3);
    for (const guard of guards) expect(guard.name).toBe(GUARD_NAME);
    expect([...GUARD_NAME].length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    expect(displayWidth(GUARD_NAME)).toBeLessThanOrEqual(MAX_NAME_DISPLAY_UNITS);
  });

  it('保安穿整套警服且不设状态，普通同事不会混入警用件', () => {
    const roster = buildNpcRoster(createRng(7), { workers: 2, guards: 3 }, { speed: SPEED, now: NOW });
    const guards = roster.filter((profile) => profile.role === NPC_ROLE_GUARD);
    const workers = roster.filter((profile) => profile.role === NPC_ROLE_WORKER);
    expect(guards.length).toBe(3);
    expect(workers.length).toBe(2);

    for (const guard of guards) {
      expect(guard.appearance.cosmetics.headwear).toBe('police_cap');
      expect(guard.appearance.cosmetics.neckwear).toBe('epaulette');
      expect(guard.status).toBe('');
    }
    for (const worker of workers) {
      expect(worker.appearance.cosmetics.headwear).not.toBe('police_cap');
      expect(worker.appearance.cosmetics.neckwear).not.toBe('epaulette');
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
      expect(career.todayMinutes).toBeGreaterThanOrEqual(0);
      expect(career.todayMinutes).toBeLessThanOrEqual(1_440);
      expect(career.todayToiletMinutes).toBeLessThanOrEqual(career.todayMinutes);
      expect(career.todaySteps).toBeLessThanOrEqual(100_000_000);
      expect(career.todayKnockdown).toBeLessThanOrEqual(65_535);
      expect(career.todayVented).toBeLessThanOrEqual(65_535);
      expect(career.todayOvertime).toBeLessThanOrEqual(1);
      expect(career.province.length).toBeGreaterThan(0);
      expect(career.province.length).toBeLessThanOrEqual(10);
    }
  });

  it('步速有快有慢，且永不越过真人速度', () => {
    const roster = buildNpcRoster(createRng(5), { workers: 10, guards: 0 }, { speed: SPEED, now: NOW });
    for (const profile of roster) {
      expect(profile.speedFactor).toBeGreaterThanOrEqual(SPEED.min);
      expect(profile.speedFactor).toBeLessThanOrEqual(SPEED.max);
    }
    expect(new Set(roster.map((profile) => profile.speedFactor)).size).toBeGreaterThan(1);
  });

  it('入场时刻早于当下 30 分钟到 6 小时：工牌看起来已经上了一阵班', () => {
    const roster = buildNpcRoster(createRng(9), { workers: 10, guards: 0 }, { speed: SPEED, now: NOW });
    for (const profile of roster) {
      const elapsed = NOW - profile.joinedAt;
      expect(elapsed).toBeGreaterThanOrEqual(1_800_000);
      expect(elapsed).toBeLessThanOrEqual(21_600_000);
    }
  });

  it('取满上限 64 位也不会重名：组合空间远大于数量上限', () => {
    const roster = buildNpcRoster(createRng(13), { workers: 64, guards: 0 }, { speed: SPEED, now: NOW });
    expect(roster.length).toBe(64);
    expect(new Set(roster.map((profile) => profile.name)).size).toBe(64);
  });
});
