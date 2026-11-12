'use client';

import { useMemo } from 'react';
import { barcodeBars, qrCells } from '@/lib/game/badge-art';

export function Barcode({ value }: { value: string }) {
  const bars = useMemo(() => barcodeBars(value), [value]);
  return (
    <svg
      viewBox="0 0 120 26"
      preserveAspectRatio="none"
      className="block h-8 w-full border border-neutral-600 bg-[#e9e1cf]"
      role="img"
      aria-label={`工号条码 ${value}`}
    >
      {bars.map((bar, index) => (
        <rect key={index} x={bar.x} y={3} width={bar.width} height={20} fill="#14100c" />
      ))}
    </svg>
  );
}

export function FakeQr({ value }: { value: string }) {
  const cells = useMemo(() => qrCells(value), [value]);
  return (
    <svg
      viewBox="0 0 21 21"
      className="h-11 w-11 shrink-0 border border-neutral-600 bg-[#e9e1cf] p-0.5"
      aria-hidden="true"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#14100c" />
      ))}
    </svg>
  );
}

/** 工牌右下角的安全芯片：纯装饰，给「实体证件」一个金属触点。 */
export function Chip() {
  return (
    <div
      className="relative h-6 w-9 shrink-0 overflow-hidden border border-amber-300/80 bg-amber-400"
      aria-hidden="true"
    >
      <span className="absolute inset-x-0 top-1.5 h-px bg-amber-800/60" />
      <span className="absolute inset-x-0 bottom-1.5 h-px bg-amber-800/60" />
      <span className="absolute inset-y-0 left-2 w-px bg-amber-800/60" />
      <span className="absolute inset-y-0 right-2 w-px bg-amber-800/60" />
    </div>
  );
}
