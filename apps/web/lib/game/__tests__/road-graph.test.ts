import { describe, expect, it } from 'bun:test';
import { NAV_TARGETS, SPAWN_CENTER, districtById, isBlocked, rectContains } from '@niuma/shared-types';
import { WORLD_LAYOUT } from '@niuma/shared-types';
import { roadGraphSize, routeViaRoads } from '../road-graph';

/**
 * 路网节点图（ADR-0099）：自动导览先走马路，最后一段交给 A*。
 *
 * 这里钉三件事：图本身连通、路线每一段都走得过去（逐段采样 `isBlocked`）、
 * 路线把玩家带到目标所在大区的门口（而不是楼背后那个「直线更近」的节点）。
 */

/** 是否「深在楼里」：与构图时的判定同一口径（贴边的门洞允许） */
function deepInside(rect: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x > rect.x + 2 && x < rect.x + rect.w - 2 && y > rect.y + 2 && y < rect.y + rect.h - 2;
}

/** 一段折线是否处处可走：8px 采样，与构图时的校验同一口径 */
function walkable(x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (isBlocked(x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

/** 目标的区门：构图先验，`nav-route` 也会这么传 */
function gateOf(id: string) {
  const target = NAV_TARGETS.find((item) => item.id === id)!;
  return districtById(target.district).gate;
}

describe('路网节点图（ADR-0099）', () => {
  it('节点与边都建出来了，规模保持在「轻量」区间', () => {
    const { nodes, edges } = roadGraphSize();
    expect(nodes).toBeGreaterThanOrEqual(20);
    expect(nodes).toBeLessThanOrEqual(160);
    expect(edges).toBeGreaterThanOrEqual(20);
  });

  it('绝大多数导览目标都能给出沿路路线', () => {
    let routed = 0;
    for (const target of NAV_TARGETS) {
      const path = routeViaRoads(
        SPAWN_CENTER.x,
        SPAWN_CENTER.y,
        target.arrive.x,
        target.arrive.y,
        gateOf(target.id),
      );
      if (path === null) continue;
      routed += 1;
      expect(path.length).toBeGreaterThan(0);
    }
    // 摸鱼亭拆除后，剩下的目标全都在路网走廊的可达范围内
    expect(routed).toBe(NAV_TARGETS.length);
  });

  it('路线逐段可走，且不会把玩家领进屋里', () => {
    for (const target of NAV_TARGETS) {
      const path = routeViaRoads(
        SPAWN_CENTER.x,
        SPAWN_CENTER.y,
        target.arrive.x,
        target.arrive.y,
        gateOf(target.id),
      );
      if (path === null) continue;
      let x = SPAWN_CENTER.x;
      let y = SPAWN_CENTER.y;
      for (let i = 0; i < path.length; i += 1) {
        const point = path[i]!;
        expect(walkable(x, y, point.x, point.y), `${target.id} → (${point.x},${point.y})`).toBe(true);
        // 末点可能正是目标本身（游乐园的到达点就在园区门楼里），只校验中间的路点
        const isArrive = i === path.length - 1 && point.x === target.arrive.x && point.y === target.arrive.y;
        if (!isArrive) {
          for (const building of WORLD_LAYOUT.buildings) {
            expect(deepInside(building.rect, point.x, point.y), `${target.id} 的路点落在屋里`).toBe(false);
          }
        }
        x = point.x;
        y = point.y;
      }
    }
  });

  it('路线把玩家带到目标所在大区的门口附近', () => {
    for (const target of NAV_TARGETS) {
      const path = routeViaRoads(
        SPAWN_CENTER.x,
        SPAWN_CENTER.y,
        target.arrive.x,
        target.arrive.y,
        gateOf(target.id),
      );
      if (path === null) continue;
      const last = path[path.length - 1]!;
      // 最远也不该停在离目标 1600px 以外（那是地图另一头）
      expect(Math.hypot(last.x - target.arrive.x, last.y - target.arrive.y), target.id).toBeLessThan(1600);
    }
  });

  it('绕路有上限：图上代价不会超过直线距离的 3 倍 + 400', () => {
    for (const target of NAV_TARGETS) {
      const path = routeViaRoads(
        SPAWN_CENTER.x,
        SPAWN_CENTER.y,
        target.arrive.x,
        target.arrive.y,
        gateOf(target.id),
      );
      if (path === null) continue;
      const straight = Math.hypot(target.arrive.x - SPAWN_CENTER.x, target.arrive.y - SPAWN_CENTER.y);
      let length = 0;
      let x = SPAWN_CENTER.x;
      let y = SPAWN_CENTER.y;
      for (const point of path) {
        length += Math.hypot(point.x - x, point.y - y);
        x = point.x;
        y = point.y;
      }
      expect(length, target.id).toBeLessThanOrEqual(straight * 3 + 400 + 1);
    }
  });

  it('目标就在旁边时直接给出那一段，不绕去广场', () => {
    // 游乐大街西端到游乐园南门：同一片街面上，直线即可
    const target = NAV_TARGETS.find((item) => item.id === 'park')!;
    const fromX = 4036;
    const fromY = 3096;
    const path = routeViaRoads(fromX, fromY, target.arrive.x, target.arrive.y, gateOf(target.id))!;
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1]!;
    expect(Math.hypot(last.x - target.arrive.x, last.y - target.arrive.y)).toBeLessThan(1);
  });
});
