'use client';

import { useEffect, useState } from 'react';
import { Users, Volume2, VolumeX } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { sfx } from '@/lib/game/sfx';

const SFX_STORAGE_KEY = 'niuma:sfx:muted';

/**
 * 游戏音效静音开关：叫唤 / 咀嚼 / 设施互动共用同一条 master 总线（ADR-0048）。
 * 偏好只存本地，不参与任何服务端状态；初值固定为「有声」，
 * 挂载后再读存储，避免 SSR 水合不一致。
 */
export function SfxToggle({ compact = false }: { compact?: boolean }) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SFX_STORAGE_KEY) === '1';
    setMuted(stored);
    sfx.setMuted(stored);
  }, []);

  const toggle = () => {
    const next = sfx.toggle();
    setMuted(next);
    window.localStorage.setItem(SFX_STORAGE_KEY, next ? '1' : '0');
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? '开启游戏音效' : '关闭游戏音效'}
      title={muted ? '游戏音效已关闭' : '游戏音效已开启'}
      className={`pointer-events-auto grid place-items-center border-2 border-ink-600 bg-ink-900/92 text-mist-500 backdrop-blur-sm transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none ${
        compact ? 'h-9 w-9' : 'h-11 w-11'
      }`}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );
}

/** 物种标签：他人工牌共用；新的左上角工牌用像素立绘，不再用文字标签 */
export function SpeciesTag({ species, dense = false }: { species: string; dense?: boolean }) {
  return (
    <span className={`tag shrink-0 ${dense ? 'px-1 py-0 text-[9px] tracking-[0.08em]' : ''}`}>
      {species === 'cow' ? 'cow' : 'horse'}
    </span>
  );
}

export function OnlineBadge({ compact = false }: { compact?: boolean }) {
  const nearby = useGameUi((state) => state.nearby);
  const status = useGameUi((state) => state.status);
  const detail = useGameUi((state) => state.detail);

  return (
    <div
      className={`pointer-events-auto flex items-center border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm ${
        compact ? 'gap-1.5 px-2 py-1.5' : 'gap-3 px-3 py-2'
      }`}
    >
      <span
        className={`${compact ? 'h-1.5 w-1.5' : 'h-2 w-2'} ${status === 'online' ? 'animate-blink bg-mint-400' : 'bg-amber-400'}`}
        aria-hidden
      />
      <span
        className={`flex items-center font-mono uppercase text-mist-300 ${
          compact ? 'gap-1 text-[9px] tracking-[0.14em]' : 'gap-1.5 text-[10px] tracking-[0.18em]'
        }`}
      >
        <Users className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        视野内 {nearby}
      </span>
      {!compact && (
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
          {status === 'online' ? 'aoi 900px' : detail || status}
        </span>
      )}
    </div>
  );
}

export function ConnectionBanner() {
  const status = useGameUi((state) => state.status);
  const rejected = useGameUi((state) => state.rejected);
  // 排队与被拒由 QueueGate 整屏接管，横幅只负责「接入中/断线」这类过渡态
  if (status === 'online' || status === 'idle' || status === 'queued' || rejected > 0) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2">
      <div className="flex items-center gap-3 border-2 border-amber-400/60 bg-ink-900/95 px-4 py-2 backdrop-blur">
        <span className="h-2 w-2 animate-blink bg-amber-400" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-400">
          {status === 'connecting' ? '正在接入园区…' : '连接中断，正在重连'}
        </span>
      </div>
    </div>
  );
}
