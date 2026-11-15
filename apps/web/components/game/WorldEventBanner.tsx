'use client';

import { useEffect, useState } from 'react';
import {
  BOSS_SHOCK,
  BOSS_SHOCK_PHASE,
  WORLD_EVENT_KIND,
  WORLD_EVENT_PHASE,
  worldEventSubtitle,
  worldEventTitle,
} from '@niuma/shared-types';
import { useGameUi } from '../../lib/game-ui';

/**
 * 全服事件横幅（ADR-0088）。
 *
 * 服务端只在阶段切换时发一条包，倒计时由这里按 `remainingSec` 本地推进：
 * 20Hz 的 Tick 上多发一条每秒的横幅包，等于给每个玩家白送 0.2KB/s。
 *
 * 位置固定在顶部安全区下方，与断线横幅 / 老板倒下提示错开，互不遮挡。
 */
export function WorldEventBanner() {
  const event = useGameUi((state) => state.worldEvent);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!event) return;
    const timer = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(timer);
  }, [event]);

  if (!event) return null;
  const { packet, receivedAt } = event;
  const elapsed = Math.max(0, now - receivedAt);
  const remainingMs = Math.max(0, packet.remainingSec * 1000 - elapsed);
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = packet.phase !== WORLD_EVENT_PHASE.Resolve && seconds <= 3;
  const raining = packet.kind === WORLD_EVENT_KIND.RedPacketRain;

  // 结算横幅只在服务端给的 2 秒窗口里显示
  if (packet.phase === WORLD_EVENT_PHASE.Resolve && elapsed > 2200) return null;

  const detail =
    packet.phase === WORLD_EVENT_PHASE.Resolve
      ? raining
        ? '红包抢完了，下次赶早'
        : `全勤 ${packet.amount} 人，奖金已到账`
      : raining
        ? `广场上还剩 ${packet.amount} 个红包`
        : worldEventSubtitle(packet.kind, packet.phase);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4">
      <div
        className={`flex min-w-[260px] max-w-[420px] items-center gap-3 rounded-full border-2 px-4 py-2 backdrop-blur-sm transition-colors duration-300 ${
          urgent
            ? 'animate-pulse border-[#e6483c] bg-[#2a1216]/92'
            : 'border-[#f5c451]/70 bg-[#0b1020]/90'
        }`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${
            raining ? 'bg-[#d8322c]/25 text-[#ffb3ad]' : 'bg-[#7cf5b0]/15 text-[#7cf5b0]'
          }`}
          aria-hidden="true"
        >
          {raining ? '🧧' : '👔'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-bold tracking-wide text-[#f2f5ff]">
              {worldEventTitle(packet.kind)}
            </span>
            {packet.phase !== WORLD_EVENT_PHASE.Resolve && (
              <span
                className={`font-mono text-lg font-bold tabular-nums ${
                  urgent ? 'text-[#ff8a7a]' : 'text-[#f5c451]'
                }`}
              >
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:
                {String(seconds % 60).padStart(2, '0')}
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-[#9aa7c7]">{detail}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * 画饼冲击波提示（ADR-0088）。
 *
 * 红色预警圈本身画在世界坐标里（`WorldEventFx`），这里只补一层屏幕边缘的警示：
 * 圈可能不在视野内，玩家仍需要知道「按 Space」——否则只会觉得莫名其妙被震趴。
 */
export function BossShockFlash() {
  const shock = useGameUi((state) => state.bossShock);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!shock) return;
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [shock]);

  if (!shock) return null;
  const { packet, receivedAt } = shock;
  const lifeMs =
    packet.phase === BOSS_SHOCK_PHASE.Warn ? BOSS_SHOCK.WarnMs : BOSS_SHOCK.WarnMs * 0.3;
  const elapsed = now - receivedAt;
  if (elapsed > lifeMs) return null;
  const warn = packet.phase === BOSS_SHOCK_PHASE.Warn;
  const fade = Math.max(0, 1 - elapsed / lifeMs);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="absolute inset-0"
        style={{
          boxShadow: `inset 0 0 ${warn ? 90 : 140}px ${warn ? 36 : 60}px rgba(230,72,60,${0.35 * fade})`,
        }}
      />
      <div className="absolute inset-x-0 top-1/3 flex justify-center">
        <div
          className={`rounded-md border-2 px-3 py-1 font-mono text-xs tracking-widest ${
            warn
              ? 'border-[#e6483c] bg-[#2a1216]/85 text-[#ff8a7a]'
              : 'border-[#f5c451] bg-[#2a2412]/85 text-[#f5c451]'
          }`}
          style={{ opacity: fade }}
        >
          {warn ? '画饼冲击波！按 Space 跳起' : `冲击波命中 ${packet.hits} 人`}
        </div>
      </div>
    </div>
  );
}
