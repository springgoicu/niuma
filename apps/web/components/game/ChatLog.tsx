'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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

/** 距顶部多远触发上翻 */
const TOP_TRIGGER = 16;
/** 贴底判定容差：分数像素不该被当成「用户已经滚开」 */
const BOTTOM_EPSILON = 1;

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
      return { glyph: '−', tone: 'text-mist-400' };
    case SYSTEM_NOTICE_KIND.OnDuty:
      return { glyph: '·', tone: 'text-amber-400/80' };
    default:
      return { glyph: '·', tone: 'text-mist-400' };
  }
}

/**
 * 频道消息区：滚动、上翻加载与「始终贴底」都在这里。
 *
 * 两条纪律：
 * 1. 打开即贴底；任何新消息都立刻跟到底部，即使会打断上翻历史；
 * 2. 只有「前插更早一页」按高度差回填 `scrollTop`，正在读的那句话不能跳走。
 *    历史不是新消息，不该触发贴底，否则上翻功能会立刻把自己顶回底部。
 */
export function ChatLog({ messages, history, open, compact, onLoadHistory }: ChatLogProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /** 前插回填基准：上一次落定时的内容总高 */
  const scrollHeightRef = useRef(0);
  const firstKeyRef = useRef<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  /** 上一次滚动位置：只有 `scrollTop` 变小才可能是用户主动上翻 */
  const lastScrollTopRef = useRef(0);
  /** 视图是否该跟随布局变化：用户滚开后为 false，贴底后回到 true */
  const followLayoutRef = useRef(true);
  /** ResizeObserver 回调合并到一帧，避免同一帧多次写入滚动位置 */
  const frameRef = useRef<number | null>(null);

  /**
   * 唯一贴底入口：写滚动位置并把所有基准对齐。
   * 所有「该看最新一条」的路径都走这里，避免多处各写一遍 `scrollTop`。
   */
  const pinToBottom = useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    scrollHeightRef.current = node.scrollHeight;
    lastScrollTopRef.current = node.scrollTop;
    followLayoutRef.current = true;
  }, []);

  // 打开面板一律贴底：从最新处开始读，而不是接着上次翻到的地方。
  // 用 layout effect 在绘制前落位，避免看见一帧旧位置；滚动条、dvh、父级 flex
  // 在首帧后还会再改一次高度，所以补一次 rAF，并由下面的 ResizeObserver 继续跟随。
  useLayoutEffect(() => {
    if (!open) return;
    pinToBottom();
    const frame = requestAnimationFrame(() => pinToBottom());
    return () => cancelAnimationFrame(frame);
  }, [open, pinToBottom]);

  // 字体就绪会改变文本度量（换行位置、行数），内容总高可能晚于首帧才稳定。
  // `fonts.ready` 已 resolve 时这里只是多贴一次，代价可以忽略。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled && followLayoutRef.current) pinToBottom();
    });
    return () => {
      cancelled = true;
    };
  }, [open, pinToBottom]);

  // 容器尺寸变化（视口变矮、地址栏收展、键盘、窗口缩放、max-h 换档、滚动条出现）
  // 会让「离底部的距离」凭空出现；只在用户本来就该看底部时跟随，上翻读史时不抢滚动。
  // 观察容器而不是内容：内容超出 max-h 之后追加/前插都不改变容器尺寸，
  // 因此不会与历史前插的锚定互抢（ADR-0047 修正 ADR-0041 方案 C 的失效理由）。
  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!followLayoutRef.current) return;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (followLayoutRef.current) pinToBottom();
      });
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [open, pinToBottom]);

  // 消息变化：首尾条目身份判断，不依赖长度——200 条封顶后长度恒定，
  // 按「有没有变长」判断会让新消息永远滚不到底。
  useLayoutEffect(() => {
    const firstKey = messages.length > 0 ? entryKey(messages[0]!) : null;
    const lastKey = messages.length > 0 ? entryKey(messages[messages.length - 1]!) : null;
    const previousFirst = firstKeyRef.current;
    const previousLast = lastKeyRef.current;
    const previousHeight = scrollHeightRef.current;

    firstKeyRef.current = firstKey;
    lastKeyRef.current = lastKey;

    const node = listRef.current;
    if (!node) return;
    const height = node.scrollHeight;

    // 首尾都没变：内容实际上没动（例如上翻返回空页 / 全是本地已有的条目），
    // 不碰滚动位置，也不要翻掉基准——否则下一次前插会按错误的高度差回填。
    if (firstKey === previousFirst && lastKey === previousLast) {
      scrollHeightRef.current = height;
      return;
    }

    // 首次落位由上面的 open effect 负责，这里再对一次即可
    if (previousFirst === null && previousLast === null) {
      pinToBottom();
      return;
    }

    // 只有「尾部没变、头部前移」才是历史前插：按高度差回填，阅读位置不动。
    // 其余情况（追加、整表替换、前插同时夹带新消息）一律贴底。
    if (firstKey !== previousFirst && lastKey === previousLast) {
      node.scrollTop += height - previousHeight;
      scrollHeightRef.current = height;
      lastScrollTopRef.current = node.scrollTop;
      // 前插后通常已不在底部：别让后续布局变化把正在读的那句话顶走
      followLayoutRef.current =
        node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_EPSILON;
      return;
    }

    pinToBottom();
  }, [messages, open, pinToBottom]);

  const handleScroll = () => {
    const node = listRef.current;
    if (!node) return;

    const top = node.scrollTop;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = top;
    followLayoutRef.current = node.scrollHeight - top - node.clientHeight <= BOTTOM_EPSILON;

    // 只有「向上滚」才可能是用户想翻更早的消息：程序化贴底与前插回填都是增大
    // scrollTop，天然不会把自己的滚动当成用户上翻，也就不会自动多发一页请求。
    if (top >= previousTop || top >= TOP_TRIGGER) return;
    // 内容不足一屏时没有真正的「上面」可翻，别在空频道里自动请求历史
    if (node.scrollHeight <= node.clientHeight) return;
    // 加载中 / 没有更多 / 还没有游标都直接跳过，滚动抖动不该连发请求
    if (onLoadHistory && history.hasMore && !history.loading && history.cursor > 0) {
      onLoadHistory(history.cursor);
    }
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
          <p role="status" className="flex items-center gap-2 font-mono text-[9px] text-mist-400">
            <span className="h-3 w-0.5 animate-pulse bg-mint-400" aria-hidden />
            正在加载更早的消息…
          </p>
        )}
        {!history.loading && hasChat && !history.hasMore && (
          <p role="status" className="text-center font-mono text-[9px] tracking-[0.14em] text-mist-400">
            没有更早的消息了
          </p>
        )}

        {messages.length === 0 && (
          <div className="space-y-1.5 font-mono text-[11px] leading-relaxed text-mist-400">
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
                  <span className="shrink-0 tabular-nums text-mist-400" title={full}>
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
                <span className="mr-1.5 font-mono text-[9px] tabular-nums text-mist-400" title={full}>
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
    </div>
  );
}

function HistoryDivider() {
  return (
    <p
      role="separator"
      className="flex items-center gap-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-mist-400"
    >
      <span className="h-px flex-1 bg-ink-600" aria-hidden />
      以上为进入园区前的消息
      <span className="h-px flex-1 bg-ink-600" aria-hidden />
    </p>
  );
}
