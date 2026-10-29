'use client';

import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import type { GameSession } from '@/lib/game/session';

const WIDTH = 168;
const HEIGHT = 128;
const RADIUS = 900;

export function MiniMap({ getSession }: { getSession: () => GameSession | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#070a08';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.strokeStyle = 'rgba(79, 227, 193, 0.12)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= WIDTH; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y <= HEIGHT; y += 24) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(WIDTH, y + 0.5);
        ctx.stroke();
      }

      const session = getSession();
      const points = session ? session.sampleNearby() : [];
      const scale = 54 / RADIUS;
      const cx = WIDTH / 2;
      const cy = HEIGHT / 2;

      for (const point of points) {
        const px = cx + point.x * scale;
        const py = cy + point.y * scale;
        if (px < 2 || py < 2 || px > WIDTH - 2 || py > HEIGHT - 2) continue;
        ctx.fillStyle = point.self ? '#4fe3c1' : '#9fb0a1';
        ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, point.self ? 3 : 2, point.self ? 3 : 2);
      }
    };

    draw();
    const timer = setInterval(draw, 250);
    return () => clearInterval(timer);
  }, [getSession]);

  return (
    <div className="pointer-events-auto hidden border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm lg:block">
      <div className="flex items-center justify-between border-b-2 border-ink-700 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">
          <MapPin className="h-3 w-3 text-mint-400" />
          floor 03
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500">900px</span>
      </div>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="附近牛马雷达" />
    </div>
  );
}
