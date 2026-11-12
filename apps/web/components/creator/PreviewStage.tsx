'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Armchair,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BedDouble,
  Footprints,
  Loader2,
  PersonStanding,
  type LucideIcon,
} from 'lucide-react';
import { useCreatorStore, type Pose } from '@/lib/creator-store';
import { CreatorPreview } from '@/lib/game/preview';
import { AtelierPetals, AtelierStar } from './Atelier';

const POSES: Array<{ id: Pose; label: string; Icon: LucideIcon }> = [
  { id: 'idle', label: '站立', Icon: PersonStanding },
  { id: 'walk', label: '走动', Icon: Footprints },
  { id: 'sit', label: '坐下', Icon: Armchair },
  { id: 'lie', label: '躺平', Icon: BedDouble },
];

const DIRECTIONS: Array<{ dir: number; label: string; Icon: LucideIcon }> = [
  { dir: 0, label: '朝下', Icon: ArrowDown },
  { dir: 1, label: '朝左', Icon: ArrowLeft },
  { dir: 2, label: '朝右', Icon: ArrowRight },
  { dir: 3, label: '朝上', Icon: ArrowUp },
];

/**
 * 默认看侧面：正面（朝下）只能看出对称度，侧面才看得清口鼻长度、尾巴与鬃毛的走向。
 * 取「朝右」而非「朝左」，与大厅里本地角色入场时的朝向保持一致。
 */
const DEFAULT_DIRECTION = 2;

/** 分段控件共用的按下态：底色 + 底部 2px 亮线，比整块描边安静 */
const SEG_ACTIVE = 'bg-mint-400/[0.09] text-mint-400 shadow-[inset_0_-2px_0_0_var(--color-mint-400)]';
const SEG_IDLE = 'text-mist-300 hover:bg-ink-800/60 hover:text-mist-100';
/** 触屏一行工具栏：44px 高，宽度均分，八颗按钮在小屏也放得下 */
const TOOL_BTN = 'flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center transition-colors duration-150';

export function PreviewStage({ className = '' }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<CreatorPreview | null>(null);
  const [ready, setReady] = useState(false);
  const [direction, setDirection] = useState(DEFAULT_DIRECTION);
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

  // 朝向只由这个 effect 落盘：挂载时即刻写入默认的侧面朝向，
  // 放在 init 回调里写会在图集加载完成时把用户提前点的方向冲掉。
  useEffect(() => {
    previewRef.current?.setDirection(direction);
  }, [direction]);

  return (
    <section
      className={`panel panel-atelier relative flex min-h-0 flex-1 flex-col overflow-hidden xl:min-h-[440px] ${className}`}
    >
      {/* 手机端把 44px 让给画布：标题条隐藏，只留右上角浮动读数 */}
      <header className="hidden shrink-0 items-center justify-between gap-3 border-b border-ink-700/80 px-5 py-3 sm:flex [@media(max-height:500px)]:hidden">
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 animate-blink bg-mint-400" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mist-400">
            spotlight / live preview
          </span>
          <AtelierStar className="h-1.5 w-1.5 bg-blush-300/70" />
        </div>
        <span className="tag border-ink-600 text-[9px]">{ready ? '60 fps' : 'loading'}</span>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            // 柔光落在角色脚底：自适应居中后脚底约在画布 84% 处。
            // 内芯仍是 mint（全站唯一冷色强调），外环一圈极淡的粉，读作化妆镜的暖反射
            background: [
              'radial-gradient(ellipse 32% 26% at 50% 84%, rgba(79,227,193,0.14) 0%, rgba(79,227,193,0.05) 52%, transparent 76%)',
              'radial-gradient(ellipse 52% 40% at 50% 85%, rgba(231,154,173,0.10) 0%, rgba(231,154,173,0.03) 54%, transparent 78%)',
            ].join(','),
          }}
        />
        <AtelierPetals className="opacity-[0.85]" />
        <div aria-hidden className="pointer-events-none absolute inset-3 sm:inset-4">
          <span className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-mint-400/25" />
          <span className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-mint-400/25" />
          <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-mint-400/25" />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-mint-400/25" />
        </div>

        <span className="tag absolute right-3 top-3 z-10 border-ink-600 text-[9px] sm:hidden">
          {ready ? '60 fps' : 'loading'}
        </span>

        <div
          ref={hostRef}
          className="relative h-full w-full"
          aria-label="角色实时预览"
          aria-busy={!ready}
        />

        {!ready && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mist-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在装载图集
            </span>
          </div>
        )}
      </div>

      {/* 手机：姿态与朝向并成一行，八颗按钮平分宽度、44px 高 */}
      <footer className="shrink-0 border-t border-ink-700/80 px-2 py-0.5 sm:hidden">
        <div className="flex items-stretch gap-1.5">
          <div className="flex flex-1 divide-x divide-ink-700 border border-ink-700 bg-ink-950/40">
            {POSES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-pressed={pose === item.id}
                onClick={() => setPose(item.id)}
                className={`${TOOL_BTN} ${pose === item.id ? SEG_ACTIVE : SEG_IDLE}`}
              >
                <item.Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>
          <div className="flex flex-1 divide-x divide-ink-700 border border-ink-700 bg-ink-950/40">
            {DIRECTIONS.map((item) => (
              <button
                key={item.dir}
                type="button"
                aria-label={item.label}
                aria-pressed={direction === item.dir}
                onClick={() => setDirection(item.dir)}
                className={`${TOOL_BTN} ${direction === item.dir ? SEG_ACTIVE : SEG_IDLE}`}
              >
                <item.Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </footer>

      <footer className="hidden shrink-0 gap-4 border-t border-ink-700/80 px-5 py-4 sm:grid sm:grid-cols-2 sm:gap-6">
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
