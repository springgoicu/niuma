'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Compass } from 'lucide-react';
import { SPAWN_CENTER, regionAt } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { nearestReading, navReadings, OCTANT_NAMES } from '@/lib/game/nav';

/** 触摸端：离开北门口袋超过这个距离就自动收起，把画面还给摇杆与动作盘 */
const LEASH = 260;
/** 触摸端：入场后自动展开的时长 */
const AUTO_COLLAPSE_MS = 8000;

/**
 * 园区导览卡（ADR-0036）：四行实时方位 + 设施名 + 步行秒数。
 *
 * 方位与距离全部来自 `nav.ts`（共享 `NAV_TARGETS`），箭头按真实方位角旋转；
 * 位置每 500ms 由 store 更新一次，正好够用，不额外开轮询。
 * 桌面常驻在 MiniMap 上方，触摸端默认展开数秒后收成一枚「导览」胶囊。
 */
export function NavCard({ compact = false }: { compact?: boolean }) {
  const x = useGameUi((state) => state.x);
  const y = useGameUi((state) => state.y);
  const [open, setOpen] = useState(true);
  /** 用户手动开合过就不再自动收起，避免和手指抢控制权 */
  const manual = useRef(false);

  const readings = useMemo(() => navReadings(x, y), [x, y]);
  const nearest = nearestReading(readings);
  const region = regionAt(x, y);

  useEffect(() => {
    if (!compact) return;
    const timer = window.setTimeout(() => {
      if (!manual.current) setOpen(false);
    }, AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [compact]);

  useEffect(() => {
    if (!compact) return;
    const dx = x - SPAWN_CENTER.x;
    const dy = y - SPAWN_CENTER.y;
    if (dx * dx + dy * dy > LEASH * LEASH && !manual.current) setOpen(false);
  }, [compact, x, y]);

  const toggle = () => {
    manual.current = true;
    setOpen((value) => !value);
  };

  return (
    <div
      className={`pointer-events-none absolute z-20 ${
        compact ? 'right-3 top-[100px]' : 'bottom-4 right-4 lg:bottom-[248px]'
      }`}
    >
      {open ? (
        <section
          aria-label="园区导览"
          className="pointer-events-auto w-[196px] border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm"
        >
          <header className="flex items-center gap-1.5 border-b-2 border-ink-700 px-2.5 py-1.5">
            <Compass className="h-3 w-3 shrink-0 text-mint-400" aria-hidden />
            <span className="flex-1 truncate font-mono text-[9px] tracking-[0.16em] text-mist-300">
              园区导览 <span className="text-mist-500">/ nav</span>
            </span>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={true}
              aria-label="收起园区导览"
              className="grid h-5 w-5 cursor-pointer place-items-center text-mist-500 transition-colors hover:text-mint-400 focus-visible:text-mint-400 focus-visible:outline-none"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <ul>
            {readings.map((reading) => {
              const active = nearest?.target.id === reading.target.id;
              return (
                <li
                  key={reading.target.id}
                  aria-label={`${reading.target.name}，${OCTANT_NAMES[reading.octant]}方向，步行约 ${reading.seconds} 秒`}
                  className={`flex items-center gap-2 px-2.5 py-1.5 ${
                    active ? 'bg-mint-400/5 text-mint-400' : 'text-mist-300'
                  }`}
                >
                  <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center">
                    <ArrowUp
                      className="h-3.5 w-3.5 transition-transform duration-200"
                      style={{ transform: `rotate(${reading.bearingDeg}deg)` }}
                    />
                  </span>
                  <span className="flex-1 text-[11px] leading-none">{reading.target.name}</span>
                  <span className={`font-mono text-[9px] tabular-nums ${active ? 'text-mint-400/80' : 'text-mist-400'}`}>
                    ≈{reading.seconds}s
                  </span>
                </li>
              );
            })}
          </ul>

          <footer className="flex items-center justify-between gap-2 border-t-2 border-ink-700 px-2.5 py-1 font-mono text-[8px] tracking-[0.12em] text-mist-400">
            <span className="truncate">{region}</span>
            <span className="shrink-0">步行</span>
          </footer>
        </section>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={
            nearest ? `展开园区导览，最近 ${nearest.target.name} 约 ${nearest.seconds} 秒` : '展开园区导览'
          }
          className="pointer-events-auto flex h-9 cursor-pointer items-center gap-1.5 border-2 border-ink-600 bg-ink-900/92 px-2.5 font-mono text-[9px] tracking-[0.14em] text-mist-300 backdrop-blur-sm transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
        >
          <Compass className="h-3.5 w-3.5 text-mint-400" aria-hidden />
          导览
          {nearest && (
            <>
              <ArrowUp
                aria-hidden
                className="h-3 w-3 text-mint-400"
                style={{ transform: `rotate(${nearest.bearingDeg}deg)` }}
              />
              <span className="text-mist-100">{nearest.target.name}</span>
              <span className="tabular-nums text-mist-400">≈{nearest.seconds}s</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
