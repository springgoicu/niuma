import { describe, expect, it } from 'bun:test';
import {
  approachValue,
  badContactFlicker,
  bannerSway,
  bulbPulse,
  codeLinePhase,
  ferrisStep,
  focusPulse,
  leafAlpha,
  leafX,
  leafY,
  neonPulse,
  noteAlpha,
  noteRise,
  noteSway,
  photoFlashAlpha,
  screenFlicker,
  seedUnit,
  slideIndex,
  torchFlicker,
  warmGlowBreath,
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

describe('场所演出的纯函数', () => {
  it('幻灯片按 holdMs 轮播、按张数回环，非法输入落回第一张', () => {
    expect(slideIndex(0, 3, 4000)).toBe(0);
    expect(slideIndex(3999, 3, 4000)).toBe(0);
    expect(slideIndex(4000, 3, 4000)).toBe(1);
    expect(slideIndex(12000, 3, 4000)).toBe(0);
    expect(slideIndex(12000, 0, 4000)).toBe(0);
    expect(slideIndex(Number.NaN, 3, 4000)).toBe(0);
    expect(slideIndex(500, 3, 0)).toBe(0);
  });

  it('摩天轮步进单调增、整圈回环，且总落在 0..steps-1', () => {
    const steps = 72;
    const period = 24000;
    let previous = ferrisStep(0, period, steps);
    for (let i = 1; i <= 240; i += 1) {
      const value = ferrisStep((i * period) / 240, period, steps);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(steps);
      // 一个周期内只能前进或回到 0，不允许倒退
      expect(value === 0 || value >= previous).toBe(true);
      previous = value;
    }
    expect(ferrisStep(0, period, steps)).toBe(0);
    expect(ferrisStep(period, period, steps)).toBe(0);
    expect(ferrisStep(period / 2, period, steps)).toBe(36);
    expect(ferrisStep(1000, 0, steps)).toBe(0);
  });

  it('彩灯在 0.15–1 之间逐颗错开相位，不会整排齐闪', () => {
    const values: number[] = [];
    for (let seed = 0; seed < 12; seed += 1) {
      for (let i = 0; i < 40; i += 1) {
        const value = bulbPulse(seed, i * step);
        expect(value).toBeGreaterThanOrEqual(0.15);
        expect(value).toBeLessThanOrEqual(1);
        values.push(value);
      }
    }
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5);
  });

  it('音符上浮走满 0..1，透明度首尾都归零', () => {
    for (let seed = 0; seed < 6; seed += 1) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < 120; i += 1) {
        const rise = noteRise(seed, i * 37);
        expect(rise).toBeGreaterThanOrEqual(0);
        expect(rise).toBeLessThan(1);
        min = Math.min(min, rise);
        max = Math.max(max, rise);
        const alpha = noteAlpha(seed, i * 37);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(0.9);
        expect(Math.abs(noteSway(seed, i * 37, 2))).toBeLessThanOrEqual(2);
      }
      expect(max - min).toBeGreaterThan(0.8);
    }
  });

  it('压暗层单调收敛到目标并吸附，非法 dt 不动', () => {
    let value = 0;
    let previous = value;
    for (let i = 0; i < 120; i += 1) {
      value = approachValue(value, 0.22, 16, 260);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(0.22);
      previous = value;
    }
    expect(value).toBe(0.22);
    expect(approachValue(0.1, 0.2, 0, 260)).toBe(0.1);
    expect(approachValue(0.1, 0.2, 16, 0)).toBe(0.2);
    expect(approachValue(Number.NaN, 0.2, 16, 260)).toBe(0.2);
  });

  it('相机闪光：起手不亮、中段最亮、到期归零', () => {
    expect(photoFlashAlpha(0, 420)).toBe(0);
    // 18% 处是满亮：420 × 0.18 = 75.6，取 76 正好进后半段的第一帧
    expect(photoFlashAlpha(76, 420)).toBeCloseTo(1, 2);
    expect(photoFlashAlpha(420, 420)).toBe(0);
    expect(photoFlashAlpha(420, 420)).toBe(0);
    expect(photoFlashAlpha(-1, 420)).toBe(0);
    expect(photoFlashAlpha(10, 0)).toBe(0);
    let peak = 0;
    for (let i = 0; i <= 420; i += 5) peak = Math.max(peak, photoFlashAlpha(i, 420));
    expect(peak).toBeGreaterThan(0.95);
  });
});

describe('室内状态美术的纯函数', () => {
  it('专注光只在 0.84–1.00 之间呼吸，不会闪成霓虹', () => {
    for (let i = 0; i < SAMPLES; i += 1) {
      const value = focusPulse(9, i * step);
      expect(value).toBeGreaterThanOrEqual(0.84);
      expect(value).toBeLessThanOrEqual(1);
      expect(focusPulse(9, i * step)).toBe(value);
    }
  });

  it('接触不良的顶灯平时常亮，只在周期末尾短暂断两下', () => {
    // 相位由种子派生，所以按「占空比」而不是按墙钟断言：
    // 一个 5.4s 周期里断闪只占几个百分点，其余时间必须是常亮
    let lit = 0;
    let dim = 0;
    const samples = 540;
    for (let i = 0; i < samples; i += 1) {
      const value = badContactFlicker(4, i * 10);
      expect(value === 1 || value < 0.5).toBe(true);
      if (value === 1) lit += 1;
      else dim += 1;
    }
    expect(lit / samples).toBeGreaterThan(0.9);
    expect(dim).toBeGreaterThan(0);
  });

  it('壁灯暖光在 0.55–1.00 之间缓慢呼吸，周期比烛火长', () => {
    const values: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const value = warmGlowBreath(6, i * step);
      expect(value).toBeGreaterThanOrEqual(0.55);
      expect(value).toBeLessThanOrEqual(1);
      values.push(value);
    }
    // 采样步长 137ms、共 240 点：两层正弦叠加不会恰好落在 0 与 1 上，读数抖动留 0.25 的下限
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.25);
  });

  it('亮屏代码行只输出 0 / 1 两帧，并会真的切换', () => {
    const phases = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const phase = codeLinePhase(11, i * 100);
      expect(phase === 0 || phase === 1).toBe(true);
      expect(codeLinePhase(11, i * 100)).toBe(phase);
      phases.add(phase);
    }
    expect(phases.size).toBe(2);
  });
});
