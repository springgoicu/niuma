'use client';

import { DICE_PHASE, diceHitLabel, type DiceResultPacket } from '@niuma/shared-types';
import { netClass, plainCoins, sideLabel, signedCoins } from '@/lib/game/dice-hall-format';
import { DiceFace } from './DiceFace';

/**
 * 一局结算单（ADR-0110）：亮牌时逐人下发，落败者也能看到谁赢了多少。
 *
 * 行内只放昵称与金额，不出现设备号；「你」那一行由服务端标好的 `self` 决定，
 * 昵称重名也不会标错人。
 */
interface DiceSettlePanelProps {
  result: DiceResultPacket | null;
  /** 当前公共阶段：亮牌之外显示的是「上一局」，避免读成正在进行 */
  phase: number;
}

export function DiceSettlePanel({ result, phase }: DiceSettlePanelProps) {
  const live = phase === DICE_PHASE.Reveal;
  const entries = result?.entries ?? [];
  const totalNet = entries.reduce((sum, entry) => sum + entry.net, 0);
  const allRefunded = entries.length > 0 && entries.every((entry) => entry.refunded);

  if (result === null) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-mist-500">NO RECORD YET</p>
          <p className="mt-2 text-[12px] leading-relaxed text-mist-300">
            本桌还没结算过。
            <br />
            投一笔，亮牌后这里会按人列出投入额、到手与净盈亏。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b-2 border-ink-700 bg-ink-800/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((index) => (
              <DiceFace key={index} value={result.dice[index] ?? 0} dim={!live} />
            ))}
            <div className="ml-1 min-w-0">
              <p className="font-mono text-[10px] leading-tight text-mist-400">
                第 <span className="text-mist-100">{result.roundId}</span> 局
                {live ? ' · 已亮牌' : ' · 上一局'}
              </p>
              <p className="mt-0.5 font-mono text-[9px] leading-tight text-mist-500">
                {result.raid ? '保安查岗 · 服务费 5%' : '0% 服务费'}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <span
              className={`inline-block border-2 px-1.5 py-0.5 text-[11px] font-semibold ${
                result.hit < 0
                  ? 'border-mist-500/60 text-mist-300'
                  : 'border-mint-500/70 bg-mint-500/10 text-mint-300'
              }`}
            >
              {diceHitLabel(result.hit)}
            </span>
            <p className={`mt-1 font-mono text-[11px] tabular-nums ${netClass(totalNet)}`}>
              全桌 {signedCoins(totalNet)}
            </p>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <p className="text-[12px] leading-relaxed text-mist-300">
            本局没人投入，奖池空转。
            <br />
            <span className="font-mono text-[10px] text-mist-500">下一局开投后这里会重新记一行。</span>
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-ink-700 px-3 py-1 font-mono text-[8px] tracking-[0.16em] text-mist-500">
            <span>投入人 · 档位</span>
            <span>净盈亏 · 投入 / 收</span>
          </div>
          <ul aria-label={`第 ${result.roundId} 局结算明细`} className="divide-y divide-ink-700/70">
            {entries.map((entry, index) => (
              <li
                key={`${entry.name}-${index}`}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 ${
                  entry.self ? 'bg-amber-400/[0.07]' : ''
                }`}
              >
                <span
                  className={`w-[2px] self-stretch ${entry.self ? 'bg-amber-400/80' : 'bg-transparent'}`}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    className={`truncate text-[11px] leading-tight ${
                      entry.self ? 'font-semibold text-amber-400' : 'text-mist-100'
                    }`}
                    title={entry.name}
                  >
                    {entry.name}
                  </span>
                  {entry.self && (
                    <span className="shrink-0 border border-amber-400/60 px-1 font-mono text-[8px] text-amber-400">
                      你
                    </span>
                  )}
                  <span className="shrink-0 border border-ink-500 px-1 font-mono text-[8px] text-mist-400">
                    {sideLabel(entry.side)}
                  </span>
                  {entry.refunded && (
                    <span className="shrink-0 font-mono text-[8px] text-mist-500">退款</span>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-mono text-[12px] leading-tight tabular-nums ${netClass(entry.net)}`}>
                    {signedCoins(entry.net)}
                  </p>
                  <p className="font-mono text-[8px] leading-tight text-mist-500">
                    {plainCoins(entry.bet)} → {plainCoins(entry.payout)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="shrink-0 border-t-2 border-ink-700 bg-ink-800/40 px-3 py-1.5">
        {allRefunded ? (
          <p className="text-[10px] leading-relaxed text-signal-500">
            命中档没人投：本金原路退回，本局不计胜负。
          </p>
        ) : (
          <p className="font-mono text-[9px] leading-relaxed text-mist-500">
            {entries.length} 人投入 · 金额以服务端真实入账为准{result.raid ? '（已含查岗服务费）' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
