'use client';

import { useEffect, useRef, useState } from 'react';
import { useGameUi } from '@/lib/game-ui';

/** 停留与淡出时长：与 `animate-welcome-in` 的入场时长一起构成 3 秒左右的一次反馈 */
const HOLD_MS = 2600;
const FADE_MS = 320;

type Phase = 'idle' | 'in' | 'out';

/**
 * 过门区域横幅（纯客户端表现）。
 *
 * 触发源是既有的 2Hz `onStats.region`：跨过区门或走进场馆时，由
 * `GameViewport` 用 `stepArrival` 连续两拍确认后推一条 `areaBanner`。
 * 这里只负责「怎么出现」——淡入、停留、淡出，然后自清。
 *
 * 三条约束：
 * 1. `pointer-events-none`：永不拦点击与摇杆，这是「不打断操作」的底线；
 * 2. 左侧 3px 区色竖条取 `DISTRICTS[].color`：与世界里的区门门灯、
 *    指路牌书脊、导览卡组标题是同一种颜色；
 * 3. 卸载与换条都清定时器，旧定时器不许关掉新横幅（`clearAreaBanner(key)` 已带 key 校验）。
 */
export function DistrictBanner({ compact = false }: { compact?: boolean }) {
  const banner = useGameUi((state) => state.areaBanner);
  const clearAreaBanner = useGameUi((state) => state.clearAreaBanner);
  const [phase, setPhase] = useState<Phase>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!banner) return;
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    const key = banner.key;
    setPhase('in');
    timers.current.push(
      window.setTimeout(() => setPhase('out'), HOLD_MS),
      window.setTimeout(() => {
        setPhase('idle');
        clearAreaBanner(key);
      }, HOLD_MS + FADE_MS),
    );
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, [banner, clearAreaBanner]);

  if (!banner || phase === 'idle') return null;

  const tint = `#${banner.color.toString(16).padStart(6, '0')}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 transition-opacity duration-300 ${
        phase === 'out' ? 'opacity-0' : 'opacity-100'
      } ${compact ? 'top-[124px]' : 'top-[136px]'}`}
    >
      <div className="animate-welcome-in relative flex w-[min(440px,86vw)] items-center gap-3 overflow-hidden border-2 border-ink-600 bg-ink-900/94 py-2 pl-3 pr-4 backdrop-blur-sm">
        {/* 顶部 2px 区色亮线 + 左侧 3px 区色竖条：整条横幅的色标只有这一处来源 */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: tint }} />
        <span aria-hidden className="h-9 w-[3px] shrink-0" style={{ backgroundColor: tint }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] font-semibold leading-none tracking-[0.08em] text-mist-100">
            {banner.title}
          </p>
          <p className="mt-1.5 truncate font-mono text-[10px] tracking-[0.06em] text-mist-300">
            {banner.subtitle}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[8px] tracking-[0.22em] text-mist-500">ARRIVED</span>
      </div>
    </div>
  );
}
