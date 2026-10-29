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

export function PreviewStage() {
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
    <section className="panel panel-scan relative flex min-h-[560px] flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b-2 border-ink-600 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-blink bg-mint-400" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mist-500">
            spotlight / live preview
          </span>
        </div>
        <span className="tag">{ready ? '60 fps' : 'loading'}</span>
      </header>

      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-50" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[384px] w-[384px] -translate-x-1/2 -translate-y-1/2"
          style={{
            // 硬停止的阶梯光晕：柔化 blur 会把角色边缘一起抹糊
            background:
              'radial-gradient(circle, rgba(79,227,193,0.16) 0 21%, rgba(79,227,193,0.11) 21% 29%, rgba(79,227,193,0.055) 29% 37%, transparent 37%)',
          }}
        />
        <div ref={hostRef} className="relative h-full min-h-[430px] w-full" aria-label="角色实时预览" />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-mist-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在装载图集
            </span>
          </div>
        )}
      </div>

      <footer className="grid gap-3 border-t-2 border-ink-600 px-5 py-4 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-mist-500">姿态</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {POSES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={pose === item.id}
                onClick={() => setPose(item.id)}
                className={`cursor-pointer border-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-150 ${
                  pose === item.id
                    ? 'border-mint-400 bg-mint-400/10 text-mint-400'
                    : 'border-ink-600 text-mist-300 hover:border-ink-500'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-mist-500">朝向</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DIRECTIONS.map((item) => (
              <button
                key={item.dir}
                type="button"
                aria-label={item.label}
                aria-pressed={direction === item.dir}
                onClick={() => setDirection(item.dir)}
                className={`grid h-8 w-8 cursor-pointer place-items-center border-2 transition-colors duration-150 ${
                  direction === item.dir
                    ? 'border-mint-400 bg-mint-400/10 text-mint-400'
                    : 'border-ink-600 text-mist-300 hover:border-ink-500'
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
