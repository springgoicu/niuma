'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Armchair, Coffee, Flame, Hand, MessageSquare, Rabbit, Sandwich } from 'lucide-react';
import { POSE } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { actionPresentation } from '@/lib/game/actions';
import { touchHint } from '@/lib/game/hint-copy';
import type { ActionKey } from '@/lib/game/input';
import { STICK_BASE, STICK_KNOB, STICK_RADIUS, stickKnob, stickVector } from '@/lib/game/joystick';

interface JoystickProps {
  onMove: (x: number, y: number) => void;
  /** 落下拇指开始移动：宿主借此收起到聊天 / 状态面板，把画面让给角色 */
  onEngage?: () => void;
  /** 轻点（没有拖动）时把屏幕坐标交给宿主，由宿主换算成舞台局部坐标做角色点选 */
  onTap?: (clientX: number, clientY: number) => void;
  /** 竖屏：热区收进左下，把顶部信息栏与右上控件的触点让出来 */
  portrait?: boolean;
}

/** 轻点判定：位移超过 10px 或按住超过 320ms 都算拖动，避免选中抢走走位 */
const TAP_SLOP = 10;
const TAP_HOLD_MS = 320;

/**
 * 浮动摇杆：在热区内任意落点按下即在落点生成摇杆。
 *
 * 横屏热区铺满左半屏，竖屏收进左下 58% 高度——竖屏顶部是信息栏与聊天浮层，
 * 不能让一次点选被摇杆截走。拇指不用低头找固定的 112px 圆；松手立即回零并淡出。
 * 指针位移只写 `ref.style.transform` 并直接算向量，不触发 React 渲染，
 * 120Hz 触摸采样下也不会每帧跑一次布局。
 */
export function Joystick({ onMove, onEngage, onTap, portrait = false }: JoystickProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  /** 一次按下的轻点判定状态：位移与时长任一超限就不再算点选 */
  const tapRef = useRef({ clientX: 0, clientY: 0, at: 0, dragging: false });

  const [active, setActive] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  const release = useCallback(() => {
    if (pointerRef.current === null) return;
    pointerRef.current = null;
    setActive(false);
    if (knobRef.current) knobRef.current.style.transform = 'translate(-50%, -50%)';
    onMoveRef.current(0, 0);
  }, []);

  useEffect(() => {
    const reset = () => release();
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

  // 朝向切换后热区会换一块区域，正在进行的拖动已无意义
  useEffect(() => {
    release();
  }, [portrait, release]);

  const update = (clientX: number, clientY: number) => {
    const sx = clientX - centerRef.current.x;
    const sy = clientY - centerRef.current.y;
    const knob = stickKnob(sx, sy);
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`;
    }
    const vector = stickVector(sx, sy);
    onMoveRef.current(vector.x, vector.y);
  };

  return (
    <div
      role="application"
      aria-label={portrait ? '移动摇杆：左下区域任意位置按下并拖动' : '移动摇杆：左半屏任意位置按下并拖动'}
      className={`pointer-events-auto absolute touch-none select-none ${
        portrait ? 'bottom-0 left-0 h-[58%] w-[56%]' : 'inset-y-0 left-0 w-[54%]'
      }`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerRef.current !== null) return;
        event.preventDefault();
        // 热区在 HUD 之下，不会冒泡到舞台：展开的聊天面板要在这里顺手收起
        onEngage?.();
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        centerRef.current = { x: event.clientX, y: event.clientY };
        tapRef.current = { clientX: event.clientX, clientY: event.clientY, at: performance.now(), dragging: false };
        // offset 是热区自身坐标：摇杆画在手指落点，不需要换算到舞台
        const native = event.nativeEvent;
        setOrigin({ x: native.offsetX, y: native.offsetY });
        setActive(true);
        onMoveRef.current(0, 0);
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (pointerRef.current !== event.pointerId) return;
        const tap = tapRef.current;
        if (!tap.dragging) {
          const dx = event.clientX - tap.clientX;
          const dy = event.clientY - tap.clientY;
          if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) tap.dragging = true;
        }
        update(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (pointerRef.current !== event.pointerId) return;
        const tap = tapRef.current;
        // 没拖动且抬手够快：这次按下只是想看人，不是想走位。
        // 传屏幕坐标而不是 offset：竖屏热区只剩左下，offset 已不等于舞台坐标。
        if (!tap.dragging && performance.now() - tap.at <= TAP_HOLD_MS) {
          onTapRef.current?.(event.clientX, event.clientY);
        }
        release();
      }}
      onPointerCancel={(event) => {
        tapRef.current.dragging = true;
        if (pointerRef.current === event.pointerId) release();
      }}
      onLostPointerCapture={(event) => {
        if (pointerRef.current === event.pointerId) release();
      }}
    >
      {/* 未按下：左下角留一枚虚线基座作提示，不占拇指的落点。
          摇杆在 HUD 之外，不继承 game-safe 的内边距，Home 条的高度要自己让 */}
      <div
        aria-hidden
        className={`pointer-events-none absolute left-6 grid place-items-center rounded-full border-2 border-dashed border-ink-600/80 bg-ink-900/35 transition-opacity duration-150 ${
          active ? 'opacity-0' : 'opacity-100'
        }`}
        style={{
          width: STICK_BASE,
          height: STICK_BASE,
          bottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))',
        }}
      >
        <span className="font-mono text-[9px] tracking-[0.2em] text-mist-500">移动</span>
      </div>

      {/* 按下：摇杆在落点生成，松手淡出（元素常挂载，ref 不会在拖动中途丢失） */}
      <div
        aria-hidden
        className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-600 bg-ink-900/75 backdrop-blur-sm transition-opacity duration-150 ${
          active ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ width: STICK_BASE, height: STICK_BASE, left: origin.x, top: origin.y }}
      >
        <div
          className="absolute rounded-full border border-dashed border-ink-600"
          style={{ inset: (STICK_BASE - STICK_RADIUS * 2) / 2 }}
        />
        <div
          ref={knobRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-mint-400 bg-mint-400/25 shadow-[0_0_12px_rgba(94,234,212,0.35)]"
          style={{ width: STICK_KNOB, height: STICK_KNOB }}
        />
      </div>
    </div>
  );
}

const ACTION_BUTTONS: Array<{ label: string; action: ActionKey; Icon: typeof Armchair }> = [
  { label: '跳', action: 'jump', Icon: Rabbit },
  { label: '招手', action: 'wave', Icon: Hand },
  { label: '发泄', action: 'vent', Icon: Flame },
  { label: '坐下', action: 'sit', Icon: Armchair },
  { label: '躺平', action: 'lie', Icon: Sandwich },
  { label: '互动', action: 'interact', Icon: Coffee },
];

interface TouchActionsProps {
  onAction: (action: ActionKey) => void;
  onChat: () => void;
  /** 竖屏：动作盘收成 2 列 × 3 行，横向只占 196px，不与左下摇杆抢宽度 */
  portrait?: boolean;
}

/** 轻震动反馈：支持的设备给一记 8ms，不支持就静默跳过 */
function haptic(): void {
  navigator.vibrate?.(8);
}

/**
 * 右下动作盘 + 独立的打字键。
 *
 * 六个动作在横屏排 3 列 × 2 行（60px）、总高 128，
 * 打字键 68px 仍在右手主位；竖屏换成 2 列 × 3 行（56px），
 * 给左下摇杆留出拇指区。两种朝向都保留 56px 以上的命中区，图标与标签一起显示。
 */
export function TouchActions({ onAction, onChat, portrait = false }: TouchActionsProps) {
  const localPose = useGameUi((state) => state.localPose);
  const seated = useGameUi((state) => state.seated);
  const seatKind = useGameUi((state) => state.seatKind);
  // 与桌面动作条共用同一套判定：激活态 / 不可用态不会两边不一致
  const state = { pose: localPose, seated, seatKind, moving: localPose === POSE.Walk };

  return (
    <div className="pointer-events-auto flex touch-none items-end gap-3 select-none">
      <div className={`grid gap-2 ${portrait ? 'grid-cols-2' : 'grid-cols-3'}`}>
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
              title={view.reason ? touchHint(view.reason) : undefined}
              onPointerDown={(event) => {
                event.preventDefault();
                haptic();
                onAction(action);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border-2 backdrop-blur-sm transition-colors active:scale-95 ${
                portrait ? 'h-[56px] w-[56px]' : 'h-[60px] w-[60px]'
              } ${
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
      </div>

      <button
        type="button"
        aria-label="打字"
        onPointerDown={(event) => {
          event.preventDefault();
          haptic();
          onChat();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-full border-2 border-mint-400/70 bg-ink-900/90 text-mint-400 backdrop-blur-sm transition-colors active:scale-95 active:bg-mint-400/15 ${
          portrait ? 'h-16 w-16' : 'h-[68px] w-[68px]'
        }`}
      >
        <MessageSquare className="h-5 w-5" />
        <span className="font-mono text-[9px] tracking-[0.08em]">打字</span>
      </button>
    </div>
  );
}
