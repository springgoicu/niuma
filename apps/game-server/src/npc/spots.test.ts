import { describe, expect, it } from 'bun:test';
import { PLAYER_RADIUS, WORLD_BOUNDS, isBlocked } from '@niuma/shared-types';
import { createRng } from './rng';
import { pickSpawnPoint, pickWaypoint } from './spots';

describe('NPC 全岛落点采样', () => {
  it('采样点都站得住：不在墙里、不在海里、不在家具里', () => {
    const rng = createRng(17);
    for (let index = 0; index < 200; index += 1) {
      const point = pickWaypoint(rng);
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(isBlocked(point.x, point.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it('采样覆盖整座岛，而不是挤在广场附近', () => {
    const rng = createRng(5);
    const points = Array.from({ length: 200 }, () => pickWaypoint(rng));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(WORLD_BOUNDS.w * 0.5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(WORLD_BOUNDS.h * 0.5);
  });

  it('同一颗种子得到同一条路点序列：回归能复现「卡住」这类问题', () => {
    const sample = () => {
      const rng = createRng(99);
      return Array.from({ length: 5 }, () => pickWaypoint(rng, { x: 4096, y: 4096 }));
    };
    expect(sample()).toEqual(sample());
  });

  it('离当前位置太近的落点会被拒绝，不会原地打转', () => {
    const rng = createRng(21);
    const from = { x: 4096, y: 4096 };
    let farEnough = 0;
    for (let index = 0; index < 30; index += 1) {
      const point = pickWaypoint(rng, from);
      if (Math.hypot(point.x - from.x, point.y - from.y) >= 240) farEnough += 1;
    }
    expect(farEnough).toBeGreaterThanOrEqual(24);
  });

  it('出生点同样可行走，并与其他同事保持距离', () => {
    const rng = createRng(3);
    const placed: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < 5; index += 1) {
      const point = pickSpawnPoint(rng, placed);
      expect(isBlocked(point.x, point.y, PLAYER_RADIUS)).toBe(false);
      for (const other of placed) {
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(160);
      }
      placed.push(point);
    }
  });
});
