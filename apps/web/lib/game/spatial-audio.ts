'use client';

/**
 * 2D 空间声场的纯数学部分（ADR-0048）。
 *
 * 只回答两个问题：这个声源在左边还是右边（pan）、传到听者还剩多少音量（gain）。
 * 不碰 Web Audio、不建对象，接口参数与返回值全是标量——播放路径每帧都可能调用，
 * 任何一次 `{ pan, gain }` 字面量都会变成稳态垃圾。
 */

/** 可听半径：与需求中的 800px 视野边界一致，超出直接不发声 */
export const AUDIBLE_RADIUS_PX = 800;
/** 近场保护区：贴身声源不做距离衰减，避免自己按 E 时音量被削一截 */
export const NEAR_FIELD_PX = 40;
/** 左右硬声像对应的世界偏移：±400px 之外不再继续偏向，只有远近变化 */
export const PAN_FULL_OFFSET_PX = 400;

/**
 * 相对 X 偏移 → 声像，范围 -1（最左）..1（最右）。
 * 先钳位再返回，调用方不需要再做一次 Math.min/Math.max。
 */
export function panFor(dx: number): number {
  if (!Number.isFinite(dx)) return 0;
  const pan = dx / PAN_FULL_OFFSET_PX;
  if (pan < -1) return -1;
  if (pan > 1) return 1;
  return pan;
}

/**
 * 距离衰减：近场为 1，800px 处为 0，中间用平方曲线。
 *
 * 为什么不是 1/d：视野边界是硬截断，1/d 在边界上仍然很响，关掉时会「啪」一声；
 * 从 NEAR_FIELD 到 AUDIBLE_RADIUS 归一化后平方，边界处连续归零。
 */
export function attenuationFor(dx: number, dy: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= NEAR_FIELD_PX) return 1;
  if (distance >= AUDIBLE_RADIUS_PX) return 0;
  const falloff = 1 - (distance - NEAR_FIELD_PX) / (AUDIBLE_RADIUS_PX - NEAR_FIELD_PX);
  return falloff * falloff;
}
