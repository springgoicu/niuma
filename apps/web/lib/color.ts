export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** 两色线性混合：高光 / 眼神光这类派生色统一走这里，避免每处各写一份 */
export function mixHex(base: number, tint: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = lerp((base >> 16) & 0xff, (tint >> 16) & 0xff);
  const g = lerp((base >> 8) & 0xff, (tint >> 8) & 0xff);
  const b = lerp(base & 0xff, tint & 0xff);
  return (r << 16) | (g << 8) | b;
}

export function hexToHsv(hex: number): Hsv {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

export function hsvToHex(h: number, s: number, v: number): number {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const val = Math.max(0, Math.min(100, v)) / 100;
  const c = val * sat;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const m = val - c;
  const to255 = (value: number) => Math.round((value + m) * 255);
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}

/**
 * 由 store 颜色决定滑轨要不要重同步。
 *
 * `emitted` 是我们自己刚写进 store 的颜色，调用方必须按 565 归一后传入
 * （`normalizeColor(hsvToHex(...))`），否则量化误差会把它认成外部改色。
 *
 * 命中 emitted 就原样返回 draft：色相拖到 360° 时 `hsvToHex` 会折成 0° 的红，
 * 照 store 回读滑块就会从末端弹回最前端；饱和度 / 明度拖到 0 时颜色丢失色相，
 * 回读同样会把另外两根滑轨一起拽回起点。只有外部改色（预设色块、hex 输入、
 * 切换槽位、套用整妆、读档）才回读。
 */
export function resolveHsvDraft(storeColor: number, emitted: number | null, draft: Hsv): Hsv {
  if (emitted !== null && storeColor === emitted) return draft;
  return hexToHsv(storeColor);
}

export function toHexString(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function parseHex(input: string): number | null {
  const cleaned = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 16);
}

export function isLight(hex: number): boolean {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}
