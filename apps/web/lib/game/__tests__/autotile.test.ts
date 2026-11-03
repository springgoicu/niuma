import { describe, expect, it } from 'bun:test';
import {
  CORNER_RADIUS,
  TILE,
  contourPolygon,
  contourSignedArea,
  fringeTeeth,
  offsetContour,
  organicContour,
  polygonContour,
  resampleContour,
  roundedRectContour,
  traceContour,
} from '../autotile';

const RECT = { x: 100, y: 200, w: 128, h: 540 };

describe('双网格轮廓', () => {
  it('采样格与圆角半径锁定在 32 / 16：整数栅格不许被改小', () => {
    expect(TILE).toBe(32);
    expect(CORNER_RADIUS).toBe(TILE / 2);
    expect(Number.isInteger(CORNER_RADIUS)).toBe(true);
  });

  it('圆角矩形不出现 90° 直角：四个角点都不在轮廓上', () => {
    const contour = roundedRectContour(RECT);
    const corners: Array<[number, number]> = [
      [RECT.x, RECT.y],
      [RECT.x + RECT.w, RECT.y],
      [RECT.x + RECT.w, RECT.y + RECT.h],
      [RECT.x, RECT.y + RECT.h],
    ];
    for (const [cx, cy] of corners) {
      expect(contour.some((point) => point.x === cx && point.y === cy)).toBe(false);
    }
    // 直边仍然贴边：没有把整个矩形圆成胶囊
    expect(contour.some((point) => point.y === RECT.y && point.x > RECT.x + CORNER_RADIUS)).toBe(true);
    expect(contour.some((point) => point.x === RECT.x && point.y > RECT.y + CORNER_RADIUS)).toBe(true);
  });

  it('轮廓闭合、顶点全在整纹素上、相邻点不重复', () => {
    const contour = roundedRectContour(RECT);
    for (const point of contour) {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
    for (let i = 1; i < contour.length; i += 1) {
      const same = contour[i]!.x === contour[i - 1]!.x && contour[i]!.y === contour[i - 1]!.y;
      expect(same).toBe(false);
    }
    const first = contour[0]!;
    const last = contour[contour.length - 1]!;
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThanOrEqual(CORNER_RADIUS * 2);
  });

  it('轮廓顺时针：有符号面积为正，外法线方向才有定义', () => {
    expect(contourSignedArea(roundedRectContour(RECT))).toBeGreaterThan(0);
  });

  it('所有顶点都落在矩形包围盒内', () => {
    for (const point of roundedRectContour(RECT)) {
      expect(point.x).toBeGreaterThanOrEqual(RECT.x);
      expect(point.x).toBeLessThanOrEqual(RECT.x + RECT.w);
      expect(point.y).toBeGreaterThanOrEqual(RECT.y);
      expect(point.y).toBeLessThanOrEqual(RECT.y + RECT.h);
    }
  });

  it('有机轮廓：同种子逐点一致，抖动不超过给定幅度', () => {
    const a = organicContour(RECT, 0x1234, 8);
    const b = organicContour(RECT, 0x1234, 8);
    expect(a).toEqual(b);

    const base = roundedRectContour(RECT);
    expect(a.length).toBe(base.length);
    for (let i = 0; i < a.length; i += 1) {
      const drift = Math.hypot(a[i]!.x - base[i]!.x, a[i]!.y - base[i]!.y);
      expect(drift).toBeLessThanOrEqual(8 + Math.SQRT2);
    }
  });

  it('有机轮廓换种子会换形状，不会退化成同一个矩形', () => {
    const a = organicContour(RECT, 1, 8);
    const b = organicContour(RECT, 2, 8);
    expect(a).not.toEqual(b);
  });

  it('草缘齿沿轮廓等距撒开，只有外部突起与内部凹口两档', () => {
    const contour = roundedRectContour(RECT);
    const teeth = fringeTeeth(contour, 6);
    const perimeter = 2 * (RECT.w + RECT.h) - (8 - 2 * Math.PI) * CORNER_RADIUS;
    expect(teeth.length).toBeGreaterThan(perimeter / 6 - 8);
    expect(teeth.length).toBeLessThan(perimeter / 6 + 8);
    for (const tooth of teeth) {
      expect(tooth.tone === 0 || tooth.tone === 1).toBe(true);
      // 齿只会离开轮廓 2px，不会变成一片毛刺
      expect(Math.abs(tooth.x - RECT.x - RECT.w / 2)).toBeLessThanOrEqual(RECT.w / 2 + 4);
    }
    expect(teeth.some((tooth) => tooth.tone === 1)).toBe(true);
    expect(teeth.some((tooth) => tooth.tone === 0)).toBe(true);
  });

  it('重采样按弧长等距，贴草缘不会一边密一边稀', () => {
    const points = resampleContour(roundedRectContour(RECT), 6);
    expect(points.length).toBeGreaterThan(100);
    for (let i = 1; i < points.length; i += 1) {
      const gap = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
      expect(gap).toBeLessThanOrEqual(8);
    }
  });

  it('traceContour 只 moveTo 一次，其余全是 lineTo', () => {
    const calls: string[] = [];
    traceContour(
      { moveTo: () => calls.push('m'), lineTo: () => calls.push('l'), closePath: () => calls.push('c') },
      roundedRectContour(RECT),
    );
    expect(calls.filter((call) => call === 'm').length).toBe(1);
    expect(calls[calls.length - 1]).toBe('c');
  });

  it('contourPolygon 拉平成偶数长度的数组', () => {
    const contour = roundedRectContour(RECT);
    const flat = contourPolygon(contour);
    expect(flat.length).toBe(contour.length * 2);
    expect(flat.length % 2).toBe(0);
  });
});

describe('多边形轮廓与偏移', () => {
  const SQUARE: Array<[number, number]> = [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
  ];
  const L_SHAPE: Array<[number, number]> = [
    [0, 0],
    [200, 0],
    [200, 80],
    [80, 80],
    [80, 200],
    [0, 200],
  ];

  it('凸角切成圆角：原顶点一个都没有留在轮廓上', () => {
    const contour = polygonContour(SQUARE, 12);
    for (const [x, y] of SQUARE) {
      expect(contour.some((point) => point.x === x && point.y === y)).toBe(false);
    }
    expect(contourSignedArea(contour)).toBeGreaterThan(0);
  });

  it('凹角保持尖角：L 形内转角不被磨圆，避免自交', () => {
    const contour = polygonContour(L_SHAPE, 12);
    expect(contour.some((point) => point.x === 80 && point.y === 80)).toBe(true);
  });

  it('顶点全在整数上，相邻点不重复，首尾落在同一条边上靠 closePath 收口', () => {
    const contour = polygonContour(SQUARE, 10);
    for (const point of contour) {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
    for (let i = 1; i < contour.length; i += 1) {
      const same = contour[i]!.x === contour[i - 1]!.x && contour[i]!.y === contour[i - 1]!.y;
      expect(same).toBe(false);
    }
    // 起点是第一条边的切点，终点是最后一条边的切点：两者都在 x = 0 的左边上
    expect(contour[0]!.x).toBe(0);
    expect(contour[contour.length - 1]!.x).toBe(0);
  });

  it('顶点不足三个原样返回，不抛异常', () => {
    expect(polygonContour([], 8)).toEqual([]);
    expect(polygonContour([[0, 0], [10, 10]], 8)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('轮廓偏移按法线整体外扩，包围盒同步变大', () => {
    const square = roundedRectContour({ x: 0, y: 0, w: 100, h: 100 }, 10);
    const expanded = offsetContour(square, 10);
    expect(Math.min(...expanded.map((point) => point.x))).toBe(-10);
    expect(Math.min(...expanded.map((point) => point.y))).toBe(-10);
    expect(Math.max(...expanded.map((point) => point.x))).toBe(110);
    expect(Math.max(...expanded.map((point) => point.y))).toBe(110);
  });

  it('偏移 0 返回副本，调用方改结果不会污染原轮廓', () => {
    const square = roundedRectContour({ x: 0, y: 0, w: 100, h: 100 }, 10);
    const copy = offsetContour(square, 0);
    expect(copy).toEqual(square);
    copy[0]!.x += 99;
    expect(square[0]!.x).not.toBe(copy[0]!.x);
  });
});
