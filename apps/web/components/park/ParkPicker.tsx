'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Gauge, RefreshCw, Timer, Users } from 'lucide-react';
import type { ParkEntry, ParkHealth } from '@/lib/park';
import { displayOnline } from '@/lib/park-display';
import { loadParkId, saveParkId } from '@/lib/park-pref';
import { loadProfile, type Profile } from '@/lib/profile';
import { useParkHealth } from './use-park-health';

type CardState = 'probing' | 'free' | 'busy' | 'down' | 'mismatch';

const STATE_STYLE: Record<CardState, { label: string; dot: string; text: string; blink: boolean }> = {
  probing: { label: '探活中', dot: 'bg-mist-500', text: 'text-mist-500', blink: true },
  free: { label: '可以进入', dot: 'bg-mint-400', text: 'text-mint-400', blink: true },
  busy: { label: '正在排队', dot: 'bg-amber-400', text: 'text-amber-400', blink: false },
  down: { label: '暂不可达', dot: 'bg-mist-500', text: 'text-mist-500', blink: false },
  mismatch: { label: '身份不符', dot: 'bg-amber-400', text: 'text-amber-400', blink: false },
};

/**
 * 卡片状态只看两件事：探活有没有回来、服务端自述的 id 与配置对不对得上。
 *
 * 身份不符不拦人——那台机器确实活着，只是 `GAME_PARK_ID` 忘了配；
 * 拦住只会让本来能玩的园区变成不可用，真正需要的是把它显眼地说出来。
 */
function cardState(park: ParkEntry, health: ParkHealth | null, loading: boolean): CardState {
  if (!health) return loading ? 'probing' : 'down';
  if (health.parkId.length > 0 && health.parkId !== park.id) return 'mismatch';
  if (!health.gateOpen) return 'busy';
  return 'free';
}

function describe(state: CardState, park: ParkEntry, health: ParkHealth | null): string {
  switch (state) {
    case 'probing':
      return '正在向这座园区查询负载…';
    case 'free':
      return '闸门通畅，随时可以刷卡进园';
    case 'busy':
      return '出口接近上限，新到访者按次序放行';
    case 'mismatch':
      return `应答身份为「${health?.parkName || health?.parkId}」，与配置不一致`;
    case 'down':
      return `没有响应，检查 ${park.name} 的进程、证书与安全组`;
  }
}

/** 水位颜色：过 65% 转琥珀，提醒「再进人就该排队了」 */
function meterColor(permille: number): string {
  return permille >= 650 ? 'bg-amber-400' : 'bg-mint-400';
}

function Stat({
  icon,
  label,
  value,
  unit,
  className = '',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  className?: string;
}) {
  return (
    <span className={`flex flex-col gap-1 ${className}`}>
      <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
        {icon}
        {label}
      </span>
      <span className="font-mono text-[15px] tabular-nums text-mist-100">
        {value}
        {unit && <span className="ml-1 text-[10px] text-mist-500">{unit}</span>}
      </span>
    </span>
  );
}

function ParkCard({
  park,
  index,
  health,
  loading,
  blocked,
  entering,
  lastUsed,
  onEnter,
}: {
  park: ParkEntry;
  index: number;
  health: ParkHealth | null;
  loading: boolean;
  blocked: boolean;
  entering: boolean;
  /** 这座就是上次进的那座：让「我不记得选过哪个」的人一眼认出来 */
  lastUsed: boolean;
  onEnter: () => void;
}) {
  const state = cardState(park, health, loading);
  const tone = STATE_STYLE[state];
  const dead = state === 'down';
  // 展示层放大：真实在线仍走 /health，这里只影响玩家看到的数字与水位条
  const shownOnline = health ? displayOnline(health.online, health.capacity) : 0;
  const percent = health
    ? health.capacity > 0
      ? Math.min(100, Math.round((shownOnline / health.capacity) * 100))
      : Math.min(100, Math.round(health.utilizationPermille / 10))
    : 0;

  return (
    <button
      type="button"
      onClick={onEnter}
      aria-disabled={blocked || dead}
      aria-describedby={`park-${park.id}-state`}
      className={`group flex w-full flex-col border-2 bg-ink-900 text-left transition-[border-color,background-color] duration-150 ${
        entering
          ? 'border-mint-400 bg-ink-800'
          : 'border-ink-600 hover:border-mint-400/60 focus-visible:border-mint-400 active:translate-y-px'
      } ${blocked || dead ? 'cursor-not-allowed hover:border-ink-600' : 'cursor-pointer'}`}
    >
      <span className="flex items-center justify-between gap-3 border-b-2 border-ink-700 px-4 py-2">
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-mist-500">
          园区 {String(index + 1).padStart(2, '0')}
          {lastUsed && (
            <span className="border border-mint-400/40 px-1 py-px text-[8px] tracking-[0.18em] text-mint-400">
              上次
            </span>
          )}
        </span>
        <span className={`flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] ${tone.text}`}>
          <span className={`h-1.5 w-1.5 ${tone.dot} ${tone.blink ? 'animate-blink' : ''}`} aria-hidden />
          {entering ? '正在进入' : tone.label}
        </span>
      </span>

      <span className="flex flex-col gap-1.5 px-4 pb-3 pt-4">
        <span
          className={`font-display text-[26px] font-semibold leading-tight tracking-wide ${
            dead ? 'text-mist-500' : 'text-mist-100'
          }`}
        >
          {park.name}
        </span>
        <span id={`park-${park.id}-state`} className="text-[12px] leading-relaxed text-mist-400">
          {describe(state, park, health)}
        </span>
      </span>

      <span className="grid grid-cols-2 gap-x-4 gap-y-3 border-t-2 border-ink-700 px-4 py-3 sm:grid-cols-3">
        <Stat
          icon={<Users className="h-3 w-3" />}
          label="在线"
          value={health ? String(shownOnline) : '--'}
          unit={health ? `/ ${health.capacity}` : undefined}
        />
        <Stat
          icon={<Gauge className="h-3 w-3" />}
          label="水位"
          value={health ? `${percent}%` : '--'}
          className="hidden sm:flex"
        />
        <Stat
          icon={<Timer className="h-3 w-3" />}
          label="延迟"
          value={health ? String(health.rttMs) : '--'}
          unit={health ? 'ms' : undefined}
        />
      </span>

      {/* 闸门水位：移动端三列压缩成两列后，这一条替代「水位」列 */}
      <span className="block h-0.5 w-full bg-ink-700" aria-hidden>
        <span
          className={`block h-full transition-[width] duration-300 ${meterColor(percent * 10)}`}
          style={{ width: `${health ? Math.max(2, percent) : 0}%` }}
        />
      </span>

      <span className="flex items-center justify-between gap-3 border-t-2 border-ink-700 px-4 py-2.5">
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
            entering ? 'text-mint-400' : dead ? 'text-mist-500' : 'text-mist-300'
          }`}
        >
          {entering ? '刷卡中…' : dead ? '暂不可用' : health && health.queued > 0 ? `${health.queued} 人排队` : '进入园区'}
        </span>
        <ArrowRight
          className={`h-4 w-4 transition-transform duration-150 ${
            dead ? 'text-mist-500' : 'text-mint-400 group-hover:translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function ParkPicker({ parks, fromPlay }: { parks: ParkEntry[]; fromPlay: boolean }) {
  const router = useRouter();
  const { probes, loading, refresh } = useParkHealth(parks);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  // 存档与工牌只能在挂载后读：SSR 阶段没有 localStorage，读在渲染里会造成水合不一致
  useEffect(() => {
    setProfile(loadProfile());
    setPreviousId(loadParkId());
  }, []);

  const healthById = new Map(probes.map((probe) => [probe.park.id, probe.health]));
  const allDown = !loading && probes.length > 0 && probes.every((probe) => probe.health === null);

  // 「返回园区」要回到刚才那一座：不带 park 参数会掉到配置里的第一座。
  // 回捏人页时把存档物种一并带上，URL 与存档不打架
  const backHref = !fromPlay
    ? profile
      ? `/create?species=${profile.appearance.species}`
      : '/create'
    : previousId
      ? `/play?park=${encodeURIComponent(previousId)}`
      : '/play';

  const enter = (park: ParkEntry) => {
    if (entering) return;
    const health = healthById.get(park.id) ?? null;
    if (cardState(park, health, loading) === 'down') return;
    setEntering(park.id);
    // 偏好先落盘：就算这次进服失败，下次回访也会直接回到同一座园区
    saveParkId(park.id);
    router.push(`/play?park=${encodeURIComponent(park.id)}`);
  };

  // 只播报「可用性」，不播报人数：后者每 15s 都会变，读屏会被反复打断
  const announcement = probes
    .map((probe) => `${probe.park.name}${probe.health ? '可达' : '不可达'}`)
    .join('，');

  return (
    <div
      className="min-h-dvh bg-ink-950 pb-[calc(2rem+env(safe-area-inset-bottom))]"
      style={{ ['--enter-top' as string]: 'calc(3.5rem + env(safe-area-inset-top))' }}
    >
      <header className="pt-safe fixed inset-x-0 top-0 z-40 border-b border-ink-700/80 bg-ink-950/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1000px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link
            href={backHref}
            className="group inline-flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-mist-400 transition-colors duration-150 hover:text-mint-400"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
            {fromPlay ? '返回园区' : '返回工作台'}
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mist-500">选择园区</span>
          <span className="flex min-w-0 items-center justify-end gap-2">
            {profile && (
              <span className="truncate font-display text-[13px] font-semibold tracking-wide text-mist-100">
                {profile.name}
              </span>
            )}
            {profile && (
              <span className="tag shrink-0">{profile.appearance.species === 'cow' ? 'cow' : 'horse'}</span>
            )}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-4 pt-[calc(var(--enter-top)+2.5rem)] sm:px-6">
        <div className="flex flex-col gap-3 border-b border-ink-700/70 pb-6">
          <h1 className="font-display text-[clamp(26px,4vw,36px)] font-bold leading-[1.12] text-mist-100">
            今天去哪座园区上班
          </h1>
          <p className="max-w-[54ch] text-[13px] leading-relaxed text-mist-300">
            不同园区的人互相看不见，工牌与外观通用。选过之后会自动进入这一座，园区里随时能换。
          </p>
        </div>

        <div className="park-grid mt-6 gap-4 sm:gap-5">
          {parks.map((park, index) => (
            <ParkCard
              // 园区顺序就是配置顺序，id 唯一，不需要额外 key
              key={park.id}
              park={park}
              index={index}
              health={healthById.get(park.id) ?? null}
              loading={loading}
              blocked={entering !== null && entering !== park.id}
              entering={entering === park.id}
              lastUsed={previousId === park.id}
              onEnter={() => enter(park)}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4 border-t border-ink-700/70 pt-4">
          <p className="max-w-[58ch] font-mono text-[10px] leading-relaxed tracking-[0.06em] text-mist-400">
            {allDown
              ? '所有园区都没有响应：先确认游戏服进程与证书，再点右侧重新探活。'
              : '切换园区后角色从园区门口开始，座位不会跟随。延迟为浏览器直连该园区的实测往返。'}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 border-2 border-ink-600 bg-ink-900 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500 transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            重新探活
          </button>
        </div>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </main>
    </div>
  );
}
