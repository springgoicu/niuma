'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Eraser } from 'lucide-react';
import {
  MAX_STATUS_DISPLAY_UNITS,
  displayWidth,
  truncateStatus,
} from '@niuma/shared-types';
import { checkProfileStatus } from '@/lib/profile';

/**
 * 常用状态 emoji：都是工位上真会发生的事，不拿随机贴纸凑一排。
 * 顺序按「摸鱼 → 干活 → 加班」排，常用项在拇指最容易够到的左侧。
 */
const QUICK_EMOJI = ['☕', '🐟', '💤', '⌨️', '🍱', '🎧', '🌙', '🔥'] as const;

interface StatusEditorProps {
  value: string;
  compact?: boolean;
  onSave: (status: string) => void;
  onClose: () => void;
}

/**
 * 工牌下方抽出来的一行表单，不是弹窗：状态是随手改的东西，
 * 弹窗会抢走焦点、遮住画面，还会逼用户再点一次「确定」。
 */
export function StatusEditor({ value, compact = false, onSave, onClose }: StatusEditorProps) {
  const [draft, setDraft] = useState(value);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 光标放末尾：最常见的动作是接着上一版状态改两个字
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const width = displayWidth(draft);
  const tooWide = width > MAX_STATUS_DISPLAY_UNITS;

  const close = () => {
    inputRef.current?.blur();
    onClose();
  };

  const submit = () => {
    const text = truncateStatus(draft);
    const verdict = text.length > 0 ? checkProfileStatus(text) : null;
    if (verdict && verdict.verdict === 'reject') {
      setNotice('这段状态用不了，换一句');
      return;
    }
    // 脏话按打码结果照常上屏，与昵称、聊天同一套规则
    onSave(verdict ? verdict.text : text);
    close();
  };

  const appendEmoji = (emoji: string) => {
    const unit = displayWidth(emoji);
    if (width + unit > MAX_STATUS_DISPLAY_UNITS) {
      setNotice('头顶放不下了，先删几个字');
      return;
    }
    setDraft(`${draft}${emoji}`);
    setNotice(null);
    inputRef.current?.focus();
  };

  return (
    <div
      id="status-editor"
      role="dialog"
      aria-label="设置状态"
      className="border-t-2 border-ink-700 bg-ink-950/70 px-3 py-2.5"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
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
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
              }
              if (event.key !== 'Enter') return;
              // 中文输入法选词时按 Enter 只是上屏，不该顺手提交
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              submit();
            }}
            maxLength={48}
            placeholder="4 个字或 8 个 emoji"
            aria-label="状态内容"
            aria-invalid={tooWide}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            className={`h-9 min-w-0 flex-1 border bg-ink-950 px-2 font-mono text-[11px] text-mist-100 outline-none transition-colors duration-150 placeholder:text-mist-500 ${
              tooWide ? 'border-amber-400' : 'border-ink-600 focus:border-mint-400'
            }`}
          />
          <button
            type="submit"
            aria-label="保存状态"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center border-2 border-mint-400 bg-mint-400/10 text-mint-400 transition-colors duration-150 hover:bg-mint-400 hover:text-ink-950"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              onSave('');
              close();
            }}
            aria-label="清除状态"
            title="清除状态"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center border border-ink-700 text-mist-400 transition-colors duration-150 hover:border-signal-500/70 hover:text-signal-500"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className={`mt-2 grid gap-1 ${compact ? 'grid-cols-4' : 'grid-cols-8'}`}>
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => appendEmoji(emoji)}
              aria-label={`插入 ${emoji}`}
              className="grid h-7 cursor-pointer place-items-center border border-ink-700 bg-ink-900/60 text-[13px] leading-none transition-colors duration-150 hover:border-mint-400/70 hover:bg-mint-400/10 active:translate-y-px"
            >
              <span className="translate-y-[-0.5px]">{emoji}</span>
            </button>
          ))}
        </div>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span
            role="status"
            className="min-w-0 truncate font-mono text-[9px] leading-relaxed text-amber-400"
          >
            {notice ?? (tooWide ? '超出头顶宽度，保存时会截断' : '')}
          </span>
          <span
            className={`shrink-0 font-mono text-[9px] tabular-nums ${
              tooWide ? 'text-amber-400' : 'text-mist-500'
            }`}
          >
            {width} / {MAX_STATUS_DISPLAY_UNITS}
          </span>
        </div>
      </form>
    </div>
  );
}
