'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquare, Send } from 'lucide-react';
import { MAX_NAME_DISPLAY_UNITS, truncateToDisplayWidth } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

interface ChatDockProps {
  onSend: (text: string) => void;
}

const MAX_INPUT_LENGTH = 160;
const CHAR_WARNING_THRESHOLD = 140;

export function ChatDock({ onSend }: ChatDockProps) {
  const messages = useGameUi((state) => state.messages);
  const open = useGameUi((state) => state.chatOpen);
  const setOpen = useGameUi((state) => state.setChatOpen);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  const submit = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    onSend(text);
    setDraft('');
  };

  const charCount = draft.length;
  const isNearLimit = charCount > CHAR_WARNING_THRESHOLD;

  return (
    <div className="pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
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
          <div ref={listRef} className="max-h-[220px] space-y-2 overflow-y-auto px-3 py-3">
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
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setOpen(false);
                }}
                maxLength={MAX_INPUT_LENGTH}
                placeholder="说点什么…（Enter 发送，Esc 收起）"
                aria-label="聊天输入框"
                className="min-w-0 flex-1 border-2 border-ink-600 bg-ink-950 px-2.5 py-1.5 font-mono text-[11px] text-mist-100 outline-none focus:border-mint-400"
              />
              <button
                type="submit"
                aria-label="发送"
                className="grid h-8 w-8 cursor-pointer place-items-center border-2 border-mint-400 bg-mint-400/10 text-mint-400 transition-colors hover:bg-mint-400 hover:text-ink-950"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className={`text-right font-mono text-[9px] ${isNearLimit ? 'text-amber-400' : 'text-mist-500'}`}>
              {charCount} / {MAX_INPUT_LENGTH}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
