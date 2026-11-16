import { describe, expect, it } from 'bun:test';
import { capDpr, normalizeDpr, pixelMetrics, resolveDprCap } from '../game/pixel-scale';

describe('DPR 上限（应急自救开关）', () => {
  it('缺省不封顶：与改造前逐帧一致', () => {
    expect(resolveDprCap('')).toBe(0);
    expect(resolveDprCap('?light=0&zoom=2')).toBe(0);
    expect(resolveDprCap('?dpr=0')).toBe(0);
  });

  it('只认 1/2/3，其余一律回落到不封顶', () => {
    expect(resolveDprCap('?dpr=1')).toBe(1);
    expect(resolveDprCap('?dpr=2')).toBe(2);
    expect(resolveDprCap('?dpr=3')).toBe(3);
    for (const bogus of ['?dpr=', '?dpr=4', '?dpr=-1', '?dpr=1.5', '?dpr=abc', '?dpr=2x']) {
      expect(resolveDprCap(bogus)).toBe(0);
    }
  });

  it('capDpr 只往下压，不会把已有的低 DPR 抬上去', () => {
    expect(capDpr(3, 0)).toBe(3);
    expect(capDpr(3, 2)).toBe(2);
    expect(capDpr(2, 2)).toBe(2);
    expect(capDpr(1.25, 2)).toBe(1.25);
    expect(capDpr(normalizeDpr(Number.NaN), 2)).toBe(1);
  });
});

describe('像素度量不受封顶影响', () => {
  it('不封顶时度量完全按实测 DPR 走', () => {
    const metrics = pixelMetrics(1.5, 3, 3);
    // round(1.5 × 3) = 5 → cssScale = 5 / 3
    expect(metrics.devicePxPerTexel).toBe(5);
    expect(metrics.cssScale).toBeCloseTo(5 / 3, 6);
  });

  it('封顶两档后按封顶值整数化：像素块仍是整数设备像素', () => {
    const capped = pixelMetrics(1.5, capDpr(3, 2), 3);
    expect(capped.devicePxPerTexel).toBe(3);
    expect(capped.cssScale).toBe(1.5);
  });
});
