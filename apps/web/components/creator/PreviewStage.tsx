'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2 } from 'lucide-react';
import { useCreatorStore, type Pose } from '@/lib/creator-store';
import { CreatorPreview } from '@/lib/game/preview';

const POSES: Array<{ id: Pose; label: string; key: string }> = [
  { id: 'idle', label: '站立', key: 'IDLE' },
  { id: 'walk', label: '走动', key: 'WALK' },
  { id: 'sit', label: '坐下', key: 'SIT' },
  { id: 'lie', label: '躺平', key: 'LIE' },
];

const DIRECTIONS = [
  { dir: 0, label: '朝下', Icon: ArrowDown },
  { dir: 1, label: '朝左', Icon: ArrowLeft },
  { dir: 2, label: '朝右', Icon: ArrowRight },
  { dir: 3, label: '朝上', Icon: ArrowUp },
];

/** 分段控件共用的按下态：底色 + 底部 2px 亮线，比整块描边安静 */
const SEG_ACTIVE = 'bg-mint-400/[0.09] text-mint-400 shadow-[inset_0_-2px_0_0_var(--color-mint-400)]';
const SEG_IDLE = 'text-mist-300 hover:bg-ink-800/60 hover:text-mist-100';

export function PreviewStage({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<CreatorPreview | null>(null);
  const [ready, setReady] = useState(false);
  const [direction, setDirection] = useState(0);
  const pose = useCreatorStore((s) => s.pose);
  const setPose = useCreatorStore((s) => s.setPose);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const preview = new CreatorPreview();
    previewRef.current = preview;
    let cancelled = false;

    preview
      .init(host, useCreatorStore.getState().appearance)
      .then(() => {
        if (cancelled) return;
        preview.setPose(useCreatorStore.getState().pose);
        preview.setDirection(0);
        setReady(true);
      })
      .catch((error: unknown) => {
        console.error('[creator] preview init failed', error);
      });

    const unsubAppearance = useCreatorStore.subscribe(
      (state) => state.appearance,
      (appearance) => preview.setAppearance(appearance),
    );
    const unsubPose = useCreatorStore.subscribe(
      (state) => state.pose,
      (next) => preview.setPose(next),
    );

    return () => {
      cancelled = true;
      unsubAppearance();
      unsubPose();
      preview.destroy();
      previewRef.current = null;
    };
  }, []);

  useEffect(() => {
    previewRef.current?.setDirection(direction);
  }, [direction]);

  return (
    <section className={`panel relative flex min-h-[540px] flex-col overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-ink-700/80 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 animate-blink bg-mint-400" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mist-400">
            spotlight / live preview
          </span>
        </div>
        <span className="tag border-ink-600 text-[9px]">{ready ? '60 fps' : 'loading'}</span>
      </header>

      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            // 一片柔光落在角色脚下；硬停止的阶梯光晕会把边缘切成几道弧线
            background:
              'radial-gradient(ellipse 44% 34% at 50% 58%, rgba(79,227,193,0.12) 0%, rgba(79,227,193,0.05) 46%, transparent 76%)',
          }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-4">
          <span className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-mint-400/25" />
          <span className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-mint-400/25" />
          <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-mint-400/25" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-mint-400/25" />
        </div>

        <div ref={hostRef} className="relative h-full min-h-[420px] w-full" aria-label="角色实时预览" />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在装载图集
            </span>
          </div>
        )}
      </div>

      <footer className="grid gap-4 border-t border-ink-700/80 px-5 py-4 sm:grid-cols-2 sm:gap-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mist-400">姿态</p>
          <div className="mt-2 inline-flex border border-ink-700 bg-ink-950/40">
            {POSES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={pose === item.id}
                onClick={() => setPose(item.id)}
                className={`h-8 cursor-pointer border-l border-ink-700 px-3 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 first:border-l-0 ${
                  pose === item.id ? SEG_ACTIVE : SEG_IDLE
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mist-400">朝向</p>
          <div className="mt-2 inline-flex border border-ink-700 bg-ink-950/40">
            {DIRECTIONS.map((item) => (
              <button
                key={item.dir}
                type="button"
                aria-label={item.label}
                aria-pressed={direction === item.dir}
                onClick={() => setDirection(item.dir)}
                className={`grid h-8 w-9 cursor-pointer place-items-center border-l border-ink-700 transition-colors duration-150 first:border-l-0 ${
                  direction === item.dir ? SEG_ACTIVE : SEG_IDLE
                }`}
              >
                <item.Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>
      </footer>
    </section>
  );
}
