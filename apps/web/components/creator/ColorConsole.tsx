'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { hexToRgb565, rgb565ToHex } from '@niuma/shared-types';
import {
  GLOBAL_COLOR_ROWS,
  PART_META,
  PART_ORDER,
  PRESET_SWATCHES,
  partLabel,
  partValue,
  useCreatorStore,
  type ColorSlot,
  type PartKey,
} from '@/lib/creator-store';
import { hexToHsv, hsvToHex, parseHex, toHexString } from '@/lib/color';

/** 区块标题：一条 1px 分隔线代替整块描边，面板里才有呼吸 */
function SectionHead({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-700/70 pb-2">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-mist-300">{label}</h3>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-mist-400">{hint}</span>
    </div>
  );
}

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
    // 触屏命中区 44px，滑轨本体仍是 2px 细线，不靠加粗表达可拖动
    <div className="group relative flex h-11 items-center focus-within:ring-1 focus-within:ring-mint-400 xl:h-6">
      <div className="relative h-2 w-full border border-ink-700">
        <div className="absolute inset-0" style={{ background: gradient }} />
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-[5px] -translate-y-1/2 border border-ink-950 bg-mist-100 transition-transform duration-150 group-hover:scale-y-110"
          style={{ left: `calc(${percent}% - 2.5px)` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={Math.round(value)}
        aria-label={label}
        aria-valuetext={max === 360 ? `${Math.round(value)}°` : `${Math.round(value)}%`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      />
    </div>
  );
}

/** 一个色槽的全部控制：色相 / 饱和 / 明度 + hex + wire 回显 */
function ColorControls({ slot, label }: { slot: ColorSlot; label: string }) {
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
    <div className="space-y-2.5">
      <Track
        label={`${label}色相`}
        value={hsv.h}
        max={360}
        gradient="linear-gradient(90deg,#ff3d5a,#ffc53d,#a8ff6b,#4fe3c1,#5ac8fa,#8a3f6b,#ff3d5a)"
        onChange={(h) => setColor(slot, hsvToHex(h, hsv.s, hsv.v))}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <Track
          label={`${label}饱和度`}
          value={hsv.s}
          max={100}
          gradient={`linear-gradient(90deg, var(--color-mist-500), ${toHexString(fresh)})`}
          onChange={(s) => setColor(slot, hsvToHex(hsv.h, s, hsv.v))}
        />
        <Track
          label={`${label}明度`}
          value={hsv.v}
          max={100}
          gradient={`linear-gradient(90deg, var(--color-ink-950), ${toHexString(fresh)})`}
          onChange={(v) => setColor(slot, hsvToHex(hsv.h, hsv.s, v))}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <input
          value={draft}
          onChange={(event) => commitHex(event.target.value)}
          onBlur={() => setDraft(toHexString(color))}
          aria-label={`${label}十六进制颜色`}
          spellCheck={false}
          className="h-11 w-[104px] border border-ink-700 bg-ink-950 px-2 font-mono text-[11px] tabular-nums text-mist-100 outline-none transition-colors duration-150 focus:border-mint-400 xl:h-7 xl:w-[88px]"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-mist-400">
          565 · {toHexString(rgb565ToHex(hexToRgb565(color)))}
        </span>
      </div>
    </div>
  );
}

/** 「整体」区的一行：默认收起，只露出色块与十六进制，点开才展开三条滑轨 */
function GlobalRow({
  slot,
  label,
  hint,
  focused,
  expanded,
  onToggle,
}: {
  slot: ColorSlot;
  label: string;
  hint: string;
  focused: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = useCreatorStore((state) => state.appearance.colors[slot]);
  return (
    <div
      className={`border bg-ink-950/40 transition-colors duration-150 ${
        focused ? 'border-mint-400/60' : expanded ? 'border-ink-600' : 'border-ink-700 hover:border-ink-600'
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          className="h-7 w-7 shrink-0 border border-ink-600"
          style={{ backgroundColor: toHexString(color), boxShadow: 'inset 0 0 0 1px rgba(7,10,8,0.55)' }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-[12px] text-mist-100">{label}</span>
            {focused ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-mint-400">focus</span>
            ) : null}
          </span>
          <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-mist-400">{hint}</span>
        </span>
        <span className="font-mono text-[10px] tabular-nums text-mist-300">{toHexString(color)}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-mist-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="border-t border-ink-700/70 px-3 pb-3.5 pt-3">
          <ColorControls slot={slot} label={label} />
        </div>
      ) : null}
    </div>
  );
}

/** 只订阅「当前佩戴项」这四个字：拖动滑轨时不会连带重渲染整张卡片 */
function PartName({ part }: { part: PartKey }) {
  const label = useCreatorStore((state) => partLabel(state.appearance, part));
  return <>{label}</>;
}

/** 「当前属性」主卡片：跟随左栏最后点选的属性 */
function FocusCard({ part }: { part: PartKey }) {
  const meta = PART_META[part];
  const color = useCreatorStore((state) => state.appearance.colors[meta.slot]);
  const off = useCreatorStore((state) => partValue(state.appearance, part) === 'none');

  return (
    <div key={part} className="motion-safe:animate-queue-roll border border-mint-400/50 bg-mint-400/[0.05] p-3.5">
      <div className="flex items-start gap-3">
        <span
          className="h-11 w-11 shrink-0 border border-mint-400/25"
          style={{ backgroundColor: toHexString(color), boxShadow: 'inset 0 0 0 1px rgba(7,10,8,0.55)' }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] leading-tight tracking-[0.04em] text-mist-100">{meta.label}</p>
          <p className="mt-1 text-[11px] leading-none text-mist-300">
            <PartName part={part} />
          </p>
        </div>
        <span className="tag border-ink-600 text-[9px]">{meta.hint}</span>
      </div>
      {off ? (
        <p className="mt-2.5 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-amber-400/90">
          未佩戴 · 先给{meta.label}选一款，颜色会对下一件立刻生效
        </p>
      ) : null}
      <div className="mt-3">
        <ColorControls slot={meta.slot} label={meta.label} />
      </div>
    </div>
  );
}

export function ColorConsole({ className = '' }: { className?: string }) {
  const activePart = useCreatorStore((state) => state.activePart);
  const setActivePart = useCreatorStore((state) => state.setActivePart);
  const setColor = useCreatorStore((state) => state.setColor);
  const [expanded, setExpanded] = useState<ColorSlot | null>('body');

  // 聚焦斑纹 / 角鬃时，颜色仍在「整体」区调：自动展开对应行，避免出现一个只读的聚焦卡
  useEffect(() => {
    if (activePart === 'pattern' || activePart === 'extra') setExpanded(PART_META[activePart].slot);
  }, [activePart]);

  const focusedSlot = activePart ? PART_META[activePart].slot : null;
  const presetSlot: ColorSlot = focusedSlot ?? 'body';
  const presetTarget = activePart ? PART_META[activePart].label : '主体';
  const inGlobal = activePart === 'pattern' || activePart === 'extra';

  return (
    <aside
      className={`panel overscroll-contain p-4 sm:p-5 xl:sticky xl:top-[72px] xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[17px] font-semibold tracking-[0.08em] text-mist-100">调色控制台</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400">rgb565</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-mist-400">
        11 个色槽全部量化到 16bit；配件与发型是灰度图叠 tint，换色不重建纹理。
      </p>

      <section className="mt-5">
        <SectionHead label="整体" hint="global · 固定" />
        <div className="mt-2.5 space-y-1.5">
          {GLOBAL_COLOR_ROWS.map((row) => (
            <GlobalRow
              key={row.slot}
              slot={row.slot}
              label={row.label}
              hint={row.hint}
              focused={focusedSlot === row.slot}
              expanded={expanded === row.slot}
              onToggle={() => setExpanded((current) => (current === row.slot ? null : row.slot))}
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <SectionHead label="当前属性" hint="focus · 跟随左栏" />

        <div className="mt-2.5" aria-live="polite">
          {!activePart ? (
            <div className="border border-ink-700 bg-ink-950/30 px-3.5 py-3.5">
              <p className="text-[12px] leading-relaxed text-mist-300">
                在左侧点选任意属性，这里会换成它专属的配色。
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PART_ORDER.map((part) => (
                  <button
                    key={part}
                    type="button"
                    onClick={() => setActivePart(part)}
                    className="cursor-pointer border border-ink-700 px-2 py-1 text-[11px] leading-none text-mist-300 transition-colors duration-150 hover:border-mint-400/70 hover:text-mint-400"
                  >
                    {PART_META[part].label}
                  </button>
                ))}
              </div>
            </div>
          ) : inGlobal ? (
            <div className="border border-ink-700 bg-ink-950/30 p-3.5">
              <p className="font-display text-[15px] leading-tight tracking-[0.04em] text-mist-100">
                {PART_META[activePart].label}
              </p>
              <p className="mt-1 text-[11px] leading-none text-mist-300">
                <PartName part={activePart} />
              </p>
              <p className="mt-2.5 text-[11px] leading-relaxed text-mist-400">
                这一项属于整体配色，滑轨已在上方「{PART_META[activePart].label}」一行展开。
              </p>
            </div>
          ) : (
            <FocusCard part={activePart} />
          )}
        </div>
      </section>

      <section className="mt-6 border-t border-ink-700/70 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-mist-300">常用主色</p>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-mint-400">→ {presetTarget}</span>
        </div>
        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {PRESET_SWATCHES.map((preset) => (
            <button
              key={preset}
              type="button"
              title={toHexString(preset)}
              aria-label={`应用 ${toHexString(preset)} 到${presetTarget}`}
              onClick={() => setColor(presetSlot, preset)}
              className="h-11 cursor-pointer border border-ink-700 transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-mint-400 xl:h-7"
              style={{ backgroundColor: toHexString(preset) }}
            />
          ))}
        </div>
      </section>
    </aside>
  );
}
