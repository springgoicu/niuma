'use client';

import { useEffect, useState } from 'react';
import { hexToRgb565, rgb565ToHex } from '@niuma/shared-types';
import { COLOR_ROWS, PRESET_SWATCHES, useCreatorStore, type ColorSlot } from '@/lib/creator-store';
import { hexToHsv, hsvToHex, parseHex, toHexString } from '@/lib/color';

function Track({
  value,
  max,
  gradient,
  label,
  onChange,
}: {
  value: number;
  max: number;
  gradient: string;
  label: string;
  onChange: (value: number) => void;
}) {
  const percent = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="relative h-3 w-full border border-ink-600 bg-ink-900">
      <div className="absolute inset-0" style={{ background: gradient }} />
      <div
        className="pointer-events-none absolute top-1/2 h-4 w-1.5 -translate-y-1/2 border border-ink-950 bg-mist-100"
        style={{ left: `calc(${percent}% - 3px)` }}
      />
      <input
        type="range"
        min={0}
        max={max}
        value={Math.round(value)}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:opacity-100"
      />
    </div>
  );
}

function ColorRow({ slot, label, hint }: { slot: ColorSlot; label: string; hint: string }) {
  const color = useCreatorStore((state) => state.appearance.colors[slot]);
  const setColor = useCreatorStore((state) => state.setColor);
  const hsv = hexToHsv(color);
  const [draft, setDraft] = useState(toHexString(color));

  useEffect(() => {
    setDraft(toHexString(color));
  }, [color]);

  const commitHex = (raw: string) => {
    setDraft(raw);
    const parsed = parseHex(raw);
    if (parsed !== null) setColor(slot, parsed);
  };

  const fresh = hsvToHex(hsv.h, 100, 100);

  return (
    <div className="border-2 border-ink-700 bg-ink-950/40 p-3.5">
      <div className="flex items-center gap-3">
        <span
          className="h-7 w-7 shrink-0 border-2 border-ink-600"
          style={{ backgroundColor: toHexString(color) }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-mist-100">{label}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-mist-500">{hint}</p>
        </div>
        <input
          value={draft}
          onChange={(event) => commitHex(event.target.value)}
          onBlur={() => setDraft(toHexString(color))}
          aria-label={`${label}十六进制颜色`}
          spellCheck={false}
          className="w-[86px] border-2 border-ink-600 bg-ink-950 px-2 py-1 font-mono text-[11px] text-mist-100 outline-none focus:border-mint-400"
        />
      </div>

      <div className="mt-3 space-y-2">
        <Track
          label={`${label}色相`}
          value={hsv.h}
          max={360}
          gradient="linear-gradient(90deg,#ff3d5a,#ffc53d,#a8ff6b,#4fe3c1,#5ac8fa,#8a3f6b,#ff3d5a)"
          onChange={(h) => setColor(slot, hsvToHex(h, hsv.s, hsv.v))}
        />
        <div className="grid grid-cols-2 gap-2">
          <Track
            label={`${label}饱和度`}
            value={hsv.s}
            max={100}
            gradient={`linear-gradient(90deg, #66756a, ${toHexString(fresh)})`}
            onChange={(s) => setColor(slot, hsvToHex(hsv.h, s, hsv.v))}
          />
          <Track
            label={`${label}明度`}
            value={hsv.v}
            max={100}
            gradient={`linear-gradient(90deg, #070a08, ${toHexString(fresh)})`}
            onChange={(v) => setColor(slot, hsvToHex(hsv.h, hsv.s, v))}
          />
        </div>
      </div>

      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500">
        wire 565 · {toHexString(rgb565ToHex(hexToRgb565(color)))}
      </p>
    </div>
  );
}

export function ColorConsole() {
  const setColor = useCreatorStore((state) => state.setColor);

  return (
    <aside className="panel panel-scan p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold tracking-wide text-mist-100">调色控制台</h2>
        <span className="tag">rgb565</span>
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-mist-500">
        拖动滑块只改 tint，不重建纹理。颜色会先量化到 16bit，保证你看到的就是别人看到的。
      </p>

      <div className="mt-4 space-y-3">
        {COLOR_ROWS.map((row) => (
          <ColorRow key={row.slot} slot={row.slot} label={row.label} hint={row.hint} />
        ))}
      </div>

      <div className="mt-5 border-t-2 border-ink-700 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mist-500">常用主色</p>
        <div className="mt-3 grid grid-cols-6 gap-2">
          {PRESET_SWATCHES.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`应用主色 ${toHexString(preset)}`}
              onClick={() => setColor('body', preset)}
              className="h-8 cursor-pointer border-2 border-ink-600 transition-transform duration-150 hover:-translate-y-0.5 hover:border-mint-400"
              style={{ backgroundColor: toHexString(preset) }}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
