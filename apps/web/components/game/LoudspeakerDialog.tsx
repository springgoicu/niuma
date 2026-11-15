'use client';

import { Megaphone, X } from 'lucide-react';
import { useState } from 'react';
import { MAX_SHOUT_CHARS, truncateShout } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

interface LoudspeakerDialogProps {
  onSend: (text: string) => void;
}

/**
 * 全服大喇叭输入（ADR-0085）。
 *
 * 客户端只做「30 字上限 + 不能为空」这两件不需要审核的事；
 * 敏感词与扣道具都在服务端，被拒时不扣道具、回一条理由由顶部提示展示。
 */
export function LoudspeakerDialog({ onSend }: LoudspeakerDialogProps) {
  const open = useGameUi((state) => state.shoutOpen);
  const setOpen = useGameUi((state) => state.setShoutOpen);
  const inventory = useGameUi((state) => state.wallet.inventory);
  const [text, setText] = useState('');
  if (!open) return null;

  const owned = inventory['loudspeaker'] ?? 0;
  const count = Array.from(text).length;
  const canSend = owned > 0 && count > 0;
  const close = () => {
    setText('');
    setOpen(false);
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/70 px-4 backdrop-blur-[2px]">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" onClick={close} />
      <div className="relative w-full max-w-[380px] border-2 border-[#F2C879]/70 bg-ink-900/95 p-4 shadow-[0_0_24px_rgba(242,200,121,0.25)]">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-[#F2C879]">
              <Megaphone className="h-4 w-4" aria-hidden /> 全服大喇叭
            </h2>
            <p className="mt-1 text-[11px] text-mist-400">
              所有在线牛马都会看到这条金色横幅 · 持有 {owned}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            className="grid h-7 w-7 shrink-0 place-items-center border-2 border-ink-600 text-mist-300 hover:border-[#F2C879] hover:text-[#F2C879]"
          >
            <X className="h-3 w-3" />
          </button>
        </header>

        <textarea
          value={text}
          onChange={(event) => setText(truncateShout(event.target.value))}
          rows={3}
          placeholder="例：全体注意，三点整集体摸鱼！"
          className="w-full resize-none border-2 border-ink-700 bg-ink-950 px-2 py-2 font-mono text-[12px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-600 focus:border-[#F2C879]/70"
        />

        <div className="mt-2 flex items-center justify-between">
          <span
            className={`font-mono text-[11px] ${
              count >= MAX_SHOUT_CHARS ? 'text-signal-500' : 'text-mist-500'
            }`}
          >
            {count}/{MAX_SHOUT_CHARS}
          </span>
          <button
            type="button"
            disabled={!canSend}
            onClick={() => {
              onSend(text);
              setText('');
              setOpen(false);
            }}
            className={`border-2 px-3 py-1.5 text-[12px] font-semibold ${
              canSend
                ? 'border-[#F2C879] bg-[#F2C879]/15 text-[#F2C879] hover:bg-[#F2C879]/25 active:translate-y-px'
                : 'cursor-not-allowed border-ink-700 text-mist-500'
            }`}
          >
            {owned > 0 ? '全服广播' : '背包里没有大喇叭'}
          </button>
        </div>
      </div>
    </div>
  );
}
