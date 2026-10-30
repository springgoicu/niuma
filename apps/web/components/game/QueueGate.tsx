'use client';

import { useEffect, useRef, useState } from 'react';
import { Gauge, RotateCw, Timer, Users, WifiOff } from 'lucide-react';
import { LIMIT_KIND, QUEUE_REJECT_REASON, type QueueStatusPacket } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

/** 水位仪表分成 12 格：终端仪表比连续进度条更贴这套像素语言 */
const SEGMENTS = 12;
/** 与 governor 的高水位一致，刻度线画在 85% */
const HIGH_WATERMARK_PERCENT = 85;

const LIMIT_STYLE = {
  [LIMIT_KIND.None]: { label: '综合', text: 'text-mist-300', chip: 'border-ink-500 text-mist-300', bar: 'bg-mist-300' },
  [LIMIT_KIND.Bandwidth]: { label: '带宽', text: 'text-mint-400', chip: 'border-mint-400/60 text-mint-400', bar: 'bg-mint-400' },
  [LIMIT_KIND.Players]: { label: '人数', text: 'text-sky-400', chip: 'border-sky-400/60 text-sky-400', bar: 'bg-sky-400' },
  [LIMIT_KIND.Tick]: { label: '负载', text: 'text-amber-400', chip: 'border-amber-400/60 text-amber-400', bar: 'bg-amber-400' },
} as const;

const REASON_COPY = {
  [LIMIT_KIND.Bandwidth]: '出口流量已达上限，闸门正在限速放行。',
  [LIMIT_KIND.Players]: '园区容量已满，等有人打卡下班就会放行。',
  [LIMIT_KIND.Tick]: '服务器负载偏高，临时收紧入场以保住手感。',
  [LIMIT_KIND.None]: '负载正在回落，闸门随时可能打开。',
} as const;

function formatEta(sec: number): string {
  if (sec <= 0) return '即将入场';
  if (sec >= 60) return `${Math.floor(sec / 60)} 分 ${String(sec % 60).padStart(2, '0')} 秒`;
  return `${sec} 秒`;
}

function formatPercent(permille: number): string {
  return `${Math.round(permille / 10)}%`;
}

export function QueueGate({ onRetry }: { onRetry: () => void }) {
  const status = useGameUi((state) => state.status);
  const queue = useGameUi((state) => state.queue);
  const rejected = useGameUi((state) => state.rejected);
  const [snapshot, setSnapshot] = useState<QueueStatusPacket | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusedRef = useRef(false);

  // 快照保留到退场动画结束：被放行时面板向上淡出，而不是啪一下消失
  useEffect(() => {
    if (queue) {
      setSnapshot(queue);
      setLeaving(false);
      return;
    }
    if (!snapshot) return;
    if (status === 'online') {
      setLeaving(true);
      const timer = setTimeout(() => {
        setLeaving(false);
        setSnapshot(null);
      }, 260);
      return () => clearTimeout(timer);
    }
    setSnapshot(null);
  }, [queue, status, snapshot]);

  const visible = Boolean(snapshot) || rejected > 0;

  useEffect(() => {
    if (!visible) {
      setShown(false);
      focusedRef.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    if (!visible || focusedRef.current) return;
    focusedRef.current = true;
    titleRef.current?.focus();
  }, [visible]);

  if (!visible) return null;

  const offline = status === 'offline';
  const rejectedMode = rejected > 0 && !snapshot;
  const limit = LIMIT_STYLE[snapshot?.dominant ?? LIMIT_KIND.None];
  const title = rejectedMode
    ? rejected === QUEUE_REJECT_REASON.WaitTimeout
      ? '排队超时'
      : '园区已满'
    : offline
      ? '连接中断'
      : '正在排队';

  const ratio = Math.min(1, Math.max(0, (snapshot?.utilizationPermille ?? 0) / 1000));
  const filled = Math.round(ratio * SEGMENTS);

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-ink-950/94 sm:items-center sm:px-5">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <section
        role="status"
        aria-live="polite"
        aria-label="园区排队"
        className={`panel panel-scan relative w-full max-w-[520px] origin-bottom transition-[opacity,transform] duration-[260ms] ease-[var(--ease-out-expo)] ${
          shown && !leaving ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b-2 border-ink-700 px-4 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-mint-400">
            // 准入控制
          </p>
          <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
            <span
              className={`h-1.5 w-1.5 ${offline ? 'bg-amber-400' : rejectedMode ? 'bg-signal-500' : 'animate-blink bg-mint-400'}`}
              aria-hidden
            />
            {offline ? 'link lost' : rejectedMode ? 'rejected' : 'gate closed'}
          </span>
        </header>

        <div className="px-5 pb-5 pt-6 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                ref={titleRef}
                tabIndex={-1}
                className="font-display text-lg font-semibold tracking-[0.02em] text-mist-100 focus:outline-none"
              >
                {title}
              </h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-500">
                {rejectedMode ? 'admission rejected' : offline ? 'holding your slot' : 'first come · first served'}
              </p>
            </div>
            {!rejectedMode && (
              <span className={`tag shrink-0 ${limit.chip}`}>
                <Gauge className="h-3 w-3" />
                {limit.label}
              </span>
            )}
          </div>

          {rejectedMode ? (
            <p className="mt-6 text-sm leading-relaxed text-mist-300">
              {rejected === QUEUE_REJECT_REASON.WaitTimeout
                ? '等了太久也没轮到你，先把名额让给后面的人。等园区松一点再来。'
                : '当前排队人数已满，继续排下去只会更慢。过几分钟再试。'}
            </p>
          ) : (
            <>
              <div className="mt-6 flex items-end gap-3">
                <span
                  key={snapshot?.position ?? 0}
                  className="animate-queue-roll font-mono text-[76px] font-medium leading-[0.82] tracking-[-0.03em] text-mist-100 tabular-nums sm:text-[92px]"
                >
                  {snapshot?.position ?? 0}
                </span>
                <div className="pb-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-mist-500">
                    前面还有
                  </p>
                  <p className="font-mono text-[11px] text-mist-300">
                    {Math.max(0, (snapshot?.position ?? 1) - 1)} 人 · 共 {snapshot?.length ?? 0} 人
                  </p>
                </div>
              </div>

              <div className="mt-7">
                <div className="flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
                  <span>load</span>
                  <span className={limit.text}>{formatPercent(snapshot?.utilizationPermille ?? 0)}</span>
                </div>
                <div className="relative mt-2 flex h-3 gap-[2px]">
                  {Array.from({ length: SEGMENTS }, (_, index) => (
                    <span
                      key={index}
                      className={`h-full flex-1 ${index < filled ? limit.bar : 'bg-ink-700'}`}
                      aria-hidden
                    />
                  ))}
                  <span
                    className="pointer-events-none absolute -top-1 bottom-[-4px] w-[2px] bg-signal-500/80"
                    style={{ left: `${HIGH_WATERMARK_PERCENT}%` }}
                    aria-hidden
                  />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[9px] text-mist-500">
                  <span>0</span>
                  <span className="text-signal-500/90">85% 关闸线</span>
                  <span>100%</span>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-2 border-t-2 border-ink-700 pt-4 sm:grid-cols-3">
                <div className="flex items-center justify-between gap-2 pr-3 sm:block">
                  <dt className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
                    <Users className="h-3 w-3" />
                    队列
                  </dt>
                  <dd className="font-mono text-sm text-mist-100 tabular-nums">{snapshot?.length ?? 0} 人</dd>
                </div>
                <div className="flex items-center justify-between gap-2 pr-3 sm:block sm:border-l-2 sm:border-ink-700 sm:pl-4">
                  <dt className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
                    <Timer className="h-3 w-3" />
                    预计
                  </dt>
                  <dd className="font-mono text-sm text-mist-100 tabular-nums">
                    {formatEta(snapshot?.etaSec ?? 0)}
                  </dd>
                </div>
                <div className="col-span-2 mt-3 flex items-center justify-between gap-2 border-t-2 border-ink-800 pt-3 sm:col-span-1 sm:mt-0 sm:block sm:border-0 sm:border-l-2 sm:border-ink-700 sm:pl-4 sm:pt-0">
                  <dt className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
                    {offline ? <WifiOff className="h-3 w-3" /> : <Gauge className="h-3 w-3" />}
                    {offline ? '链路' : '容量'}
                  </dt>
                  <dd className={`font-mono text-sm tabular-nums ${offline ? 'text-amber-400' : 'text-mist-100'}`}>
                    {offline ? '重连中' : `${snapshot?.capacity ?? 0} 人`}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 border-l-2 border-ink-600 pl-3 text-xs leading-relaxed text-mist-300">
                {offline
                  ? '连接断了，正在重连。位次不保留——但你现在的位置本来也快到门口了。'
                  : REASON_COPY[snapshot?.dominant ?? LIMIT_KIND.None]}
              </p>
            </>
          )}

          {rejectedMode && (
            <button type="button" onClick={onRetry} className="btn-ghost mt-6 w-full">
              <RotateCw className="h-3.5 w-3.5" />
              重新排队
            </button>
          )}

          <p className="mt-4 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
            <span>ticket #{snapshot?.ticket ?? '—'}</span>
            <span>每秒刷新 · 排队期间不进世界</span>
          </p>
        </div>
      </section>
    </div>
  );
}
