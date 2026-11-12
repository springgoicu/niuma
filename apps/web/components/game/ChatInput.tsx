'use client';

import { useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import type { ChatSendPacket, DanmakuMode } from '@niuma/shared-types';
import {
  DANMAKU_MODE_OPTIONS,
  DANMAKU_PALETTE,
  DANMAKU_QUICK_PILLS,
  cssHex,
  danmakuColorAt,
  danmakuModeOption,
  nextDanmakuMode,
} from '@/lib/game/danmaku-palette';

export const MAX_INPUT_LENGTH = 160;
const CHAR_WARNING_THRESHOLD = 140;

export interface ChatInputProps {
  draft: string;
  onDraftChange: (value: string) => void;
  /** 发送：颜色与模式随正文一起上行 */
  onSend: (packet: ChatSendPacket) => void;
  colorIndex: number;
  onColorChange: (index: number) => void;
  mode: DanmakuMode;
  onModeChange: (mode: DanmakuMode) => void;
  notice: string | null;
  onNoticeClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** 触屏发送后收起键盘：输入法常驻会压住摇杆 */
  blurOnSend?: boolean;
  /** 窄版（移动端 250px 面板）：尺寸保持原样，放大只给桌面档（ADR-0058） */
  compact?: boolean;
  /** Esc：先放掉焦点再收起面板，WASD 立刻恢复移动 */
  onEscape?: () => void;
}

/**
 * 弹幕输入区（ADR-0056）。
 *
 * 工具栏是发送侧的设置：颜色、飞行模式、职场黑话快捷词条。
 * 快捷词条只填入不发射——误触一条「这个需求做不了」比少点一次发送更贵。
 */
export function ChatInput({
  draft,
  onDraftChange,
  onSend,
  colorIndex,
  onColorChange,
  mode,
  onModeChange,
  notice,
  onNoticeClear,
  inputRef,
  blurOnSend = false,
  compact = false,
  onEscape,
}: ChatInputProps) {
  /**
   * 中文输入法守卫。
   *
   * `isComposing` 在部分浏览器（Safari 旧版、部分 Windows IME）不置位，
   * 所以再加一份 composition 事件状态与 `keyCode 229` 兜底：三者任一命中都拦。
   */
  const composingRef = useRef(false);
  const color = danmakuColorAt(colorIndex);
  const modeOption = danmakuModeOption(mode);

  const submit = useCallback(() => {
    // 选词期间的回车不能发射：合成中的文本还不是用户最终确认的内容
    if (composingRef.current) return;
    const text = draft.trim();
    if (text.length === 0) return;
    onSend({ colorIndex, danmakuMode: mode, text });
  }, [colorIndex, draft, mode, onSend]);

  const applyPill = (pill: string) => {
    onDraftChange(pill);
    if (notice) onNoticeClear();
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 光标落在末尾：词条是起手式，用户接着改结尾。
    // 用 pill 的长度而不是 input.value：React 还没把新草稿刷进 DOM
    input.setSelectionRange(pill.length, pill.length);
  };

  const charCount = draft.length;
  const isNearLimit = charCount > CHAR_WARNING_THRESHOLD;

  /**
   * 两档尺寸：桌面档按「看得清」重排，窄版沿用原来的紧凑值（ADR-0058）。
   *
   * 输入框去掉 `font-mono`：JetBrains Mono 没有中文字形，中文会落到等宽回退字体，
   * 11px 下中英混排最发虚。草稿与消息正文统一用无衬线，才能所见即所得。
   * 14px 正文 + py-2 + 上下 2px 边框合计 44px，与发送键同高。
   */
  const barSkin = compact ? 'gap-0.5' : 'gap-1';
  const swatchSlotSkin = compact ? 'h-5 w-5' : 'h-6 w-6';
  const swatchSkin = compact ? 'h-4 w-4' : 'h-5 w-5';
  const chipSkin = compact
    ? 'px-1.5 py-1 font-mono text-[9px]'
    : 'px-2 py-1.5 font-mono text-[10px]';
  const inputSkin = compact
    ? 'px-2.5 py-1.5 font-mono text-[11px]'
    : 'px-3 py-2 font-sans text-[14px] leading-6';
  const sendSkin = compact ? 'h-9 w-9' : 'h-11 w-11';
  const sendIconSkin = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  /** 提示条是中文散文，桌面档走无衬线；字数统计是数字，始终等宽 */
  const noticeSkin = compact ? 'font-mono text-[9px]' : 'text-[10px]';
  const countSkin = compact ? 'font-mono text-[9px]' : 'font-mono text-[10px]';

  return (
    <>
      <div className={`space-y-1.5 border-t-2 border-ink-700 ${compact ? 'px-2 pb-1.5 pt-2' : 'px-2.5 pb-2 pt-2.5'}`}>
        {/* 第一行：颜色胶囊 + 模式轮转。两件都是「下一条消息」的设置，所以并排放在输入框正上方 */}
        <div className={`flex items-center justify-between ${compact ? 'gap-2' : 'gap-2.5'}`}>
          <div className={`flex items-center ${barSkin}`} role="group" aria-label="弹幕颜色">
            {DANMAKU_PALETTE.map((preset) => {
              const active = preset.index === colorIndex;
              return (
                <button
                  key={preset.index}
                  type="button"
                  onClick={() => onColorChange(preset.index)}
                  aria-pressed={active}
                  aria-label={`${preset.label}：${preset.tagline}`}
                  title={`${preset.label} · ${preset.tagline}`}
                  className={`grid ${swatchSlotSkin} shrink-0 cursor-pointer place-items-center transition-transform duration-100 ${
                    active ? 'scale-110' : 'hover:scale-105'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`block ${swatchSkin} rounded-[2px] border border-ink-950/80`}
                    style={{
                      backgroundColor: cssHex(preset.hex),
                      // 选中态不靠颜色单独表达：外环 + 放大，色盲用户也能定位
                      boxShadow: active ? '0 0 0 2px #4fe3c1' : undefined,
                    }}
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onModeChange(nextDanmakuMode(mode))}
            aria-label={`弹幕模式：${modeOption.label}，点击切换`}
            title="切换弹幕飞行模式"
            className={`flex shrink-0 cursor-pointer items-center gap-1 border border-ink-600 ${chipSkin} leading-none text-mist-300 transition-colors hover:border-mint-400/70 hover:text-mint-400`}
          >
            <span aria-hidden>{modeOption.icon}</span>
            {modeOption.label}
          </button>
        </div>

        {/* 第二行：职场黑话。手机端横向滚动，不折行、不把输入框顶走 */}
        <div
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="快捷词条"
        >
          {DANMAKU_QUICK_PILLS.map((pill) => (
            <button
              key={pill}
              type="button"
              onClick={() => applyPill(pill)}
              className={`shrink-0 cursor-pointer whitespace-nowrap border border-ink-600 bg-ink-950/60 ${chipSkin} leading-none text-mist-300 transition-colors hover:border-mint-400/60 hover:text-mint-400`}
            >
              {pill}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className={`border-t border-ink-700 ${compact ? 'px-2 py-2 space-y-1' : 'px-2.5 py-2.5 space-y-1.5'}`}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              // 提示只对上一次提交成立，继续编辑就撤掉，避免误导
              if (notice) onNoticeClear();
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // 先释放焦点再收起：输入框卸载后焦点交还 body，WASD 立即恢复移动
                event.preventDefault();
                inputRef.current?.blur();
                onEscape?.();
                return;
              }
              // 选词中的回车不提交（表单的 submit 也会被这里挡掉）
              if (event.key === 'Enter' && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229)) {
                event.preventDefault();
              }
            }}
            maxLength={MAX_INPUT_LENGTH}
            placeholder={`以 ${color.label} 弹幕说点什么…`}
            aria-label="聊天输入框"
            enterKeyHint="send"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            // 输入文字直接预览选中颜色；根节点是 select-none，输入框必须拿回文本选择
            style={{ color: cssHex(color.hex) }}
            className={`min-w-0 flex-1 select-text border-2 border-ink-600 bg-ink-950/85 ${inputSkin} outline-none placeholder:text-mist-400 [-webkit-touch-callout:default] focus:border-mint-400`}
          />
          <button
            type="submit"
            aria-label="发送弹幕"
            className={`grid ${sendSkin} shrink-0 cursor-pointer place-items-center border-2 border-mint-400 bg-mint-400/10 text-mint-400 transition-colors hover:bg-mint-400 hover:text-ink-950`}
            onClick={() => {
              // 触屏：发送后主动 blur 收键盘，焦点交还移动
              if (blurOnSend) window.setTimeout(() => inputRef.current?.blur(), 0);
            }}
          >
            <Send className={sendIconSkin} />
          </button>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span role="status" className={`min-w-0 truncate ${noticeSkin} leading-relaxed text-amber-400`}>
            {notice}
          </span>
          <span
            className={`shrink-0 ${countSkin} tabular-nums ${isNearLimit ? 'text-amber-400' : 'text-mist-400'}`}
          >
            {charCount} / {MAX_INPUT_LENGTH}
          </span>
        </div>
      </form>

      {/* 输入法提示：工具栏的模式符号只有三个，长按不到就靠这行文字兜底 */}
      <p className="sr-only">
        当前将发送 {modeOption.label} 弹幕，颜色 {color.label}。可选模式：
        {DANMAKU_MODE_OPTIONS.map((option) => option.label).join('、')}。
      </p>
    </>
  );
}
