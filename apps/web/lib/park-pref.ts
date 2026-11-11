'use client';

import { browserStorage, readJson, removeKey, writeJson, type StorageLike } from './storage';
import { PARK_PREF_KEY, isParkId } from './park';

/**
 * 「上次选了哪座园区」的本地存档。
 *
 * 只存 id：URL 一律由服务端配置翻译（`resolvePark`），所以存档被改成
 * `wss://evil.example` 也只是变成一次普通的「id 不在白名单」回落。
 */

export function loadParkId(storage: StorageLike | null = browserStorage('local')): string | null {
  return readJson(storage, PARK_PREF_KEY, (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const id = (raw as Record<string, unknown>).id;
    return isParkId(id) ? id : null;
  });
}

export function saveParkId(
  id: string,
  storage: StorageLike | null = browserStorage('local'),
): void {
  if (!isParkId(id)) return;
  writeJson(storage, PARK_PREF_KEY, { id, savedAt: Date.now() });
}

export function clearParkId(storage: StorageLike | null = browserStorage('local')): void {
  removeKey(storage, PARK_PREF_KEY);
}
