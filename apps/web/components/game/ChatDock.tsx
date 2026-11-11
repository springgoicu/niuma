'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquare, Send } from 'lucide-react';
import { inspectText } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { ChatLog } from './ChatLog';

interface ChatDockProps {
  onSend: (text: string) => void;
  /** 打开面板：由宿主统一清移动键并请求聚焦；缺省时只切展开态 */
  onOpen?: () => void;
  /** 上翻到顶：把当前最旧的 msgId 交给宿主去拉更早的一页 */
  onLoadHistory?: (cursor: number) => void;
  compact?: boolean;
}

const MAX_INPUT_LENGTH = 160;
const CHAR_WARNING_THRESHOLD = 140;
/** 提示条在收起态也要留一会儿，但不能常驻 */
const NOTICE_DURATION_MS = 4000;

export function ChatDock({ onSend, onOpen, onLoadHistory, compact = false }: ChatDockProps) {
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

  const submit = () => {
    const text = draft.trim();
    if (text.length === 0) return;

    // 服务端仍会复核一次；这里先判是为了不让用户白等一个往返
    const verdict = inspectText(text);
    if (verdict.verdict === 'reject') {
      setNotice('这句话里有不能发的词，换个说法');
      return;
    }

    onSend(verdict.text);
    setDraft('');
    setNotice(verdict.verdict === 'mask' ? '不文明用词已自动打码' : null);
    // 聊天常驻：发送成功不再收起面板。
    // 桌面端保留焦点，方便连着说几句；触屏仍要 blur 收键盘，否则输入法会常驻压住摇杆。
    if (compact) inputRef.current?.blur();
  };

  const charCount = draft.length;
  const isNearLimit = charCount > CHAR_WARNING_THRESHOLD;
  const unreadLabel = unread > 99 ? '99+' : `${unread}`;

  return (
    <div
      className={`pointer-events-auto max-w-[calc(100vw-2rem)] border-2 border-ink-600 bg-ink-900/65 backdrop-blur-md ${compact ? 'w-[250px]' : 'w-[340px]'}`}
    >
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
        className="flex w-full cursor-pointer items-center justify-between border-b-2 border-ink-700 px-3 py-2 transition-colors hover:bg-ink-800/60"
      >
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-300">
          <MessageSquare className="h-3.5 w-3.5 text-mint-400" />
          园区频道
          <span className="text-mist-400">/local</span>
        </span>
        <span className="flex items-center gap-2">
          {/* 收起态显示未读而不是总数：200 条这个数字不携带任何信息 */}
          {!open && unread > 0 ? (
            <span className="border border-mint-400 bg-mint-400 px-1 py-0.5 font-mono text-[9px] font-semibold tabular-nums leading-none text-ink-950">
              {unreadLabel}
            </span>
          ) : (
            <span className="font-mono text-[9px] tabular-nums text-mist-400">{messages.length}</span>
          )}
          {/* 未读同时用文案表达，不只靠颜色 */}
          {!open && unread > 0 && <span className="sr-only">{unread} 条未读</span>}
          <ChevronDown
            className={`h-3.5 w-3.5 text-mist-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

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

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="border-t-2 border-ink-700 px-2 py-2 space-y-1"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  // 提示只对上一次提交成立，继续编辑就撤掉，避免误导
                  if (notice) setNotice(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  // 先释放焦点再收起：输入框卸载后焦点交还 body，WASD 立即恢复移动
                  event.preventDefault();
                  inputRef.current?.blur();
                  setOpen(false);
                }}
                maxLength={MAX_INPUT_LENGTH}
                placeholder="说点什么…"
                aria-label="聊天输入框"
                enterKeyHint="send"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                // 根节点是 select-none / no-callout：输入框必须拿回文本选择与系统放大镜
                className="min-w-0 flex-1 select-text border-2 border-ink-600 bg-ink-950/85 px-2.5 py-1.5 font-mono text-[11px] text-mist-100 outline-none placeholder:text-mist-400 [-webkit-touch-callout:default] focus:border-mint-400"
              />
              <button
                type="submit"
                aria-label="发送"
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center border-2 border-mint-400 bg-mint-400/10 text-mint-400 transition-colors hover:bg-mint-400 hover:text-ink-950"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span
                role="status"
                className="min-w-0 truncate font-mono text-[9px] leading-relaxed text-amber-400"
              >
                {notice}
              </span>
              <span
                className={`shrink-0 font-mono text-[9px] tabular-nums ${isNearLimit ? 'text-amber-400' : 'text-mist-400'}`}
              >
                {charCount} / {MAX_INPUT_LENGTH}
              </span>
            </div>
          </form>
        </>
      )}

      {/* 用户手动收起时也要留住打码提示：收起态在面板底部留一条 */}
      {!open && notice && (
        <p
          role="status"
          className="border-t-2 border-ink-700 px-3 py-1.5 font-mono text-[9px] leading-relaxed text-amber-400"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
