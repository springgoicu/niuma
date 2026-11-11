import { describe, expect, it } from 'bun:test';
import { ISLAND, NAV_TARGETS, SPAWN_CENTER, WORLD_CENTER, isBlocked } from '@niuma/shared-types';
import { NAV_CELL, findPath } from '../pathfinding';

const MAX_STEP = NAV_CELL * Math.SQRT2 + 0.001;

describe('园区自动寻路（ADR-0040）', () => {
  it('从北门出生点到四个设施都能找到路径', () => {
    for (const target of NAV_TARGETS) {
      const path = findPath(SPAWN_CENTER.x, SPAWN_CENTER.y, target.arrive.x, target.arrive.y);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(4);
    }
  });

  it('路径上的每个路点都能站人，相邻路点连续', () => {
    for (const target of NAV_TARGETS) {
      const path = findPath(SPAWN_CENTER.x, SPAWN_CENTER.y, target.arrive.x, target.arrive.y)!;
      for (const point of path) expect(isBlocked(point.x, point.y)).toBe(false);
      for (let i = 1; i < path.length; i += 1) {
        const step = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
        expect(step).toBeLessThanOrEqual(MAX_STEP);
      }
    }
  });

  it('最后一段落在房间内的到达点，而不是网格中心', () => {
    for (const target of NAV_TARGETS) {
      const path = findPath(SPAWN_CENTER.x, SPAWN_CENTER.y, target.arrive.x, target.arrive.y)!;
      const last = path[path.length - 1]!;
      expect(Math.hypot(last.x - target.arrive.x, last.y - target.arrive.y)).toBeLessThan(1);
    }
  });

  it('广场中心到四个设施同样可达', () => {
    for (const target of NAV_TARGETS) {
      expect(findPath(WORLD_CENTER.x, WORLD_CENTER.y, target.arrive.x, target.arrive.y)).not.toBeNull();
    }
  });

  it('已经在终点附近时不返回路点', () => {
    expect(findPath(SPAWN_CENTER.x, SPAWN_CENTER.y, SPAWN_CENTER.x, SPAWN_CENTER.y)).toEqual([]);
  });

  it('网格之外的终点不可达', () => {
    const outside = ISLAND.bounds;
    expect(findPath(SPAWN_CENTER.x, SPAWN_CENTER.y, outside.x - 200, outside.y - 200)).toBeNull();
  });
});
