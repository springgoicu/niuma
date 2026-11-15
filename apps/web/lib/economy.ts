'use client';

import {
  ECONOMY_STORAGE_KEY,
  emptyEconomyProfile,
  sanitizeEconomyProfile,
  type EconomyProfile,
} from '@niuma/shared-types';
import { browserStorage, readJson, writeJson, type StorageLike } from './storage';

/**
 * 牛马币的永久层（ADR-0082）：只存在浏览器 localStorage。
 *
 * 服务端是本次进园的权威，但关掉页面之后只有这里记得余额。
 * 读盘与写盘都过 `sanitizeEconomyProfile`：同一把尺子负责钳制余额、等级、
 * 道具 id 与数量，坏档直接丢弃而不是读出半截结构。
 */
export function loadEconomy(
  storage: StorageLike | null = browserStorage('local'),
): EconomyProfile {
  const stored = readJson(storage, ECONOMY_STORAGE_KEY, (raw) => sanitizeEconomyProfile(raw));
  return stored ?? emptyEconomyProfile();
}

export function saveEconomy(
  profile: EconomyProfile,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, ECONOMY_STORAGE_KEY, sanitizeEconomyProfile(profile));
}
