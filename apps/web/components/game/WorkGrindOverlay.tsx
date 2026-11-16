'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORK_REWARD, workPayout } from '@niuma/shared-types';
import {
  comboMilestone,
  createWorkRound,
  finishWorkRound,
  isWorkRoundDone,
  typeWorkKey,
  workRoundRemainingMs,
  type WorkGrindRound,
} from '../../lib/game/work-grind';

interface WorkGrindOverlayProps {
  open: boolean;
  /** 工效等级：只用于「本轮 ≈ N 币」的预估，真金额由服务端算 */
  workEffLv: number;
  /** 是否夜班：与 `isNightShift` 同一把尺子 */
  night: boolean;
  /** 完成一轮：宿主转发 `claimWork`，金额回包后由飘字呈现 */
  onClaim: (combo: number) => void;
  onClose: () => void;
}

/** 一轮结束到下一轮开始之间的喘息：够看清「已结算」，又不至于手冷掉 */
const INTERMISSION_MS = 720;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * 加班搬砖终端小游戏（ADR-0088）。
 *
 * 三条硬约束：
 * 1. **不遮挡中央画面**：面板固定在下三分之一、宽度上限 560px，角色与老板血条都露着；
 * 2. **输入法防误触**：组合中的按键（`isComposing` / keyCode 229）一律忽略，
 *    输入框里打字也不会掉字母；
 * 3. **只在本地做玩法**：每轮结束只上报连击数，金额、坐姿与间隔全由服务端裁决。
 */
export function WorkGrindOverlay({
  open,
  workEffLv,
  night,
  onClaim,
  onClose,
}: WorkGrindOverlayProps) {
  const roundRef = useRef<WorkGrindRound | null>(null);
  const [tick, setTick] = useState(0);
  const [streak, setStreak] = useState<{ key: number; amount: number } | null>(null);
  const [shake, setShake] = useState(0);
  const claimedRef = useRef(0);
  const rafRef = useRef(0);
  const intermissionUntil = useRef(0);
  // 倒计时与进度条是逐帧变化的瞬时值：走 ref 直写 DOM，不进 React 状态。
  // 进状态的代价是每 33ms 让整块面板（含磨砂背景）重渲染一次，把 canvas 的帧预算吃光。
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const estimate = useMemo(
    () => workPayout(0.5, workEffLv, night),
    [workEffLv, night],
  );

  const restart = useCallback(() => {
    roundRef.current = createWorkRound(performance.now());
    claimedRef.current = 0;
    intermissionUntil.current = 0;
    setStreak(null);
    setTick((value) => value + 1);
  }, []);

  // 打开即开一轮；关闭时彻底丢弃状态，避免下次打开停在半轮上
  useEffect(() => {
    if (!open) {
      roundRef.current = null;
      return;
    }
    restart();
    return () => {
      roundRef.current = null;
    };
  }, [open, restart]);

  // 帧推进：只负责「超时结束」与时钟直写，按键结算走 keydown，不必每个键都等一帧。
  // 倒计时与进度条直写 DOM，React 只在轮次切换与按键时重渲染（rerender-use-ref-transient-values）。
  useEffect(() => {
    if (!open) return;
    let last = 0;
    const paintClock = (round: WorkGrindRound, now: number) => {
      const text = clockRef.current;
      if (text) {
        const label = `${(workRoundRemainingMs(round, now) / 1000).toFixed(1)}s`;
        if (text.textContent !== label) text.textContent = label;
      }
      const bar = barRef.current;
      if (bar) {
        const ratio = Math.max(0, Math.min(1, 1 - workRoundRemainingMs(round, now) / WORK_REWARD.RoundMs));
        const width = `${Math.round(ratio * 100)}%`;
        if (bar.style.width !== width) bar.style.width = width;
      }
    };
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const round = roundRef.current;
      if (!round) return;
      // 已结算：等喘息结束再开下一轮。喘息截止时间只在结束那一刻写一次，
      // 每帧都重写会把下一轮无限推迟。
      if (round.finishedAt !== 0) {
        if (now >= intermissionUntil.current) {
          intermissionUntil.current = 0;
          restart();
          return;
        }
      } else if (isWorkRoundDone(round, now)) {
        finishWorkRound(round, now);
        // 只有敲完全部字母才算「完成一轮」，超时中断不发领取请求
        if (round.index >= round.sequence.length && claimedRef.current !== round.startedAt) {
          claimedRef.current = round.startedAt;
          onClaim(round.maxCombo);
          setStreak({ key: round.startedAt, amount: -1 });
        }
        intermissionUntil.current = now + INTERMISSION_MS;
      }
      paintClock(round, now);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, onClaim, restart]);

  // 键盘：capture 阶段吃掉按键，避免同一次按键把角色也踹出去
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      // 输入框 / 聊天框里打字不算搬砖；不拦浏览器快捷键
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const round = roundRef.current;
        if (round) finishWorkRound(round, performance.now());
        onClose();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // 长按不重复计数：按住 W 不该被判成十几次失误
      if (event.repeat) return;
      if (event.key.length !== 1) return;
      const round = roundRef.current;
      if (!round) return;
      event.preventDefault();
      event.stopPropagation();
      const verdict = typeWorkKey(round, event.key, performance.now());
      if (verdict === 'miss') setShake((value) => value + 1);
      setTick((value) => value + 1);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open, onClose]);

  if (!open) return null;

  const round = roundRef.current;
  const now = performance.now();
  const remaining = round ? workRoundRemainingMs(round, now) : 0;
  const progress = round ? Math.max(0, Math.min(1, 1 - remaining / WORK_REWARD.RoundMs)) : 0;
  const current = round?.sequence[round.index] ?? '';
  const next = round?.sequence[round.index + 1] ?? '';
  const tier = comboMilestone(round?.combo ?? 0);
  const borderTone =
    tier >= 3
      ? 'border-[#f5c451]'
      : tier >= 2
        ? 'border-[#7cf5b0]'
        : 'border-white/15';

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-4"
      data-tick={tick}
    >
      <div
        className={`pointer-events-auto w-full max-w-[560px] rounded-xl border-2 ${borderTone} bg-[#0b1020]/92 px-4 py-3 font-mono shadow-[0_0_28px_rgba(124,245,176,0.14)] backdrop-blur-sm transition-[border-color] duration-200`}
        style={{ transform: shake % 2 === 0 ? undefined : 'translateX(1px)' }}
      >
        {/* 顶栏：标题 + 连击 + 8 秒进度 */}
        <div className="flex items-center justify-between text-[11px] tracking-wider text-[#9aa7c7]">
          <span className="flex items-center gap-2 text-[#7cf5b0]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#7cf5b0]" />
            OVERTIME.EXE
          </span>
          <span className={tier > 0 ? 'text-[#f5c451]' : 'text-[#9aa7c7]'}>
            连击 ×{round?.combo ?? 0}
            {tier >= 2 ? ' · 手感不错' : ''}
          </span>
          <span ref={clockRef}>{(remaining / 1000).toFixed(1)}s</span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            ref={barRef}
            className="h-full rounded-full bg-gradient-to-r from-[#7cf5b0] to-[#f5c451] transition-[width] duration-100"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        {/* 中部：伪代码行 + 当前目标字母 */}
        <div className="mt-3 rounded-lg bg-black/40 px-3 py-2 text-[11px] leading-5 text-[#5c6b8a]">
          <div>
            <span className="text-[#7cf5b0]">$</span> niuma worker --overtime --release
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-[#9aa7c7]">敲下高亮字母：</span>
            <span className="text-2xl font-bold tracking-[0.2em] text-[#f5c451] drop-shadow-[0_0_8px_rgba(245,196,81,0.55)]">
              {current || '✓'}
            </span>
            <span className="text-base tracking-[0.3em] text-white/25">{next}</span>
          </div>
          <div className="mt-1 truncate text-[10px] text-[#4b5878]">
            {round?.sequence.slice(0, 20).join(' ') ?? ''}
          </div>
        </div>

        {/* 底栏：预估产出 + 退出提示 */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-[#9aa7c7]">
          <span>
            本轮 ≈ <span className="text-[#f5c451]">{estimate}</span> 币
            {night ? ' · 夜班 ×1.5' : ''}
            {workEffLv > 0 ? ` · 工效 +${workEffLv * 8}%` : ''}
          </span>
          <span className="text-[#5c6b8a]">
            {streak ? '已提交结算 · ' : ''}ESC 摸鱼
          </span>
        </div>
      </div>
    </div>
  );
}
