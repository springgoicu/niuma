'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquare, Send } from 'lucide-react';
import { MAX_NAME_DISPLAY_UNITS, inspectText, truncateToDisplayWidth } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

interface ChatDockProps {
  onSend: (text: string) => void;
  /** 打开面板：由宿主统一清移动键并请求聚焦；缺省时只切展开态 */
  onOpen?: () => void;
  compact?: boolean;
}

const MAX_INPUT_LENGTH = 160;
const CHAR_WARNING_THRESHOLD = 140;
/** 提示条在收起态也要留一会儿，但不能常驻 */
const NOTICE_DURATION_MS = 4000;

export function ChatDock({ onSend, onOpen, compact = false }: ChatDockProps) {
  const messages = useGameUi((state) => state.messages);
  const open = useGameUi((state) => state.chatOpen);
  const focusSeq = useGameUi((state) => state.chatFocusSeq);
  const setOpen = useGameUi((state) => state.setChatOpen);
  const [draft, setDraft] = useState('');
  /** 本地预检的即时解释：被拦下时保留草稿，打码时照常发出 */
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * 聚焦由 `open` 与 `chatFocusSeq` 共同驱动：
   * 面板已展开但输入框失焦时（点过游戏画面），只改 open 不会让 effect 重跑，
   * 所以每次「打开 / 重新聚焦」都推进一次序号。
   */
  useEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 光标落在末尾：回车重新打开时接着上次的草稿继续打，而不是从头插入
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [open, focusSeq]);

  // 提示条自动消失：被拦下 / 打码的文案只对上一次提交成立
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

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
    // 发送成功一律收起：桌面端也把焦点还给游戏，WASD 立刻可用，再按 Enter 重新打开；
    // 手机端还额外收回输入法，别让它常驻压住摇杆
    inputRef.current?.blur();
    setOpen(false);
  };

  const charCount = draft.length;
  const isNearLimit = charCount > CHAR_WARNING_THRESHOLD;

  return (
    <div
      className={`pointer-events-auto max-w-[calc(100vw-2rem)] border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm ${compact ? 'w-[250px]' : 'w-[340px]'}`}
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
          <span className="text-mist-500">/local</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-mist-500">{messages.length}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-mist-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <>
          <div
            ref={listRef}
            // 旋转舞台的 dvh 指的是物理高度（等于舞台宽度），这里只用一个固定的舞台内高度
            className={`space-y-2 overflow-y-auto px-3 py-3 ${compact ? 'max-h-[120px]' : 'max-h-[220px]'}`}
          >
            {messages.length === 0 && (
              <p className="font-mono text-[11px] leading-relaxed text-mist-500">
                频道很安静。按 Enter 说点什么，附近 900px 内的牛马都能看到。
              </p>
            )}
            {messages.map((message) => (
              <p key={`${message.id}-${message.at}`} className="text-[12px] leading-relaxed">
                <span
                  className={`mr-2 font-mono text-[10px] uppercase tracking-[0.12em] ${
                    message.self ? 'text-lime-400' : 'text-mint-400'
                  }`}
                >
                  {/* 与头顶同一口径：全角算 2 宽，超出换省略号，不撑开 340px 面板 */}
                  {truncateToDisplayWidth(message.name, MAX_NAME_DISPLAY_UNITS)}
                </span>
                <span className="text-mist-100">{message.text}</span>
              </p>
            ))}
          </div>

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
                className="min-w-0 flex-1 select-text border-2 border-ink-600 bg-ink-950 px-2.5 py-1.5 font-mono text-[11px] text-mist-100 outline-none [-webkit-touch-callout:default] focus:border-mint-400"
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
                className={`shrink-0 font-mono text-[9px] ${isNearLimit ? 'text-amber-400' : 'text-mist-500'}`}
              >
                {charCount} / {MAX_INPUT_LENGTH}
              </span>
            </div>
          </form>
        </>
      )}

      {/* 发送成功即收起，打码提示不能被一起关掉：收起态在面板底部留一条 */}
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
