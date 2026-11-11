import { describe, expect, it } from 'bun:test';
import { fitMetrics, pixelMetrics, PORTRAIT_TARGET_TEXELS, worldCssPerTexel } from '../pixel-scale';

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

describe('竖屏取景倍率（worldCssPerTexel）', () => {
  it('横屏与宽窗口保持基准倍率', () => {
    expect(worldCssPerTexel(844, 390, 1.5)).toBe(1.5);
    expect(worldCssPerTexel(1440, 900, 1.5)).toBe(1.5);
    expect(worldCssPerTexel(390, 390, 1.5)).toBe(1.5);
  });

  it('竖屏按屏宽反推到目标纹素，且不超过基准', () => {
    const next = worldCssPerTexel(390, 844, 1.5);
    expect(next).toBeLessThan(1.5);
    expect(390 / next).toBeCloseTo(PORTRAIT_TARGET_TEXELS, 9);
    for (const width of [320, 360, 390, 414, 430]) {
      const value = worldCssPerTexel(width, 900, 1.5);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(1.5);
    }
  });

  it('平板竖屏（宽 ≥ 目标纹素）不降倍率', () => {
    expect(worldCssPerTexel(768, 1024, 1.5)).toBe(1.5);
  });

  it('零尺寸 / 非法目标纹素回落到基准', () => {
    expect(worldCssPerTexel(0, 844, 1.5)).toBe(1.5);
    expect(worldCssPerTexel(390, 0, 1.5)).toBe(1.5);
    expect(worldCssPerTexel(Number.NaN, 844, 1.5)).toBe(1.5);
    expect(worldCssPerTexel(390, 844, 1.5, 0)).toBe(1.5);
  });

  it('常见手机 DPR 取整后仍能看到 340+ 横向纹素', () => {
    for (const dpr of [2, 2.625, 3]) {
      const metrics = pixelMetrics(worldCssPerTexel(390, 844, 1.5), dpr, 2);
      expect(Number.isInteger(metrics.devicePxPerTexel)).toBe(true);
      expect(390 / metrics.cssScale).toBeGreaterThanOrEqual(340);
    }
  });
});
