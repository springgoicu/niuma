/**
 * 场所微动效：全部是 `(seed, nowMs) => 数值` 的纯函数。
 *
 * 纪律（与 `police-beacon.ts` 同源）：
 * 1. 只看绝对时间，不看帧间隔——掉帧、切标签页回来都不会错位；
 * 2. 相位由种子派生，同屏的灯不会一起闪、落叶不会一起跳；
 * 3. 没有状态、不分配对象，帧循环里直接算，测试可以直接断言区间。
 *
 * 这里只放「算」，怎么用（哪个精灵移动多少像素、透明度多少）在 `venue-art.ts` 的 `VenueFx` 里。
 */

const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 种子散列到 0..1：整数运算，浏览器与 bun 结果一致 */
export function seedUnit(seed: number): number {
  let h = (seed | 0) * 0x27d4eb2d;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 4096) / 4096;
}

/** 烛火 / 灯泡：0.82–1.00，190ms 一拍，两个不同频率叠加避免机械感 */
export function torchFlicker(seed: number, nowMs: number): number {
  const phase = nowMs / 190 + seedUnit(seed) * TAU;
  const wave = Math.sin(phase) * 0.5 + Math.sin(phase * 2.31 + 1.7) * 0.5;
  return 0.82 + 0.18 * (wave * 0.5 + 0.5);
}

/** 霓虹呼吸：0–1，2.6s 一周期，偶发一次短暂断闪 */
export function neonPulse(seed: number, nowMs: number): number {
  const unit = seedUnit(seed);
  const period = 2600;
  const t = (nowMs / period + unit) % 1;
  const breath = 0.55 + 0.45 * Math.sin(t * TAU);
  // 每个周期最后 6% 断一下，霓虹才有「老」的味道
  if (t > 0.94) return breath * 0.35;
  return breath;
}

/** 水面反光：0–1，2.4s 一周期，相位按位置错开 */
export function waterGlint(seed: number, nowMs: number): number {
  const t = (nowMs / 2400 + seedUnit(seed)) % 1;
  const wave = Math.sin(t * TAU) * 0.5 + Math.sin(t * TAU * 2.7 + 0.8) * 0.5;
  return clamp01(0.25 + 0.75 * (wave * 0.5 + 0.5));
}

/** 旗帜 / 灯串轻摆：-1–1，3.2s 一周期 */
export function bannerSway(seed: number, nowMs: number): number {
  const t = nowMs / 3200 + seedUnit(seed);
  return Math.sin(t * TAU) * 0.6 + Math.sin(t * TAU * 2.3 + 0.4) * 0.4;
}

/** 屏幕闪烁：0–1，用于影音室银幕与赌场霓虹牌，周期 1.4s 且有一段静止 */
export function screenFlicker(seed: number, nowMs: number): number {
  const unit = seedUnit(seed);
  const t = (nowMs / 1400 + unit) % 1;
  if (t < 0.72) return 0.9 + 0.1 * Math.sin(t * TAU * 3);
  return 0.55 + 0.45 * Math.sin((t - 0.72) * TAU * 6.4);
}

/**
 * 落叶横向漂移：`span` 是左右各漂多少像素。
 * 用 9s 一个完整循环，回到起点时透明度正好归零，看不出跳跃。
 */
export function leafX(seed: number, nowMs: number, span: number): number {
  const t = (nowMs / 9000 + seedUnit(seed)) % 1;
  return (t * 2 - 1) * span;
}

/** 落叶纵向起伏：与 `leafX` 共用同一个 9s 周期的两个次谐波 */
export function leafY(seed: number, nowMs: number, amp: number): number {
  const t = (nowMs / 9000 + seedUnit(seed)) % 1;
  return Math.sin(t * TAU * 3.1) * amp + Math.sin(t * TAU * 1.3 + 1.1) * amp * 0.6;
}

/** 落叶透明度：首尾淡入淡出，中间满亮 */
export function leafAlpha(seed: number, nowMs: number): number {
  const t = (nowMs / 9000 + seedUnit(seed)) % 1;
  const fade = Math.min(t / 0.12, (1 - t) / 0.12, 1);
  return clamp01(fade) * 0.85;
}
