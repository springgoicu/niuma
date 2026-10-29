'use client';

import { Armchair, Keyboard, MessageSquare, Music4, Sandwich } from 'lucide-react';
import type { ActionKey } from '@/lib/game/input';

interface ActionBarProps {
  onAction: (action: ActionKey) => void;
  onChat: () => void;
}

const ACTIONS: Array<{ key: string; label: string; hint: string; Icon: typeof Armchair; action?: ActionKey }> = [
  { key: 'sit', label: '坐下', hint: 'Z', Icon: Armchair, action: 'sit' },
  { key: 'lie', label: '躺平', hint: 'X', Icon: Sandwich, action: 'lie' },
  { key: 'emote', label: '叫唤', hint: 'C', Icon: Music4, action: 'emote' },
];

export function ActionBar({ onAction, onChat }: ActionBarProps) {
  return (
    <div className="pointer-events-auto flex items-stretch gap-2 border-2 border-ink-600 bg-ink-900/92 p-2 backdrop-blur-sm">
      {ACTIONS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => (item.action ? onAction(item.action) : undefined)}
          className="group flex cursor-pointer flex-col items-center gap-1 border-2 border-transparent px-4 py-2 transition-colors duration-150 hover:border-mint-400/60 hover:bg-mint-400/5"
        >
          <item.Icon className="h-4 w-4 text-mist-300 transition-colors group-hover:text-mint-400" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist-300">{item.label}</span>
          <span className="font-mono text-[8px] text-mist-500">[{item.hint}]</span>
        </button>
      ))}

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
