'use client';

import { HINT, hintButton, touchHint } from '@/lib/game/hint-copy';
import type { ActionKey } from '@/lib/game/input';

interface InteractionHintProps {
  hint: string;
  isTouch: boolean;
  portrait: boolean;
  onAction: (action: ActionKey) => void;
}

/**
 * 电脑端统一落在画面中线偏下（ADR-0079）。
 *
 * 角色由相机跟随、基本处于画面正中：压 50% 会挡住自己和设施本体；
 * 62% 正好落在角色脚下，又离底部动作条足够远，不会被读成动作条的一部分。
 */
const DESKTOP_PLACEMENT = 'left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2';

/** 触屏位置沿用旧提示：告示板贴右下角（ADR-0059），其余底部居中 */
function placement(hint: string, isTouch: boolean, portrait: boolean): string {
  if (!isTouch) return DESKTOP_PLACEMENT;
  if (hint === HINT.bulletin) {
    // 竖屏要避开聊天面板与动作盘
    return portrait ? 'bottom-[300px] right-3' : 'bottom-56 right-3';
  }
  return `left-1/2 -translate-x-1/2 ${portrait ? 'bottom-[296px]' : 'bottom-56'}`;
}

/**
 * 靠近设施的提示：有互动动作时直接渲染成按钮，点一下等同按快捷键。
 *
 * 外层 HUD 是 `pointer-events-none`，只有按钮自己接收指针；点选角色的监听
 * 在兄弟节点上，按钮点击不会穿透过去。按钮动作仍走 `onAction` → `perform`，
 * 与键盘共用同一条路径，不在视图层另开一套互动规则。
 */
export function InteractionHint({ hint, isTouch, portrait, onAction }: InteractionHintProps) {
  const where = placement(hint, isTouch, portrait);
  const button = hintButton(hint);

  if (!button) {
    // 纯状态 / 劝阻文案保持原来的胶囊，视觉上明确「不可点」
    return (
      <div
        role="status"
        className={`pointer-events-none absolute z-30 ${where} max-w-[min(92vw,36rem)] border-2 border-ink-600 bg-ink-900/92 text-center font-mono uppercase text-signal-500 backdrop-blur-sm ${
          isTouch ? 'px-3 py-1.5 text-[10px] tracking-[0.16em]' : 'px-5 py-2.5 text-[13px] tracking-[0.18em]'
        }`}
      >
        {isTouch ? touchHint(hint) : hint}
      </div>
    );
  }

  return (
    // key 让换设施时重播一次入场，不打断提示内容的连续更新
    <div key={hint} className={`pointer-events-none absolute z-30 ${where}`}>
      <button
        type="button"
        onClick={() => {
          if (isTouch) navigator.vibrate?.(8);
          onAction(button.action);
        }}
        // 鼠标按下不抢焦点：点完按钮后方向键 / 空格仍归游戏键盘处理
        onMouseDown={(event) => event.preventDefault()}
        aria-label={isTouch ? `${button.label}，轻点执行` : `${button.label}，点击或按 ${button.key} 执行`}
        aria-keyshortcuts={button.key}
        title={isTouch ? `轻点${button.label}` : `点击或按 ${button.key} ${button.label}`}
        className={`animate-hint-in pointer-events-auto flex cursor-pointer items-center whitespace-nowrap border-2 border-mint-400/60 bg-ink-900/92 font-mono backdrop-blur-sm transition-[border-color,background-color,transform] duration-150 hover:border-mint-400 hover:bg-mint-400/10 active:scale-[0.97] focus-visible:border-mint-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${
          // 桌面放大一档：离角色更远的落位要更大的字才读得清；触屏仍是拇指 40px 命中区
          isTouch
            ? 'min-h-10 gap-2 px-2.5 py-1 shadow-[0_0_18px_-6px_rgba(79,227,193,0.35)]'
            : 'min-h-14 gap-3 px-5 py-3 shadow-[0_12px_36px_-14px_rgba(79,227,193,0.55)]'
        }`}
      >
        {!isTouch && (
          <kbd className="grid h-8 min-w-8 place-items-center border-2 border-ink-600 bg-ink-800 px-1.5 font-mono text-[13px] leading-none text-mist-300">
            {button.key}
          </kbd>
        )}
        <span className={`${isTouch ? 'text-[11px] tracking-[0.12em]' : 'text-[15px] tracking-[0.14em]'} text-mint-400`}>
          {button.label}
        </span>
        <span className={`w-px bg-ink-600 ${isTouch ? 'h-3' : 'h-5'}`} aria-hidden />
        <span
          className={
            isTouch
              ? 'text-[9px] tracking-[0.16em] text-mist-500'
              : 'text-[11px] tracking-[0.18em] text-mist-400'
          }
        >
          {isTouch ? '轻点' : '点击'}
        </span>
      </button>
    </div>
  );
}
