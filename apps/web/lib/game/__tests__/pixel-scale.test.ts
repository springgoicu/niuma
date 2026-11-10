import { describe, expect, it } from 'bun:test';
import { fitMetrics, pixelMetrics } from '../pixel-scale';

/** 角色站立高（纹素）：ADR-0010 的基准 */
const BODY_TEXELS = 48;

describe('大厅倍率的纹素下限', () => {
  it('DPR 1 传下限 2：真的能缩到 2 设备像素，不被默认下限夹回去', () => {
    const metrics = pixelMetrics(1.5, 1, 2);
    expect(metrics.devicePxPerTexel).toBe(2);
    expect(metrics.cssScale).toBe(2);
  });

  it('DPR 2 落在 1.5 CSS/纹素：角色 72px', () => {
    const metrics = pixelMetrics(1.5, 2, 2);
    expect(metrics.devicePxPerTexel).toBe(3);
    expect(metrics.cssScale).toBe(1.5);
    expect(metrics.cssScale * BODY_TEXELS).toBe(72);
  });

  it('各档 DPR 都保持整数设备像素，角色高度落在 64–96', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]) {
      const metrics = pixelMetrics(1.5, dpr, 2);
      expect(Number.isInteger(metrics.devicePxPerTexel)).toBe(true);
      expect(metrics.devicePxPerTexel).toBeGreaterThanOrEqual(2);
      expect(metrics.cssScale * metrics.dpr).toBeCloseTo(metrics.devicePxPerTexel, 9);
      const height = metrics.cssScale * BODY_TEXELS;
      expect(height).toBeGreaterThanOrEqual(64);
      expect(height).toBeLessThanOrEqual(96);
    }
  });

  it('下限不会突破防呆上限', () => {
    expect(pixelMetrics(1.5, 1, 1000).devicePxPerTexel).toBe(24);
    expect(pixelMetrics(1.5, 1, Number.NaN).devicePxPerTexel).toBe(3);
  });
});

describe('默认下限不污染预览台', () => {
  it('不传下限时仍是 3 起步', () => {
    expect(pixelMetrics(1.5, 1).devicePxPerTexel).toBe(3);
    expect(pixelMetrics(1, 1).devicePxPerTexel).toBe(3);
  });

  it('fitMetrics 的结果不受大厅下限影响', () => {
    for (const dpr of [1, 1.5, 2, 2.75, 3]) {
      for (const base of [5, 2.4, 1.5]) {
        const metrics = fitMetrics(base, dpr);
        expect(metrics.devicePxPerTexel).toBeGreaterThanOrEqual(3);
        expect(metrics.cssScale * metrics.dpr).toBeCloseTo(metrics.devicePxPerTexel, 9);
      }
    }
  });
});
