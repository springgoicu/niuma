'use client';

import { useEffect, useState } from 'react';
import { Activity, Cpu, Gauge, Users, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { sfx } from '@/lib/game/sfx';

const SFX_STORAGE_KEY = 'niuma:sfx:muted';

/**
 * 叫唤静音开关：偏好只存本地，不参与任何服务端状态。
 * 初值固定为「有声」，挂载后再读存储，避免 SSR 水合不一致。
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
      aria-label={muted ? '开启叫唤音效' : '关闭叫唤音效'}
      title={muted ? '叫唤音效已关闭' : '叫唤音效已开启'}
      className={`pointer-events-auto grid place-items-center border-2 border-ink-600 bg-ink-900/92 text-mist-500 backdrop-blur-sm transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none ${
        compact ? 'h-9 w-9' : 'h-11 w-11'
      }`}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );
}

export function PlayerCard({ name, species, compact = false }: { name: string; species: string; compact?: boolean }) {
  const fps = useGameUi((state) => state.fps);
  const ping = useGameUi((state) => state.ping);
  const x = useGameUi((state) => state.x);
  const y = useGameUi((state) => state.y);
  const backend = useGameUi((state) => state.backend);
  const status = useGameUi((state) => state.status);

  return (
    <div
      className={`pointer-events-auto border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm ${compact ? 'w-[190px]' : 'w-[268px]'}`}
    >
      <div className="flex items-center justify-between border-b-2 border-ink-700 px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
          <Cpu className="h-3.5 w-3.5 text-mint-400" />
          工牌
        </span>
        <span className="tag">{species === 'cow' ? 'cow' : 'horse'}</span>
      </div>

      <div className="px-3 py-3">
        <p className="truncate font-display text-xl font-semibold tracking-wide text-mist-100">{name}</p>
        {!compact && (
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-500">floor 03 · corridor b</p>
        )}
      </div>
      {!compact && (
        <>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[10px]">
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1 text-mist-500">
              <Gauge className="h-3 w-3" />
              FPS
            </dt>
            <dd className="text-mist-100">{fps}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1 text-mist-500">
              {status === 'online' ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3 text-amber-400" />
              )}
              PING
            </dt>
            <dd className={ping > 150 ? 'text-amber-400' : 'text-mist-100'}>{ping}ms</dd>
          </div>
          <div className="col-span-2 flex items-center justify-between">
            <dt className="flex items-center gap-1 text-mist-500">
              <Activity className="h-3 w-3" />
              POS
            </dt>
            <dd className="text-mist-300">
              {x} , {y}
            </dd>
          </div>
        </dl>

      <div className="flex items-center justify-between border-t-2 border-ink-700 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
        <span>renderer</span>
        <span className="text-mint-400">{backend}</span>
      </div>
        </>
      )}
    </div>
  );
}

export function OnlineBadge({ compact = false }: { compact?: boolean }) {
  const nearby = useGameUi((state) => state.nearby);
  const status = useGameUi((state) => state.status);
  const detail = useGameUi((state) => state.detail);

  return (
    <div className="pointer-events-auto flex items-center gap-3 border-2 border-ink-600 bg-ink-900/92 px-3 py-2 backdrop-blur-sm">
      <span
        className={`h-2 w-2 ${status === 'online' ? 'animate-blink bg-mint-400' : 'bg-amber-400'}`}
        aria-hidden
      />
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-mist-300">
        <Users className="h-3.5 w-3.5" />
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
