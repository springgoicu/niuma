'use client';

import { useEffect, useState } from 'react';

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
    const orientation = window.screen.orientation as (ScreenOrientation & { lock?: (type: string) => Promise<void> }) | undefined;
    void orientation?.lock?.('landscape')?.catch(() => undefined);
  }, [enabled, portrait]);

  return enabled && portrait;
}
