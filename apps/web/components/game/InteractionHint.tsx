'use client';

import { HINT, hintButton, touchHint } from '@/lib/game/hint-copy';
import type { ActionKey } from '@/lib/game/input';

interface InteractionHintProps {
  hint: string;
  isTouch: boolean;
  portrait: boolean;
  onAction: (action: ActionKey) => void;
}

/** 位置沿用旧提示：告示板贴右下角（ADR-0059），其余底部居中 */
function placement(hint: string, isTouch: boolean, portrait: boolean): string {
  if (hint === HINT.bulletin) {
    // 竖屏要避开聊天面板与动作盘，横屏/桌面按原有偏移
    return portrait ? 'bottom-[300px] right-3' : isTouch ? 'bottom-56 right-3' : 'bottom-28 right-4';
  }
  // 桌面动作条（7 个纵向按钮）顶边距底约 95px：96px（bottom-24）会和它贴死，
  // 视觉上被读成动作条的一部分，所以再抬高一档留出明确间隙
  return `left-1/2 -translate-x-1/2 ${portrait ? 'bottom-[296px]' : isTouch ? 'bottom-56' : 'bottom-[112px]'}`;
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
        className={`pointer-events-none absolute z-30 ${where} border-2 border-ink-600 bg-ink-900/92 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-signal-500 backdrop-blur-sm`}
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
        className={`animate-hint-in pointer-events-auto flex cursor-pointer items-center gap-2 whitespace-nowrap border-2 border-mint-400/60 bg-ink-900/92 px-2.5 py-1 font-mono shadow-[0_0_18px_-6px_rgba(79,227,193,0.35)] backdrop-blur-sm transition-[border-color,background-color,transform] duration-150 hover:border-mint-400 hover:bg-mint-400/10 active:scale-[0.97] focus-visible:border-mint-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${
          // 触屏给拇指留 40px 命中高度；桌面保持紧凑的 32px
          isTouch ? 'min-h-10' : 'min-h-8'
        }`}
      >
        {!isTouch && (
          <kbd className="grid h-5 min-w-5 place-items-center border-2 border-ink-600 bg-ink-800 px-1 font-mono text-[10px] leading-none text-mist-300">
            {button.key}
          </kbd>
        )}
        <span className="text-[11px] tracking-[0.12em] text-mint-400">{button.label}</span>
        <span className="h-3 w-px bg-ink-600" aria-hidden />
        <span className="text-[9px] tracking-[0.16em] text-mist-500">{isTouch ? '轻点' : '点击'}</span>
      </button>
    </div>
  );
}
