import { describe, expect, it } from 'vitest';
import { distanceSqToSegment, rectContains, type Point } from '../world/geometry';
import {
  CREEK_HALF_WIDTH,
  RIVER_HALF_WIDTH,
  WORLD_LAYOUT,
  isOnBridge,
  isOnLand,
  isWaterAt,
  regionAt,
} from '../world/layout';

const river = WORLD_LAYOUT.rivers[0]!;
const creek = WORLD_LAYOUT.rivers[1]!;
const plaza = WORLD_LAYOUT.plaza;
const office = WORLD_LAYOUT.office;

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

function expectNoSelfIntersection(points: Point[]): void {
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
}

describe('河道几何', () => {
  it('主河两岸到中心线的距离恒为半河宽', () => {
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

  it('晨会溪两岸到中心线的距离恒为半溪宽', () => {
    for (const bank of [creek.leftBank, creek.rightBank]) {
      for (const point of bank) {
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < creek.centerline.length - 1; i += 1) {
          const from = creek.centerline[i]!;
          const to = creek.centerline[i + 1]!;
          const distance = distanceSqToSegment(point[0], point[1], from[0], from[1], to[0], to[1]);
          if (distance < best) best = distance;
        }
        expect(Math.abs(Math.sqrt(best) - CREEK_HALF_WIDTH)).toBeLessThan(5);
      }
    }
  });

  it('两条水面的多边形闭合且没有自交', () => {
    for (const shape of [river, creek]) {
      expect(shape.polygon.length).toBeGreaterThan(12);
      expect(shape.polygon.length).toBeLessThan(120);
      expectNoSelfIntersection(shape.polygon);
    }
  });

  it('主河南北两端都探进海里，不再断在草地中央', () => {
    const north = river.centerline[0]!;
    const south = river.centerline[river.centerline.length - 1]!;
    expect(isOnLand(north[0], north[1])).toBe(false);
    expect(isOnLand(south[0], south[1])).toBe(false);
    // 入岛后的第一个站点必须在陆地上
    expect(isOnLand(river.centerline[1]![0], river.centerline[1]![1], 24)).toBe(true);
    expect(isWaterAt(north[0], north[1])).toBe(true);
    expect(isWaterAt(south[0], south[1])).toBe(true);
  });

  it('晨会溪两端都在水里（从主河分出、汇进东湾）', () => {
    const first = creek.centerline[0]!;
    const last = creek.centerline[creek.centerline.length - 1]!;
    expect(isWaterAt(first[0], first[1])).toBe(true);
    expect(isWaterAt(last[0], last[1])).toBe(true);
  });

  it('桥面完整覆盖水面，栏杆方向随通行方向', () => {
    for (const bridge of WORLD_LAYOUT.bridges) {
      const vertical = bridge.h > bridge.w;
      if (vertical) {
        for (const x of [bridge.x + 2, bridge.x + bridge.w / 2, bridge.x + bridge.w - 2]) {
          let top = Number.POSITIVE_INFINITY;
          let bottom = Number.NEGATIVE_INFINITY;
          for (let y = bridge.y - 200; y <= bridge.y + bridge.h + 200; y += 2) {
            if (!isWaterAt(x, y)) continue;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
          expect(top).toBeGreaterThan(bridge.y + 20);
          expect(bottom).toBeLessThan(bridge.y + bridge.h - 20);
        }
      } else {
        for (const y of [bridge.y + 2, bridge.y + bridge.h / 2, bridge.y + bridge.h - 2]) {
          let left = Number.POSITIVE_INFINITY;
          let right = Number.NEGATIVE_INFINITY;
          for (let x = bridge.x - 200; x <= bridge.x + bridge.w + 200; x += 2) {
            if (!isWaterAt(x, y)) continue;
            if (x < left) left = x;
            if (x > right) right = x;
          }
          expect(left).toBeGreaterThan(bridge.x + 20);
          expect(right).toBeLessThan(bridge.x + bridge.w - 20);
          expect(right - left).toBeGreaterThan(RIVER_HALF_WIDTH);
        }
      }
      expect(isWaterAt(bridge.x + bridge.w / 2, bridge.y + bridge.h / 2)).toBe(true);
    }
  });

  it('河道不穿广场与办公区，跨路处必须落在桥面内', () => {
    for (const shape of [river, creek]) {
      for (const [x, y] of shape.centerline) {
        expect(rectContains(plaza, x, y)).toBe(false);
        expect(rectContains(office, x, y)).toBe(false);
        for (const path of WORLD_LAYOUT.paths) {
          if (!rectContains(path, x, y)) continue;
          expect(isOnBridge(x, y)).toBe(true);
        }
        for (const forest of WORLD_LAYOUT.forests) expect(rectContains(forest.rect, x, y)).toBe(false);
      }
    }
  });

  it('河面归到各自的区域名', () => {
    expect(regionAt(2712, 3000)).toBe('周报河');
    expect(regionAt(3050, 4940)).toBe('晨会溪');
  });
});
