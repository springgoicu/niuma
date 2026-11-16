'use client';

import {
  DICE_BOARD_LIMIT,
  DICE_BOARD_METRIC,
  DICE_BOARD_SCOPE,
  type DiceBoardPacket,
} from '@niuma/shared-types';
import {
  diceMetricLabel,
  diceScopeLabel,
  netClass,
  percentText,
  signedCoins,
} from '@/lib/game/dice-hall-format';

/**
 * 骰桌排行榜（ADR-0110）：全场总榜与两张单桌榜共用一份快照。
 *
 * 榜单按需拉取、服务端 2 秒冷却；本人若排在前 N 名之外，服务端会补一行并保留真实名次，
 * 所以列表尾部偶尔会出现名次跳跃的「你」——那是补行，不是排序坏了。
 */
interface DiceBoardPanelProps {
  board: DiceBoardPacket | null;
  pending: boolean;
  scope: number;
  metric: number;
  onScope(scope: number): void;
  onMetric(metric: number): void;
  onRefresh(): void;
}

const SCOPES = [DICE_BOARD_SCOPE.All, DICE_BOARD_SCOPE.Table0, DICE_BOARD_SCOPE.Table1] as const;
const METRICS = [DICE_BOARD_METRIC.Net, DICE_BOARD_METRIC.WinRate] as const;

/** 前三名的名次徽标底色：金 / 银 / 铜，与牛马榜领奖台同一套 */
const RANK_STYLE: Record<number, string> = {
  1: 'border-amber-400/70 bg-amber-400/10 text-amber-400',
  2: 'border-mist-300/60 bg-mist-300/[0.08] text-mist-100',
  3: 'border-ember-500/60 bg-ember-500/[0.07] text-ember-500',
};

function Segmented<T extends number>({
  options,
  value,
  label,
  onChange,
}: {
  options: readonly T[];
  value: number;
  label(value: T): string;
  onChange(value: T): void;
}) {
  return (
    <div role="group" aria-label="榜单切换" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`cursor-pointer border-2 px-1 py-1 text-[10px] transition-colors ${
            value === option
              ? 'border-amber-400/70 bg-amber-400/10 text-amber-400'
              : 'border-ink-700 text-mist-300 hover:border-ink-500 hover:text-mist-100'
          }`}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

export function DiceBoardPanel({
  board,
  pending,
  scope,
  metric,
  onScope,
  onMetric,
  onRefresh,
}: DiceBoardPanelProps) {
  const entries = board?.entries ?? [];
  const own = entries.find((entry) => entry.self) ?? null;
  // 补行只在本人排在前 N 名之外时出现：列表尾部标一道「以下为补行」
  const pinned = own !== null && own.rank > DICE_BOARD_LIMIT;
  const showNet = metric === DICE_BOARD_METRIC.Net;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1.5 border-b-2 border-ink-700 px-3 py-2">
        <Segmented options={SCOPES} value={scope} label={diceScopeLabel} onChange={onScope} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1">
            <Segmented options={METRICS} value={metric} label={diceMetricLabel} onChange={onMetric} />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={pending}
            className={`shrink-0 border-2 px-2 py-1 font-mono text-[9px] transition-colors ${
              pending
                ? 'cursor-not-allowed border-ink-700 text-mist-500'
                : 'cursor-pointer border-ink-500 text-mist-300 hover:border-mint-400/70 hover:text-mint-400'
            }`}
          >
            {pending ? '算榜中…' : '刷新'}
          </button>
        </div>
        <p className="font-mono text-[8px] tracking-[0.12em] text-mist-500" aria-live="polite">
          {board ? `共 ${board.total} 人有战绩 · 按${diceMetricLabel(metric)}排序` : '正在取回榜单…'}
          <span className="ml-1 text-mist-600">· 刷新冷却 2s</span>
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] text-mist-500">NO RECORDS YET</p>
              <p className="mt-2 text-[12px] leading-relaxed text-mist-300">
                {board === null ? '正在取回排行榜…' : `${diceScopeLabel(scope)}还没有人留下战绩。`}
                <br />
                <span className="font-mono text-[10px] text-mist-500">
                  坐上圆凳玩过一局，就能占一行。
                </span>
              </p>
            </div>
          </div>
        ) : (
          <ul aria-label={`${diceScopeLabel(scope)}排行榜`} className="divide-y divide-ink-700/60">
            {entries.map((entry, index) => {
              const rankStyle = RANK_STYLE[entry.rank] ?? 'border-ink-600 text-mist-400';
              return (
                <li key={`${entry.rank}-${entry.name}-${index}`}>
                  {pinned && index === entries.length - 1 && (
                    <p className="border-y border-dashed border-ink-600 bg-ink-800/40 px-3 py-0.5 text-center font-mono text-[8px] text-mist-500">
                      以下为本人补行
                    </p>
                  )}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 ${
                      entry.self ? 'bg-amber-400/[0.07]' : ''
                    }`}
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center border-2 font-mono text-[10px] tabular-nums ${rankStyle}`}
                    >
                      {entry.rank}
                    </span>
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
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`font-mono text-[12px] leading-tight tabular-nums ${
                          showNet ? netClass(entry.net) : 'text-mist-100'
                        }`}
                      >
                        {showNet ? signedCoins(entry.net) : percentText(entry.winRate)}
                      </p>
                      <p className="font-mono text-[8px] leading-tight text-mist-500">
                        {showNet
                          ? `${entry.rounds} 局 · 胜率 ${percentText(entry.winRate)}`
                          : `${entry.rounds} 局 · ${signedCoins(entry.net)}`}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t-2 border-ink-700 bg-ink-800/50 px-3 py-1.5">
        {own ? (
          <p className="flex items-center justify-between gap-2 font-mono text-[10px]">
            <span className="text-mist-400">
              我的名次 <span className="text-amber-400">#{own.rank}</span>
              <span className="ml-1 text-mist-500">/ {board?.total ?? 0} 人</span>
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className={showNet ? netClass(own.net) : 'text-mist-300'}>
                {showNet ? signedCoins(own.net) : percentText(own.winRate)}
              </span>
              <span className="text-mist-500">胜率 {percentText(own.winRate)}</span>
            </span>
          </p>
        ) : (
          <p className="font-mono text-[9px] leading-relaxed text-mist-500">
            {pending ? '正在取回你的名次…' : '你还没有上榜：玩过一局就会出现在这里。'}
          </p>
        )}
      </div>
    </div>
  );
}
