'use client';

import { Megaphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useGameUi } from '@/lib/game-ui';

/** 横幅停留时长：够读完 30 字，又不至于一直压在画面上 */
const HOLD_MS = 4_200;
/** 淡出过渡：与 CSS 的 transition 时长保持一致 */
const FADE_MS = 320;

/**
 * 全服大喇叭的置顶金色横幅（ADR-0085）。
 *
 * 做在 DOM 而不是 PixiJS 弹幕层：它要压在所有 HUD 之上、与相机无关，
 * 而且需要「双层发光描边」这种 DOM 更容易做准的效果。
 */
export function LoudspeakerBanner() {
  const banner = useGameUi((state) => state.shoutBanner);
  const clear = useGameUi((state) => state.clearShoutBanner);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!banner) return;
    setShown(false);
    // 下一帧再显示：同一 key 重播时也要重新走一遍入场
    const raf = requestAnimationFrame(() => setShown(true));
    const hideAt = window.setTimeout(() => setShown(false), HOLD_MS);
    const clearAt = window.setTimeout(() => clear(banner.key), HOLD_MS + FADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hideAt);
      window.clearTimeout(clearAt);
    };
  }, [banner, clear]);

  if (!banner) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[70] flex justify-center px-3">
      <div
        key={banner.key}
        className={`flex max-w-[92vw] items-center gap-2 border-2 border-[#F2C879] bg-ink-950/95 px-3 py-2 shadow-[0_0_18px_rgba(242,200,121,0.45)] transition-all duration-300 ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        }`}
      >
        <Megaphone className="h-4 w-4 shrink-0 text-[#F2C879]" aria-hidden />
        <p className="min-w-0 truncate font-semibold text-[13px] tracking-wide text-[#FFE7AE]">
          {banner.text}
        </p>
      </div>
    </div>
  );
}
