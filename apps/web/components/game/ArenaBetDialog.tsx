'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  RING_BET_MAX,
  RING_BET_MIN,
  RING_PHASE,
  RING_SIDE,
  RING_SIDE_NAME,
  type ArenaPoolPacket,
  type RingPacket,
} from '@niuma/shared-types';

interface ArenaBetDialogProps {
  pool: ArenaPoolPacket | null;
  ring: RingPacket | null;
  coins: number;
  onClose: () => void;
  onBet: (side: number, amount: number) => void;
}

const PRESETS = [10, 50, 200, 500] as const;

/**
 * 绩效八角笼观战押注（ADR-0087）。
 *
 * 只有坐在观战长椅上的玩家能押（服务端按 `seat.group === 'arena-bench'` 复核）；
 * 彩池是双方注额之和，押中一侧按注额比例分走全池，平台不抽水。
 */
export function ArenaBetDialog({ pool, ring, coins, onClose, onBet }: ArenaBetDialogProps) {
  const [side, setSide] = useState<number>(RING_SIDE.Red);
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState('');

  const running = (pool?.phase ?? ring?.phase ?? RING_PHASE.Idle) === RING_PHASE.Running;
  const placed = (pool?.myBet ?? 0) > 0;
  const capped = Math.max(RING_BET_MIN, Math.min(RING_BET_MAX, Math.floor(amount)));
  const red = pool?.redPool ?? 0;
  const blue = pool?.bluePool ?? 0;
  const total = red + blue;
  const redPct = total > 0 ? Math.round((red / total) * 100) : 50;

  const redMember = ring?.members.find((member) => member.slot === RING_SIDE.Red) ?? null;
  const blueMember = ring?.members.find((member) => member.slot === RING_SIDE.Blue) ?? null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-4 pb-24 sm:items-center sm:pb-0">
      <div className="w-full max-w-[380px] border-2 border-ink-600 bg-ink-900/95 p-3 shadow-[4px_4px_0_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-mist-100">
            绩效八角笼 · <span className="text-mint-400">观战押注</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink-700 p-1 text-mist-400 hover:text-signal-500"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1">
          {[RING_SIDE.Red, RING_SIDE.Blue].map((value) => {
            const member = value === RING_SIDE.Red ? redMember : blueMember;
            const isRed = value === RING_SIDE.Red;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setSide(value)}
                className={`border-2 px-2 py-1.5 text-left ${
                  side === value
                    ? isRed
                      ? 'border-signal-500 bg-signal-500/10'
                      : 'border-[#3B7BD4] bg-[#3B7BD4]/10'
                    : 'border-ink-700 hover:bg-ink-800'
                }`}
              >
                <span className={`block text-[11px] font-semibold ${isRed ? 'text-signal-500' : 'text-[#7DA9E8]'}`}>
                  {RING_SIDE_NAME[value]}
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-mist-100">
                  {member?.name ?? '虚位以待'}
                </span>
                <span className="mt-0.5 block font-mono text-[9px] text-mist-500">
                  {member ? `${member.hp} 血` : `报名 ${RING_BET_MIN} 币起`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex h-2 w-full overflow-hidden border border-ink-700">
          <span className="h-full bg-signal-500/70" style={{ width: `${redPct}%` }} />
          <span className="h-full flex-1 bg-[#3B7BD4]/70" />
        </div>
        <p className="mt-1 flex justify-between font-mono text-[9px] text-mist-400">
          <span>红池 {red}</span>
          <span>蓝池 {blue}</span>
        </p>

        <p className="mt-2 px-1 text-[10px] text-mist-400">
          押注 <span className="font-mono text-[#F2C879]">{capped}</span> 币 · 余额{' '}
          <span className="font-mono">{coins}</span>
          {placed && <span className="ml-2 text-mint-400">本场已押 {pool!.myBet}</span>}
        </p>
        <div className="mt-1 grid grid-cols-4 gap-1">
          {PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setAmount(value);
                setCustom('');
              }}
              className={`border-2 py-1 font-mono text-[11px] ${
                amount === value
                  ? 'border-[#F2C879] bg-[#F2C879]/15 text-[#F2C879]'
                  : 'border-ink-700 text-mist-300 hover:bg-ink-800'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <input
          value={custom}
          inputMode="numeric"
          placeholder="自定义注额"
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d]/g, '');
            setCustom(next);
            if (next) setAmount(Number(next));
          }}
          className="mt-1 w-full border-2 border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11px] text-mist-100 outline-none focus:border-mint-500"
        />

        <button
          type="button"
          disabled={!running || placed || capped > coins}
          onClick={() => onBet(side, capped)}
          className={`mt-2 w-full border-2 py-2 text-[12px] font-semibold ${
            !running || placed || capped > coins
              ? 'cursor-not-allowed border-ink-700 text-mist-500'
              : 'border-mint-500 bg-mint-500/15 text-mint-300 hover:bg-mint-500/25'
          }`}
        >
          {!running ? '比赛中途开押，等下一场' : placed ? '本场已押注' : `押 ${capped} 币 · ${RING_SIDE_NAME[side]}`}
        </button>
      </div>
    </div>
  );
}
