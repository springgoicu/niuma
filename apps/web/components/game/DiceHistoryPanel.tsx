'use client';

import {
  DICE_BOARD_SCOPE,
  DICE_PLAYER_HISTORY,
  diceHitLabel,
  diceWinRate,
  type DiceAggregatePacket,
  type DiceSelfSnapshot,
} from '@niuma/shared-types';
import {
  diceScopeLabel,
  netClass,
  percentText,
  plainCoins,
  signedCoins,
} from '@/lib/game/dice-hall-format';

/**
 * 我的战绩（ADR-0110）：累计指标 + 最近若干局逐局回放。
 *
 * 数据与排行榜同一趟下发（`S2C_DICE_BOARD` 的 self 段），所以打开面板只花一次冷却；
 * 页签里不做任何请求，刷新按钮交给宿主去限频。
 */
interface DiceHistoryPanelProps {
  self: DiceSelfSnapshot | null;
  /** 榜单请求在途：此时显示「正在取回」，不清空已有数据 */
  pending: boolean;
  onRefresh: () => void;
}

function MetricTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="border-2 border-ink-700 bg-ink-800/50 px-2 py-1.5">
      <p className="font-mono text-[8px] tracking-[0.16em] text-mist-500">{label}</p>
      <p className={`mt-0.5 font-mono text-[15px] leading-tight tabular-nums ${tone ?? 'text-mist-100'}`}>
        {value}
      </p>
      <p className="font-mono text-[8px] leading-tight text-mist-500">{note}</p>
    </div>
  );
}

/** 单桌口径一行：总榜之外的两张桌各占一行，方便看「在哪张桌亏的」 */
function ScopeRow({ scope, agg }: { scope: number; agg: DiceAggregatePacket }) {
  const rate = diceWinRate(agg.wins, agg.rounds, agg.refunds);
  return (
    <div className="flex items-center justify-between border-b border-ink-700/60 px-1 py-1 font-mono text-[10px]">
      <span className="text-mist-400">{diceScopeLabel(scope)}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className="text-mist-500">{agg.rounds} 局</span>
        <span className="text-mist-500">胜率 {percentText(rate)}</span>
        <span className={`w-[54px] text-right ${netClass(agg.net)}`}>{signedCoins(agg.net)}</span>
      </span>
    </div>
  );
}

export function DiceHistoryPanel({ self, pending, onRefresh }: DiceHistoryPanelProps) {
  if (self === null) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-mist-500">
            {pending ? 'READING LEDGER…' : 'EMPTY LEDGER'}
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-mist-300">
            {pending ? (
              '正在取回你的台账…'
            ) : (
              <>
                你还没在骰桌上玩过一局。
                <br />
                玩过一局之后，这里会记下每一局的输赢与累计战绩。
              </>
            )}
          </p>
          {!pending && (
            <p className="mt-2 font-mono text-[9px] text-mist-500">上方骰桌正在开局 · 选中档位即可入局</p>
          )}
        </div>
      </div>
    );
  }

  const all = self.all;
  const rate = diceWinRate(all.wins, all.rounds, all.refunds);
  const history = self.history.slice(0, DICE_PLAYER_HISTORY);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b-2 border-ink-700 px-3 py-2">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[9px] tracking-[0.18em] text-mist-500">累计 · 全场</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className={`border-2 px-2 py-0.5 font-mono text-[9px] transition-colors ${
              pending
                ? 'cursor-not-allowed border-ink-700 text-mist-500'
                : 'cursor-pointer border-ink-500 text-mist-300 hover:border-mint-400/70 hover:text-mint-400'
            }`}
          >
            {pending ? '取回中…' : '刷新'}
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <MetricTile
            label="净收益"
            value={signedCoins(all.net)}
            note={`${plainCoins(all.totalPayout)} 到手 / ${plainCoins(all.totalBet)} 投入`}
            tone={netClass(all.net)}
          />
          <MetricTile
            label="胜率"
            value={percentText(rate)}
            note={`${all.wins} 胜 ${all.losses} 负 ${all.refunds} 退`}
          />
          <MetricTile label="局数" value={String(all.rounds)} note="退款局也计入" />
          <MetricTile
            label="单局最佳"
            value={all.bestWin > 0 ? signedCoins(all.bestWin) : '—'}
            note={all.bestWin > 0 ? '最高一局净赚' : '还没有盈利局'}
            tone={all.bestWin > 0 ? 'text-amber-400' : 'text-mist-400'}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-ink-700 px-3 py-1">
          <ScopeRow scope={DICE_BOARD_SCOPE.All} agg={all} />
          <ScopeRow scope={DICE_BOARD_SCOPE.Table0} agg={self.table0} />
          <ScopeRow scope={DICE_BOARD_SCOPE.Table1} agg={self.table1} />
        </div>

        {history.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-mist-400">
            账本里还没有逐局记录，下一局亮牌后会出现。
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between bg-ink-800/40 px-3 py-1 font-mono text-[8px] tracking-[0.16em] text-mist-500">
              <span>最近 {history.length} 局 · 最新在上</span>
              <span>净盈亏</span>
            </div>
            <ul aria-label="最近对局" className="divide-y divide-ink-700/60">
              {history.map((row, index) => (
                <li
                  key={`${row.table}-${row.roundId}`}
                  className={`flex items-center justify-between gap-2 pl-2 pr-3 ${
                    index === 0 ? 'bg-mist-100/[0.035]' : ''
                  }`}
                >
                  <span
                    className={`w-[2px] self-stretch ${index === 0 ? 'bg-mint-400/70' : 'bg-transparent'}`}
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
                    <span className="shrink-0 font-mono text-[9px] text-mist-500">
                      #{row.roundId}
                    </span>
                    <span className="shrink-0 border border-ink-500 px-1 font-mono text-[8px] text-mist-400">
                      {diceScopeLabel(row.table === 1 ? DICE_BOARD_SCOPE.Table1 : DICE_BOARD_SCOPE.Table0)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-mist-200">
                      {row.dice.join('·')}
                    </span>
                    <span className="shrink-0 font-mono text-[8px] text-mist-500">
                      {diceHitLabel(row.hit)}
                    </span>
                    {row.refunded && (
                      <span className="shrink-0 font-mono text-[8px] text-signal-500">退款</span>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-mono text-[11px] leading-tight tabular-nums ${netClass(row.net)}`}>
                      {signedCoins(row.net)}
                    </p>
                    <p className="font-mono text-[8px] leading-tight text-mist-500">
                      {plainCoins(row.bet)} → {plainCoins(row.payout)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="shrink-0 border-t-2 border-ink-700 bg-ink-800/40 px-3 py-1.5 font-mono text-[8px] leading-relaxed text-mist-500">
        按匿名设备归户，换浏览器不继承；账单与服务端一致，退款局不计胜负。
      </p>
    </div>
  );
}
