import { browserStorage, readJson, writeJson, type StorageLike } from './storage';

/** 全园区播报条的开关偏好：localStorage，关掉后重进园区仍然是关的 */
export const ACTIVITY_FEED_KEY = 'niuma:activity-feed:v1';

interface ActivityPrefs {
  open: boolean;
}

/** 只认 `{ open: boolean }`；别的字段一律丢掉，避免旧版本数据污染 */
function sanitizeActivityPrefs(raw: unknown): ActivityPrefs | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const parsed = raw as Partial<ActivityPrefs>;
  if (typeof parsed.open !== 'boolean') return null;
  return { open: parsed.open };
}

/**
 * 读上次的开关状态。
 *
 * 默认开启：不知道「谁被救护车接走了」正是这次要解决的问题，新玩家不该先
 * 去设置里找开关。隐私模式读不到就按默认开。
 */
export function loadActivityFeedOpen(storage: StorageLike | null = browserStorage('local')): boolean {
  return readJson(storage, ACTIVITY_FEED_KEY, sanitizeActivityPrefs)?.open ?? true;
}

/** 写开关状态：配额满 / 隐私模式写失败由 `writeJson` 静默兜底 */
export function saveActivityFeedOpen(
  open: boolean,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, ACTIVITY_FEED_KEY, { open } satisfies ActivityPrefs);
}
