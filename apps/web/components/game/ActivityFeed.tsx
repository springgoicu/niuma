'use client';

import { useEffect, useRef, useState } from 'react';
import { useGameUi } from '@/lib/game-ui';
import {
  FEED_HOLD_MS,
  emptyFeed,
  pushFeed,
  tickFeed,
  type FeedSlot,
  type FeedState,
} from '@/lib/game/activity-feed';

/** 分级取色：强演出朱红 / 生活暖金 / 常规薄荷，与设计稿的色带一一对应 */
const TIER_BAR = ['bg-signal-500', 'bg-amber-400', 'bg-mint-400'] as const;

/** 淡出提前量：留 240ms 给过渡，队列在这一刻之后才真正移除 */
const FADE_MS = 240;

function ActivityRow({ slot }: { slot: FeedSlot }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setLeaving(false);
    // 行自己的定时器按「进入可见区的时刻」算，不受 tick 的 250ms 粒度影响
    const delay = Math.max(0, FEED_HOLD_MS - FADE_MS - (performance.now() - slot.shownAt));
    const timer = setTimeout(() => setLeaving(true), delay);
    return () => clearTimeout(timer);
  }, [slot.item.key, slot.shownAt]);

  return (
    <div
      className={`activity-row flex items-stretch gap-2.5 border-2 border-ink-600 bg-ink-900/94 py-1.5 pr-3 backdrop-blur-sm transition-all duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        leaving ? '-translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
      }`}
      // 强演出加一次 900ms 的边框呼吸：只在入场时跑一遍，不循环抢注意力
      style={
        slot.item.tier === 0
          ? { animation: 'activity-pulse 900ms cubic-bezier(0.22, 1, 0.36, 1) 1' }
          : { animation: 'activity-in 180ms cubic-bezier(0.22, 1, 0.36, 1) 1' }
      }
    >
      <span
        aria-hidden
        className={`w-[3px] shrink-0 ${TIER_BAR[slot.item.tier] ?? TIER_BAR[2]}`}
      />
      <p className="min-w-0 flex-1 pt-0.5 text-[12px] leading-snug text-mist-100">{slot.item.text}</p>
    </div>
  );
}

/**
 * 顶部播报条（ADR-0112）。
 *
 * 只做「远处也没错过」：完整动画仍在现场，这里只有一句话。队列规则收在
 * `activity-feed.ts`，组件只负责把 `visible` 画出来与开关偏好。
 *
 * `portrait` 是竖屏触控排版：顶栏收成两列方钮后高度翻倍，播报条必须下移，
 * 否则会压在手牌与工具栏上。
 */
export function ActivityFeed({ portrait }: { portrait: boolean }) {
  const events = useGameUi((state) => state.activities);
  const open = useGameUi((state) => state.activityFeedOpen);
  const [feed, setFeed] = useState<FeedState>(emptyFeed);
  /** 已入队的最大 key：zustand 只追加，靠它找出「这一批新事件」 */
  const pushedRef = useRef(0);

  useEffect(() => {
    const fresh = events.filter((event) => event.key > pushedRef.current);
    if (fresh.length === 0) return;
    pushedRef.current = events[events.length - 1]?.key ?? pushedRef.current;
    const now = performance.now();
    setFeed((state) => fresh.reduce((next, item) => pushFeed(next, item, now), state));
  }, [events]);

  useEffect(() => {
    // 空队列不挂定时器：园区安静时这里没有任何周期任务
    if (feed.visible.length === 0 && feed.queue.length === 0) return;
    const timer = setInterval(() => setFeed((state) => tickFeed(state, performance.now())), 250);
    return () => clearInterval(timer);
  }, [feed.visible.length, feed.queue.length]);

  if (!open || feed.visible.length === 0) return null;

  const hasDramatic = feed.visible.some((slot) => slot.item.tier === 0);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3 ${
        portrait ? 'top-[172px]' : 'top-[58px]'
      }`}
      role="status"
      // 只有强演出进读屏：坐下 / 挥手这类常规动作每秒都有，读屏会被念到没法玩
      aria-live={hasDramatic ? 'polite' : 'off'}
      aria-atomic="false"
    >
      <div className="flex w-full max-w-[520px] flex-col gap-1.5">
        {feed.visible.map((slot) => (
          <ActivityRow key={slot.item.key} slot={slot} />
        ))}
        {feed.queue.length > 0 && (
          <p className="pl-1 font-mono text-[9px] tracking-[0.12em] text-mist-500">
            还有 {feed.queue.length} 条动态
          </p>
        )}
      </div>
    </div>
  );
}
