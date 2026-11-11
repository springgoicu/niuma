'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Cpu,
  Gauge,
  MapPin,
  Pencil,
  Timer,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { formatOnline } from '@/lib/game/badge';
import { sfx } from '@/lib/game/sfx';
import { StatusEditor } from './StatusEditor';

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

/** 物种标签：桌面工牌、手机折叠条与他人工牌共用，dense 用于更紧凑的一行 */
export function SpeciesTag({ species, dense = false }: { species: string; dense?: boolean }) {
  return (
    <span className={`tag shrink-0 ${dense ? 'px-1 py-0 text-[9px] tracking-[0.08em]' : ''}`}>
      {species === 'cow' ? 'cow' : 'horse'}
    </span>
  );
}

/**
 * 所在地 + 在线时长：桌面常显，手机展开工牌时出现。
 * 断线 / 未入场时时长显示 --:--，不用 00:00:00 假装刚上线。
 */
function BadgeMeta({
  region,
  parkName,
  onlineSec,
  online,
  dense = false,
}: {
  region: string;
  /** 园区名（多园区部署时才有意义）：与区域名拼成「一号园区 · 工作区」 */
  parkName?: string;
  onlineSec: number;
  online: boolean;
  dense?: boolean;
}) {
  const icon = dense ? 'h-2.5 w-2.5' : 'h-3 w-3';
  const text = online ? formatOnline(onlineSec) : '--:--';
  const place = [parkName, region].filter(Boolean).join(' · ') || '园区';
  return (
    <div
      role="group"
      className={`flex items-center gap-2 font-mono text-mist-500 ${
        dense ? 'px-2.5 pb-1.5 text-[9px]' : 'mt-1 text-[10px]'
      }`}
      aria-label={`所在地 ${place}，在线 ${text}`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <MapPin className={`${icon} shrink-0 text-mint-400`} />
        <span className="truncate text-mist-300">{place}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 tabular-nums">
        <Timer className={`${icon} shrink-0`} />
        {text}
      </span>
    </div>
  );
}

interface CardStatsProps {
  fps: number;
  ping: number;
  x: number;
  y: number;
  online: boolean;
  dense?: boolean;
}

/** FPS / PING / POS：桌面常显，手机端只在展开工牌时出现 */
function CardStats({ fps, ping, x, y, online, dense = false }: CardStatsProps) {
  const icon = dense ? 'h-2.5 w-2.5' : 'h-3 w-3';
  return (
    <dl
      className={
        dense
          ? 'grid grid-cols-2 gap-x-2 gap-y-1.5 font-mono text-[9px]'
          : 'grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[10px]'
      }
    >
      <div className="flex items-center justify-between gap-1">
        <dt className="flex items-center gap-1 text-mist-500">
          <Gauge className={icon} />
          FPS
        </dt>
        <dd className="text-mist-100">{fps}</dd>
      </div>
      <div className="flex items-center justify-between gap-1">
        <dt className="flex items-center gap-1 text-mist-500">
          {online ? <Wifi className={icon} /> : <WifiOff className={`${icon} text-amber-400`} />}
          PING
        </dt>
        <dd className={ping > 150 ? 'text-amber-400' : 'text-mist-100'}>{ping}ms</dd>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-1">
        <dt className="flex items-center gap-1 text-mist-500">
          <Activity className={icon} />
          POS
        </dt>
        <dd className="text-mist-300">
          {x} , {y}
        </dd>
      </div>
    </dl>
  );
}

/**
 * 工牌上的状态行 + 下方抽出的编辑表单。
 * 没设状态时整行是一句「设置状态…」，视觉权重压到最低，不抢名字。
 */
function StatusBlock({
  statusText,
  onStatusChange,
  dense = false,
  compact = false,
}: {
  statusText: string;
  onStatusChange: (status: string) => void;
  dense?: boolean;
  compact?: boolean;
}) {
  const statusOpen = useGameUi((state) => state.statusOpen);
  const setStatusOpen = useGameUi((state) => state.setStatusOpen);
  // 桌面端状态编辑在工牌内、聊天在左下角，两块面板不再互相收起
  const toggle = () => setStatusOpen(!statusOpen);

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={statusOpen}
        aria-controls="status-editor"
        title={statusText ? '修改状态' : '设置状态'}
        data-no-immersive
        className={`flex w-full cursor-pointer items-center gap-2 border-t-2 border-ink-700 text-left transition-colors duration-150 hover:bg-ink-800/60 ${
          dense ? 'h-8 px-2.5' : 'h-9 px-3'
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate font-mono ${dense ? 'text-[10px]' : 'text-[11px]'} ${
            statusText ? 'text-mint-400' : 'text-mist-500'
          }`}
        >
          {statusText || '设置状态…'}
        </span>
        <Pencil className="h-3 w-3 shrink-0 text-mist-500" />
      </button>
      {statusOpen && (
        <StatusEditor
          value={statusText}
          compact={compact}
          onSave={onStatusChange}
          onClose={() => setStatusOpen(false)}
        />
      )}
    </>
  );
}

export function PlayerCard({
  name,
  species,
  statusText,
  onStatusChange,
  parkName,
  compact = false,
}: {
  name: string;
  species: string;
  /** 常驻状态：空串表示还没设置 */
  statusText: string;
  onStatusChange: (status: string) => void;
  /** 当前园区名：单园区部署时不传，工牌只显示区域 */
  parkName?: string;
  compact?: boolean;
}) {
  const fps = useGameUi((state) => state.fps);
  const ping = useGameUi((state) => state.ping);
  const x = useGameUi((state) => state.x);
  const y = useGameUi((state) => state.y);
  const region = useGameUi((state) => state.region);
  const onlineSec = useGameUi((state) => state.onlineSec);
  const backend = useGameUi((state) => state.backend);
  const status = useGameUi((state) => state.status);
  const chatOpen = useGameUi((state) => state.chatOpen);
  const setChatOpen = useGameUi((state) => state.setChatOpen);
  /** 手机端默认只露一条名字，详情按需展开；桌面端永远展开 */
  const [open, setOpen] = useState(false);
  const stats = { fps, ping, x, y, online: status === 'online' };

  // 聊天浮层与展开的工牌抢同一块左上角：聊天一开，工牌就退回折叠态
  useEffect(() => {
    if (chatOpen) setOpen(false);
  }, [chatOpen]);

  const toggle = () => {
    if (!compact) return;
    // 展开前先收起聊天，两块面板不同时占用左上角
    if (!open) setChatOpen(false);
    setOpen(!open);
  };

  if (compact) {
    return (
      <div className="pointer-events-auto max-w-[200px] border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="player-card-detail"
          aria-label={open ? '收起工牌详情' : `${name} 的工牌，展开详情`}
          title={open ? '收起工牌详情' : '展开工牌详情'}
          data-no-immersive
          className={`flex w-full items-center gap-2 text-left transition-colors ${
            open ? 'justify-between border-b-2 border-ink-700 px-2 py-1.5' : 'h-9 px-2'
          }`}
        >
          {open ? (
            <>
              <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">
                <Cpu className="h-3 w-3 text-mint-400" />
                工牌
              </span>
              <span className="flex items-center gap-1.5">
                <SpeciesTag species={species} dense />
                <ChevronDown className="h-3 w-3 rotate-180 text-mist-500" />
              </span>
            </>
          ) : (
            <>
              <Cpu className="h-3.5 w-3.5 shrink-0 text-mint-400" />
              <span className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold tracking-wide text-mist-100">
                {name}
              </span>
              <SpeciesTag species={species} dense />
              <ChevronDown className="h-3 w-3 shrink-0 text-mist-500" />
            </>
          )}
        </button>

        <div id="player-card-detail" hidden={!open} className="w-[184px]">
          <p className="truncate px-2.5 pt-1.5 font-display text-base font-semibold tracking-wide text-mist-100">{name}</p>
          <BadgeMeta region={region} parkName={parkName} onlineSec={onlineSec} online={status === 'online'} dense />
          <StatusBlock statusText={statusText} onStatusChange={onStatusChange} dense compact />
          <div className="border-t-2 border-ink-700 px-2.5 py-2">
            <CardStats {...stats} dense />
          </div>
          <div className="flex items-center justify-between border-t-2 border-ink-700 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500">
            <span>renderer</span>
            <span className="text-mint-400">{backend}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto w-[268px] border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b-2 border-ink-700 px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">
          <Cpu className="h-3.5 w-3.5 text-mint-400" />
          工牌
        </span>
        <SpeciesTag species={species} />
      </div>

      <div className="px-3 py-3">
        <p className="truncate font-display text-xl font-semibold tracking-wide text-mist-100">{name}</p>
        <BadgeMeta region={region} parkName={parkName} onlineSec={onlineSec} online={status === 'online'} />
      </div>

      <StatusBlock statusText={statusText} onStatusChange={onStatusChange} />

      <div className="mt-3">
        <CardStats {...stats} />
      </div>

      <div className="flex items-center justify-between border-t-2 border-ink-700 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
        <span>renderer</span>
        <span className="text-mint-400">{backend}</span>
      </div>
    </div>
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
