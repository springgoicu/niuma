'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Eraser } from 'lucide-react';
import {
  MAX_NAME_CHARS,
  MAX_NAME_DISPLAY_UNITS,
  MAX_STATUS_DISPLAY_UNITS,
  displayWidth,
  truncateStatus,
} from '@niuma/shared-types';
import {
  checkProfileName,
  checkProfileStatus,
  describeProfileName,
} from '@/lib/profile';

/**
 * 常用状态 emoji：都是工位上真会发生的事，不拿随机贴纸凑一排。
 * 顺序按「摸鱼 → 干活 → 加班」排，常用项在拇指最容易够到的左侧。
 */
const QUICK_EMOJI = ['☕', '🐟', '💤', '⌨️', '🍱', '🎧', '🌙', '🔥'] as const;

export interface BadgeSavePayload {
  name: string;
  status: string;
}

interface BadgeEditorProps {
  name: string;
  status: string;
  compact?: boolean;
  onSave: (payload: BadgeSavePayload) => void;
  onClose: () => void;
}

/**
 * 工牌下方抽出来的一块表单，不是弹窗：名字与状态都是随手改的东西，
 * 弹窗会抢走焦点、遮住画面，还会逼用户再点一次「确定」。
 *
 * 名字行在状态行之上，一次提交两个字段；清除按钮仍只清状态，
 * 因为「我今天不想挂状态」不该顺手把名字也清掉。
 */
export function BadgeEditor({
  name,
  status,
  compact = false,
  onSave,
  onClose,
}: BadgeEditorProps) {
  const [nameDraft, setNameDraft] = useState(name);
  const [statusDraft, setStatusDraft] = useState(status);
  const [notice, setNotice] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = nameRef.current;
    if (!input) return;
    input.focus();
    // 光标放末尾：最常见的动作是接着上一版名字改两个字
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const nameStatus = describeProfileName(nameDraft);
  const statusWidth = displayWidth(statusDraft);
  const statusTooWide = statusWidth > MAX_STATUS_DISPLAY_UNITS;

  /**
   * 名字的实时提示。空名与敏感词在输入时就说明白，
   * 不必等用户按了保存才被弹回来。
   */
  const nameHint = nameStatus.empty
    ? '工牌名不能空着'
    : nameStatus.blocked
      ? '这个工牌名用不了，换个说法'
      : nameStatus.tooWide
        ? '超出头顶宽度，保存时会截断'
        : nameStatus.masked
          ? '不文明用词会自动打码'
          : '工牌名会同步到头顶与档案';

  const close = () => {
    nameRef.current?.blur();
    statusRef.current?.blur();
    onClose();
  };

  const submit = () => {
    if (nameStatus.empty) {
      setNotice('先给工牌起个名字');
      nameRef.current?.focus();
      return;
    }
    if (nameStatus.blocked) {
      setNotice('这个工牌名用不了，换个说法');
      nameRef.current?.focus();
      return;
    }

    const statusText = truncateStatus(statusDraft);
    const statusVerdict = statusText.length > 0 ? checkProfileStatus(statusText) : null;
    if (statusVerdict && statusVerdict.verdict === 'reject') {
      setNotice('这段状态用不了，换一句');
      statusRef.current?.focus();
      return;
    }

    // 脏话按打码结果上屏，与状态、聊天同一套规则
    onSave({
      name: checkProfileName(nameDraft).text,
      status: statusVerdict ? statusVerdict.text : statusText,
    });
    close();
  };

  const clearStatus = () => {
    // 名字此刻非法时退回卡片上的旧名字：清除状态不该连带失败
    const safeName = nameStatus.empty || nameStatus.blocked
      ? name
      : checkProfileName(nameDraft).text;
    onSave({ name: safeName, status: '' });
    close();
  };

  const appendEmoji = (emoji: string) => {
    const unit = displayWidth(emoji);
    if (statusWidth + unit > MAX_STATUS_DISPLAY_UNITS) {
      setNotice('头顶放不下了，先删几个字');
      return;
    }
    setStatusDraft(`${statusDraft}${emoji}`);
    setNotice(null);
    statusRef.current?.focus();
  };

  return (
    <div
      id="badge-editor"
      role="dialog"
      aria-label="编辑工牌"
      className="border-t-2 border-ink-700 bg-ink-950/70 px-3 py-2.5"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/* 名字行：只有输入与宽度计数，保存按钮放在状态行，一处提交两个字段 */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="badge-name"
            className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500"
          >
            工牌名
          </label>
          <input
            id="badge-name"
            ref={nameRef}
            value={nameDraft}
            onChange={(event) => {
              setNameDraft(event.target.value);
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
            maxLength={MAX_NAME_CHARS}
            placeholder="8 个字以内"
            aria-label="工牌名"
            aria-invalid={nameStatus.empty || nameStatus.blocked || nameStatus.tooWide}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            className={`h-9 min-w-0 flex-1 border bg-ink-950 px-2 font-mono text-[11px] text-mist-100 outline-none transition-colors duration-150 placeholder:text-mist-500 ${
              nameStatus.empty || nameStatus.blocked
                ? 'border-amber-400'
                : nameStatus.tooWide
                  ? 'border-amber-400/70'
                  : 'border-ink-600 focus:border-mint-400'
            }`}
          />
          <span
            aria-hidden
            className={`shrink-0 font-mono text-[9px] tabular-nums ${
              nameStatus.tooWide ? 'text-amber-400' : 'text-mist-500'
            }`}
          >
            {nameStatus.displayUnits}/{MAX_NAME_DISPLAY_UNITS}
          </span>
        </div>
        <p
          className={`mt-1 truncate font-mono text-[9px] leading-relaxed tracking-[0.06em] ${
            nameStatus.empty || nameStatus.blocked || nameStatus.tooWide
              ? 'text-amber-400'
              : 'text-mist-500'
          }`}
        >
          {nameHint}
        </p>

        {/* 状态行：沿用原有节奏，保存按钮负责提交名字 + 状态 */}
        <div className="mt-2 flex items-center gap-2 border-t border-ink-800 pt-2">
          <input
            ref={statusRef}
            value={statusDraft}
            onChange={(event) => {
              setStatusDraft(event.target.value);
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
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              submit();
            }}
            maxLength={48}
            placeholder="4 个字或 8 个 emoji"
            aria-label="状态内容"
            aria-invalid={statusTooWide}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            className={`h-9 min-w-0 flex-1 border bg-ink-950 px-2 font-mono text-[11px] text-mist-100 outline-none transition-colors duration-150 placeholder:text-mist-500 ${
              statusTooWide ? 'border-amber-400' : 'border-ink-600 focus:border-mint-400'
            }`}
          />
          <button
            type="submit"
            aria-label="保存工牌"
            title="保存名字与状态"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center border-2 border-mint-400 bg-mint-400/10 text-mint-400 transition-colors duration-150 hover:bg-mint-400 hover:text-ink-950"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={clearStatus}
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
            {notice ?? (statusTooWide ? '超出头顶宽度，保存时会截断' : '')}
          </span>
          <span
            className={`shrink-0 font-mono text-[9px] tabular-nums ${
              statusTooWide ? 'text-amber-400' : 'text-mist-500'
            }`}
          >
            {statusWidth} / {MAX_STATUS_DISPLAY_UNITS}
          </span>
        </div>
      </form>
    </div>
  );
}
