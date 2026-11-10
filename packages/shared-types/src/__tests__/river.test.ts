import { describe, expect, it } from 'vitest';
import { distanceSqToSegment, rectContains, type Point } from '../world/geometry';
import { RIVER_HALF_WIDTH, WORLD_LAYOUT, isOnLand, isWaterAt, regionAt } from '../world/layout';

const river = WORLD_LAYOUT.rivers[0]!;
const bridge = WORLD_LAYOUT.bridges[0]!;
const plaza = WORLD_LAYOUT.plaza;
const fence = WORLD_LAYOUT.fence.rect;

/** 严格相交：共享端点与共线不算交叉，正好用来验证闭合多边形没有自交 */
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

describe('河道几何', () => {
  it('两岸到中心线的距离恒为半河宽', () => {
    for (const bank of [river.leftBank, river.rightBank]) {
      for (const point of bank) {
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < river.centerline.length - 1; i += 1) {
          const from = river.centerline[i]!;
          const to = river.centerline[i + 1]!;
          const distance = distanceSqToSegment(point[0], point[1], from[0], from[1], to[0], to[1]);
          if (distance < best) best = distance;
        }
        expect(Math.abs(Math.sqrt(best) - RIVER_HALF_WIDTH)).toBeLessThan(5);
      }
    }
  });

  it('水面多边形闭合且没有自交', () => {
    const points = river.polygon;
    expect(points.length).toBeGreaterThan(40);
    expect(points.length).toBeLessThan(120);
    for (let i = 0; i < points.length; i += 1) {
      const a1 = points[i]!;
      const a2 = points[(i + 1) % points.length]!;
      expect(a1[0] === a2[0] && a1[1] === a2[1]).toBe(false);
      for (let j = i + 1; j < points.length; j += 1) {
        // 相邻边共享端点，首尾也相邻
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        expect(segmentsCross(a1, a2, points[j]!, points[(j + 1) % points.length]!)).toBe(false);
      }
    }
  });

  it('南北两端都探进海里，不再断在草地中央', () => {
    const north = river.centerline[0]!;
    const south = river.centerline[river.centerline.length - 1]!;
    expect(isOnLand(north[0], north[1])).toBe(false);
    expect(isOnLand(south[0], south[1])).toBe(false);
    // 入岛后的第一个站点必须在陆地上
    expect(isOnLand(river.centerline[1]![0], river.centerline[1]![1], 24)).toBe(true);
    expect(isWaterAt(north[0], north[1])).toBe(true);
    expect(isWaterAt(south[0], south[1])).toBe(true);
  });

  it('桥段水面完整落在桥面以内', () => {
    const rows = [bridge.y + 2, bridge.y + bridge.h / 2, bridge.y + bridge.h - 2];
    for (const y of rows) {
      let waterLeft = Number.POSITIVE_INFINITY;
      let waterRight = Number.NEGATIVE_INFINITY;
      for (let x = bridge.x - 200; x <= bridge.x + bridge.w + 200; x += 2) {
        if (!isWaterAt(x, y)) continue;
        if (x < waterLeft) waterLeft = x;
        if (x > waterRight) waterRight = x;
      }
      expect(waterLeft).toBeGreaterThan(bridge.x + 20);
      expect(waterRight).toBeLessThan(bridge.x + bridge.w - 20);
      expect(waterRight - waterLeft).toBeGreaterThan(RIVER_HALF_WIDTH);
    }
    expect(isWaterAt(bridge.x + bridge.w / 2, bridge.y + bridge.h / 2)).toBe(true);
  });

  it('河道不穿广场、围栏与土路', () => {
    for (const [x, y] of river.centerline) {
      expect(rectContains(plaza, x, y)).toBe(false);
      expect(rectContains(fence, x, y)).toBe(false);
      for (const path of WORLD_LAYOUT.paths) expect(rectContains(path, x, y)).toBe(false);
      for (const forest of WORLD_LAYOUT.forests) expect(rectContains(forest.rect, x, y)).toBe(false);
    }
  });

  it('河面归到「周报河」区域', () => {
    expect(regionAt(2500, 3000)).toBe('周报河');
    expect(regionAt(2500, 500)).toBe('周报河');
  });
});
