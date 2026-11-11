'use client';

/**
 * 浏览器存储的最小收口。
 *
 * 直接碰 `window.localStorage` 的代码一多，SSR 没有 window、Safari 隐私模式
 * 访问即抛、配额满写不进去、旧版本写坏 JSON 这四件事就会散落到每个调用点。
 * 这里只做一件事：把「读到的字符串」变成「经过 guard 的对象」，失败一律当没有。
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStorage(kind: 'local' | 'session'): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    // Safari 隐私模式下访问 localStorage 会直接抛 SecurityError
    return null;
  }
}

/** 读 JSON 并过 guard：解析失败或 guard 不认，就当没有，并顺手清掉坏数据 */
export function readJson<T>(
  storage: StorageLike | null,
  key: string,
  guard: (raw: unknown) => T | null,
): T | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = guard(JSON.parse(raw) as unknown);
    if (value === null) removeKey(storage, key);
    return value;
  } catch {
    removeKey(storage, key);
    return null;
  }
}

/** 读一个未经校验的对象：给「合并写入」用，保留未知字段 */
export function readRawObject(
  storage: StorageLike | null,
  key: string,
): Record<string, unknown> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额满 / 隐私模式：缓存只是体验增强，写失败不能影响进服
  }
}

export function removeKey(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // 清不掉也不阻断流程
  }
}
