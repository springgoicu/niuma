'use client';

import { useEffect, useRef, useState } from 'react';
import { useGameUi } from '@/lib/game-ui';

/** 停留时长与淡出时长：与 globals.css 的 welcome-run 进度条保持一致 */
const HOLD_MS = 5600;
const FADE_MS = 320;

type Phase = 'idle' | 'in' | 'out';

/**
 * 入场欢迎条（ADR-0036）：第一次进入园区时从顶部/底部出现一次，几秒后淡出。
 *
 * 只认「第一次 online」：断线重连、切标签页回来都不会再弹一遍。
 * 不拦任何指针事件，也不读 localStorage——一次性的引导不该留下状态。
 */
export function WelcomeBanner({ compact = false, portrait = false }: { compact?: boolean; portrait?: boolean }) {
  const status = useGameUi((state) => state.status);
  const chatOpen = useGameUi((state) => state.chatOpen);
  const entered = useRef(false);
  const timers = useRef<number[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    if (status !== 'online' || entered.current) return;
    entered.current = true;
    setPhase('in');
    timers.current.push(
      window.setTimeout(() => setPhase('out'), HOLD_MS),
      window.setTimeout(() => setPhase('idle'), HOLD_MS + FADE_MS),
    );
  }, [status]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  // 打字时让位给输入框与候选词：欢迎条只是引导，不该压在聊天上
  if (phase === 'idle' || chatOpen) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute left-1/2 z-30 w-[min(520px,92vw)] -translate-x-1/2 transition-opacity duration-300 ${
        phase === 'out' ? 'opacity-0' : 'opacity-100'
      } ${compact ? (portrait ? 'bottom-[232px]' : 'bottom-[148px]') : 'top-[232px]'}`}
    >
      <div
        className={`animate-welcome-in relative overflow-hidden border-2 border-ink-600 bg-ink-900/95 backdrop-blur-sm ${
          compact ? 'px-4 py-3' : 'px-5 py-4'
        }`}
      >
        <span className="absolute inset-x-0 top-0 h-0.5 bg-mint-400" aria-hidden />

        <div className="flex items-start gap-3">
          <span className="mt-1 h-2.5 w-2.5 shrink-0 bg-mint-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={`font-display font-semibold leading-none tracking-[0.06em] text-mist-100 ${compact ? 'text-[20px]' : 'text-[26px]'}`}>
              欢迎来到牛马园
            </p>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.28em] text-mist-500">
              welcome to niuma park · shift 03
            </p>
            <p
              className={`mt-2.5 font-mono tracking-[0.06em] text-mist-300 ${compact ? 'text-[9px]' : 'border-t-2 border-ink-700 pt-2.5 text-[10px]'}`}
            >
              {compact
                ? `${portrait ? '左下' : '左半屏'}拖动移动 · 右下动作盘 · 聊天在左上`
                : 'WASD 移动 · Z 坐下 · X 躺平 · F 互动 · Enter 打字'}
            </p>
          </div>
          <span className="tag mt-0.5 shrink-0">北门</span>
        </div>

        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-700" aria-hidden>
          <span className="animate-welcome-run block h-full origin-left bg-mint-400/70" />
        </span>
      </div>
    </div>
  );
}
