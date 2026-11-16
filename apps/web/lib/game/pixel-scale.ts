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
/** 只是防呆上限：基准 3 / 6 乘上 DPR 3 也只有 18，正常不会触发 */
const MAX_DEVICE_PX = 24;

/**
 * DPR 归一化。
 *
 * 渲染线程里没有 `window`，DPR 由主线程通过控制块传进来，所以真正的读取动作
 * 收敛到 `readDpr()`（只给主线程用），Worker 侧一律调用本函数处理注入值。
 */
export function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * 可选的高 DPI 上限：`?dpr=1|2|3` 显式封顶，缺省 / 非法 / `0` 一律不封顶。
 *
 * 封顶会让 backing store 与设备像素不再 1:1（`renderer.ts` 初始化处要求保持 1:1），
 * 浏览器合成阶段会重采样，像素块边界可能出现 4/5 设备像素交替。所以它只能当
 * 低端机的显式自救开关，不参与自动降档，默认一个字都不改。
 */
export function resolveDprCap(search: string): number {
  const raw = new URLSearchParams(search).get('dpr');
  if (raw === null) return 0;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return 0;
  const value = Number(text);
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

/** 压到上限；上限 `0` 表示不封顶，原样返回，与 `normalizeDpr` 串联使用 */
export function capDpr(dpr: number, cap: number): number {
  return cap > 0 && dpr > cap ? cap : dpr;
}

export function readDpr(): number {
  // 同 build-version 的坑：`typeof window === 'undefined'` 会被 SWC 在 client bundle 里
  // 折叠掉，Worker 调用时直接 ReferenceError。按能力判断才靠得住。
  const scope = globalThis as { devicePixelRatio?: number };
  return normalizeDpr(scope.devicePixelRatio ?? 1);
}

/**
 * `minDevicePx` 单独开放给大厅：世界倍率降到 1.5 之后，DPR 1 的屏幕上
 * `round(1.5 × 1) = 2` 会被默认下限 3 夹回去，等于在 100% 缩放的桌面上什么都没改。
 * 预览台与 `fitMetrics` 仍走默认下限，两处结果一字不动。
 */
export function pixelMetrics(
  baseCssPerTexel: number,
  dpr: number = readDpr(),
  minDevicePx: number = MIN_DEVICE_PX,
): PixelMetrics {
  const ratio = normalizeDpr(dpr);
  const floor = Number.isFinite(minDevicePx)
    ? Math.min(MAX_DEVICE_PX, Math.max(1, Math.round(minDevicePx)))
    : MIN_DEVICE_PX;
  const devicePxPerTexel = Math.min(
    MAX_DEVICE_PX,
    Math.max(floor, Math.round(baseCssPerTexel * ratio)),
  );
  return { dpr: ratio, devicePxPerTexel, cssScale: devicePxPerTexel / ratio };
}

export function sameMetrics(a: PixelMetrics, b: PixelMetrics): boolean {
  return a.dpr === b.dpr && a.devicePxPerTexel === b.devicePxPerTexel;
}

/**
 * 按「最多允许多少 CSS 像素画一个纹素」反推档位，向下取整。
 *
 * 与 `pixelMetrics` 的差别只在这一步取整：固定版式用四舍五入保住观感，
 * 自适应容器必须向下取整，宁可角色小一档，也不能让它撑出画布。
 */
export function fitMetrics(maxCssPerTexel: number, dpr: number = readDpr()): PixelMetrics {
  const ratio = normalizeDpr(dpr);
  const raw = Number.isFinite(maxCssPerTexel) ? maxCssPerTexel * ratio : 0;
  const devicePxPerTexel = Math.min(MAX_DEVICE_PX, Math.max(MIN_DEVICE_PX, Math.floor(raw)));
  return { dpr: ratio, devicePxPerTexel, cssScale: devicePxPerTexel / ratio };
}

/**
 * 竖屏取景的目标横向纹素数：390px 宽的竖屏在 1.5 CSS/纹素下只看到 260 纹素，
 * 不到横屏（844px / 1.5 ≈ 563）的一半。按屏宽反推倍率，把视野拉回约 360 纹素。
 */
export const PORTRAIT_TARGET_TEXELS = 360;

/**
 * 世界倍率的朝向自适应：横屏 / 宽窗口原样返回 `base`；竖屏按 `width / targetTexels`
 * 反推一档更小的值，只降不升、下限 1。
 *
 * 这里只给出「理想 CSS 倍率」，最终的整数设备像素仍由 `pixelMetrics` 决定：
 * DPR 1 的屏幕受 `MIN_DEVICE_PX_PER_TEXEL = 2` 夹制，竖屏并不能真的再缩小，
 * 属于已知限制，不做特例。`?zoom=` 显式覆盖时调用方应跳过本函数。
 */
export function worldCssPerTexel(
  width: number,
  height: number,
  base: number,
  targetTexels: number = PORTRAIT_TARGET_TEXELS,
): number {
  if (!(width > 0) || !(height > width)) return base;
  if (!(targetTexels > 0)) return base;
  return Math.min(base, Math.max(1, width / targetTexels));
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
