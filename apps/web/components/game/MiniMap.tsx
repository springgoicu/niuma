'use client';

import { MapPin } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameUi } from '@/lib/game-ui';
import { ACTIVITY_TTL_MS, countRecentActivities } from '@/lib/game/activity-feed';
import { MINIMAP_SIZE } from '@/lib/game/minimap-draw';

/** 点击后文案停留时长：够读完一句带名字的话，又不至于长期占住页脚 */
const PEEK_HOLD_MS = 2_000;

/**
 * 小地图外壳。
 *
 * 画布本身只是一块像素载体：Worker 模式下它被
 * `transferControlToOffscreen()` 交出去，4Hz 的地形重绘完全在渲染线程里，
 * 主线程既不 measure 也不 draw。主线程回退模式下由客户端用同一个
 * `drawMiniMap()` 自己画，组件这一侧没有任何分支。
 *
 * 两个标签直接读 2Hz 的 stats：区域名与附近人数本来就在那份快照里。
 */
export function MiniMap({ hostRef }: { hostRef: (host: HTMLDivElement | null) => void }) {
  const region = useGameUi((state) => state.region) || '园区';
  const nearby = useGameUi((state) => state.nearby);
  const activities = useGameUi((state) => state.activities);
  const feedOpen = useGameUi((state) => state.activityFeedOpen);
  const setActivityFeedOpen = useGameUi((state) => state.setActivityFeedOpen);
  // 只在有推送 / 区域变化时重算：页脚不需要独立定时器，数字允许慢 1 拍过期
  const recentCount = countRecentActivities(activities, performance.now(), ACTIVITY_TTL_MS);

  /** 最近一条仍在有效期内的动态：悬停 / 点击页脚计数时用它替换数字 */
  const latest = useMemo(() => {
    const now = performance.now();
    for (let i = activities.length - 1; i >= 0; i -= 1) {
      const item = activities[i]!;
      if (now - item.at < ACTIVITY_TTL_MS) return item;
    }
    return null;
  }, [activities]);

  // 悬停即时查看；点击 / 触摸再钉住 2 秒，移开鼠标不会立刻收走
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pinTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pinTimer.current !== null) window.clearTimeout(pinTimer.current);
    },
    [],
  );

  const pin = (): void => {
    setPinned(true);
    if (pinTimer.current !== null) window.clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(() => {
      setPinned(false);
      pinTimer.current = null;
    }, PEEK_HOLD_MS);
  };

  const showText = latest !== null && (hovered || pinned);

  return (
    <div className="pointer-events-auto relative hidden border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm lg:block">
      <div className="flex items-center justify-between gap-3 border-b-2 border-ink-700 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] text-mist-500">
          <MapPin className="h-3 w-3 text-mint-400" />
          {region}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-mist-500">{nearby} 头牛马</span>
      </div>

      {/* 画布由宿主创建并塞进来：transfer 一次性，React 复用节点会让二次挂载失效 */}
      <div
        ref={hostRef}
        className="block"
        style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
        aria-label={`${region}附近 ${nearby} 头牛马，视野半径 1000 像素`}
      />

      {/*
        悬停 / 点击计数时临时展开最近一条文案。绝对定位盖在画布下沿：
        若让它参与布局，页脚会被顶下去，鼠标随之离开按钮，文案会反复闪。
      */}
      {showText && latest && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[23px] z-10 border-t-2 border-ink-700 bg-ink-800/92 px-2.5 py-1">
          <p className="font-mono text-[9px] leading-snug tracking-[0.04em] text-mist-300">
            {latest.text}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between border-t-2 border-ink-700 px-2.5 py-1 font-mono text-[9px] tracking-[0.12em] text-mist-500">
        <span className="flex items-center gap-2">
          {/* 动态计数：最近的播报条数，关掉播报后小地图标记照旧，这个数字也照常 */}
          <button
            type="button"
            disabled={latest === null}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            onClick={pin}
            title={latest?.text}
            aria-label={latest ? `最近动态：${latest.text}` : '最近没有动态'}
            className={`tabular-nums ${
              latest ? 'cursor-help text-mist-500 hover:text-mist-100' : 'cursor-default'
            }`}
          >
            动态 {recentCount}
          </button>
          <button
            type="button"
            onClick={() => setActivityFeedOpen(!feedOpen)}
            aria-pressed={feedOpen}
            aria-label={feedOpen ? '关闭全园区播报条' : '开启全园区播报条'}
            title={feedOpen ? '关闭全园区播报条' : '开启全园区播报条'}
            className={`grid h-3.5 w-3.5 place-items-center border-2 transition-colors duration-150 ${
              feedOpen
                ? 'border-mint-400 bg-mint-400/20'
                : 'border-ink-500 bg-transparent hover:border-mist-500'
            }`}
          >
            <span
              aria-hidden
              className={`h-1 w-1 ${feedOpen ? 'bg-mint-400' : 'bg-transparent'}`}
            />
          </button>
        </span>
        {/* 与 shared-types 的 VIEW_RADIUS=1000 对齐：旧文案写 900，和画布覆盖范围对不上 */}
        <span>AOI 1000px</span>
      </div>
    </div>
  );
}
