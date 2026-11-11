'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Armchair, Coffee, Hand, MessageSquare, Music4, Rabbit, Sandwich } from 'lucide-react';
import { POSE } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { actionPresentation } from '@/lib/game/actions';
import type { ActionKey } from '@/lib/game/input';

/** 摇杆死区：小于该比例的推动视为静止，避免拇指轻碰就滑步 */
const DEAD_ZONE = 0.18;

interface JoystickProps {
  onMove: (x: number, y: number) => void;
  /** 舞台被 CSS 旋转 90° 时，屏幕坐标需要换算回舞台坐标 */
  rotated?: boolean;
}

/** 左下角虚拟摇杆：输出 -1..1 的方向，松手即回零 */
export function Joystick({ onMove, rotated = false }: JoystickProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const release = useCallback(() => {
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    onMoveRef.current(0, 0);
  }, []);

  useEffect(() => {
    const reset = () => {
      if (pointerRef.current !== null) release();
    };
    const onVisibility = () => {
      if (document.hidden) reset();
    };
    window.addEventListener('blur', reset);
    window.addEventListener('orientationchange', reset);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', reset);
      window.removeEventListener('orientationchange', reset);
      document.removeEventListener('visibilitychange', onVisibility);
      onMoveRef.current(0, 0);
    };
  }, [release]);

  // 旋转切换时，正在进行的拖动已无意义
  useEffect(() => {
    if (pointerRef.current !== null) release();
  }, [rotated, release]);

  const update = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const radius = Math.max(rect.width, rect.height) / 2;
    const sx = clientX - (rect.left + rect.width / 2);
    const sy = clientY - (rect.top + rect.height / 2);
    let dx = rotated ? sy : sx;
    let dy = rotated ? -sx : sy;
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
    }
    const nx = dx / radius;
    const ny = dy / radius;
    const magnitude = Math.hypot(nx, ny);
    let x = 0;
    let y = 0;
    if (magnitude > DEAD_ZONE) {
      const scale = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE) / magnitude;
      x = nx * scale;
      y = ny * scale;
    }
    setKnob({ x: dx, y: dy });
    onMove(x, y);
  };

  return (
    <div
      ref={padRef}
      role="application"
      aria-label="移动摇杆"
      className="pointer-events-auto no-callout relative h-[124px] w-[124px] shrink-0 touch-none select-none rounded-full border-2 border-ink-600 bg-ink-900/80 backdrop-blur-sm"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerRef.current !== null) return;
        event.preventDefault();
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event.clientX, event.clientY);
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerRef.current !== event.pointerId) return;
        update(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (pointerRef.current === event.pointerId) release();
      }}
      onPointerCancel={(event) => {
        if (pointerRef.current === event.pointerId) release();
      }}
      onLostPointerCapture={(event) => {
        if (pointerRef.current === event.pointerId) release();
      }}
    >
      <div className="pointer-events-none absolute inset-[30px] rounded-full border border-dashed border-ink-600" />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[44px] w-[44px] rounded-full border-2 border-mint-400 bg-mint-400/25 shadow-[0_0_12px_rgba(94,234,212,0.35)]"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

const ACTION_BUTTONS: Array<{ label: string; action: ActionKey; Icon: typeof Armchair }> = [
  { label: '坐下', action: 'sit', Icon: Armchair },
  { label: '躺平', action: 'lie', Icon: Sandwich },
  { label: '叫唤', action: 'emote', Icon: Music4 },
  { label: '打招呼', action: 'wave', Icon: Hand },
  { label: '跳', action: 'jump', Icon: Rabbit },
  { label: '互动', action: 'interact', Icon: Coffee },
];

interface TouchActionsProps {
  onAction: (action: ActionKey) => void;
  onChat: () => void;
}

/** 右下角动作按钮：按下即触发，与键盘 Z/X/C/E/Space/F 一一对应 */
export function TouchActions({ onAction, onChat }: TouchActionsProps) {
  const localPose = useGameUi((state) => state.localPose);
  const seated = useGameUi((state) => state.seated);
  const seatKind = useGameUi((state) => state.seatKind);
  // 与桌面动作条共用同一套判定：激活态 / 不可用态不会两边不一致
  const state = { pose: localPose, seated, seatKind, moving: localPose === POSE.Walk };

  return (
    <div className="pointer-events-auto grid grid-cols-3 gap-2 touch-none select-none">
      {ACTION_BUTTONS.map(({ label, action, Icon }) => {
        const view = actionPresentation(action, state);
        const text = view.label ?? label;
        const toggles = action === 'sit' || action === 'lie';

        return (
          <button
            key={action}
            type="button"
            aria-label={text}
            aria-pressed={toggles ? view.active : undefined}
            aria-disabled={view.unavailable || undefined}
            title={view.reason}
            onPointerDown={(event) => {
              event.preventDefault();
              onAction(action);
            }}
            className={`flex h-[58px] w-[58px] flex-col items-center justify-center gap-0.5 rounded-full border-2 backdrop-blur-sm transition-colors active:scale-95 ${
              view.active
                ? 'border-mint-400 bg-mint-400/15 text-mint-400'
                : 'border-ink-600 bg-ink-900/85 text-mist-300 active:border-mint-400 active:text-mint-400'
            } ${view.unavailable ? 'opacity-45' : ''}`}
          >
            <Icon className="h-4 w-4" />
            <span className="font-mono text-[8px] tracking-[0.08em]">{text}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-label="打字"
        onPointerDown={(event) => {
          event.preventDefault();
          onChat();
        }}
        className="flex h-[58px] w-[58px] flex-col items-center justify-center gap-0.5 rounded-full border-2 border-ink-600 bg-ink-900/85 text-mist-300 backdrop-blur-sm active:scale-95 active:border-mint-400 active:text-mint-400"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="font-mono text-[8px] tracking-[0.08em]">打字</span>
      </button>
    </div>
  );
}
