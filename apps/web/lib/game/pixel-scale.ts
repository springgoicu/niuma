/**
 * 像素度量的唯一真相：把「1 个纹素占多少设备像素」收敛成整数。
 *
 * 只开 nearest + roundPixels 还不够：当 缩放 × DPR 不是整数时（Windows 125% / 150% 缩放很常见），
 * 相邻纹素会轮流占 3 个和 4 个设备像素，看起来就是「糊」而不是「像素块」。
 * 因此先在设备像素上取整，再反推回 CSS 缩放。
 */

export interface PixelMetrics {
  dpr: number;
  /** 每个纹素占用的设备像素数，恒为整数 */
  devicePxPerTexel: number;
  /** 世界容器 / 精灵容器应当使用的 CSS 缩放 */
  cssScale: number;
}

const MIN_DEVICE_PX = 3;
const MAX_DEVICE_PX = 8;

function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

export function readDpr(): number {
  if (typeof window === 'undefined') return 1;
  return normalizeDpr(window.devicePixelRatio);
}

export function pixelMetrics(baseCssPerTexel: number, dpr: number = readDpr()): PixelMetrics {
  const ratio = normalizeDpr(dpr);
  const devicePxPerTexel = Math.min(
    MAX_DEVICE_PX,
    Math.max(MIN_DEVICE_PX, Math.round(baseCssPerTexel * ratio)),
  );
  return { dpr: ratio, devicePxPerTexel, cssScale: devicePxPerTexel / ratio };
}

export function sameMetrics(a: PixelMetrics, b: PixelMetrics): boolean {
  return a.dpr === b.dpr && a.devicePxPerTexel === b.devicePxPerTexel;
}

/** CSS 长度吸附到整数设备像素上，避免整层画面落在半像素里被重采样 */
export function snapCss(value: number, dpr: number = readDpr()): number {
  const ratio = normalizeDpr(dpr);
  return Math.round(value * ratio) / ratio;
}

/** 世界坐标吸附到整纹素；世界 1 单位 = 图集 1 像素 */
export function snapTexel(value: number): number {
  return Math.round(value);
}
