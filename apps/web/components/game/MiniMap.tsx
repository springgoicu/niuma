'use client';

import { MapPin } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { MINIMAP_SIZE } from '@/lib/game/minimap-draw';

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

  return (
    <div className="pointer-events-auto hidden border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm lg:block">
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

      <div className="flex items-center justify-between border-t-2 border-ink-700 px-2.5 py-1 font-mono text-[9px] tracking-[0.12em] text-mist-500">
        <span>SCAN 4Hz</span>
        {/* 与 shared-types 的 VIEW_RADIUS=1000 对齐：旧文案写 900，和画布覆盖范围对不上 */}
        <span>AOI 1000px</span>
      </div>
    </div>
  );
}
