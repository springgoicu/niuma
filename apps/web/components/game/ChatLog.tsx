'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import {
  MAX_NAME_DISPLAY_UNITS,
  SYSTEM_NOTICE_KIND,
  truncateToDisplayWidth,
} from '@niuma/shared-types';
import type { ChatEntry } from '@/lib/game/session';
import { formatClock, formatFullClock } from '@/lib/game/clock';

interface ChatLogProps {
  messages: ChatEntry[];
  /** 历史分页状态：`cursor` 是最旧一条聊天消息的 msgId */
  history: { loading: boolean; hasMore: boolean; cursor: number };
  /** 面板展开态：收起时列表不渲染，但仍要把滚动基准记下来 */
  open: boolean;
  compact: boolean;
  /** 滚到顶部时请求更早的一页；缺省表示不提供上翻 */
  onLoadHistory?: (cursor: number) => void;
}

/** 距底部多远算「贴底」：留 24px 容差，别让 1px 取整误差把跟随关掉 */
const BOTTOM_TOLERANCE = 24;
/** 距顶部多远触发上翻 */
const TOP_TRIGGER = 16;

/** 列表身份键：系统消息 id 是负数，与聊天 msgId 分开记 */
function entryKey(entry: ChatEntry): string {
  return `${entry.kind === 'system' ? 's' : 'c'}:${entry.id}`;
}

/**
 * 系统消息的类型标记：进园「+」、离园「−」、本地提醒「·」。
 * 颜色只做区分，不承担语义——读屏读到的始终是整句文案。
 */
function systemMarker(kind: number | undefined): { glyph: string; tone: string } {
  switch (kind) {
    case SYSTEM_NOTICE_KIND.Enter:
      return { glyph: '+', tone: 'text-mint-400/80' };
    case SYSTEM_NOTICE_KIND.Leave:
      return { glyph: '−', tone: 'text-mist-500' };
    case SYSTEM_NOTICE_KIND.OnDuty:
      return { glyph: '·', tone: 'text-amber-400/80' };
    default:
      return { glyph: '·', tone: 'text-mist-500' };
  }
}

/**
 * 频道消息区：滚动、上翻加载与「贴底才跟随」都在这里。
 *
 * 两条纪律：
 * 1. 用户往上翻时新消息不许抢滚动条，只累计数字，由「↓ N 条新消息」带回底部；
 * 2. 前插更早的一页时按高度差回填 `scrollTop`，正在读的那句话不能跳走。
 */
export function ChatLog({ messages, history, open, compact, onLoadHistory }: ChatLogProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /** 贴底标志用 ref：滚动回调里要立刻可读，不必等一次渲染 */
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const scrollHeightRef = useRef(0);
  const firstKeyRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const countRef = useRef(0);

  // 打开面板一律贴底：从最新处开始读，而不是接着上次翻到的地方
  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    scrollHeightRef.current = node.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setNewCount(0);
  }, [open]);

  useEffect(() => {
    const firstKey = messages.length > 0 ? entryKey(messages[0]!) : null;
    const lastKey = messages.length > 0 ? entryKey(messages[messages.length - 1]!) : null;
    const grew = messages.length > countRef.current;
    const prepended = firstKeyRef.current !== null && firstKeyRef.current !== firstKey;
    const appended = lastKeyRef.current !== lastKey;
    const previousHeight = scrollHeightRef.current;

    firstKeyRef.current = firstKey;
    lastKeyRef.current = lastKey;
    countRef.current = messages.length;

    const node = listRef.current;
    if (!node) return;
    const height = node.scrollHeight;
    if (!open) {
      scrollHeightRef.current = height;
      return;
    }
    if (prepended && grew) {
      node.scrollTop += height - previousHeight;
    } else if (appended && grew) {
      if (atBottomRef.current) node.scrollTop = height;
      else setNewCount((count) => count + 1);
    }
    scrollHeightRef.current = height;
  }, [messages, open]);

  const handleScroll = () => {
    const node = listRef.current;
    if (!node) return;
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < BOTTOM_TOLERANCE;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setNewCount(0);
    // 加载中 / 没有更多 / 还没有游标都直接跳过，滚动抖动不该连发请求
    if (
      node.scrollTop < TOP_TRIGGER &&
      onLoadHistory &&
      history.hasMore &&
      !history.loading &&
      history.cursor > 0
    ) {
      onLoadHistory(history.cursor);
    }
  };

  const jumpToLatest = () => {
    const node = listRef.current;
    if (!node) return;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollTo({ top: node.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    atBottomRef.current = true;
    setAtBottom(true);
    setNewCount(0);
  };

  // 一条聊天都没有时，「没有更早的消息了」没有意义，别在空频道里故意提醒用户翻不动
  const hasChat = messages.some((message) => message.kind !== 'system');

  return (
    <div className="relative">
      <div
        ref={listRef}
        onScroll={handleScroll}
        // 可聚焦才能用方向键 / PageUp 翻记录；焦点环走薄荷描边，不借用浏览器默认
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-label="园区频道消息"
        className={`space-y-2 overflow-y-auto px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-400/60 ${
          // 桌面端也要跟着视口高度收：矮窗口里 340px 会把工牌与操作行挤出屏幕
          compact ? 'max-h-[min(38dvh,220px)]' : 'max-h-[min(46dvh,340px)]'
        }`}
      >
        {history.loading && (
          <p role="status" className="flex items-center gap-2 font-mono text-[9px] text-mist-500">
            <span className="h-3 w-0.5 animate-pulse bg-mint-400" aria-hidden />
            正在加载更早的消息…
          </p>
        )}
        {!history.loading && hasChat && !history.hasMore && (
          <p role="status" className="text-center font-mono text-[9px] tracking-[0.14em] text-mist-500">
            没有更早的消息了
          </p>
        )}

        {messages.length === 0 && (
          <div className="space-y-1.5 font-mono text-[11px] leading-relaxed text-mist-500">
            <p>频道很安静。按 Enter 说点什么，附近 900px 内的牛马都能看到。</p>
            <p className="text-[10px]">有人进园、离园，或你在岗满 30 分钟，这里会自动播报。</p>
          </div>
        )}

        {messages.map((message, index) => {
          const time = formatClock(message.at);
          const full = formatFullClock(message.at);
          // 历史与实时之间画一条线：别让人误以为「一直能收到全园消息」
          const previous = messages[index - 1];
          const divider = previous?.history === true && message.history !== true;

          if (message.kind === 'system') {
            const marker = systemMarker(message.systemKind);
            return (
              <Fragment key={entryKey(message)}>
                {divider && <HistoryDivider />}
                <p className="flex items-baseline gap-1.5 font-mono text-[10px] leading-relaxed text-mist-400">
                  <span className="shrink-0 tabular-nums text-mist-500" title={full}>
                    {time}
                  </span>
                  <span className={`shrink-0 ${marker.tone}`} aria-hidden>
                    {marker.glyph}
                  </span>
                  <span className="min-w-0 flex-1">{message.text}</span>
                </p>
              </Fragment>
            );
          }

          return (
            <Fragment key={entryKey(message)}>
              {divider && <HistoryDivider />}
              <p className="text-[12px] leading-relaxed">
                <span className="mr-1.5 font-mono text-[9px] tabular-nums text-mist-500" title={full}>
                  {time}
                </span>
                <span
                  className={`mr-2 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    message.self ? 'text-lime-400' : 'text-mint-400'
                  }`}
                >
                  {/* 与头顶同一口径：全角算 2 宽，超出换省略号，不撑开面板 */}
                  {truncateToDisplayWidth(message.name, MAX_NAME_DISPLAY_UNITS)}
                </span>
                {/* 历史条目略降一档：同一屏里「旧话」不该和刚说的话抢注意力 */}
                <span className={message.history ? 'text-mist-100/85' : 'text-mist-100'}>{message.text}</span>
              </p>
            </Fragment>
          );
        })}
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-2 right-2 flex cursor-pointer items-center gap-1 border-2 border-mint-400 bg-ink-950/95 px-2 py-1 font-mono text-[9px] tabular-nums text-mint-400 backdrop-blur-sm transition-colors hover:bg-mint-400 hover:text-ink-950"
        >
          <ArrowDown className="h-3 w-3" aria-hidden />
          {newCount > 0 ? `${newCount} 条新消息` : '回到最新'}
        </button>
      )}
    </div>
  );
}

function HistoryDivider() {
  return (
    <p
      role="separator"
      className="flex items-center gap-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-mist-500"
    >
      <span className="h-px flex-1 bg-ink-600" aria-hidden />
      以上为进入园区前的消息
      <span className="h-px flex-1 bg-ink-600" aria-hidden />
    </p>
  );
}
