'use client';

import { readJson, writeJson, type StorageLike } from './storage';

/** 断线重连等场景触发一次版本检查；BuildWatcher 监听这个事件 */
export const BUILD_CHECK_EVENT = 'niuma:build-check';
/** 强刷记录：同一构建版本的尝试次数与冷却时间，避免旧 HTML 反复缓存导致刷新循环 */
export const RELOAD_GUARD_KEY = 'niuma:build-reload';
const RELOAD_COOLDOWN_MS = 10_000;
const RELOAD_MAX_TRIES = 3;

interface ReloadGuard {
  id: string;
  at: number;
  tries: number;
}

/** 页面版本与服务端版本不同才需要重载；空版本视为「接口异常」，不做任何事 */
export function shouldReloadForVersion(current: string, latest: string | undefined): boolean {
  return typeof latest === 'string' && latest.length > 0 && latest !== current;
}

/** 带版本参数的重载地址：保留原有查询参数与 hash，只覆盖 `__v` */
export function reloadUrl(href: string, id: string): string {
  const url = new URL(href);
  url.searchParams.set('__v', id);
  return url.toString();
}

function readGuard(storage: StorageLike | null): ReloadGuard | null {
  return readJson(storage, RELOAD_GUARD_KEY, (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const draft = raw as Record<string, unknown>;
    if (typeof draft.id !== 'string' || draft.id.length === 0) return null;
    if (typeof draft.at !== 'number' || !Number.isFinite(draft.at)) return null;
    if (typeof draft.tries !== 'number' || !Number.isFinite(draft.tries)) return null;
    return { id: draft.id, at: draft.at, tries: Math.max(0, Math.floor(draft.tries)) };
  });
}

/**
 * 是否允许为这个版本再刷一次。
 *
 * - 换版本立即放行：新版本是新的故障域，不该被旧版本的失败次数拖住；
 * - 同版本 10 秒冷却、最多 3 次：Nginx 的 HTML 缓存一旦配错，最多循环三次就停，
 *   不会把用户的标签页刷成永动机。
 */
export function allowReloadForVersion(
  storage: StorageLike | null,
  id: string,
  now: number,
  cooldownMs: number = RELOAD_COOLDOWN_MS,
  maxTries: number = RELOAD_MAX_TRIES,
): boolean {
  const guard = readGuard(storage);
  const tries = guard?.id === id ? guard.tries : 0;
  if (tries >= maxTries) return false;
  if (guard?.id === id && now - guard.at < cooldownMs) return false;
  writeJson(storage, RELOAD_GUARD_KEY, { id, at: now, tries: tries + 1 });
  return true;
}

/** 从游戏服断线等非 UI 入口请求一次检查；后台标签页由 BuildWatcher 延后处理 */
export function requestBuildCheck(): void {
  // 这里不能写 `typeof window === 'undefined'`：Next 的 SWC 认定 client bundle 一定
  // 跑在浏览器里，会把这个判断当常量折叠掉，函数体只剩 `window.dispatchEvent(...)`。
  // 而 GameSession 同时跑在渲染 Worker 里（断线回调就在这里），Worker 没有 window，
  // 一次部署重启游戏服就会把所有在线玩家的 Worker 打成 ReferenceError 并回退主线程。
  // 改成检测能力本身：Worker 有 globalThis，但没有 dispatchEvent。
  const scope = globalThis as { dispatchEvent?: (event: Event) => boolean };
  if (typeof scope.dispatchEvent !== 'function') return;
  scope.dispatchEvent(new Event(BUILD_CHECK_EVENT));
}
