'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { hexToRgb565, normalizeColor, rgb565ToHex } from '@niuma/shared-types';
import {
  GLOBAL_COLOR_ROWS,
  LOOK_PALETTES,
  PART_META,
  PART_ORDER,
  PRESET_SWATCHES,
  lookSwatches,
  partLabel,
  partValue,
  useCreatorStore,
  type ColorSlot,
  type LookPalette,
  type PartKey,
} from '@/lib/creator-store';
import { hexToHsv, hsvToHex, parseHex, resolveHsvDraft, toHexString, type Hsv } from '@/lib/color';
import { AtelierEyebrow, AtelierRule, AtelierStar } from './Atelier';

type Axis = 'h' | 's' | 'v';

/** 区块标题：一条淡出的金色细线代替整块描边，面板里才有呼吸 */
function SectionHead({ label, hint }: { label: string; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-mist-300">{label}</h3>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-mist-400">{hint}</span>
      </div>
      <AtelierRule />
    </div>
  );
}

/**
 * 一根滑轨。
 *
 * 位置只认传进来的 `value`（ColorControls 的草稿），不认 store 里的颜色——
 * 色相拖到 360° 时颜色会被折成 0°，跟着颜色走就会从末端弹回最前端。
 * 触屏命中区仍是 44px，滑轨本体仍是 8px 细条，不靠加粗表达可拖动。
 */
function Track({
  value,
  max,
  gradient,
  label,
  accent,
  unit,
  active,
  onActiveChange,
  onChange,
}: {
  value: number;
  max: number;
  gradient: string;
  label: string;
  /** 当前颜色：滑块的填充与柔光都用它，读数才是「手里这支色」 */
  accent: string;
  unit: '°' | '%';
  active: boolean;
  onActiveChange: (active: boolean) => void;
  onChange: (value: number) => void;
}) {
  const shown = Math.round(value);
  const percent = Math.max(0, Math.min(1, shown / max)) * 100;
  const readout = `${shown}${unit}`;

  return (
    <div
      className={`group relative flex h-11 items-center focus-within:ring-1 focus-within:ring-mint-400 xl:h-6 ${
        active ? 'z-20' : ''
      }`}
    >
      <div className="relative h-2 w-full border border-ink-700">
        <div className="absolute inset-0" style={{ background: gradient }} />
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-[6px] -translate-y-1/2 border border-mist-100/85 transition-transform duration-150 group-hover:scale-y-110"
          style={{
            left: `calc(${percent}% - 3px)`,
            backgroundColor: accent,
            boxShadow: `0 0 12px -1px ${accent}`,
          }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={shown}
        aria-label={label}
        aria-valuetext={readout}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerDown={() => onActiveChange(true)}
        onPointerUp={() => onActiveChange(false)}
        onPointerCancel={() => onActiveChange(false)}
        onFocus={() => onActiveChange(true)}
        onBlur={() => onActiveChange(false)}
        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      />
      {/* 数值气泡：悬停 / 键盘聚焦 / 按住拖动时贴着滑块浮出，屏读仍读原生 range */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[calc(50%+9px)] z-20 -translate-x-1/2 border border-ink-600 bg-ink-950 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-mist-100 opacity-0 shadow-[0_6px_16px_-10px_rgba(10,6,3,0.9)] transition-opacity duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100 peer-active:opacity-100"
        style={{ left: `clamp(14px, ${percent}%, calc(100% - 14px))` }}
      >
        {readout}
      </span>
    </div>
  );
}

/** 一格读数：等宽右对齐，正在拖的那个轴描一道淡 mint 边 */
function Readout({
  axis,
  value,
  unit,
  active,
}: {
  axis: string;
  value: number;
  unit: '°' | '%';
  active: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-1 border px-1.5 py-1 font-mono text-[10px] leading-none tabular-nums transition-colors duration-150 ${
        active ? 'border-mint-400/60 bg-mint-400/[0.07] text-mist-100' : 'border-ink-700 bg-ink-950/50 text-mist-300'
      }`}
    >
      <span className="text-[9px] uppercase tracking-[0.12em] text-mist-500">{axis}</span>
      <span>
        {Math.round(value)}
        {unit}
      </span>
    </div>
  );
}

/**
 * 一个色槽的全部控制：色相 / 饱和 / 明度 + hex + 565 回显。
 *
 * 滑轨的真相是本地 HSV 草稿，store 只是输出端：`setColor` 会把颜色量化到 RGB565，
 * 从 store 反推 HSV 会让滑块每拖一格就抖一下，遇到 0/360 的边界还会整根跳回起点。
 */
function ColorControls({ slot, label }: { slot: ColorSlot; label: string }) {
  const color = useCreatorStore((state) => state.appearance.colors[slot]);
  const setColor = useCreatorStore((state) => state.setColor);

  const [draft, setDraft] = useState<Hsv>(() => hexToHsv(color));
  const [hexDraft, setHexDraft] = useState(() => toHexString(color));
  const [axis, setAxis] = useState<Axis | null>(null);
  const draftRef = useRef(draft);
  const emittedRef = useRef<number | null>(null);
  const slotRef = useRef(slot);
  /** 首帧的 draft 就是从 color 推出来的，不必再同步一次 */
  const mountedRef = useRef(false);

  useEffect(() => {
    setHexDraft(toHexString(color));
  }, [color]);

  // 只有外部改色才回读 store；自己刚发出去的那一版（含 565 量化）原样保留草稿
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    let next: Hsv;
    if (slotRef.current !== slot) {
      slotRef.current = slot;
      emittedRef.current = null;
      next = hexToHsv(color);
    } else {
      next = resolveHsvDraft(color, emittedRef.current, draftRef.current);
    }
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraft(next);
  }, [color, slot]);

  const commit = (next: Hsv) => {
    draftRef.current = next;
    setDraft(next);
    const hex = normalizeColor(hsvToHex(next.h, next.s, next.v));
    if (hex === emittedRef.current) return;
    emittedRef.current = hex;
    if (hex === useCreatorStore.getState().appearance.colors[slot]) return;
    setColor(slot, hex);
  };

  const setAxisValue = (target: Axis, value: number) => {
    commit({ ...draftRef.current, [target]: value });
  };

  const commitHex = (raw: string) => {
    setHexDraft(raw);
    const parsed = parseHex(raw);
    if (parsed !== null) setColor(slot, parsed);
  };

  const hex = toHexString(color);
  const fresh = hsvToHex(draft.h, 100, 100);

  return (
    <div className="space-y-2">
      <Track
        label={`${label}色相`}
        value={draft.h}
        max={360}
        unit="°"
        accent={hex}
        active={axis === 'h'}
        onActiveChange={(on) => setAxis(on ? 'h' : null)}
        gradient="linear-gradient(90deg,#ff3d5a,#ffc53d,#a8ff6b,#4fe3c1,#5ac8fa,#8a3f6b,#ff3d5a)"
        onChange={(h) => setAxisValue('h', h)}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <Track
          label={`${label}饱和度`}
          value={draft.s}
          max={100}
          unit="%"
          accent={hex}
          active={axis === 's'}
          onActiveChange={(on) => setAxis(on ? 's' : null)}
          gradient={`linear-gradient(90deg, var(--color-mist-500), ${toHexString(fresh)})`}
          onChange={(s) => setAxisValue('s', s)}
        />
        <Track
          label={`${label}明度`}
          value={draft.v}
          max={100}
          unit="%"
          accent={hex}
          active={axis === 'v'}
          onActiveChange={(on) => setAxis(on ? 'v' : null)}
          gradient={`linear-gradient(90deg, var(--color-ink-950), ${toHexString(fresh)})`}
          onChange={(v) => setAxisValue('v', v)}
        />
      </div>

      <div className="flex items-center gap-2">
        <span
          className="h-9 w-9 shrink-0 border border-ink-600 xl:h-7 xl:w-7"
          style={{
            backgroundColor: hex,
            boxShadow: `inset 0 0 0 1px rgba(7,10,8,0.55), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 16px -8px ${hex}`,
          }}
          aria-hidden
        />
        <input
          value={hexDraft}
          onChange={(event) => commitHex(event.target.value)}
          onBlur={() => setHexDraft(hex)}
          aria-label={`${label}十六进制颜色`}
          spellCheck={false}
          className="h-9 min-w-0 flex-1 border border-ink-700 bg-ink-950 px-2 font-mono text-[11px] tabular-nums text-mist-100 outline-none transition-colors duration-150 focus:border-mint-400 xl:h-7"
        />
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-mist-500">
          565 · {toHexString(rgb565ToHex(hexToRgb565(color)))}
        </span>
      </div>

      <div aria-hidden className="grid grid-cols-3 gap-1.5">
        <Readout axis="H" value={draft.h} unit="°" active={axis === 'h'} />
        <Readout axis="S" value={draft.s} unit="%" active={axis === 's'} />
        <Readout axis="V" value={draft.v} unit="%" active={axis === 'v'} />
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
          style={{
            backgroundColor: toHexString(color),
            boxShadow: `inset 0 0 0 1px rgba(7,10,8,0.55), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 14px -8px ${toHexString(color)}`,
          }}
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
          style={{
            backgroundColor: toHexString(color),
            boxShadow: `inset 0 0 0 1px rgba(7,10,8,0.55), 0 0 20px -8px ${toHexString(color)}`,
          }}
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

/**
 * 常用主色：只订阅目标槽位自己的颜色。
 * 放在独立组件里，拖动滑轨时不会把整张调色台一起重渲染。
 */
function PresetSwatches({ slot, target }: { slot: ColorSlot; target: string }) {
  const current = useCreatorStore((state) => state.appearance.colors[slot]);
  const setColor = useCreatorStore((state) => state.setColor);

  return (
    <div className="mt-3 grid grid-cols-6 gap-1.5">
      {PRESET_SWATCHES.map((preset) => {
        const picked = normalizeColor(preset) === current;
        return (
          <button
            key={preset}
            type="button"
            title={toHexString(preset)}
            aria-label={`应用 ${toHexString(preset)} 到${target}`}
            aria-pressed={picked}
            onClick={() => setColor(slot, preset)}
            className={`relative cursor-pointer border transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-mint-400 xl:h-7 ${
              picked ? 'h-11 border-gilt-400/80' : 'h-11 border-ink-700'
            }`}
            style={{
              backgroundColor: toHexString(preset),
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.26), inset 0 -3px 8px -6px rgba(0,0,0,0.8)',
            }}
          >
            {picked ? <AtelierStar className="absolute bottom-0.5 right-0.5 h-2 w-2 bg-ink-950/80" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 整妆卡片：三色迷你条先给冷暖，中文名给含义，拉丁小字只是妆台的字形点缀 */
function LookCard({ palette }: { palette: LookPalette }) {
  const applyPalette = useCreatorStore((state) => state.applyPalette);
  return (
    <button
      type="button"
      onClick={() => applyPalette(palette.colors)}
      aria-label={`套用整套配色：${palette.name}`}
      className="group/look flex cursor-pointer items-center gap-2.5 border border-ink-700 bg-ink-950/40 px-2 py-2 text-left transition-colors duration-150 hover:border-gilt-400/60 hover:bg-ink-800/50"
    >
      <span className="flex h-8 w-[6px] shrink-0 flex-col overflow-hidden border border-ink-600" aria-hidden>
        {lookSwatches(palette).map((swatch, index) => (
          <span key={index} className="flex-1" style={{ backgroundColor: toHexString(swatch) }} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] leading-none text-mist-100">{palette.name}</span>
        <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500">
          {palette.hint}
        </span>
      </span>
      <AtelierStar className="h-2 w-2 bg-gilt-400/0 transition-colors duration-150 group-hover/look:bg-gilt-400/80" />
    </button>
  );
}

export function ColorConsole({ className = '' }: { className?: string }) {
  const activePart = useCreatorStore((state) => state.activePart);
  const setActivePart = useCreatorStore((state) => state.setActivePart);
  const [expanded, setExpanded] = useState<ColorSlot | null>('body');

  // 聚焦斑纹 / 角鬃时，颜色仍在「整体」区调：自动展开对应行，避免出现一个只读的聚焦卡
  useEffect(() => {
    if (activePart === 'pattern' || activePart === 'extra') setExpanded(PART_META[activePart].slot);
  }, [activePart]);

  const focusedSlot = activePart ? PART_META[activePart].slot : null;
  const presetTarget = activePart ? PART_META[activePart].label : '主体';
  const inGlobal = activePart === 'pattern' || activePart === 'extra';
  const presetSlot: ColorSlot = focusedSlot ?? 'body';

  return (
    <aside
      className={`panel panel-atelier overscroll-contain xl:sticky xl:top-[72px] xl:flex xl:max-h-[calc(100dvh-6rem)] xl:flex-col ${className}`}
    >
      {/* 滚动交给内层：镜框挂在 aside 上，才不会被滚动条一起卷走；
          xl 留 8px 边距，滚动条不会压在 5px 处那道金线上 */}
      <div className="p-4 sm:p-5 xl:mx-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
        <AtelierEyebrow latin="Vanity" hint="妆台 · 11 slots" className="mb-2.5" />
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

        <section className="mt-6">
          <div className="flex items-baseline justify-between gap-3 pb-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-mist-300">常用主色</p>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-mint-400">→ {presetTarget}</span>
          </div>
          <AtelierRule />
          <PresetSwatches slot={presetSlot} target={presetTarget} />
        </section>

        <section className="mt-6">
          <div className="flex items-baseline justify-between gap-3 pb-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-mist-300">整妆配色</p>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-gilt-400">look · 一键成套</span>
          </div>
          <AtelierRule />
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {LOOK_PALETTES.map((palette) => (
              <LookCard key={palette.id} palette={palette} />
            ))}
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-mist-400">
            整妆只改颜色，不动你选的配件与发型；套完还能逐槽微调。
          </p>
        </section>
      </div>
    </aside>
  );
}
