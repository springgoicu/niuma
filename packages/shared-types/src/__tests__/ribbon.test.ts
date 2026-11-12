import { describe, expect, it } from 'vitest';
import { distanceSqToSegment, polygonBounds, type Point } from '../world/geometry';
import { buildRibbon } from '../world/ribbon';

/**
 * 带状几何（土路 / 未来的任何线性景观）：
 * 两侧岸线到中心线的距离必须恒等于半宽，闭合多边形不能自交。
 * 同一份输入必须逐位一致——服务端、客户端、小地图共用这一份结果。
 */

function expectHalfWidth(shape: ReturnType<typeof buildRibbon>, halfWidth: number): void {
  for (const bank of [shape.leftBank, shape.rightBank]) {
    for (const point of bank) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < shape.centerline.length - 1; i += 1) {
        const from = shape.centerline[i]!;
        const to = shape.centerline[i + 1]!;
        const distance = distanceSqToSegment(point[0], point[1], from[0], from[1], to[0], to[1]);
        if (distance < best) best = distance;
      }
      expect(Math.abs(Math.sqrt(best) - halfWidth)).toBeLessThan(5);
    }
  }
}

function cross(ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = cross(a1[0], a1[1], a2[0], a2[1], b1[0], b1[1]);
  const d2 = cross(a1[0], a1[1], a2[0], a2[1], b2[0], b2[1]);
  const d3 = cross(b1[0], b1[1], b2[0], b2[1], a1[0], a1[1]);
  const d4 = cross(b1[0], b1[1], b2[0], b2[1], a2[0], a2[1]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function expectNoSelfIntersection(points: Point[]): void {
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % points.length]!;
    expect(a1[0] === a2[0] && a1[1] === a2[1]).toBe(false);
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      expect(segmentsCross(a1, a2, points[j]!, points[(j + 1) % points.length]!)).toBe(false);
    }
  }
}

describe('带状几何', () => {
  // 缓弯：90° 折角的斜接点会自然伸到顶点外侧，用缓弯验证「岸线到中心线 = 半宽」
  const straight = buildRibbon(
    [
      [100, 100],
      [300, 100],
      [500, 140],
    ],
    40,
  );

  it('两岸到中心线的距离恒为半宽', () => {
    expectHalfWidth(straight, 40);
  });

  it('闭合多边形没有自交，包围盒覆盖全部顶点', () => {
    expect(straight.polygon.length).toBeGreaterThanOrEqual(6);
    expectNoSelfIntersection(straight.polygon);
    const bounds = polygonBounds(straight.polygon);
    expect(bounds).toEqual(straight.rect);
    for (const [x, y] of straight.polygon) {
      expect(x).toBeGreaterThanOrEqual(bounds.x);
      expect(x).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(y).toBeGreaterThanOrEqual(bounds.y);
      expect(y).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });

  it('同一输入逐位一致：双端不会各画一条路', () => {
    const again = buildRibbon(
      [
        [100, 100],
        [300, 100],
        [500, 140],
      ],
      40,
    );
    expect(again).toEqual(straight);
  });

  it('站点不足或半宽非法时直接抛错', () => {
    expect(() => buildRibbon([[0, 0]], 20)).toThrow();
    expect(() => buildRibbon([[0, 0], [10, 10]], 0)).toThrow();
  });
});
