'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { toWsUrl, type ParkEntry } from '@/lib/park';
import { resolveEntryPark } from '@/lib/park-health';
import { saveParkId } from '@/lib/park-pref';

/** 载入期的同一块底：深墨底 + 一个薄荷色方点，与动态 chunk 的 loading 保持一致 */
function ParkBoot({ label }: { label: string }) {
  return (
    <div className="grid h-dvh place-items-center bg-ink-950">
      <div className="flex flex-col items-center gap-3">
        <span className="h-2 w-2 animate-blink bg-mint-400" />
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-mist-500">{label}</p>
      </div>
    </div>
  );
}

const GameViewport = dynamic(
  () => import('@/components/game/GameViewport').then((mod) => mod.GameViewport),
  { ssr: false, loading: () => <ParkBoot label="正在装载园区…" /> },
);

export interface PlayShellProps {
  parks: ParkEntry[];
  parkId: string;
  initialName?: string;
  initialSpecies?: string;
}

interface EntryState {
  park: ParkEntry;
  wsUrl: string;
  fallbackFrom: string | null;
}

/**
 * 入场第一跳：先确认园区还活着，再挂载游戏外壳。
 *
 * 这一段刻意放在 GameViewport 之外，两个原因：
 * 1. `/play` 是 Server Component，`next/dynamic({ ssr: false })` 只能在客户端组件里用，
 *    所以必须有一层薄客户端壳；
 * 2. 探活与回落要在 Pixi 初始化之前完成——先连一个死掉的园区再换，等于白付一次
 *    重连退避的时间。
 */
export function PlayShell({ parks, parkId, initialName, initialSpecies }: PlayShellProps) {
  const [entry, setEntry] = useState<EntryState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveEntryPark(parks, parkId).then((result) => {
      if (cancelled) return;
      // 记下「实际进的是哪一座」：单园区部署第一次入场也会写下偏好，
      // 之后回访就不用再经过 /enter；被兜底顶替时也顺手把偏好纠正过来
      saveParkId(result.park.id);
      setEntry({
        park: result.park,
        wsUrl: toWsUrl(result.park.ws, window.location.origin),
        fallbackFrom: result.fallbackFrom,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [parks, parkId]);

  if (!entry) return <ParkBoot label="正在确认园区…" />;

  return (
    <GameViewport
      parks={parks}
      parkId={entry.park.id}
      parkName={entry.park.name}
      wsUrl={entry.wsUrl}
      fallbackFrom={entry.fallbackFrom}
      initialName={initialName}
      initialSpecies={initialSpecies}
    />
  );
}
