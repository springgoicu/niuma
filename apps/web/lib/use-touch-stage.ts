'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 触屏设备：决定是否显示虚拟摇杆与按钮。
 *
 * 只要有任意一个粗指针就算触屏——带触屏的二合一笔记本、接了鼠标的平板
 * 原来会被判成桌面端，摇杆消失而用户手里没有键盘，直接不可玩（ADR-0032）。
 */
export function useIsTouch(): boolean {
  const detect = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches);
  const [touch, setTouch] = useState(detect);
  useEffect(() => {
    const queries = [window.matchMedia('(pointer: coarse)'), window.matchMedia('(any-pointer: coarse)')];
    const sync = () => setTouch(detect());
    sync();
    for (const query of queries) query.addEventListener('change', sync);
    return () => {
      for (const query of queries) query.removeEventListener('change', sync);
    };
  }, []);
  return touch;
}

/**
 * 可视视口尺寸（CSS px）：iOS 键盘弹起时 `dvh` 不变，只有 `visualViewport` 会缩。
 * 返回 `{ width: 0, height: 0 }` 表示还没测量（SSR / 首帧），调用方据此退回 CSS 单位。
 */
export function useVisualViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () =>
      setSize({
        width: Math.round(viewport?.width ?? window.innerWidth),
        height: Math.round(viewport?.height ?? window.innerHeight),
      });
    sync();
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return size;
}

/**
 * 当前是否竖屏。只决定 HUD 与触控区的排布，不参与世界倍率——倍率看的是屏幕宽高比。
 *
 * 与 useIsTouch 分开：桌面把窗口拖成竖长条也会命中 portrait，但那时仍走桌面 HUD。
 */
export function useIsPortrait(): boolean {
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

  return portrait;
}

/* ------------------------------------------------------------------ *
 * 全屏：唯一入口是界面上的手动按钮。进入园区、首次按压、横竖屏切换都不
 * 会主动请求全屏，页面始终保持浏览器默认显示。
 * iOS Safari 没有 Element.requestFullscreen，此时 supported 为 false，
 * 界面不出现点不动的按钮。
 * ------------------------------------------------------------------ */

type LegacyDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenHost = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

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
 * 全屏舞台：只响应手动按钮，不自动进入、不请求横屏锁。
 * 屏幕朝向始终交给设备与用户。
 *
 * 注意：requestFullscreen 必须由用户手势同步触发，任何延迟（setState 后、
 * 定时器里）都会被浏览器拒绝，所以 `enter` 只能挂在点击回调上。
 */
export function useImmersiveStage(): ImmersiveStage {
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
      // 被浏览器拒绝就保持原样，不白屏
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
    const sync = () => setActive(fullscreenElement() !== null);
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [supported]);

  // 离开园区时把屏幕还给用户：全屏不该跟着路由带到别的页面
  useEffect(
    () => () => {
      if (fullscreenElement()) void leaveFullscreen();
    },
    [],
  );

  return useMemo(() => ({ supported, active, enter, exit, toggle }), [supported, active, enter, exit, toggle]);
}
