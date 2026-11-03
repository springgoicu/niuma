'use client';

import dynamic from 'next/dynamic';

const GameViewport = dynamic(
  () => import('@/components/game/GameViewport').then((mod) => mod.GameViewport),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-dvh place-items-center bg-ink-950">
        <div className="flex flex-col items-center gap-3">
          <span className="h-2 w-2 animate-blink bg-mint-400" />
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-mist-500">正在装载园区…</p>
        </div>
      </div>
    ),
  },
);

export default function PlayPage() {
  return <GameViewport />;
}