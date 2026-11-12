import { describe, expect, it } from 'bun:test';
import { PLAYER_RADIUS, isBlocked } from '@niuma/shared-types';
import { createRng } from './rng';
import { NPC_REGIONS, pickRegion, pickSpawnPoint, pickWaypoint, resolveRegions } from './spots';

describe('NPC 落点采样', () => {
  it('每个区域的采样点都站得住：不在墙里、不在海里、不在家具里', () => {
    for (const region of NPC_REGIONS) {
      const rng = createRng(region.id.length * 17 + 1);
      for (let index = 0; index < 40; index += 1) {
        const point = pickWaypoint(rng, region);
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(isBlocked(point.x, point.y, PLAYER_RADIUS)).toBe(false);
      }
    }
  });

  it('同一颗种子得到同一条路点序列：回归能复现「卡住」这类问题', () => {
    const region = NPC_REGIONS[0]!;
    const sample = () => {
      const rng = createRng(99);
      return Array.from({ length: 5 }, () => pickWaypoint(rng, region, { x: 4096, y: 4096 }));
    };
    expect(sample()).toEqual(sample());
  });

  it('离当前位置太近的落点会被拒绝，不会原地打转', () => {
    const region = NPC_REGIONS[0]!;
    const rng = createRng(21);
    const from = { x: region.x, y: region.y };
    let farEnough = 0;
    for (let index = 0; index < 30; index += 1) {
      const point = pickWaypoint(rng, region, from);
      const distance = Math.hypot(point.x - from.x, point.y - from.y);
      // 采样点落在圆心附近时最后两次会放宽，但绝大多数必须走出至少 80px
      if (distance >= 80) farEnough += 1;
    }
    expect(farEnough).toBeGreaterThanOrEqual(24);
  });

  it('出生点同样可行走，且不会落在区域外太远', () => {
    for (const region of NPC_REGIONS) {
      const rng = createRng(region.id.length + 3);
      for (let index = 0; index < 20; index += 1) {
        const point = pickSpawnPoint(rng, region);
        expect(isBlocked(point.x, point.y, PLAYER_RADIUS)).toBe(false);
      }
    }
  });

  it('加权抽样把最多落点分给广场，保证进场就能看到同事', () => {
    const rng = createRng(1);
    const counts = new Map<string, number>();
    for (let index = 0; index < 1_000; index += 1) {
      const region = pickRegion(rng, NPC_REGIONS);
      counts.set(region.id, (counts.get(region.id) ?? 0) + 1);
    }
    const plaza = counts.get('plaza') ?? 0;
    expect(plaza).toBeGreaterThan(250);
    for (const region of NPC_REGIONS) {
      if (region.id === 'plaza') continue;
      expect(counts.get(region.id) ?? 0).toBeLessThan(plaza);
    }
  });

  it('配置覆盖：权重 0 停用区域，全部停用时退回默认表', () => {
    const withoutPlaza = resolveRegions([{ id: 'plaza', weight: 0, radius: 400 }]);
    expect(withoutPlaza.some((region) => region.id === 'plaza')).toBe(false);
    expect(withoutPlaza.length).toBe(NPC_REGIONS.length - 1);

    const allOff = resolveRegions(
      NPC_REGIONS.map((region) => ({ id: region.id, weight: 0, radius: region.radius })),
    );
    expect(allOff.length).toBe(NPC_REGIONS.length);
  });

  it('未知区域 id 与越界半径被静默钳制，不阻断开服', () => {
    const merged = resolveRegions([
      { id: 'unknown', weight: 5, radius: 300 },
      { id: 'plaza', weight: 2, radius: 100 },
    ]);
    expect(merged.some((region) => region.id === 'unknown')).toBe(false);
    const plaza = merged.find((region) => region.id === 'plaza')!;
    expect(plaza.weight).toBe(2);
    expect(plaza.radius).toBeGreaterThanOrEqual(120);
  });
});
