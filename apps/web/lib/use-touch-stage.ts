'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/** 触屏设备（主输入为粗指针）：决定是否显示虚拟摇杆与按钮 */
export function useIsTouch(): boolean {
  const detect = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches ||
      (window.matchMedia('(any-pointer: coarse)').matches && !window.matchMedia('(any-hover: hover)').matches));
  const [touch, setTouch] = useState(detect);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const sync = () => setTouch(detect());
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return touch;
}

/**
 * 触屏竖屏时把游戏舞台横过来：先尝试系统横屏锁（仅全屏或部分浏览器可用），
 * 锁定失败则由调用方用 CSS 旋转舞台兜底。返回 true 表示当前应当旋转。
 */
export function useLandscapeStage(enabled: boolean): boolean {
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(orientation: portrait)');
    const sync = () => setPortrait(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!enabled || !portrait) return;
    void orientationApi()?.lock?.('landscape')?.catch(() => undefined);
  }, [enabled, portrait]);

  return enabled && portrait;
}

/* ------------------------------------------------------------------ *
 * 全屏：横屏锁只有在全屏状态下才会被浏览器接受，所以两者必须成对使用。
 * iOS Safari 没有 Element.requestFullscreen，此时 supported 为 false，
 * 舞台退回 CSS 旋转，界面不出现点不动的按钮。
 * ------------------------------------------------------------------ */

type LegacyDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenHost = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type OrientationApi = {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

function orientationApi(): OrientationApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.screen?.orientation as unknown as OrientationApi | undefined;
}

function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const legacy = document as LegacyDocument;
  return legacy.fullscreenElement ?? legacy.webkitFullscreenElement ?? null;
}

function supportsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const host = document.documentElement as FullscreenHost;
  return typeof host.requestFullscreen === 'function' || typeof host.webkitRequestFullscreen === 'function';
}

async function leaveFullscreen(): Promise<void> {
  const doc = document as LegacyDocument;
  try {
    await (typeof doc.exitFullscreen === 'function' ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
  } catch {
    // 已经不在全屏里，或者浏览器拒绝；两种都无需处理
  }
}

export interface ImmersiveStage {
  /** 浏览器支持元素全屏（iOS Safari 为 false） */
  supported: boolean;
  active: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

/**
 * 全屏舞台。`lockLandscape` 决定进入全屏后是否顺手锁横屏——
 * 触屏传 true，桌面传 false（桌面的 orientation.lock 本来就会 reject）。
 *
 * 注意：requestFullscreen 必须由用户手势同步触发，任何延迟（setState 后、
 * 定时器里）都会被浏览器拒绝，所以 `enter` 要直接挂在点击回调上。
 */
export function useImmersiveStage(lockLandscape: boolean): ImmersiveStage {
  const [supported] = useState(supportsFullscreen);
  const [active, setActive] = useState(() => fullscreenElement() !== null);

  const enter = useCallback(() => {
    if (typeof document === 'undefined' || fullscreenElement()) return;
    const host = document.documentElement as FullscreenHost;
    try {
      // navigationUI: 'hide' 让 Android Chrome 全屏时收掉地址栏与导航条
      const request =
        typeof host.requestFullscreen === 'function'
          ? host.requestFullscreen({ navigationUI: 'hide' })
          : Promise.resolve(host.webkitRequestFullscreen?.());
      void request.catch(() => undefined);
    } catch {
      // 被浏览器拒绝就保持原样：竖屏仍有 CSS 旋转兜底，不会白屏
    }
  }, []);

  const exit = useCallback(() => {
    if (typeof document === 'undefined' || !fullscreenElement()) return;
    void leaveFullscreen();
  }, []);

  const toggle = useCallback(() => {
    if (fullscreenElement()) exit();
    else enter();
  }, [enter, exit]);

  useEffect(() => {
    if (!supported) return;
    const sync = () => {
      const full = fullscreenElement() !== null;
      setActive(full);
      const orientation = orientationApi();
      if (!full) {
        orientation?.unlock?.();
        return;
      }
      if (!lockLandscape) return;
      // lock 只能在全屏之后调用：Android 会真的转成横屏，其余浏览器 reject 后由 CSS 旋转接手
      void orientation?.lock?.('landscape')?.catch(() => undefined);
    };
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [supported, lockLandscape]);

  // 离开园区时把屏幕还给用户：全屏与横屏锁都不该跟着路由带到别的页面
  useEffect(
    () => () => {
      orientationApi()?.unlock?.();
      if (fullscreenElement()) void leaveFullscreen();
    },
    [],
  );

  return useMemo(() => ({ supported, active, enter, exit, toggle }), [supported, active, enter, exit, toggle]);
}
