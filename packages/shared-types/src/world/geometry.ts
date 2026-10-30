/**
 * 平面几何基元：布局生成与碰撞求解共用，避免两份「点在多边形内」的实现漂移。
 * 纯函数、无框架依赖，Bun / Node / 浏览器可直接引用。
 */

export type Point = readonly [number, number];

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectContains(rect: WorldRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function rectExpanded(rect: WorldRect, margin: number): WorldRect {
  return { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
}

export function pointInPolygon(x: number, y: number, points: ReadonlyArray<Point>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceSqToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x1 + dx * t - px;
  const ey = y1 + dy * t - py;
  return ex * ex + ey * ey;
}

/** 点到多边形边界的最短距离平方；落在内部时不用于判定，由 `pointInPolygon` 先拦 */
export function distanceSqToPolygon(x: number, y: number, points: ReadonlyArray<Point>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    const d = distanceSqToSegment(x, y, xj, yj, xi, yi);
    if (d < best) best = d;
  }
  return best;
}

export function polygonBounds(points: ReadonlyArray<Point>): WorldRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
