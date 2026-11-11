import { describe, expect, it } from 'vitest';
import { distanceSqToSegment, rectContains, type Point } from '../world/geometry';
import {
  CREEK_HALF_WIDTH,
  PARK_CANAL_HALF_WIDTH,
  RIVER_HALF_WIDTH,
  WORLD_LAYOUT,
  isOnBridge,
  isOnLand,
  isWaterAt,
  regionAt,
} from '../world/layout';

const river = WORLD_LAYOUT.rivers[0]!;
const creek = WORLD_LAYOUT.rivers[1]!;
const canal = WORLD_LAYOUT.rivers[2]!;
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

/** 一条中心线到岸边折线的最大偏差：两岸到中心线的距离应恒等于半宽 */
function expectHalfWidth(shape: typeof river, halfWidth: number): void {
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

describe('河道几何', () => {
  it('三条河的两岸到中心线距离恒为半河宽', () => {
    expectHalfWidth(river, RIVER_HALF_WIDTH);
    expectHalfWidth(creek, CREEK_HALF_WIDTH);
    expectHalfWidth(canal, PARK_CANAL_HALF_WIDTH);
  });

  it('三条水面的多边形闭合且没有自交', () => {
    for (const shape of [river, creek, canal]) {
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

  it('护园溪两端都汇进晨会溪，围出一个闭合水环', () => {
    const first = canal.centerline[0]!;
    const last = canal.centerline[canal.centerline.length - 1]!;
    expect(isWaterAt(first[0], first[1])).toBe(true);
    expect(isWaterAt(last[0], last[1])).toBe(true);
    // 三面环水：西臂、北臂、东臂都在院落外缘
    expect(isWaterAt(3200, 3800)).toBe(true);
    expect(isWaterAt(4096, 3230)).toBe(true);
    expect(isWaterAt(4992, 3800)).toBe(true);
    // 院落内部保持干燥
    expect(isWaterAt(4096, 4096)).toBe(false);
  });

  it('每座桥都盖住脚下水面：至少一个轴向的水面完整落在桥面里', () => {
    for (const bridge of WORLD_LAYOUT.bridges) {
      const cx = bridge.x + bridge.w / 2;
      const cy = bridge.y + bridge.h / 2;
      expect(isWaterAt(cx, cy)).toBe(true);
      expect(isOnBridge(cx, cy)).toBe(true);

      // 沿 x 扫描：水面左右都落在桥面内（东西向通行）
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      for (let x = bridge.x - 200; x <= bridge.x + bridge.w + 200; x += 2) {
        if (!isWaterAt(x, cy)) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
      const crossX = left > bridge.x + 10 && right < bridge.x + bridge.w - 10 && right - left > 20;

      // 沿 y 扫描：水面上边与下边都落在桥面内（南北向通行）
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (let y = bridge.y - 200; y <= bridge.y + bridge.h + 200; y += 2) {
        if (!isWaterAt(cx, y)) continue;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
      const crossY = top > bridge.y + 10 && bottom < bridge.y + bridge.h - 10 && bottom - top > 20;

      expect(crossX || crossY).toBe(true);
    }
  });

  it('河道不穿广场与办公区，跨路处必须落在桥面内', () => {
    for (const shape of [river, creek, canal]) {
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
    expect(regionAt(3200, 3800)).toBe('护园溪');
    expect(regionAt(4992, 3800)).toBe('护园溪');
  });
});
