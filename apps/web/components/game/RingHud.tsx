'use client';

import { useEffect, useState } from 'react';
import {
  RING_CAPACITY,
  RING_MAX_HP,
  RING_PHASE,
  isNearRing,
  type RingPacket,
} from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import {
  ringClock,
  ringHpTone,
  ringIsUrgent,
  ringPhaseLabel,
  ringRankLabel,
  ringRemainingMs,
  ringSeats,
  type RingSeat,
} from '@/lib/game/ring-status';

/**
 * 擂台 HUD（ADR-0073）。
 *
 * 只在「靠近擂台」或「本人参赛」时出现：全局常驻会让园区所有玩家都顶着一块
 * 与自己无关的比分板。比赛中的信息按重要性排序——
 * 倒计时 → 三个席位的血量 → 名次；颁奖时把名次提到最前。
 */

const HP_TONE: Record<'safe' | 'warn' | 'danger', string> = {
  safe: 'bg-mint-400',
  warn: 'bg-amber-400',
  danger: 'bg-signal-500',
};

const RANK_TONE: Record<number, string> = {
  1: 'text-amber-300',
  2: 'text-mist-200',
  3: 'text-[#d9a97a]',
};

function HpPips({ hp, eliminated }: { hp: number; eliminated: boolean }) {
  const tone = HP_TONE[ringHpTone(hp)];
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
      {Array.from({ length: RING_MAX_HP }, (_, index) => (
        <span
          key={index}
          className={`h-[7px] w-[3px] ${
            eliminated || index >= hp ? 'bg-ink-600' : tone
          }`}
        />
      ))}
    </span>
  );
}

function SeatRow({
  seat,
  index,
  packet,
  selfId,
}: {
  seat: RingSeat;
  index: number;
  packet: RingPacket;
  selfId: number;
}) {
  const member = seat.member;
  const self = member?.id === selfId;
  const award = packet.phase === RING_PHASE.Award;

  if (!member) {
    return (
      <div className="flex h-6 items-center gap-2 border border-dashed border-ink-700 px-1.5 text-[10px] text-mist-600">
        <span aria-hidden className="font-mono text-[9px] text-mist-600">
          {index + 1}
        </span>
        <span className="flex-1">空位</span>
        <span className="font-mono text-[9px]">可报名</span>
      </div>
    );
  }

  return (
    <div
      className={`flex h-6 items-center gap-2 px-1.5 text-[11px] ${
        self ? 'bg-mint-400/10 text-mist-100' : 'text-mist-300'
      }`}
    >
      <span aria-hidden className="w-3 shrink-0 font-mono text-[9px] text-mist-600">
        {index + 1}
      </span>
      <span className={`min-w-0 flex-1 truncate ${member.eliminated ? 'text-mist-500 line-through' : ''}`}>
        {member.name}
        {self && <span className="ml-1 text-[9px] text-mint-400">你</span>}
      </span>
      <HpPips hp={member.hp} eliminated={member.eliminated} />
      <span className="w-12 shrink-0 text-right">
        {member.eliminated ? (
          <span className="font-mono text-[9px] tracking-wider text-signal-500">淘汰</span>
        ) : award && member.rank > 0 ? (
          <span className={`font-mono text-[10px] ${RANK_TONE[member.rank] ?? 'text-mist-300'}`}>
            {ringRankLabel(member.rank)}
          </span>
        ) : (
          <span className="font-mono text-[10px] tabular-nums text-mist-400">{member.hp} HP</span>
        )}
      </span>
    </div>
  );
}

/** 颁奖时的排名板：名次 → 名字，和服务端下发的 rank 一一对应，不再本地排序 */
function AwardBoard({ packet }: { packet: RingPacket }) {
  const ranked = [...packet.members].sort((a, b) => a.rank - b.rank);
  return (
    <div className="mt-1.5 border-t border-ink-700 pt-1.5">
      {ranked.map((member) => (
        <div key={member.id} className="flex h-4 items-center gap-2 text-[10px]">
          <span className={`w-9 shrink-0 font-mono ${RANK_TONE[member.rank] ?? 'text-mist-400'}`}>
            {ringRankLabel(member.rank)}
          </span>
          <span className="min-w-0 flex-1 truncate text-mist-200">{member.name}</span>
          <span className="shrink-0 font-mono tabular-nums text-mist-500">{member.hp} HP</span>
        </div>
      ))}
    </div>
  );
}

export function RingHud({ touch = false }: { touch?: boolean }) {
  const ring = useGameUi((state) => state.ring);
  const selfId = useGameUi((state) => state.selfId);
  const x = useGameUi((state) => state.x);
  const y = useGameUi((state) => state.y);
  const [now, setNow] = useState(() => Date.now());

  const running = ring?.packet.phase === RING_PHASE.Running;

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    // 200ms 足够让「最后 10 秒」跳得利落，又不会把 React 每帧叫醒
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [running, ring]);

  if (!ring) return null;
  const packet = ring.packet;
  if (packet.phase === RING_PHASE.Idle) return null;

  const member = packet.members.find((entry) => entry.id === selfId) ?? null;
  const visible = member !== null || isNearRing(x, y);
  if (!visible) return null;

  const seats = ringSeats(packet);
  const remainingMs = ringRemainingMs(packet, ring.receivedAt, now);
  const urgent = ringIsUrgent(packet, remainingMs);
  const award = packet.phase === RING_PHASE.Award;

  return (
    <div
      className={`pointer-events-none absolute left-1/2 z-20 w-[19rem] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 ${
        touch ? 'top-[9.5rem]' : 'top-3'
      }`}
    >
      <div className="border-2 border-ink-600 bg-ink-900/92 px-2.5 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">
            擂台
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-mist-200">
            {ringPhaseLabel(packet, member !== null)}
          </span>
          {running ? (
            <span
              aria-label={`擂台上剩余 ${ringClock(remainingMs)}`}
              className={`shrink-0 font-mono text-[13px] tabular-nums ${
                urgent ? 'animate-pulse text-signal-500' : 'text-mist-100'
              }`}
            >
              {ringClock(remainingMs)}
            </span>
          ) : (
            <span className="shrink-0 font-mono text-[10px] text-mist-500">
              {packet.members.length}/{RING_CAPACITY}
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-col gap-1">
          {seats.map((seat, index) => (
            <SeatRow key={seat.slot} seat={seat} index={index} packet={packet} selfId={selfId} />
          ))}
        </div>

        {award ? (
          <AwardBoard packet={packet} />
        ) : packet.phase === RING_PHASE.Waiting ? (
          <p className="mt-1.5 text-[10px] text-mist-500">
            {member ? '再进 1 人就开始 2 分钟计时' : '第 2 人入场后开始计时'}
          </p>
        ) : urgent ? (
          <p className="mt-1.5 text-[10px] text-signal-500">最后 10 秒，撑住血量</p>
        ) : (
          <p className="mt-1.5 text-[10px] text-mist-500">
            每次命中 -1 血，归零即淘汰
          </p>
        )}
      </div>
    </div>
  );
}
