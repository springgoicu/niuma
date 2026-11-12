'use client';

import { Armchair, Coffee, Flame, Hand, Keyboard, MessageSquare, Rabbit, Sandwich, Wheat } from 'lucide-react';
import { POSE } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { actionPresentation } from '@/lib/game/actions';
import type { ActionKey } from '@/lib/game/input';

interface ActionBarProps {
  onAction: (action: ActionKey) => void;
  onChat: () => void;
}

const ACTIONS: Array<{ key: string; label: string; hint: string; Icon: typeof Armchair; action?: ActionKey }> = [
  { key: 'sit', label: '坐下', hint: 'Z', Icon: Armchair, action: 'sit' },
  { key: 'lie', label: '躺平', hint: 'X', Icon: Sandwich, action: 'lie' },
  // 发泄：一记牛马式冲撞，打到人对方会被创飞倒地（ADR-0051）
  { key: 'vent', label: '发泄', hint: 'E', Icon: Flame, action: 'vent' },
  // 吃草紧挨发泄：E / G 在键盘上相邻，两个都是一次性动作（ADR-0048）
  { key: 'graze', label: '吃草', hint: 'G', Icon: Wheat, action: 'graze' },
  { key: 'wave', label: '打招呼', hint: 'C', Icon: Hand, action: 'wave' },
  { key: 'jump', label: '跳一下', hint: 'Space', Icon: Rabbit, action: 'jump' },
  { key: 'interact', label: '互动', hint: 'F', Icon: Coffee, action: 'interact' },
];

export function ActionBar({ onAction, onChat }: ActionBarProps) {
  const localPose = useGameUi((state) => state.localPose);
  const seated = useGameUi((state) => state.seated);
  const seatKind = useGameUi((state) => state.seatKind);
  // 行走由姿态体现：Walk 就是移动中，按钮的降级态与解析器同一套判定
  const state = { pose: localPose, seated, seatKind, moving: localPose === POSE.Walk };

  return (
    <div className="pointer-events-auto flex flex-wrap items-stretch justify-center gap-2 border-2 border-ink-600 bg-ink-900/92 p-2 backdrop-blur-sm">
      {ACTIONS.map((item) => {
        const view = item.action ? actionPresentation(item.action, state) : null;
        const active = view?.active ?? false;
        const unavailable = view?.unavailable ?? false;
        const label = view?.label ?? item.label;
        const toggles = item.action === 'sit' || item.action === 'lie';

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => (item.action ? onAction(item.action) : undefined)}
            aria-pressed={toggles ? active : undefined}
            aria-disabled={unavailable || undefined}
            title={view?.reason}
            className={`group flex cursor-pointer flex-col items-center gap-1 border-2 px-4 py-2 transition-colors duration-150 ${
              active
                ? 'border-mint-400 bg-mint-400/10'
                : 'border-transparent hover:border-mint-400/60 hover:bg-mint-400/5'
            } ${unavailable ? 'opacity-45' : ''}`}
          >
            <item.Icon
              className={`h-4 w-4 transition-colors ${
                active ? 'text-mint-400' : 'text-mist-300 group-hover:text-mint-400'
              }`}
            />
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.14em] ${
                active ? 'text-mint-400' : 'text-mist-300'
              }`}
            >
              {label}
            </span>
            <span className="font-mono text-[8px] text-mist-500">[{item.hint}]</span>
          </button>
        );
      })}

      <span className="my-2 w-px bg-ink-700" aria-hidden />

      <button
        type="button"
        onClick={onChat}
        className="group flex cursor-pointer flex-col items-center gap-1 border-2 border-transparent px-4 py-2 transition-colors duration-150 hover:border-mint-400/60 hover:bg-mint-400/5"
      >
        <MessageSquare className="h-4 w-4 text-mist-300 transition-colors group-hover:text-mint-400" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist-300">打字</span>
        <span className="font-mono text-[8px] text-mist-500">[enter]</span>
      </button>

      <span className="my-2 w-px bg-ink-700" aria-hidden />

      <div className="flex flex-col justify-center px-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.14em] text-mist-500">
        <span className="flex items-center gap-1.5">
          <Keyboard className="h-3 w-3" />
          WASD / 方向键
        </span>
        <span>八向移动 · 服务端校验</span>
      </div>
    </div>
  );
}
