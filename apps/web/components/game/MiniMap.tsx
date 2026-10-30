'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { WORLD_CENTER, WORLD_LAYOUT, type Point, type WorldRect } from '@niuma/shared-types';
import { MINIMAP_COLORS as M } from '@/lib/game/terrain-palette';
import type { GameSession } from '@/lib/game/session';

const SIZE = 168;
/** 画布正好覆盖 AOI 视野半径，地形与玩家共用同一套世界变换 */
const VIEW_RADIUS = 900;
const SCALE = SIZE / (VIEW_RADIUS * 2);
const REFRESH_MS = 250;

function screenX(worldX: number, camX: number): number {
  return Math.round((worldX - camX) * SCALE + SIZE / 2);
}

function screenY(worldY: number, camY: number): number {
  return Math.round((worldY - camY) * SCALE + SIZE / 2);
}

function span(length: number): number {
  return Math.max(1, Math.round(length * SCALE));
}

function fillWorldRect(ctx: CanvasRenderingContext2D, rect: WorldRect, camX: number, camY: number): void {
  ctx.fillRect(screenX(rect.x, camX), screenY(rect.y, camY), span(rect.w), span(rect.h));
}

function traceWorldPolygon(ctx: CanvasRenderingContext2D, points: readonly Point[], camX: number, camY: number): void {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const px = screenX(x, camX);
    const py = screenY(y, camY);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

/** 小地图只画布局，不采样主视图：形状少、4Hz，绘制成本可以忽略 */
function drawTerrain(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
  ctx.fillStyle = M.ground;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = M.forest;
  for (const forest of WORLD_LAYOUT.forests) fillWorldRect(ctx, forest.rect, camX, camY);

  ctx.fillStyle = M.dirt;
  for (const path of WORLD_LAYOUT.paths) fillWorldRect(ctx, path, camX, camY);

  ctx.fillStyle = M.plaza;
  fillWorldRect(ctx, WORLD_LAYOUT.plaza, camX, camY);
  ctx.strokeStyle = M.plazaEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    screenX(WORLD_LAYOUT.plaza.x, camX) + 0.5,
    screenY(WORLD_LAYOUT.plaza.y, camY) + 0.5,
    span(WORLD_LAYOUT.plaza.w) - 1,
    span(WORLD_LAYOUT.plaza.h) - 1,
  );

  ctx.fillStyle = M.water;
  for (const lake of WORLD_LAYOUT.lakes) {
    traceWorldPolygon(ctx, lake.points, camX, camY);
    ctx.fill();
  }
  for (const river of WORLD_LAYOUT.rivers) fillWorldRect(ctx, river.rect, camX, camY);

  ctx.strokeStyle = M.sand;
  for (const lake of WORLD_LAYOUT.lakes) {
    traceWorldPolygon(ctx, lake.points, camX, camY);
    ctx.stroke();
  }

  ctx.fillStyle = M.bridge;
  for (const bridge of WORLD_LAYOUT.bridges) fillWorldRect(ctx, bridge, camX, camY);

  ctx.strokeStyle = M.fence;
  for (const segment of WORLD_LAYOUT.fence.segments) {
    ctx.beginPath();
    ctx.moveTo(screenX(segment.x1, camX) + 0.5, screenY(segment.y1, camY) + 0.5);
    ctx.lineTo(screenX(segment.x2, camX) + 0.5, screenY(segment.y2, camY) + 0.5);
    ctx.stroke();
  }

  // 树只画 1px 点：密到成片就说明到了加班林
  ctx.fillStyle = M.forestDot;
  const reach = VIEW_RADIUS + 80;
  for (const forest of WORLD_LAYOUT.forests) {
    for (const tree of forest.trees) {
      if (Math.abs(tree.x - camX) > reach || Math.abs(tree.y - camY) > reach) continue;
      ctx.fillRect(screenX(tree.x, camX), screenY(tree.y, camY), 1, 1);
    }
  }
}

export function MiniMap({ getSession }: { getSession: () => GameSession | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [region, setRegion] = useState('园区');
  const [nearby, setNearby] = useState(0);
  const labelRef = useRef({ region: '', nearby: -1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 小地图也按 DPR 出图，否则 1px 围栏线在 2x 屏上会糊成两像素灰边
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const draw = () => {
      const snapshot = getSession()?.worldSnapshot();
      const camX = snapshot?.x ?? WORLD_CENTER.x;
      const camY = snapshot?.y ?? WORLD_CENTER.y;
      drawTerrain(ctx, camX, camY);

      const points = snapshot?.points ?? [];
      let others = 0;
      for (const point of points) {
        if (point.self) continue;
        others += 1;
        ctx.fillStyle = M.other;
        ctx.fillRect(screenX(point.x, camX) - 1, screenY(point.y, camY) - 1, 2, 2);
      }

      const self = points.find((point) => point.self);
      if (self) {
        const px = screenX(self.x, camX);
        const py = screenY(self.y, camY);
        ctx.fillStyle = '#070a08';
        ctx.fillRect(px - 2, py - 2, 5, 5);
        ctx.fillStyle = M.self;
        ctx.fillRect(px - 1, py - 1, 3, 3);
      }

      const nextRegion = snapshot?.region || '园区';
      if (labelRef.current.region !== nextRegion) {
        labelRef.current.region = nextRegion;
        setRegion(nextRegion);
      }
      if (labelRef.current.nearby !== others) {
        labelRef.current.nearby = others;
        setNearby(others);
      }
    };

    draw();
    const timer = setInterval(draw, REFRESH_MS);
    return () => clearInterval(timer);
  }, [getSession]);

  return (
    <div className="pointer-events-auto hidden border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm lg:block">
      <div className="flex items-center justify-between gap-3 border-b-2 border-ink-700 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] text-mist-500">
          <MapPin className="h-3 w-3 text-mint-400" />
          {region}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-mist-500">{nearby} 头牛马</span>
      </div>

      <canvas
        ref={canvasRef}
        className="block h-[168px] w-[168px]"
        aria-label={`${region}附近 ${nearby} 头牛马，视野半径 900 像素`}
      />

      <div className="flex items-center justify-between border-t-2 border-ink-700 px-2.5 py-1 font-mono text-[9px] tracking-[0.12em] text-mist-500">
        <span>SCAN 4Hz</span>
        <span>AOI 900px</span>
      </div>
    </div>
  );
}
