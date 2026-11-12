'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FISH_ACHIEVEMENT,
  FISH_UNLOCK_COUNT,
  readAlmanac,
  recordFishKnock,
  todayKnocks,
} from '@/lib/game/almanac-store';
import { playWoodfish } from '@/lib/game/woodfish-audio';

/**
 * 赛博木鱼（ADR-0059）。
 *
 * 敲击的账本在 `almanac-store`，声音在 `woodfish-audio`，这里只负责：
 * 金色飘字的队列、木鱼的下沉反馈、以及「今日 N / 20」与解锁章。
 *
 * 状态放在 hook 里而不是组件里，是因为键盘的空格由弹窗统一接：
 * 同一个 `strike()` 必须既能被按钮点击，也能被 capture 阶段的 keydown 调用。
 */

const WORDS = ['放假进度 +1s', '功德 +1', '离自由更近一步'] as const;
const MAX_WORDS = 4;
const WORD_LIFE_MS = 1_100;

export interface FishWord {
  id: number;
  text: string;
  /** 每一下的横向漂移，避免两句话完全重叠 */
  drift: number;
}

export interface FishDrumState {
  todayCount: number;
  unlocked: boolean;
  /** 本次打开面板期间刚解锁：用于显示一次性成就条 */
  justUnlocked: boolean;
  /** 敲击计数：组件用它触发一次下沉动画 */
  pulse: number;
  words: readonly FishWord[];
  strike(): void;
}

export function useFishDrum(): FishDrumState {
  const [todayCount, setTodayCount] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [words, setWords] = useState<FishWord[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  // 首帧用 0 / false：SSR 没有 localStorage，挂载后再读盘，避免水合告警
  useEffect(() => {
    setTodayCount(todayKnocks());
    setUnlocked(readAlmanac().unlockedOn !== null);
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.length = 0;
    };
  }, []);

  const strike = useCallback(() => {
    const result = recordFishKnock();
    setTodayCount(result.todayCount);
    setPulse(result.todayCount);
    if (result.unlocked) {
      setUnlocked(true);
      setJustUnlocked(true);
    }
    playWoodfish();

    seq.current += 1;
    const id = seq.current;
    const word: FishWord = {
      id,
      text: WORDS[id % WORDS.length]!,
      drift: ((id % 5) - 2) * 6,
    };
    setWords((prev) => [...prev.slice(-(MAX_WORDS - 1)), word]);
    timers.current.push(
      window.setTimeout(() => {
        setWords((prev) => prev.filter((item) => item.id !== id));
      }, WORD_LIFE_MS),
    );
  }, []);

  return { todayCount, unlocked, justUnlocked, pulse, words, strike };
}

/** 像素木鱼：纯矩形拼出来的 SVG，配一枚铜环与木槌；击打时整只船下沉 2px */
export function FishDrum({ drum }: { drum: FishDrumState }) {
  const [hitting, setHitting] = useState(false);

  useEffect(() => {
    if (drum.pulse === 0) return;
    setHitting(true);
    const timer = window.setTimeout(() => setHitting(false), 140);
    return () => window.clearTimeout(timer);
  }, [drum.pulse]);

  const progress = Math.min(drum.todayCount, FISH_UNLOCK_COUNT);

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-1.5">
      {/* 金色飘字：从木鱼上方升起，1.1s 后自己消失 */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-1 left-1/2 z-10 h-16 w-32 -translate-x-1/2">
        {drum.words.map((word) => (
          <span
            key={word.id}
            className="animate-fish-word absolute bottom-2 left-1/2 whitespace-nowrap font-mono text-[10px] font-semibold tracking-[0.08em] text-amber-400 drop-shadow-[0_1px_0_rgba(40,24,10,0.9)]"
            style={{ '--drift': `${word.drift}px` } as React.CSSProperties}
          >
            {word.text}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={drum.strike}
        aria-label={`敲一下赛博木鱼，今日已敲 ${drum.todayCount} 次`}
        title="敲一下（空格）"
        className="group grid h-16 w-20 cursor-pointer place-items-end rounded-sm border-2 border-[#5b3d2a] bg-[#7a5237]/30 pb-0.5 transition-colors hover:border-[#3d281b] hover:bg-[#7a5237]/45 focus-visible:border-amber-400 focus-visible:outline-none"
      >
        <svg
          viewBox="0 0 64 54"
          width="64"
          height="54"
          aria-hidden="true"
          shapeRendering="crispEdges"
          className={`transition-transform ${hitting ? 'animate-fish-hit' : 'group-active:translate-y-[2px]'}`}
        >
          <rect x="12" y="46" width="40" height="3" fill="rgba(30,18,10,0.35)" />
          {/* 木槌：敲击时跟着木鱼一起下沉 */}
          <rect x="45" y="7" width="3" height="15" fill="#8a6446" />
          <rect x="43" y="2" width="8" height="6" fill="#a97b52" />
          <rect x="43" y="2" width="8" height="1" fill="#c79a6c" />
          {/* 鱼身：阶梯边角让它一眼读成木鱼而不是箱子 */}
          <rect x="14" y="22" width="36" height="22" fill="#5b3d2a" />
          <rect x="10" y="26" width="44" height="14" fill="#5b3d2a" />
          <rect x="16" y="24" width="32" height="18" fill="#8a6446" />
          <rect x="12" y="28" width="40" height="10" fill="#8a6446" />
          <rect x="18" y="26" width="28" height="3" fill="#a97b52" />
          <rect x="24" y="32" width="16" height="3" fill="#3b2a1e" />
          <rect x="28" y="35" width="8" height="2" fill="#3b2a1e" />
          {/* 铜环与铆钉 */}
          <rect x="47" y="22" width="4" height="4" fill="#f2c879" />
          <rect x="48" y="23" width="2" height="2" fill="#ffe49a" />
          <rect x="18" y="19" width="2" height="2" fill="#f2c879" />
          <rect x="10" y="30" width="2" height="2" fill="#d8a33f" />
        </svg>
      </button>

      <p className="font-mono text-[9px] tracking-[0.12em] text-[#5c4632]">
        今日 <span className="tabular-nums text-[#2a2118]">{drum.todayCount}</span> / {FISH_UNLOCK_COUNT}
      </p>
      <div className="h-1 w-20 border border-[#7a5237]/70 bg-[#d8c39d]">
        <div
          className="h-full bg-amber-400 transition-[width] duration-300 ease-out"
          style={{ width: `${(progress / FISH_UNLOCK_COUNT) * 100}%` }}
          aria-hidden="true"
        />
      </div>
      {drum.unlocked && (
        <span className="animate-stamp-in mt-1 rotate-[12deg] border-2 border-[#b83b3b] px-1.5 py-0.5 font-mono text-[8px] font-semibold tracking-[0.1em] text-[#b83b3b]">
          {FISH_ACHIEVEMENT}
        </span>
      )}
    </div>
  );
}
