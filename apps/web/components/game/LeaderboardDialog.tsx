'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  BOARD_AUTO_REFRESH_MS,
  BOARD_REFRESH_COOLDOWN_MS,
  type BoardMetric,
  type BoardPacket,
} from '@niuma/shared-types';
import type { ConnectionStatus } from '@/lib/game-ui';
import { GAME_KEYS, TAB_KEYS } from '@/lib/game/game-keys';
import { BOARD_METRICS, formatBoardValue, metricMeta } from '@/lib/game/leaderboard';
import { nextTabIndex, type TabNavKey } from '@/lib/game/tab-keyboard';

/**
 * 牛马榜面板（ADR-0054）：把中央广场那块木框纸签板拉近到屏幕上。
 *
 * 深 ink 底 + 木色上梁 + 纸签页签，视觉语言沿用园区 HUD；
 * 一次打开拉全部五个指标，页签只切本地缓存，每 20 秒补一次快照。
 * 键盘：方向键切页签、Esc 关闭、游戏键在 capture 阶段吞掉。
 */
interface LeaderboardDialogProps {
  /** 已按 metric 归并的五份快照；打开后由宿主持续更新 */
  boards: Partial<Record<BoardMetric, BoardPacket>>;
  status: ConnectionStatus;
  /** 重新拉取全部指标：打开面板、手动刷新与自动刷新都走它 */
  onRequest(): void;
  onClose(): void;
}

const ACCENT = {
  1: {
    border: 'border-amber-400/60',
    background: 'bg-amber-400/[0.08]',
    text: 'text-amber-400',
    height: 'h-[64px]',
  },
  2: {
    border: 'border-mist-400/40',
    background: 'bg-mist-400/[0.05]',
    text: 'text-mist-100',
    height: 'h-[50px]',
  },
  3: {
    border: 'border-ember-500/60',
    background: 'bg-ember-500/[0.07]',
    text: 'text-ember-500',
    height: 'h-[50px]',
  },
} as const;

/** 三根像素柱：不借图标库，和世界里的公告栏画法同一套语汇 */
function BoardMark() {
  return (
    <span
      className="grid h-9 w-9 shrink-0 place-items-end border-2 border-ink-500 bg-ink-950 p-1"
      aria-hidden="true"
    >
      <span className="flex w-full items-end justify-between gap-[2px]">
        <span className="h-2 w-1.5 bg-mist-500" />
        <span className="h-4 w-1.5 bg-mint-400" />
        <span className="h-3 w-1.5 bg-amber-400" />
      </span>
    </span>
  );
}

function PodiumSlot({
  rank,
  entry,
  metric,
  unit,
  self,
}: {
  rank: 1 | 2 | 3;
  entry: BoardPacket['rows'][number] | undefined;
  metric: BoardMetric;
  unit: string;
  self: boolean;
}) {
  const accent = ACCENT[rank];
  return (
    <div className="flex min-w-0 flex-col justify-end">
      <div className="min-w-0 px-1 text-center">
        {entry ? (
          <>
            <p className="truncate text-[11px] leading-tight text-mist-100" title={entry.name}>
              {entry.name}
              {self && (
                <span className="ml-1 border border-mint-400/60 px-1 py-px align-middle font-mono text-[8px] text-mint-400">
                  你
                </span>
              )}
            </p>
            <p className={`mt-0.5 font-mono text-[10px] tabular-nums ${accent.text}`}>
              {formatBoardValue(metric, entry.value)}
              {unit && <span className="ml-1 text-[8px] text-mist-500">{unit}</span>}
            </p>
          </>
        ) : (
          <p className="font-mono text-[9px] leading-relaxed text-mist-500">虚位以待</p>
        )}
      </div>
      <div
        className={`mt-1.5 grid place-items-center border-2 ${accent.border} ${accent.background} ${accent.height} ${
          entry ? '' : 'border-dashed bg-ink-950/40'
        }`}
      >
        <span className={`font-display text-[20px] font-semibold leading-none ${entry ? accent.text : 'text-mist-500'}`}>
          {rank}
        </span>
      </div>
    </div>
  );
}

export function LeaderboardDialog({ boards, status, onRequest, onClose }: LeaderboardDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const refreshTimer = useRef<number | null>(null);
  const [metric, setMetric] = useState<BoardMetric>(BOARD_METRICS[0]!.id);
  const [cooling, setCooling] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState(0);

  const meta = metricMeta(metric);
  const packet = boards[metric];
  const rows = packet?.rows ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  // 打开：把焦点从画布 / 聊天输入框收进面板；关闭后还给游戏画布
  useEffect(() => {
    const previous = document.activeElement;
    if (previous instanceof HTMLElement) previous.blur();
    tabRefs.current[0]?.focus();
    return () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const canvas =
        document.querySelector<HTMLCanvasElement>('[aria-label="游戏视口"] canvas') ??
        document.querySelector<HTMLCanvasElement>('canvas');
      if (canvas) {
        canvas.tabIndex = -1;
        canvas.focus({ preventScroll: true });
      }
    };
  }, []);

  // 打开即拉一次；之后按节拍补快照。onRequest 由宿主 useCallback 固定。
  useEffect(() => {
    onRequest();
  }, [onRequest]);

  useEffect(() => {
    const timer = window.setInterval(() => onRequest(), BOARD_AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [onRequest]);

  useEffect(() => {
    if (packet) setSnapshotAt(Date.now());
  }, [packet]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const refresh = useCallback(() => {
    if (cooling) return;
    setCooling(true);
    onRequest();
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => setCooling(false), BOARD_REFRESH_COOLDOWN_MS);
  }, [cooling, onRequest]);

  // capture 阶段吞键：Esc 关闭；方向键在纸签之间移动；其余游戏键不再穿透
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      const target = event.target;
      const tabButton = target instanceof HTMLElement ? target.closest<HTMLElement>('[role="tab"]') : null;
      if (tabButton && TAB_KEYS.has(event.key as TabNavKey)) {
        const tabs = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
        const current = tabs.indexOf(tabButton);
        const next = nextTabIndex(current, event.key as TabNavKey, tabs.length);
        event.preventDefault();
        event.stopPropagation();
        tabs[next]?.focus();
        return;
      }

      if (GAME_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const interactive =
          target instanceof HTMLElement &&
          Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'));
        event.stopPropagation();
        if (!interactive) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const online = packet?.online ?? 0;
  const slacking = packet?.slacking ?? 0;
  const snapshotTime =
    snapshotAt > 0
      ? new Date(snapshotAt).toLocaleTimeString('zh-CN', { hour12: false })
      : '--:--:--';
  const selfOutsideTop =
    packet !== undefined && packet.selfRank > 0 && packet.selfRank > rows.length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 cursor-pointer bg-black/75 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-title"
        onKeyDown={trapFocus}
        className="animate-board-in relative z-10 flex h-[min(620px,90dvh)] w-[min(440px,94vw)] flex-col overflow-hidden border-2 border-ink-500 bg-ink-800 p-[3px] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.95)]"
      >
        <div className="flex min-h-0 flex-1 flex-col border-2 border-ink-600 bg-ink-900">
          <header
            className="relative shrink-0 overflow-hidden border-b-2 border-ink-600 bg-ink-800 px-4 pb-2.5 pt-3"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(242,200,121,0.07) 0 2px, transparent 2px 7px)',
            }}
          >
            <span className="absolute inset-x-0 top-0 h-0.5 bg-amber-400/70" aria-hidden="true" />
            <span className="absolute left-3 top-1.5 h-1 w-1 bg-amber-400/70" aria-hidden="true" />
            <span className="absolute right-12 top-1.5 h-1 w-1 bg-amber-400/70" aria-hidden="true" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <BoardMark />
                <div className="min-w-0">
                  <h2
                    id="leaderboard-title"
                    className="font-display text-[22px] font-semibold leading-none tracking-[0.08em] text-mist-100"
                  >
                    牛马榜
                  </h2>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.26em] text-amber-400/80">
                    NIOMA · EMPLOYEE LEADERBOARD
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="flex items-center gap-1 border border-mint-400/40 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.18em] text-mint-400">
                  <span className="h-1 w-1 animate-blink bg-mint-400" aria-hidden="true" />
                  LIVE
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭牛马榜"
                  title="关闭牛马榜（Esc）"
                  className="grid h-8 w-8 cursor-pointer place-items-center border-2 border-ink-500 bg-ink-800 text-mist-400 transition-colors hover:border-mint-400/70 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div
              className="mt-2.5 flex items-center justify-between border-t border-ink-700 pt-2 font-mono text-[9px] tracking-[0.08em] text-mist-400"
              aria-live="polite"
            >
              <span>
                在岗 <span className="text-mint-400">{packet ? online : '--'}</span> · 摸鱼{' '}
                <span className="text-amber-400">{packet ? slacking : '--'}</span>
              </span>
              <span className="text-mist-500">本园区</span>
            </div>
          </header>

          {status !== 'online' && (
            <div className="flex shrink-0 items-center gap-2 border-b-2 border-ink-600 bg-amber-400/[0.08] px-4 py-1.5 font-mono text-[9px] tracking-[0.08em] text-amber-400">
              <span className="h-1.5 w-1.5 animate-blink bg-amber-400" aria-hidden="true" />
              连接中断，显示上次快照
            </div>
          )}

          <div
            role="tablist"
            aria-label="榜单指标"
            className="grid shrink-0 grid-cols-6 gap-1.5 border-b-2 border-ink-600 bg-ink-950/50 px-2 py-2"
          >
            {BOARD_METRICS.map((item, index) => {
              const active = item.id === metric;
              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`leaderboard-tab-${item.id}`}
                  aria-selected={active}
                  aria-controls="leaderboard-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => setMetric(item.id)}
                  className={`relative flex min-h-8 cursor-pointer items-center justify-center border-2 px-1 py-1 font-mono text-[10px] tracking-[0.08em] transition-[transform,color,border-color,background-color] duration-150 focus-visible:border-mint-400 focus-visible:outline-none ${
                    active
                      ? '-translate-y-px border-mint-400 bg-mint-400/[0.08] text-mint-400'
                      : 'border-ink-600 text-mist-400 hover:border-mist-500 hover:text-mist-100'
                  }`}
                >
                  <span
                    className={`absolute left-1/2 top-0.5 h-1 w-1 -translate-x-1/2 ${
                      active ? 'bg-mint-400' : 'bg-ink-500'
                    }`}
                    aria-hidden="true"
                  />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div
            id="leaderboard-panel"
            role="tabpanel"
            aria-labelledby={`leaderboard-tab-${metric}`}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none"
          >
            {!packet ? (
              <div className="px-4 py-6" role="status">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-10 animate-blink bg-mint-400/70" aria-hidden="true" />
                  <p className="font-mono text-[10px] tracking-[0.12em] text-mist-400">正在读取公告栏…</p>
                </div>
                <div className="mt-4 grid gap-1.5">
                  {[0, 1, 2].map((line) => (
                    <div key={line} className="h-8 border border-ink-700 bg-ink-800/60" />
                  ))}
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="grid place-items-center px-6 py-12 text-center" role="status">
                <p className="max-w-[28ch] font-mono text-[10px] leading-relaxed tracking-[0.06em] text-mist-400">
                  {meta.empty}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2 border-b border-ink-700/80 px-4 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">{meta.caption}</p>
                  <p className="shrink-0 font-mono text-[8px] tracking-[0.12em] text-mist-500">TOP 10</p>
                </div>

                <div className="grid grid-cols-3 items-end gap-2 px-3 pb-2 pt-3">
                  <PodiumSlot
                    rank={2}
                    entry={podium[1]}
                    metric={metric}
                    unit={meta.unit}
                    self={packet.selfRank === 2}
                  />
                  <PodiumSlot
                    rank={1}
                    entry={podium[0]}
                    metric={metric}
                    unit={meta.unit}
                    self={packet.selfRank === 1}
                  />
                  <PodiumSlot
                    rank={3}
                    entry={podium[2]}
                    metric={metric}
                    unit={meta.unit}
                    self={packet.selfRank === 3}
                  />
                </div>

                <ol>
                  {rest.map((entry, index) => {
                    const rank = index + 4;
                    const self = packet.selfRank === rank;
                    return (
                      <li
                        key={entry.id}
                        className={`flex items-baseline gap-2.5 border-b border-ink-700/70 px-4 py-[7px] ${
                          self ? 'bg-mint-400/[0.07]' : ''
                        }`}
                      >
                        <span
                          className={`w-5 shrink-0 font-mono text-[10px] tabular-nums ${
                            self ? 'text-mint-400' : 'text-mist-500'
                          }`}
                        >
                          {String(rank).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12px] leading-relaxed text-mist-100" title={entry.name}>
                          {entry.name}
                          {self && (
                            <span className="ml-1.5 border border-mint-400/60 px-1 py-px align-middle font-mono text-[8px] tracking-[0.06em] text-mint-400">
                              你
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] tabular-nums text-mist-100">
                          {formatBoardValue(metric, entry.value)}
                        </span>
                        {meta.unit && (
                          <span className="w-3 shrink-0 font-mono text-[8px] text-mist-500">{meta.unit}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>

                {selfOutsideTop && (
                  <div className="mt-1 border-t-2 border-ink-600 bg-mint-400/[0.06] px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-mint-400">
                        我的位置 · 第 {packet.selfRank} 名
                      </span>
                      <span className="font-mono text-[12px] tabular-nums text-mist-100">
                        {formatBoardValue(metric, packet.selfValue)}
                        {meta.unit && <span className="ml-1 text-[8px] text-mist-500">{meta.unit}</span>}
                      </span>
                    </div>
                  </div>
                )}

                {packet.selfRank === 0 && (
                  <div className="mt-1 border-t-2 border-ink-600 px-4 py-2.5">
                    <p className="font-mono text-[9px] leading-relaxed tracking-[0.06em] text-mist-500">
                      你还没有上榜：这一项尚未上报，或已经离开园区。
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <footer className="shrink-0 border-t-2 border-ink-600 bg-ink-950/50 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[8px] leading-relaxed tracking-[0.06em] text-mist-500">
                仅统计本园区当前在岗 · 离线即离榜
              </p>
              <button
                type="button"
                onClick={refresh}
                disabled={cooling || status !== 'online'}
                className="shrink-0 cursor-pointer border border-ink-500 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-mist-300 transition-colors hover:border-mint-400 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:border-ink-700 disabled:text-mist-500"
              >
                刷新
              </button>
            </div>
            <p className="mt-1 font-mono text-[8px] leading-relaxed tracking-[0.06em] text-mist-500">
              工时 / 摸鱼 / 击倒 / 步数由本人自报，最多 60 秒延迟 · 快照 {snapshotTime}
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
