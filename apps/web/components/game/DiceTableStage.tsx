'use client';

import { useState } from 'react';
import {
  DICE_MAX_BET,
  DICE_MIN_BET,
  DICE_PHASE,
  DICE_SIDE,
  DICE_SIDE_NAME,
  type DiceTablePacket,
} from '@niuma/shared-types';
import { DiceFace } from './DiceFace';

/**
 * 牌桌区（ADR-0087 / ADR-0110）：选档位、定投入额、确认投入。
 *
 * 只显示「公共奖池 + 我的投入」而不显示固定倍率：奖池由所有人投入额实时合成，
 * 猜中档位的人按投入额分走奖池。亮牌后骰面点亮，与右侧结算单同一套骰面。
 */
interface DiceTableStageProps {
  table: number;
  info: DiceTablePacket | null;
  coins: number;
  onBet(table: number, side: number, amount: number): void;
}

const SIDES = [DICE_SIDE.Big, DICE_SIDE.Small, DICE_SIDE.Leopard] as const;
const PRESETS = [10, 50, 200, 500] as const;

const PHASE_LABEL: Record<number, string> = {
  [DICE_PHASE.Betting]: '投选中',
  [DICE_PHASE.Rolling]: '摇骰中',
  [DICE_PHASE.Reveal]: '亮牌结算',
  [DICE_PHASE.Idle]: '等待开局',
};

export function DiceTableStage({ table, info, coins, onBet }: DiceTableStageProps) {
  const [side, setSide] = useState<number>(DICE_SIDE.Big);
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState('');

  const betting = info?.phase === DICE_PHASE.Betting;
  const placed = (info?.myBet ?? 0) > 0;
  const capped = Math.max(DICE_MIN_BET, Math.min(DICE_MAX_BET, Math.floor(amount)));
  const affordable = capped <= coins;
  const seconds = info ? Math.ceil(info.remainingMs / 1000) : 0;
  // 服务端只在亮牌期下发点数；这里再按阶段收一次口，Rolling 阶段不提前揭晓
  const revealed = info !== null && info.phase === DICE_PHASE.Reveal && info.dice.every((v) => v > 0);
  const disabled = !betting || placed || !affordable;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-2 border-ink-700 bg-ink-800/60 px-2 py-1">
        <span className="font-mono text-[10px] text-mist-400">
          {PHASE_LABEL[info?.phase ?? DICE_PHASE.Betting]} · {seconds}s
        </span>
        <span className="font-mono text-[10px] text-amber-400">奖池 {info?.totalPot ?? 0} 币</span>
      </div>

      <div className="mt-2 flex items-center justify-center gap-2">
        {[0, 1, 2].map((index) => (
          <span key={info?.roundId ?? -1} className="animate-board-in inline-flex">
            <DiceFace size="lg" value={revealed ? info!.dice[index]! : 0} />
          </span>
        ))}
      </div>
      <p className="mt-1 text-center font-mono text-[9px] leading-relaxed">
        {info?.raid ? (
          <span className="text-signal-500">本局保安查岗：猜中的奖池收 5% 服务费</span>
        ) : (
          <span className="text-mist-500">0% 服务费 · 猜中档位按投入额分走奖池</span>
        )}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-1">
        {SIDES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value)}
            aria-pressed={side === value}
            className={`cursor-pointer border-2 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-mint-400 ${
              side === value
                ? 'border-mint-500 bg-mint-500/15 text-mint-300'
                : 'border-ink-700 text-mist-200 hover:border-ink-500 hover:bg-ink-800'
            }`}
          >
            {DICE_SIDE_NAME[value]}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-baseline justify-between px-1">
        <p className="text-[10px] text-mist-400">
          投入 <span className="font-mono text-amber-400">{capped}</span> 币
          <span className="ml-2 font-mono text-mist-500">余额 {coins}</span>
        </p>
        {placed && (
          <span className="font-mono text-[9px] text-mint-400">
            已投入 {info!.myBet} · {DICE_SIDE_NAME[info!.mySide] ?? '—'}
          </span>
        )}
      </div>

      <div className="mt-1 grid grid-cols-4 gap-1">
        {PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setAmount(value);
              setCustom('');
            }}
            aria-pressed={custom === '' && amount === value}
            className={`cursor-pointer border-2 py-1 font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
              custom === '' && amount === value
                ? 'border-amber-400 bg-amber-400/15 text-amber-400'
                : 'border-ink-700 text-mist-300 hover:border-ink-500 hover:bg-ink-800'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="mt-1 flex items-center gap-1">
        <input
          value={custom}
          inputMode="numeric"
          aria-label="自定义投入额"
          placeholder="自定义投入额"
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d]/g, '');
            setCustom(next);
            if (next) setAmount(Number(next));
          }}
          className="min-w-0 flex-1 border-2 border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11px] text-mist-100 outline-none placeholder:text-mist-500 focus:border-mint-500"
        />
        <button
          type="button"
          onClick={() => {
            setAmount(Math.min(capped + 50, DICE_MAX_BET));
            setCustom('');
          }}
          className="cursor-pointer border-2 border-ink-700 px-2 py-1 font-mono text-[10px] text-mist-300 hover:border-ink-500 hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-mint-400"
        >
          +50
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onBet(table, side, capped)}
        className={`mt-2 w-full border-2 py-2 text-[12px] font-semibold transition-colors ${
          disabled
            ? 'cursor-not-allowed border-ink-700 text-mist-500'
            : 'cursor-pointer border-mint-500 bg-mint-500/15 text-mint-300 hover:bg-mint-500/25 focus-visible:outline-2 focus-visible:outline-mint-400'
        }`}
      >
        {!betting
          ? '本局已截止，等下一局'
          : placed
            ? '本局已投入'
            : affordable
              ? `投入 ${capped} 币 · ${DICE_SIDE_NAME[side]}`
              : '余额不足'}
      </button>
    </div>
  );
}
