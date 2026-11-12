import { describe, expect, it } from 'bun:test';
import {
  EMPTY_ALMANAC,
  FISH_ACHIEVEMENT,
  FISH_UNLOCK_COUNT,
  applyFishKnock,
  parseAlmanac,
  unlockedAchievements,
} from '../almanac-store';

describe('赛博木鱼账本', () => {
  it('同一天连敲会累加，第 20 下解锁成就', () => {
    let state = EMPTY_ALMANAC;
    for (let i = 1; i < FISH_UNLOCK_COUNT; i += 1) {
      const result = applyFishKnock(state, '2026-04-01');
      state = result.state;
      expect(result.todayCount).toBe(i);
      expect(result.unlocked).toBe(false);
    }
    const last = applyFishKnock(state, '2026-04-01');
    expect(last.todayCount).toBe(FISH_UNLOCK_COUNT);
    expect(last.unlocked).toBe(true);
    expect(last.state.unlockedOn).toBe('2026-04-01');
  });

  it('解锁只发生一次：第 21 下与第二天都不会重复触发', () => {
    let state = EMPTY_ALMANAC;
    for (let i = 0; i < FISH_UNLOCK_COUNT; i += 1) state = applyFishKnock(state, '2026-04-01').state;
    expect(applyFishKnock(state, '2026-04-01').unlocked).toBe(false);

    const nextDay = applyFishKnock(state, '2026-04-02');
    expect(nextDay.todayCount).toBe(1);
    expect(nextDay.unlocked).toBe(false);
    // 成就是永久的：换一天只清计数，不清解锁日期
    expect(nextDay.state.unlockedOn).toBe('2026-04-01');
  });

  it('坏数据一律当没有：字段类型不对就整条丢弃', () => {
    expect(parseAlmanac(null)).toBeNull();
    expect(parseAlmanac('2026-04-01')).toBeNull();
    expect(parseAlmanac({ day: 1, knocks: 'x', unlockedOn: false })).toBeNull();
    expect(parseAlmanac({ day: '', knocks: 0, unlockedOn: null })).toBeNull();
  });

  it('合法数据过 guard：次数取整并钳到上限', () => {
    expect(parseAlmanac({ day: '2026-04-01', knocks: 7, unlockedOn: null })).toEqual({
      day: '2026-04-01',
      knocks: 7,
      unlockedOn: null,
    });
    expect(parseAlmanac({ day: '2026-04-01', knocks: 12.8, unlockedOn: '2026-04-01' })?.knocks).toBe(12);
    // 日期合法、其余字段坏掉：修成可用的零值，不整条丢掉
    expect(parseAlmanac({ day: '2026-04-01', knocks: -3, unlockedOn: 'x' })).toEqual({
      day: '2026-04-01',
      knocks: 0,
      unlockedOn: null,
    });
    // 三个字段全坏：视作没有数据
    expect(parseAlmanac({ day: '2026-4-1', knocks: -3, unlockedOn: 'x' })).toBeNull();
  });

  it('没有本地数据时读不到成就（测试环境没有 localStorage）', () => {
    expect(unlockedAchievements()).toEqual([]);
    expect(FISH_ACHIEVEMENT).toBe('急急急放假人');
  });
});
