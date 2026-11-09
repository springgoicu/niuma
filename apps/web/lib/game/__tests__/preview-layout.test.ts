import { describe, expect, it } from 'bun:test';
import { BASE_CSS_PER_TEXEL as BASE, GROUND_TEXELS, layoutPreview, VISUAL_TEXELS } from '../preview-layout';
import { SPRITE_LAYOUT } from '../sprite-layout.generated';

const BODY = SPRITE_LAYOUT.origin.y;

/** 视觉盒上下边界：头顶与台座底 */
function edges(height: number, dpr: number, width = 390) {
  const { footY, metrics } = layoutPreview({ width, height }, BASE, dpr);
  return { top: footY - BODY * metrics.cssScale, bottom: footY + GROUND_TEXELS * metrics.cssScale };
}

describe('预览台自适应布局', () => {
  it('矮屏 300px 角色完整可见，头顶与台座都不出界', () => {
    for (const dpr of [1, 2, 2.75, 3]) {
      const { top, bottom } = edges(300, dpr);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(300.5);
    }
  });

  it('视觉盒垂直居中：上下留白差不超过 1px', () => {
    for (const height of [240, 300, 360, 420, 540]) {
      for (const dpr of [2, 3]) {
        const { top, bottom } = edges(height, dpr);
        expect(Math.abs(top - (height - bottom))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('容器够高时回到基准倍率 5，桌面版式不变', () => {
    const desktop = layoutPreview({ width: 900, height: 420 }, BASE, 2);
    expect(desktop.metrics.cssScale).toBe(BASE);
    expect(desktop.scaleRatio).toBe(1);
  });

  it('每纹素始终是整数设备像素', () => {
    for (const dpr of [1, 1.5, 2, 2.625, 3, 4]) {
      for (const height of [120, 200, 300, 420, 800]) {
        const { metrics } = layoutPreview({ width: 390, height }, BASE, dpr);
        expect(Number.isInteger(metrics.devicePxPerTexel)).toBe(true);
        expect(metrics.cssScale * metrics.dpr).toBeCloseTo(metrics.devicePxPerTexel, 9);
        expect(metrics.devicePxPerTexel).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('窄容器不超宽：角色宽度不超过可用宽度', () => {
    for (const width of [240, 280, 320, 390]) {
      const { metrics } = layoutPreview({ width, height: 640 }, BASE, 3);
      expect(SPRITE_LAYOUT.frame.w * metrics.cssScale).toBeLessThanOrEqual(width);
    }
  });

  it('极矮容器仍给出正倍率，不抛错', () => {
    const { metrics, footX, footY } = layoutPreview({ width: 320, height: 120 }, BASE, 2);
    expect(metrics.cssScale).toBeGreaterThan(0);
    expect(Number.isFinite(footX)).toBe(true);
    expect(Number.isFinite(footY)).toBe(true);
  });

  it('零尺寸 / 负尺寸回落到 0 坐标，等 ResizeObserver 修正', () => {
    for (const box of [{ width: 0, height: 0 }, { width: -10, height: -10 }]) {
      const placement = layoutPreview(box, BASE, 3);
      expect(placement.footX).toBe(0);
      expect(placement.footY).toBe(0);
      expect(Number.isInteger(placement.metrics.devicePxPerTexel)).toBe(true);
    }
  });

  it('水平居中：脚底落在容器中线（吸附到设备像素内）', () => {
    for (const width of [320, 375, 390, 768]) {
      const { footX, metrics } = layoutPreview({ width, height: 420 }, BASE, 3);
      expect(Math.abs(footX - width / 2)).toBeLessThanOrEqual(1 / metrics.dpr);
    }
  });

  it('纯函数：同输入同输出', () => {
    const box = { width: 375, height: 300 };
    expect(layoutPreview(box, BASE, 3)).toEqual(layoutPreview(box, BASE, 3));
  });

  it('视觉盒定义覆盖角色：身体 + 地面 = 65 纹素', () => {
    expect(VISUAL_TEXELS).toBe(BODY + GROUND_TEXELS);
    expect(VISUAL_TEXELS).toBe(65);
  });
});
