'use client';

import { PLAYER_RADIUS, isBlocked, isWaterAt } from '@niuma/shared-types';
import { findPath, type PathPoint } from './pathfinding';
import { routeViaRoads } from './road-graph';

/**
 * 自动导览的路线规划（ADR-0099）：**先走马路，再进门口**。
 *
 * 三层，从便宜到昂贵：
 * 1. 直线可走且不涉水 → 一个点，最省事（同房间、同街面）；
 * 2. 路网节点图 → 沿真正的道路走到目标所在大区的门口；
 * 3. 图路线尾段被墙挡住 → 从最后一个路点跑一次格子 A* 收口。
 *
 * 图给不出路线（起点被墙围住、目标在开阔草地深处）时整体回退到 A*，
 * 因此这里的返回值语义与 `findPath` 一致：`null` = 真的过不去。
 */

/** 直线探针的采样步长 */
const LINE_STEP = 8;

/** 两点之间能不能直接走过去：既要不撞墙，也不该为了抄近路横穿湖面 */
function straightClear(x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;
  const steps = Math.ceil(distance / LINE_STEP);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    if (isBlocked(x, y, PLAYER_RADIUS)) return false;
    if (isWaterAt(x, y)) return false;
  }
  return true;
}

/**
 * 规划一条到 `(toX, toY)` 的路线（不含起点）。
 *
 * `approach` 是目标所在大区的区门：只在「目标在墙里、图上看不见它」时起作用，
 * 用来把「最后一段」对齐到门口那一侧，而不是楼背后那个直线更近的节点。
 */
export function planRoute(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  approach?: { readonly x: number; readonly y: number },
): PathPoint[] | null {
  if (straightClear(fromX, fromY, toX, toY)) return [{ x: toX, y: toY }];

  const viaRoads = routeViaRoads(fromX, fromY, toX, toY, approach);
  if (viaRoads && viaRoads.length > 0) {
    const last = viaRoads[viaRoads.length - 1]!;
    const remaining = Math.hypot(last.x - toX, last.y - toY);
    if (remaining < 1) return viaRoads;
    // 尾段：从最后一个路点收口。室内目标、门口台阶都靠这一步
    const tail = findPath(last.x, last.y, toX, toY);
    if (tail !== null && tail.length > 0) {
      for (const point of tail) viaRoads.push(point);
      return viaRoads;
    }
    // 收不了口（目标在墙里、A* 也到不了）：距离够近就停在门口，否则整体回退
    if (tail !== null || remaining <= 32) return viaRoads;
  }

  return findPath(fromX, fromY, toX, toY);
}
