'use client';

import { useEffect } from 'react';
import { BUILD_ID } from '@/lib/build-id';
import {
  BUILD_CHECK_EVENT,
  allowReloadForVersion,
  reloadUrl,
  shouldReloadForVersion,
} from '@/lib/build-version';
import { browserStorage } from '@/lib/storage';

/** 30 秒一次极小 JSON；后台标签页不发请求，切回前台立即补查 */
const CHECK_INTERVAL_MS = 30_000;

/**
 * 部署后强制换图：页面版本与服务端版本不一致时，自动带 `__v` 重载。
 *
 * 不渲染任何东西，也不持有 React 状态；所有判定都在纯函数里，单测覆盖。
 */
export function BuildWatcher() {
  useEffect(() => {
    const storage = browserStorage('session');
    let inFlight = false;
    let disposed = false;

    const check = async () => {
      if (inFlight || disposed) return;
      if (document.hidden) return;

      inFlight = true;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { id?: unknown };
        const latest = typeof data.id === 'string' ? data.id : '';
        if (!shouldReloadForVersion(BUILD_ID, latest)) return;
        // 请求期间切到后台：留到切回前台再刷，避免后台标签页突然重载
        if (document.visibilityState === 'hidden') return;
        if (!allowReloadForVersion(storage, latest, Date.now())) return;

        disposed = true;
        window.location.replace(reloadUrl(window.location.href, latest));
      } catch {
        // 网络抖动 / 接口异常都不影响游戏，下一轮再查
      } finally {
        inFlight = false;
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };

    void check();
    const timer = window.setInterval(checkWhenVisible, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('focus', checkWhenVisible);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener(BUILD_CHECK_EVENT, checkWhenVisible);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('focus', checkWhenVisible);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener(BUILD_CHECK_EVENT, checkWhenVisible);
    };
  }, []);

  return null;
}
