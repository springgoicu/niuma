'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { inspectText, type ChatSendPacket } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import type { DanmakuPrefs } from '@/lib/game/danmaku-prefs';
import { ChatInput } from './ChatInput';
import { ChatLog } from './ChatLog';
import { DanmakuHUD } from './DanmakuHUD';

interface ChatDockProps {
  /** 发送：正文已过本地预检，颜色与模式原样上行（服务端还会再钳一次） */
  onSend: (packet: ChatSendPacket) => void;
  /** 打开面板：由宿主统一清移动键并请求聚焦；缺省时只切展开态 */
  onOpen?: () => void;
  /** 上翻到顶：把当前最旧的 msgId 交给宿主去拉更早的一页 */
  onLoadHistory?: (cursor: number) => void;
  /** 弹幕偏好：颜色 / 模式在发送侧，开关与透明度在接收侧，共用一份存储 */
  danmakuPrefs: DanmakuPrefs;
  onDanmakuPrefsChange: (prefs: DanmakuPrefs) => void;
  compact?: boolean;
}

/** 提示条在收起态也要留一会儿，但不能常驻 */
const NOTICE_DURATION_MS = 4000;

export function ChatDock({
  onSend,
  onOpen,
  onLoadHistory,
  danmakuPrefs,
  onDanmakuPrefsChange,
  compact = false,
}: ChatDockProps) {
  const messages = useGameUi((state) => state.messages);
  const history = useGameUi((state) => state.history);
  const unread = useGameUi((state) => state.unread);
  const open = useGameUi((state) => state.chatOpen);
  const focusSeq = useGameUi((state) => state.chatFocusSeq);
  const setOpen = useGameUi((state) => state.setChatOpen);
  const [draft, setDraft] = useState('');
  /** 本地预检的即时解释：被拦下时保留草稿，打码时照常发出 */
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 上一次真正处理过的聚焦序号：恢复常驻时不聚焦 */
  const focusSeqRef = useRef(focusSeq);

  /**
   * 聚焦只看 `chatFocusSeq` 是否真的推进过：
   * - 点头部按钮 / 按 Enter / 动作盘打字键走 `requestChat`，序号 +1，这里聚焦；
   * - 刷新后从 localStorage 恢复常驻只改 `chatOpen`，序号没变，不能自动聚焦，
   *   否则手机端一进页面就弹输入法。
   */
  useEffect(() => {
    if (!open) {
      focusSeqRef.current = focusSeq;
      return;
    }
    if (focusSeqRef.current === focusSeq) return;
    focusSeqRef.current = focusSeq;

    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 光标落在末尾：回车重新打开时接着上次的草稿继续打，而不是从头插入
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [open, focusSeq]);

  // 聊天常驻后输入框经常是失焦的：Esc 必须仍然能关，不然只能点头部按钮。
  // 输入框自己的 Esc 已经 preventDefault，这里靠 defaultPrevented 去重。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      inputRef.current?.blur();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  // 提示条自动消失：被拦下 / 打码的文案只对上一次提交成立
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /**
   * 本地预检 + 发送。
   *
   * 审核仍在这里先判一次，只是换了个入口（ChatInput 负责键盘与控件）。
   * 颜色与模式不参与审核：它们是外观，不是内容。
   */
  const submit = (packet: ChatSendPacket) => {
    const verdict = inspectText(packet.text);
    if (verdict.verdict === 'reject') {
      setNotice('这句话里有不能发的词，换个说法');
      return;
    }
    onSend({ ...packet, text: verdict.text });
    setDraft('');
    setNotice(verdict.verdict === 'mask' ? '不文明用词已自动打码' : null);
  };

  const unreadLabel = unread > 99 ? '99+' : `${unread}`;

  /**
   * 两档尺寸：默认档（桌面）按「一眼看清」重排，窄版保持原来的紧凑值。
   *
   * 反馈是「左下角的发送框太马赛克」——9~11px 的小字在 1x 屏上本身就发虚，
   * 65% 的玻璃底又把像素风的噪点叠到字后面。桌面档把字整体上调一档、底压实到
   * 88%，模糊降到 4px；窄版不动，小屏没有这个余量（ADR-0058）。
   */
  const shellSkin = compact
    ? 'w-[250px] bg-ink-900/65 backdrop-blur-md'
    : 'w-[340px] bg-ink-900/88 backdrop-blur-sm lg:w-[380px]';
  /** 标题栏内边距：桌面放大字号后需要更宽的呼吸区 */
  const headSkin = compact ? 'gap-2 px-3 py-2' : 'gap-2.5 px-3.5 py-2.5';
  const titleSkin = compact ? 'text-[10px]' : 'text-[11px]';
  const metaSkin = compact ? 'text-[9px]' : 'text-[10px]';
  /** 收起态提示条是中文散文：桌面档不套等宽字 */
  const hintSkin = compact ? 'font-mono text-[9px]' : 'text-[10px]';
  const iconSkin = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <div
      className={`pointer-events-auto max-w-[calc(100vw-2rem)] border-2 border-ink-600 ${shellSkin}`}
    >
      {/* 标题栏拆成两个按钮：折叠是主操作，齿轮是设置入口，不能把 button 套进 button */}
      <div className="flex items-center border-b-2 border-ink-700">
        <button
          type="button"
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            if (onOpen) onOpen();
            else setOpen(true);
          }}
          aria-expanded={open}
          data-no-immersive
          className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between ${headSkin} transition-colors hover:bg-ink-800/60`}
        >
          <span className={`flex items-center gap-2 font-mono ${titleSkin} uppercase tracking-[0.2em] text-mist-300`}>
            <MessageSquare className={`${iconSkin} text-mint-400`} />
            园区频道
            <span className="text-mist-400">/local</span>
          </span>
          <span className="flex items-center gap-2">
            {/* 收起态显示未读而不是总数：200 条这个数字不携带任何信息 */}
            {!open && unread > 0 ? (
              <span className={`border border-mint-400 bg-mint-400 px-1 py-0.5 font-mono ${metaSkin} font-semibold tabular-nums leading-none text-ink-950`}>
                {unreadLabel}
              </span>
            ) : (
              <span className={`font-mono ${metaSkin} tabular-nums text-mist-400`}>{messages.length}</span>
            )}
            {/* 未读同时用文案表达，不只靠颜色 */}
            {!open && unread > 0 && <span className="sr-only">{unread} 条未读</span>}
            <ChevronDown
              className={`${iconSkin} text-mist-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </button>
        <div className={`shrink-0 ${compact ? 'pr-1.5' : 'pr-2'}`}>
          <DanmakuHUD prefs={danmakuPrefs} onChange={onDanmakuPrefsChange} compact={compact} />
        </div>
      </div>

      {open && (
        <>
          {/*
            固定高度而不是 dvh：竖屏聊天浮在工牌下方，展开后不能把底部操作区顶出屏幕（ADR-0033）。
            手机端取 min(38dvh, 220px)，桌面端给到 340px 让一屏多看到几轮对话。
          */}
          <ChatLog
            messages={messages}
            history={history}
            open={open}
            compact={compact}
            onLoadHistory={onLoadHistory}
          />

          <ChatInput
            draft={draft}
            onDraftChange={setDraft}
            onSend={submit}
            colorIndex={danmakuPrefs.colorIndex}
            onColorChange={(colorIndex) => onDanmakuPrefsChange({ ...danmakuPrefs, colorIndex })}
            mode={danmakuPrefs.mode}
            onModeChange={(mode) => onDanmakuPrefsChange({ ...danmakuPrefs, mode })}
            notice={notice}
            onNoticeClear={() => setNotice(null)}
            inputRef={inputRef}
            blurOnSend={compact}
            compact={compact}
            onEscape={() => setOpen(false)}
          />
        </>
      )}

      {/* 用户手动收起时也要留住打码提示：收起态在面板底部留一条 */}
      {!open && notice && (
        <p
          role="status"
          className={`border-t-2 border-ink-700 ${compact ? 'px-3 py-1.5' : 'px-3.5 py-2'} ${hintSkin} leading-relaxed text-amber-400`}
        >
          {notice}
        </p>
      )}
    </div>
  );
}
