'use client';

import {
  Armchair,
  Briefcase,
  Car,
  Coffee,
  Flame,
  Hand,
  HeartPulse,
  Keyboard,
  MessageSquare,
  Rabbit,
  Sandwich,
  Volume2,
} from 'lucide-react';
import { GHOST_MODE, POSE } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { actionPresentation } from '@/lib/game/actions';
import type { ActionKey } from '@/lib/game/input';

interface ActionBarProps {
  onAction: (action: ActionKey) => void;
  onChat: () => void;
}

const ACTIONS: Array<{ key: string; label: string; hint: string; tip?: string; Icon: typeof Armchair; action?: ActionKey }> = [
  { key: 'sit', label: '坐下', hint: 'Z', Icon: Armchair, action: 'sit' },
  { key: 'lie', label: '躺平', hint: 'X', Icon: Sandwich, action: 'lie' },
  { key: 'vent', label: '发泄', hint: 'E', tip: '走到同事面前按 E 即可击倒', Icon: Flame, action: 'vent' },
  { key: 'wave', label: '打招呼', hint: 'C', Icon: Hand, action: 'wave' },
  { key: 'jump', label: '跳一下', hint: 'Space', Icon: Rabbit, action: 'jump' },
  { key: 'interact', label: '互动', hint: 'F', Icon: Coffee, action: 'interact' },
  { key: 'vehicle', label: '载具', hint: 'Q', tip: '靠近电驴/叉车/巡逻车/跑车按 Q 上车', Icon: Car, action: 'vehicle' },
  { key: 'cpr', label: '急救', hint: 'H', tip: '按 H 对倒地队友做 CPR 或喝咖啡', Icon: HeartPulse, action: 'cpr' },
  { key: 'gig', label: '零工', hint: 'G', tip: '按 G 接取或交付街头零工', Icon: Briefcase, action: 'gig' },
];

export function ActionBar({ onAction, onChat }: ActionBarProps) {
  const localPose = useGameUi((state) => state.localPose);
  const seated = useGameUi((state) => state.seated);
  const seatKind = useGameUi((state) => state.seatKind);
  const driving = useGameUi((state) => state.driving);
  const ghost = useGameUi((state) => state.ghost);
  // 行走由姿态体现：Walk 就是移动中，按钮的降级态与解析器同一套判定
  const state = { pose: localPose, seated, seatKind, moving: localPose === POSE.Walk };

  const inVehicle = driving.vehicleId !== 0;
  const downed = ghost.mode !== GHOST_MODE.Alive;
  const items = inVehicle
    ? [
        { key: 'vehicle', label: '下车', hint: 'Q', Icon: Car, action: 'vehicle' as ActionKey },
        { key: 'jump', label: '鸣笛', hint: 'Space', tip: '按空格鸣笛提示路人让道', Icon: Volume2, action: 'jump' as ActionKey },
        { key: 'interact', label: '互动', hint: 'F', Icon: Coffee, action: 'interact' as ActionKey },
        { key: 'gig', label: '零工', hint: 'G', Icon: Briefcase, action: 'gig' as ActionKey },
      ]
    : downed
      ? [
          {
            key: 'cpr',
            label: ghost.mode === GHOST_MODE.Ghost ? '灵魂游荡' : '灵魂出窍',
            hint: 'H',
            tip: '倒地按 H 进入幽灵穿墙模式或等待路人施救',
            Icon: HeartPulse,
            action: 'cpr' as ActionKey,
          },
        ]
      : ACTIONS;

  return (
    <div className="pointer-events-auto flex flex-wrap items-stretch justify-center gap-1.5 border-2 border-ink-600 bg-ink-900/92 p-2 backdrop-blur-sm">
      {items.map((item) => {
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
            aria-describedby={item.tip ? `tip-${item.key}` : undefined}
            className={`group relative flex cursor-pointer flex-col items-center gap-1 border-2 px-3 py-2 transition-colors duration-150 ${
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
            {item.tip && (
              // 悬停教学气泡：动作条贴屏幕底部，向上弹出；纯 CSS 显隐，不拦指针
              <span
                id={`tip-${item.key}`}
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap border border-mint-400/60 bg-ink-900/95 px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-mist-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {item.tip}
              </span>
            )}
          </button>
        );
      })}

      <span className="my-2 w-px bg-ink-700" aria-hidden />

      <button
        type="button"
        onClick={onChat}
        className="group flex cursor-pointer flex-col items-center gap-1 border-2 border-transparent px-3 py-2 transition-colors duration-150 hover:border-mint-400/60 hover:bg-mint-400/5"
      >
        <MessageSquare className="h-4 w-4 text-mist-300 transition-colors group-hover:text-mint-400" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-mist-300">打字</span>
        <span className="font-mono text-[8px] text-mist-500">[enter]</span>
      </button>

      <span className="my-2 w-px bg-ink-700" aria-hidden />

      <div className="flex flex-col justify-center px-2.5 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-mist-500">
        <span className="flex items-center gap-1.5">
          <Keyboard className="h-3 w-3" />
          {inVehicle ? 'WASD 驾驶 · Shift 加速' : 'WASD 移动 · E 发泄 · Q 上车'}
        </span>
        <span>八向移动 · 服务端校验</span>
      </div>
    </div>
  );
}
