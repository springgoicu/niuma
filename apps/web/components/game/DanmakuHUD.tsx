'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import {
  DANMAKU_COVERAGES,
  DANMAKU_COVERAGE_LABELS,
  DANMAKU_OPACITY_MAX,
  DANMAKU_OPACITY_MIN,
  clampOpacity,
  type DanmakuPrefs,
} from '@/lib/game/danmaku-prefs';

export interface DanmakuHUDProps {
  prefs: DanmakuPrefs;
  onChange: (prefs: DanmakuPrefs) => void;
}

/**
 * 弹幕设置（ADR-0056）：挂在聊天框标题栏的齿轮上。
 *
 * 三条都是「防打扰」而不是「调外观」：关掉整层、压低不透明度、缩小覆盖区域。
 * 偏好由宿主落盘，这里只负责发变更，不在组件里读 localStorage。
 */
export function DanmakuHUD({ prefs, onChange }: DanmakuHUDProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc 与点击外部关闭：面板是浮层，不给它第二个退出路径
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const opacityPercent = Math.round(prefs.opacity * 100);
  const update = (patch: Partial<DanmakuPrefs>) => onChange({ ...prefs, ...patch });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="弹幕设置"
        title="弹幕设置"
        data-no-immersive
        className={`grid h-7 w-7 cursor-pointer place-items-center border transition-colors ${
          open
            ? 'border-mint-400 bg-mint-400/10 text-mint-400'
            : 'border-ink-600 text-mist-400 hover:border-mint-400/60 hover:text-mint-400'
        }`}
      >
        <Settings2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="弹幕设置"
          data-no-immersive
          className="absolute right-0 top-full z-40 mt-1 w-[220px] max-w-[calc(100vw-2rem)] border-2 border-ink-600 bg-ink-900/95 p-3 shadow-[0_8px_20px_rgba(0,0,0,0.55)] backdrop-blur-md"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-mist-400">弹幕 / danmaku</span>
            <span className="font-mono text-[9px] tabular-nums text-mist-500">
              {prefs.enabled ? '开启' : '已屏蔽'}
            </span>
          </div>

          {/* 总开关：一键清屏，聊天仍进频道列表 */}
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="font-mono text-[10px] text-mist-100">全屏弹幕</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.enabled}
              aria-label="全屏弹幕开关"
              onClick={() => update({ enabled: !prefs.enabled })}
              className={`relative h-5 w-10 shrink-0 cursor-pointer border-2 transition-colors ${
                prefs.enabled ? 'border-mint-400 bg-mint-400/20' : 'border-ink-600 bg-ink-950'
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 h-3 w-3 transition-transform duration-150 ease-out ${
                  prefs.enabled ? 'translate-x-[22px] bg-mint-400' : 'translate-x-0.5 bg-mist-500'
                }`}
              />
            </button>
          </div>

          {/* 不透明度：范围写死 20~100，避免拖到 0 之后以为坏掉 */}
          <label className="mt-1 block">
            <span className="flex items-baseline justify-between font-mono text-[10px] text-mist-100">
              不透明度
              <span className="tabular-nums text-mist-400">{opacityPercent}%</span>
            </span>
            <input
              type="range"
              min={Math.round(DANMAKU_OPACITY_MIN * 100)}
              max={Math.round(DANMAKU_OPACITY_MAX * 100)}
              step={1}
              value={opacityPercent}
              disabled={!prefs.enabled}
              aria-label="弹幕不透明度"
              aria-valuetext={`${opacityPercent}%`}
              onChange={(event) => update({ opacity: clampOpacity(Number(event.target.value) / 100) })}
              className="mt-1 h-4 w-full cursor-pointer accent-mint-400 disabled:cursor-not-allowed disabled:opacity-40"
            />
          </label>

          {/* 覆盖区域：三档按钮比滑块更快，也不会产生「半屏偏下」这种无法解释的中间态 */}
          <div className="mt-2">
            <span className="font-mono text-[10px] text-mist-100">覆盖区域</span>
            <div className="mt-1 grid grid-cols-3 gap-1" role="group" aria-label="弹幕覆盖区域">
              {DANMAKU_COVERAGES.map((coverage) => {
                const meta = DANMAKU_COVERAGE_LABELS[coverage];
                const active = prefs.coverage === coverage;
                return (
                  <button
                    key={coverage}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${meta.label}：${meta.hint}`}
                    title={meta.hint}
                    onClick={() => update({ coverage })}
                    className={`cursor-pointer border px-1 py-1.5 font-mono text-[9px] leading-none transition-colors ${
                      active
                        ? 'border-mint-400 bg-mint-400/15 text-mint-400'
                        : 'border-ink-600 text-mist-300 hover:border-mint-400/50 hover:text-mint-400'
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-2 border-t border-ink-700 pt-2 font-mono text-[9px] leading-relaxed text-mist-400">
            关掉只影响屏幕，频道列表照常记录。
          </p>
        </div>
      )}
    </div>
  );
}
