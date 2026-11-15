import { describe, expect, it } from 'bun:test';
import {
  bannerSway,
  leafAlpha,
  leafX,
  leafY,
  neonPulse,
  screenFlicker,
  seedUnit,
  torchFlicker,
  waterGlint,
} from '../venue-motion';

const SAMPLES = 240;
const step = 137;

describe('场所微动效纯函数', () => {
  it('种子散列落在 0..1，且同种子可复现', () => {
    for (let seed = 0; seed < 32; seed += 1) {
      const value = seedUnit(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(seedUnit(seed)).toBe(value);
    }
    expect(seedUnit(1)).not.toBe(seedUnit(2));
  });

  it('烛火在 0.82–1.00，霓虹与屏幕在 0–1，旗帜在 -1–1', () => {
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = i * step;
      const torch = torchFlicker(i, t);
      expect(torch).toBeGreaterThanOrEqual(0.82);
      expect(torch).toBeLessThanOrEqual(1);

      const neon = neonPulse(i, t);
      expect(neon).toBeGreaterThanOrEqual(0);
      expect(neon).toBeLessThanOrEqual(1);

      const screen = screenFlicker(i, t);
      expect(screen).toBeGreaterThanOrEqual(0);
      expect(screen).toBeLessThanOrEqual(1);

      const sway = bannerSway(i, t);
      expect(sway).toBeGreaterThanOrEqual(-1);
      expect(sway).toBeLessThanOrEqual(1);
    }
  });

  it('水光有暗有亮：既不会整片常亮，也不会一直灰', () => {
    const values: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) values.push(waterGlint(3, i * step));
    expect(Math.min(...values)).toBeLessThan(0.35);
    expect(Math.max(...values)).toBeGreaterThan(0.9);
  });

  it('落叶横向漂移被 span 夹住，透明度首尾淡出', () => {
    const span = 24;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = i * step;
      const x = leafX(5, t, span);
      expect(x).toBeGreaterThanOrEqual(-span);
      expect(x).toBeLessThanOrEqual(span);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      expect(Math.abs(leafY(5, t, 7))).toBeLessThanOrEqual(11.2);
      expect(leafAlpha(5, t)).toBeGreaterThanOrEqual(0);
      expect(leafAlpha(5, t)).toBeLessThanOrEqual(0.85);
    }
    // 一个 9s 周期里必须真的走完全程，否则读起来像原地抖
    expect(maxX - minX).toBeGreaterThan(span);
  });

  it('相位按种子错开：同一时刻的落叶铺满整条漂移带', () => {
    const span = 20;
    const xs: number[] = [];
    for (let seed = 1; seed <= 12; seed += 1) xs.push(leafX(seed, 2000, span));
    const spread = Math.max(...xs) - Math.min(...xs);
    // 12 片叶子在同一帧要散开七成带宽（实测约 79%），否则读起来像整排一起飘
    expect(spread).toBeGreaterThan(span * 1.4);
  });
});
