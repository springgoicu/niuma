'use client';

import { useState } from 'react';
import { Dices, Scissors, Swords, X } from 'lucide-react';
import {
  P2P_BET_PRESETS,
  P2P_GAME_NAME,
  P2P_GAME_TYPE,
  P2P_MAX_WAGER,
} from '@niuma/shared-types';

interface ChallengeDialogProps {
  target: { id: number; name: string };
  coins: number;
  defaultWager: number;
  onClose: () => void;
  onConfirm: (id: number, gameType: number, wager: number) => void;
}

const GAME_CARDS = [
  {
    type: P2P_GAME_TYPE.Dice,
    icon: Dices,
    rule: '3 颗骰子比大小 · 同点 > 顺子 > 点数 · 赢家拿 95%',
  },
  {
    type: P2P_GAME_TYPE.Rps,
    icon: Scissors,
    rule: '5 秒盲选 · 平局加赛 · 最多 3 轮',
  },
  {
    type: P2P_GAME_TYPE.Duel,
    icon: Swords,
    rule: '100 HP · 30 秒 · E 头槌 / Space 跳跃闪避',
  },
] as const;

/** 发起挑战：先选玩法，再选投入额；金额与余额由服务端再复核一次 */
export function ChallengeDialog({
  target,
  coins,
  defaultWager,
  onClose,
  onConfirm,
}: ChallengeDialogProps) {
  const [gameType, setGameType] = useState<number>(P2P_GAME_TYPE.Dice);
  const [wager, setWager] = useState(defaultWager);
  const [custom, setCustom] = useState('');

  const capped = Math.max(0, Math.min(P2P_MAX_WAGER, Math.floor(wager)));
  const affordable = capped <= coins;
  const effective = affordable ? capped : coins;

  const pickPreset = (amount: number): void => {
    setWager(amount);
    setCustom('');
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-4 pb-24 sm:items-center sm:pb-0">
      <div className="w-full max-w-[360px] border-2 border-ink-600 bg-ink-900/95 p-3 shadow-[4px_4px_0_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-mist-100">
            挑战 <span className="text-mint-400">{target.name}</span>
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

        <div className="mt-2 grid gap-1">
          {GAME_CARDS.map((card) => {
            const Icon = card.icon;
            const active = gameType === card.type;
            return (
              <button
                key={card.type}
                type="button"
                onClick={() => setGameType(card.type)}
                className={`flex items-start gap-2 border-2 px-2 py-1.5 text-left ${
                  active
                    ? 'border-mint-500 bg-mint-500/15 text-mint-300'
                    : 'border-ink-700 text-mist-200 hover:bg-ink-800'
                }`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold leading-none">
                    {P2P_GAME_NAME[card.type]}
                  </span>
                  <span className="mt-1 block font-mono text-[9px] leading-tight text-mist-500">
                    {card.rule}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-2 px-1 text-[10px] text-mist-400">
          投入 <span className="font-mono text-[#F2C879]">{effective}</span> 币 · 余额{' '}
          <span className="font-mono">{coins}</span>
        </p>
        <div className="mt-1 grid grid-cols-4 gap-1">
          {P2P_BET_PRESETS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => pickPreset(amount)}
              className={`border-2 py-1 font-mono text-[11px] ${
                wager === amount
                  ? 'border-[#F2C879] bg-[#F2C879]/15 text-[#F2C879]'
                  : 'border-ink-700 text-mist-300 hover:bg-ink-800'
              }`}
            >
              {amount}
            </button>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <input
            value={custom}
            onChange={(event) => {
              const raw = event.target.value.replace(/[^0-9]/g, '').slice(0, 4);
              setCustom(raw);
              setWager(raw.length > 0 ? Number(raw) : 0);
            }}
            inputMode="numeric"
            placeholder="自定义投入额"
            className="min-w-0 flex-1 border-2 border-ink-700 bg-ink-950 px-2 py-1 font-mono text-[11px] text-mist-200 outline-none placeholder:text-mist-600 focus:border-mint-500"
          />
          <button
            type="button"
            onClick={() => {
              setWager(coins);
              setCustom(String(coins));
            }}
            className="border-2 border-ink-700 px-2 py-1 text-[10px] text-mist-300 hover:bg-ink-800"
          >
            全部
          </button>
        </div>

        <button
          type="button"
          disabled={!affordable}
          onClick={() => {
            onConfirm(target.id, gameType, effective);
            onClose();
          }}
          className={`mt-2 w-full border-2 py-2 text-[12px] font-semibold ${
            affordable
              ? 'border-mint-500 bg-mint-500/20 text-mint-300 hover:bg-mint-500/30'
              : 'cursor-not-allowed border-ink-700 text-mist-500'
          }`}
        >
          {affordable ? '发出挑战' : '余额不够付这笔投入'}
        </button>
      </div>
    </div>
  );
}
