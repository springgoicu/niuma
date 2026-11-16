import { describe, expect, it } from 'bun:test';
import { NAV_TARGETS, SPAWN_CENTER, districtById, isBlocked } from '@niuma/shared-types';
import { planRoute } from '../nav-route';

/**
 * 自动导览的路线规划（ADR-0099）：先走马路、再进门口，尾段交给格子 A*。
 *
 * 这里只钉「结果能不能走通、末点落不落在到达点」，
 * 至于「走的是不是马路」由 `road-graph.test.ts` 单独看守。
 */

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

describe('自动导览路线规划（ADR-0099）', () => {
  it('出生点到 14 个目标都能规划出路线，且末点落在到达点', () => {
    for (const target of NAV_TARGETS) {
      const gate = districtById(target.district).gate;
      const path = planRoute(SPAWN_CENTER.x, SPAWN_CENTER.y, target.arrive.x, target.arrive.y, gate);
      expect(path, target.id).not.toBeNull();
      const last = path![path!.length - 1]!;
      expect(Math.hypot(last.x - target.arrive.x, last.y - target.arrive.y), target.id).toBeLessThan(1);
    }
  });

  it('路线的每一段都走得过去', () => {
    for (const target of NAV_TARGETS) {
      const gate = districtById(target.district).gate;
      const path = planRoute(SPAWN_CENTER.x, SPAWN_CENTER.y, target.arrive.x, target.arrive.y, gate)!;
      let x = SPAWN_CENTER.x;
      let y = SPAWN_CENTER.y;
      for (const point of path) {
        expect(walkable(x, y, point.x, point.y), `${target.id} → (${point.x},${point.y})`).toBe(true);
        x = point.x;
        y = point.y;
      }
    }
  });

  it('就在旁边时只给一个点，不必绕路', () => {
    const path = planRoute(SPAWN_CENTER.x, SPAWN_CENTER.y, SPAWN_CENTER.x + 60, SPAWN_CENTER.y)!;
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual({ x: SPAWN_CENTER.x + 60, y: SPAWN_CENTER.y });
  });

  it('回中央广场也能规划：终点就是出生点', () => {
    // 从生活大街西端走回广场
    const path = planRoute(3160, 5340, SPAWN_CENTER.x, SPAWN_CENTER.y);
    expect(path).not.toBeNull();
    const last = path![path!.length - 1]!;
    expect(Math.hypot(last.x - SPAWN_CENTER.x, last.y - SPAWN_CENTER.y)).toBeLessThan(1);
  });

  it('穿墙的目标不会给出直线：路线长度明显大于直线距离', () => {
    const target = NAV_TARGETS.find((item) => item.id === 'workroom')!;
    const gate = districtById(target.district).gate;
    const path = planRoute(SPAWN_CENTER.x, SPAWN_CENTER.y, target.arrive.x, target.arrive.y, gate)!;
    const straight = Math.hypot(target.arrive.x - SPAWN_CENTER.x, target.arrive.y - SPAWN_CENTER.y);
    let length = 0;
    let x = SPAWN_CENTER.x;
    let y = SPAWN_CENTER.y;
    for (const point of path) {
      length += Math.hypot(point.x - x, point.y - y);
      x = point.x;
      y = point.y;
    }
    expect(length).toBeGreaterThan(straight);
  });
});
