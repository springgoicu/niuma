'use client';

import { useEffect, useState } from 'react';
import { Armchair, Cpu, MapPin, MessageSquareText, Timer, X } from 'lucide-react';
import { formatOnline, poseLabel, seatLabel, type PlayerBadge } from '@/lib/game/badge';
import type { GameSession } from '@/lib/game/session';
import { SpeciesTag } from './Hud';

/** 1Hz 轮询：在线时长按秒走，姿态 / 入座 / 所在地也顺带跟上，不必为详情节流 */
const REFRESH_MS = 1000;

interface InspectCardProps {
  /** 被查看的角色；null 表示不显示 */
  playerId: number | null;
  getSession: () => GameSession | null;
  onClose: () => void;
  compact?: boolean;
}

function BadgeRow({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1 text-mist-500">
        <Icon className="h-3 w-3" />
        {label}
      </dt>
      <dd className={`min-w-0 truncate text-right ${accent ? 'tabular-nums text-mint-400' : 'text-mist-300'}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 他人工牌：点击 / 轻点园区里的角色后弹出。
 *
 * 只持有 `playerId`，展示数据每秒从会话重新取一次——这样对方移动、换姿态、
 * 离开视野（despawn 后 badgeOf 返回 null）都会自动反映，不需要把整份模型同步进 store。
 */
export function InspectCard({ playerId, getSession, onClose, compact = false }: InspectCardProps) {
  const [badge, setBadge] = useState<PlayerBadge | null>(null);

  useEffect(() => {
    if (playerId === null) {
      setBadge(null);
      return;
    }
    const read = () => {
      const next = getSession()?.badgeOf(playerId) ?? null;
      // 被查看者已离开世界：直接收起，避免留一张写着旧位置与旧时长的卡片
      if (!next) {
        onClose();
        return;
      }
      setBadge(next);
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => clearInterval(timer);
  }, [playerId, getSession, onClose]);

  if (playerId === null || badge === null) return null;

  const online = formatOnline(badge.onlineSec);
  const pose = poseLabel(badge.pose, badge.moving, badge.seated);

  return (
    <aside
      aria-label={`${badge.name} 的工牌详情`}
      className={`pointer-events-auto border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm ${
        compact ? 'w-[min(320px,92vw)]' : 'w-[240px]'
      }`}
    >
      <div className="flex items-center justify-between border-b-2 border-ink-700 px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
          <Cpu className="h-3.5 w-3.5 text-mint-400" />
          他人工牌
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭工牌详情"
          title="关闭工牌详情"
          data-no-immersive
          className="grid h-6 w-6 cursor-pointer place-items-center border border-ink-600 text-mist-500 transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="px-3 py-2.5">
        <p className="truncate font-display text-lg font-semibold tracking-wide text-mist-100">{badge.name}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[10px] text-mist-500">
          <SpeciesTag species={badge.species} dense />
          {/* 状态是可选项：没设置就不占一行，别用「未设置」把工牌撑长 */}
          {badge.status && <span className="min-w-0 truncate text-mint-400">{badge.status}</span>}
        </div>
      </div>

      <dl className="grid gap-1.5 border-t-2 border-ink-700 px-3 py-2.5 font-mono text-[10px]">
        <BadgeRow icon={MapPin} label="所在地" value={badge.region || '园区'} />
        <BadgeRow icon={Timer} label="在线" value={online} accent />
        <BadgeRow icon={MessageSquareText} label="姿态" value={pose} />
        <BadgeRow icon={Armchair} label="入座" value={seatLabel(badge.seatKind)} />
      </dl>

      <div className="border-t-2 border-ink-700 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500">
        {compact ? '轻点空白处关闭' : '点击空白处关闭'}
      </div>
    </aside>
  );
}
