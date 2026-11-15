'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  DICE_MAX_BET,
  DICE_MIN_BET,
  DICE_PHASE,
  DICE_SIDE,
  DICE_SIDE_NAME,
  DICE_TABLES,
  type DiceStatePacket,
} from '@niuma/shared-types';

interface DiceHallDialogProps {
  /** 桌号：0 翡翠桌 / 1 鎏金桌 */
  table: number;
  dice: DiceStatePacket | null;
  coins: number;
  onClose: () => void;
  onBet: (table: number, side: number, amount: number) => void;
}

const SIDES = [DICE_SIDE.Big, DICE_SIDE.Small, DICE_SIDE.Leopard] as const;
const PRESETS = [10, 50, 200, 500] as const;

const PHASE_LABEL: Record<number, string> = {
  [DICE_PHASE.Betting]: '下注中',
  [DICE_PHASE.Rolling]: '摇骰中',
  [DICE_PHASE.Reveal]: '亮牌结算',
  [DICE_PHASE.Idle]: '等待开局',
};

/**
 * 摸鱼大赌场下注面板（ADR-0087）。
 *
 * 只负责「选档位 + 选注额 + 确认」；彩池由所有人注额实时合成，
 * 所以界面显示的是池子与自己的注，不是固定赔率——0% 抽水，押中的人按注额分池。
 */
export function DiceHallDialog({ table, dice, coins, onClose, onBet }: DiceHallDialogProps) {
  const spec = DICE_TABLES.find((item) => item.id === table) ?? DICE_TABLES[0]!;
  const info = dice?.tables.find((item) => item.id === table) ?? null;
  const [side, setSide] = useState<number>(DICE_SIDE.Big);
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState('');

  const betting = info?.phase === DICE_PHASE.Betting;
  const placed = (info?.myBet ?? 0) > 0;
  const capped = Math.max(DICE_MIN_BET, Math.min(DICE_MAX_BET, Math.floor(amount)));
  const affordable = capped <= coins;
  const seconds = info ? Math.ceil(info.remainingMs / 1000) : 0;
  const revealed = info !== null && info.phase !== DICE_PHASE.Betting && info.dice.every((v) => v > 0);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-4 pb-24 sm:items-center sm:pb-0">
      <div className="w-full max-w-[380px] border-2 border-ink-600 bg-ink-900/95 p-3 shadow-[4px_4px_0_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-mist-100">
            摸鱼大赌场 · <span className="text-mint-400">{spec.name}</span>
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

        <div className="mt-2 flex items-center justify-between border-2 border-ink-700 bg-ink-800/60 px-2 py-1">
          <span className="font-mono text-[10px] text-mist-400">
            {PHASE_LABEL[info?.phase ?? DICE_PHASE.Betting]} · {seconds}s
          </span>
          <span className="font-mono text-[10px] text-[#F2C879]">公共池 {info?.totalPot ?? 0} 币</span>
        </div>

        <div className="mt-2 flex items-center justify-center gap-2">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="flex h-9 w-9 items-center justify-center border-2 border-ink-600 bg-mist-100 font-mono text-[15px] font-bold text-ink-900"
            >
              {revealed ? info!.dice[index] : '?'}
            </span>
          ))}
        </div>
        {info?.raid ? (
          <p className="mt-1 text-center font-mono text-[9px] text-signal-500">
            本局保安查岗：押中的彩池抽 5%
          </p>
        ) : (
          <p className="mt-1 text-center font-mono text-[9px] text-mist-500">
            0% 抽水 · 押中档位按注额分走全池
          </p>
        )}

        <div className="mt-2 grid grid-cols-3 gap-1">
          {SIDES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSide(value)}
              className={`border-2 py-1.5 text-[12px] font-semibold ${
                side === value
                  ? 'border-mint-500 bg-mint-500/15 text-mint-300'
                  : 'border-ink-700 text-mist-200 hover:bg-ink-800'
              }`}
            >
              {DICE_SIDE_NAME[value]}
            </button>
          ))}
        </div>

        <p className="mt-2 px-1 text-[10px] text-mist-400">
          押注 <span className="font-mono text-[#F2C879]">{capped}</span> 币 · 余额{' '}
          <span className="font-mono">{coins}</span>
          {placed && <span className="ml-2 text-mint-400">本局已押 {info!.myBet}</span>}
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
        <div className="mt-1 flex items-center gap-1">
          <input
            value={custom}
            inputMode="numeric"
            placeholder="自定义注额"
            onChange={(event) => {
              const next = event.target.value.replace(/[^\d]/g, '');
              setCustom(next);
              if (next) setAmount(Number(next));
            }}
            className="min-w-0 flex-1 border-2 border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11px] text-mist-100 outline-none focus:border-mint-500"
          />
          <button
            type="button"
            onClick={() => {
              setAmount(Math.min(capped + 50, DICE_MAX_BET));
              setCustom('');
            }}
            className="border-2 border-ink-700 px-2 py-1 font-mono text-[10px] text-mist-300 hover:bg-ink-800"
          >
            +50
          </button>
        </div>

        <button
          type="button"
          disabled={!betting || placed || !affordable}
          onClick={() => onBet(table, side, capped)}
          className={`mt-2 w-full border-2 py-2 text-[12px] font-semibold ${
            !betting || placed || !affordable
              ? 'cursor-not-allowed border-ink-700 text-mist-500'
              : 'border-mint-500 bg-mint-500/15 text-mint-300 hover:bg-mint-500/25'
          }`}
        >
          {!betting
            ? '本局已封盘，等下一局'
            : placed
              ? '本局已下注'
              : affordable
                ? `押 ${capped} 币 · ${DICE_SIDE_NAME[side]}`
                : '余额不足'}
        </button>
      </div>
    </div>
  );
}
