'use client';

import {
  DANMAKU_PREF_KEY,
  DEFAULT_DANMAKU_PREFS,
  sanitizeDanmakuPrefs,
  type DanmakuPrefs,
} from './game/danmaku-prefs';
import { browserStorage, readJson, writeJson, type StorageLike } from './storage';

/**
 * 弹幕偏好的落盘（ADR-0056）。
 *
 * localStorage 只能在主线程碰，所以这里与 `lib/game/danmaku-prefs.ts` 分成两层：
 * 契约与清洗是纯函数，Worker 也能安全导入；读写一律留在宿主。
 */

/** 读偏好：没有记录、坏 JSON、隐私模式都回默认值，绝不让游戏起不来 */
export function loadDanmakuPrefs(storage: StorageLike | null = browserStorage('local')): DanmakuPrefs {
  return readJson(storage, DANMAKU_PREF_KEY, sanitizeDanmakuPrefs) ?? { ...DEFAULT_DANMAKU_PREFS };
}

/** 写偏好：配额满 / 隐私模式由 `writeJson` 静默兜底，不影响正在进行的会话 */
export function saveDanmakuPrefs(
  prefs: DanmakuPrefs,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, DANMAKU_PREF_KEY, prefs);
}
