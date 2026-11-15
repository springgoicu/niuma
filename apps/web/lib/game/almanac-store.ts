'use client';

import { browserStorage, readJson, writeJson } from '../storage';
import { serverNow } from './server-clock';
import { serverDateKey, serverTzOffsetMin } from './server-date';

/**
 * 赛博木鱼的本地账本（ADR-0059）。
 *
 * 零服务端持久化：敲了多少下、哪天解锁的成就，全部只活在这台浏览器的 localStorage 里。
 * 三个字段就是全部状态，读写都过 guard；坏数据当没有，绝不阻塞进园。
 *
 * 注意：这是**体验型**数据，不参与排名、奖励或任何权威判定。
 * 玩家清掉浏览器数据就是重新开始敲，设计上接受这一点。
 */

export const ALMANAC_STORE_KEY = 'niuma:almanac:v1';
/** 当天敲满这个数解锁「急急急放假人」 */
export const FISH_UNLOCK_COUNT = 20;
/** 工牌「已解锁成就」区展示的戳印文案 */
export const FISH_ACHIEVEMENT = '急急急放假人';

export interface AlmanacStore {
  /** 最近一次敲击的本地日期键 `YYYY-MM-DD`；空串表示还没敲过 */
  day: string;
  /** 当天累计敲击次数 */
  knocks: number;
  /** 解锁「急急急放假人」的日期键；null 表示还没解锁 */
  unlockedOn: string | null;
}

export const EMPTY_ALMANAC: AlmanacStore = { day: '', knocks: 0, unlockedOn: null };

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 读盘 guard：字段类型不对就整条丢弃，宁可从零开始也不带着脏数据跑 */
export function parseAlmanac(raw: unknown): AlmanacStore | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const day = typeof record.day === 'string' && DAY_KEY_PATTERN.test(record.day) ? record.day : '';
  const knocks =
    typeof record.knocks === 'number' && Number.isFinite(record.knocks)
      ? Math.min(99_999, Math.max(0, Math.floor(record.knocks)))
      : 0;
  const unlockedOn =
    typeof record.unlockedOn === 'string' && DAY_KEY_PATTERN.test(record.unlockedOn) ? record.unlockedOn : null;
  if (day === '' && knocks === 0 && unlockedOn === null) return null;
  return { day, knocks, unlockedOn };
}

export interface FishKnockResult {
  state: AlmanacStore;
  /** 这一下是否刚好凑满 20 次（只在解锁那一刻为 true） */
  unlocked: boolean;
  /** 今天第几下：用于「今日 N / 20」与飘字节奏 */
  todayCount: number;
}

/**
 * 纯函数：把一次敲击落到状态上。
 *
 * 跨日自动清零今日计数，但**已解锁的成就永久保留**——
 * 玩家昨天敲满的章，今天打开工牌仍然在。
 */
export function applyFishKnock(state: AlmanacStore, dateKey: string): FishKnockResult {
  const sameDay = state.day === dateKey;
  const todayCount = (sameDay ? state.knocks : 0) + 1;
  const unlocked = state.unlockedOn === null && todayCount >= FISH_UNLOCK_COUNT;
  return {
    state: {
      day: dateKey,
      knocks: todayCount,
      unlockedOn: unlocked ? dateKey : state.unlockedOn,
    },
    unlocked,
    todayCount,
  };
}

export function readAlmanac(): AlmanacStore {
  return readJson(browserStorage('local'), ALMANAC_STORE_KEY, parseAlmanac) ?? EMPTY_ALMANAC;
}

export function writeAlmanac(state: AlmanacStore): void {
  writeJson(browserStorage('local'), ALMANAC_STORE_KEY, state);
}

/** 记录一次敲击并落盘：返回今天第几下与是否刚解锁 */
export function recordFishKnock(now: number = serverNow()): FishKnockResult {
  const result = applyFishKnock(readAlmanac(), serverDateKey(now, serverTzOffsetMin()));
  writeAlmanac(result.state);
  return result;
}

/** 今天已经敲了多少下；跨日的旧记录按 0 算（“今天”按园区日历） */
export function todayKnocks(now: number = serverNow()): number {
  const stored = readAlmanac();
  return stored.day === serverDateKey(now, serverTzOffsetMin()) ? stored.knocks : 0;
}

/** 工牌「已解锁成就」：目前只有木鱼这一枚，后续新成就往这里追加 */
export function unlockedAchievements(): string[] {
  return readAlmanac().unlockedOn === null ? [] : [FISH_ACHIEVEMENT];
}
