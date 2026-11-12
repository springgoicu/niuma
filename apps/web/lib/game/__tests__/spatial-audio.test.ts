import { describe, expect, it } from 'bun:test';
import {
  AUDIBLE_RADIUS_PX,
  NEAR_FIELD_PX,
  PAN_FULL_OFFSET_PX,
  attenuationFor,
  panFor,
} from '../spatial-audio';

/**
 * 空间声场只守两条承诺：左右不能反、800px 外不能出声。
 * 这里不测 Web Audio：节点图在浏览器里，数学部分必须能在 bun 里单独验证。
 */
describe('空间声像', () => {
  it('听者正前方 / 正后方不偏声', () => {
    expect(panFor(0)).toBe(0);
  });

  it('右侧为正、左侧为负，且按偏移线性映射', () => {
    expect(panFor(PAN_FULL_OFFSET_PX / 2)).toBeCloseTo(0.5, 6);
    expect(panFor(-PAN_FULL_OFFSET_PX / 2)).toBeCloseTo(-0.5, 6);
  });

  it('超过硬声像距离后钳在 ±1，不会越界', () => {
    expect(panFor(10_000)).toBe(1);
    expect(panFor(-10_000)).toBe(-1);
  });

  it('非法输入退回中置，而不是 NaN 传进 AudioParam', () => {
    expect(panFor(Number.NaN)).toBe(0);
    expect(panFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('距离衰减', () => {
  it('近场内不衰减：自己的动作与贴身设施保持原音量', () => {
    expect(attenuationFor(0, 0)).toBe(1);
    expect(attenuationFor(NEAR_FIELD_PX, 0)).toBe(1);
  });

  it('800px 边界外为 0，边界上连续归零', () => {
    expect(attenuationFor(AUDIBLE_RADIUS_PX, 0)).toBe(0);
    expect(attenuationFor(AUDIBLE_RADIUS_PX + 1, 0)).toBe(0);
    expect(attenuationFor(480, 640)).toBe(0);
  });

  it('从近场到边界单调递减', () => {
    let previous = 1;
    for (let d = NEAR_FIELD_PX; d <= AUDIBLE_RADIUS_PX; d += 20) {
      const gain = attenuationFor(d, 0);
      expect(gain).toBeLessThanOrEqual(previous + 1e-9);
      expect(gain).toBeGreaterThanOrEqual(0);
      previous = gain;
    }
  });

  it('只看欧氏距离：同样的半径在 Y 轴与斜向给同样的音量', () => {
    expect(attenuationFor(0, 300)).toBeCloseTo(attenuationFor(300, 0), 9);
    expect(attenuationFor(180, 240)).toBeCloseTo(attenuationFor(300, 0), 9);
  });

  it('非法坐标不发声，避免 NaN 变成满音量', () => {
    expect(attenuationFor(Number.NaN, 0)).toBe(0);
    expect(attenuationFor(0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
