'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  DICE_BOARD_METRIC,
  DICE_BOARD_SCOPE,
  DICE_TABLES,
  type DiceBoardPacket,
  type DiceResultPacket,
  type DiceStatePacket,
} from '@niuma/shared-types';
import { GAME_KEYS, TAB_KEYS } from '@/lib/game/game-keys';
import { isBackdropCloseAllowed } from '@/lib/game/leaderboard';
import { nextTabIndex, type TabNavKey } from '@/lib/game/tab-keyboard';
import { DiceBoardPanel } from './DiceBoardPanel';
import { DiceHistoryPanel } from './DiceHistoryPanel';
import { DiceSettlePanel } from './DiceSettlePanel';
import { DiceTableStage } from './DiceTableStage';

/**
 * 摸鱼骰子馆 · 骰桌台账（ADR-0087 / ADR-0110）。
 *
 * 牌桌区常驻顶部，下面三个页签共用一份快照：本局结算来自亮牌时的逐人推送，
 * 我的战绩与排行榜来自同一次按需拉取（服务端 2 秒冷却），不把名单塞进心跳包。
 */
interface DiceHallDialogProps {
  /** 桌号：0 翡翠桌 / 1 鎏金桌 */
  table: number;
  dice: DiceStatePacket | null;
  /** 按桌号索引的最近一局结算单；下一局结束前一直保留 */
  results: ReadonlyArray<DiceResultPacket | null>;
  board: DiceBoardPacket | null;
  boardPending: boolean;
  coins: number;
  onClose: () => void;
  onBet: (table: number, side: number, amount: number) => void;
  onRequestBoard: (scope: number, metric: number) => void;
}

const TABS = [
  { id: 'settle', label: '本局结算' },
  { id: 'history', label: '我的战绩' },
  { id: 'board', label: '排行榜' },
] as const;
type DiceTab = (typeof TABS)[number]['id'];

export function DiceHallDialog({
  table,
  dice,
  results,
  board,
  boardPending,
  coins,
  onClose,
  onBet,
  onRequestBoard,
}: DiceHallDialogProps) {
  const spec = DICE_TABLES.find((item) => item.id === table) ?? DICE_TABLES[0]!;
  const info = dice?.tables.find((item) => item.id === table) ?? null;
  const result = results[table] ?? null;

  const [tab, setTab] = useState<DiceTab>('settle');
  const [fresh, setFresh] = useState(false);
  const [scope, setScope] = useState<number>(DICE_BOARD_SCOPE.All);
  const [metric, setMetric] = useState<number>(DICE_BOARD_METRIC.Net);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openedAt = useRef(Date.now());
  const seen = useRef({ table, roundId: result?.roundId ?? null });
  const lastRequest = useRef('');

  const selectTab = useCallback((next: DiceTab) => {
    setTab(next);
    if (next === 'settle') setFresh(false);
  }, []);

  // 亮牌到达：结算页常驻自动刷新；正在读战绩 / 排行榜时不抢视线，只在页签上点亮提示
  useEffect(() => {
    const roundId = result?.roundId ?? null;
    const previous = seen.current;
    seen.current = { table, roundId };
    if (previous.table !== table) return;
    if (roundId === null || roundId === previous.roundId) return;
    if (tab === 'settle') return;
    setFresh(true);
    // 账本页开着就顺手补一次快照：服务端 2s 冷却兜底，冷却期内被拒也不影响已有数据
    if (!boardPending) onRequestBoard(scope, metric);
  }, [result, table, tab, scope, metric, boardPending, onRequestBoard]);

  // 打开：焦点从画布收进面板；关闭后还给游戏画布
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

  // 进入战绩 / 排行榜页签时才拉快照；同一口径只发一次，被冷却挡掉就等手动刷新
  useEffect(() => {
    if (tab !== 'board' && tab !== 'history') return;
    if (boardPending) return;
    const key = `board-${scope}-${metric}`;
    if (lastRequest.current === key) return;
    lastRequest.current = key;
    // 「我的战绩」与排行榜吃同一份快照：self 段与 scope 无关，不必换口径重拉
    onRequestBoard(scope, metric);
  }, [tab, scope, metric, boardPending, onRequestBoard]);

  const refresh = useCallback(() => {
    lastRequest.current = `board-${scope}-${metric}`;
    onRequestBoard(scope, metric);
  }, [scope, metric, onRequestBoard]);

  // capture 阶段吞键：Esc 关闭、方向键在页签间移动、其余游戏键不穿透
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
        const next = nextTabIndex(tabs.indexOf(tabButton), event.key as TabNavKey, tabs.length);
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

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-3 pb-8 sm:items-center sm:pb-0"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!isBackdropCloseAllowed(openedAt.current, Date.now())) return;
        onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dice-hall-title"
        onKeyDown={trapFocus}
        className="animate-board-in relative flex h-[min(720px,94dvh)] w-[min(520px,94vw)] flex-col overflow-hidden border-2 border-ink-500 bg-ink-900 p-[3px] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.95)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b-2 border-ink-700 px-3 py-2">
          <p id="dice-hall-title" className="text-[13px] font-semibold text-mist-100">
            摸鱼骰子馆 · <span className="text-mint-400">{spec.name}</span>
            <span className="ml-2 font-mono text-[9px] font-normal text-mist-500">
              台账按设备归户 · 重启也在
            </span>
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭台账"
            className="cursor-pointer border-2 border-ink-700 p-1 text-mist-400 transition-colors hover:border-signal-500/60 hover:text-signal-500 focus-visible:outline-2 focus-visible:outline-signal-500"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="shrink-0 border-b-2 border-ink-700 bg-ink-800/30 px-3 py-2">
          <DiceTableStage table={table} info={info} coins={coins} onBet={onBet} />
        </div>

        <div
          role="tablist"
          aria-label="骰桌台账"
          className="grid shrink-0 grid-cols-3 gap-1 border-b-2 border-ink-700 px-2 py-1.5"
        >
          {TABS.map((item, index) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`dice-tab-${item.id}`}
                aria-selected={active}
                aria-controls="dice-tab-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(item.id)}
                aria-label={
                  item.id === 'settle' && fresh ? `${item.label}（有新结算）` : item.label
                }
                className={`relative flex min-h-8 cursor-pointer items-center justify-center border-2 px-1 py-1 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-mint-400 ${
                  active
                    ? 'border-amber-400/70 bg-amber-400/10 text-amber-400'
                    : 'border-ink-700 text-mist-300 hover:border-ink-500 hover:text-mist-100'
                }`}
              >
                {item.label}
                {item.id === 'settle' && fresh && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-blink bg-mint-400" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        <div
          id="dice-tab-panel"
          role="tabpanel"
          aria-labelledby={`dice-tab-${tab}`}
          className="min-h-0 flex-1"
        >
          {tab === 'settle' && <DiceSettlePanel result={result} phase={info?.phase ?? 0} />}
          {tab === 'history' && (
            <DiceHistoryPanel self={board?.self ?? null} pending={boardPending} onRefresh={refresh} />
          )}
          {tab === 'board' && (
            <DiceBoardPanel
              board={board}
              pending={boardPending}
              scope={scope}
              metric={metric}
              onScope={(next) => {
                setScope(next);
                lastRequest.current = '';
              }}
              onMetric={(next) => {
                setMetric(next);
                lastRequest.current = '';
              }}
              onRefresh={refresh}
            />
          )}
        </div>

        <p className="shrink-0 border-t-2 border-ink-700 bg-ink-800/40 px-3 py-1 font-mono text-[8px] leading-relaxed text-mist-500">
          结算按服务端真实入账 · 榜单按需拉取，刷新冷却 2s
        </p>
      </div>
    </div>
  );
}
