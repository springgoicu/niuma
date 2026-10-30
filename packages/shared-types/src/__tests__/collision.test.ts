import { describe, expect, it } from 'vitest';
import { findFreePoint, isBlocked, resolveMotion } from '../world/collision';
import { pointInPolygon, rectContains } from '../world/geometry';
import { WORLD_CENTER, WORLD_LAYOUT, regionAt } from '../world/layout';

const CENTER = WORLD_CENTER;
const FENCE = WORLD_LAYOUT.fence.rect;
const SOUTH = FENCE.y + FENCE.h;
const NORTH = FENCE.y;
const EAST = FENCE.x + FENCE.w;
const WEST = FENCE.x;

describe('围栏与门洞', () => {
  it('四个门洞都能穿过围栏', () => {
    const south = resolveMotion(CENTER.x, SOUTH - 60, CENTER.x, SOUTH + 60);
    expect(south.y).toBeGreaterThan(SOUTH);

    const north = resolveMotion(CENTER.x, NORTH + 60, CENTER.x, NORTH - 60);
    expect(north.y).toBeLessThan(NORTH);

    const east = resolveMotion(EAST - 60, CENTER.y, EAST + 60, CENTER.y);
    expect(east.x).toBeGreaterThan(EAST);

    const west = resolveMotion(WEST + 60, CENTER.y, WEST - 60, CENTER.y);
    expect(west.x).toBeLessThan(WEST);
  });

  it('门洞之外的栏板挡住去路', () => {
    const result = resolveMotion(3800, SOUTH - 80, 3800, SOUTH + 120);
    expect(result.y).toBeLessThan(SOUTH);
    expect(result.y).toBeGreaterThan(SOUTH - 30);
  });

  it('贴着栏板会沿墙滑动而不是卡死', () => {
    const result = resolveMotion(3800, SOUTH - 40, 3960, SOUTH + 80);
    expect(result.x).toBeGreaterThan(3950);
    expect(result.y).toBeLessThan(SOUTH);
  });
});

describe('水体', () => {
  it('湖面不可进入', () => {
    const result = resolveMotion(5700, 4780, 5700, 5300);
    expect(result.y).toBeLessThan(4880);
  });

  it('桥面可以过河', () => {
    const result = resolveMotion(2650, 4096, 2950, 4096);
    expect(result.x).toBeGreaterThan(2940);
  });

  it('桥面以外的河段挡人', () => {
    const result = resolveMotion(2650, 3500, 3000, 3500);
    expect(result.x).toBeLessThan(2720);
  });
});

describe('出生点与坐标兜底', () => {
  it('中心 240px 内的随机出生点都能落到空地上', () => {
    let seed = 0x1f2e3d4c;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i += 1) {
      const angle = next() * Math.PI * 2;
      const distance = Math.sqrt(next()) * 240;
      const x = CENTER.x + Math.cos(angle) * distance;
      const y = CENTER.y + Math.sin(angle) * distance;
      // 花箱就摆在出生点四周，服务端也是先采样再就近挪到空地
      const spawn = findFreePoint(x, y);
      expect(isBlocked(spawn.x, spawn.y)).toBe(false);
      expect(Math.hypot(spawn.x - x, spawn.y - y)).toBeLessThan(120);
    }
  });

  it('广场花箱挡人', () => {
    for (const planter of WORLD_LAYOUT.planters) {
      expect(isBlocked(planter.x, planter.y)).toBe(true);
    }
  });

  it('非有限坐标不污染结果', () => {
    expect(resolveMotion(1000, 1000, Number.NaN, Number.NaN)).toEqual({ x: 1000, y: 1000 });
    expect(isBlocked(Number.NaN, 0)).toBe(true);
  });
});

describe('地形布局', () => {
  it('区域名按优先级命中', () => {
    expect(regionAt(CENTER.x, CENTER.y)).toBe('办公区');
    expect(regionAt(5700, 5300)).toBe('摸鱼湖');
    expect(regionAt(2075, 1850)).toBe('加班林');
    expect(regionAt(600, 600)).toBe('园区野地');
  });

  it('树木不会长进广场、水面与道路上', () => {
    for (const forest of WORLD_LAYOUT.forests) {
      for (const tree of forest.trees) {
        expect(rectContains(WORLD_LAYOUT.plaza, tree.x, tree.y)).toBe(false);
        expect(rectContains(WORLD_LAYOUT.fence.rect, tree.x, tree.y)).toBe(false);
        for (const path of WORLD_LAYOUT.paths) {
          expect(rectContains(path, tree.x, tree.y)).toBe(false);
        }
        for (const river of WORLD_LAYOUT.rivers) {
          expect(rectContains(river.rect, tree.x, tree.y)).toBe(false);
        }
        for (const lake of WORLD_LAYOUT.lakes) {
          expect(pointInPolygon(tree.x, tree.y, lake.points)).toBe(false);
        }
      }
    }
  });

  it('森林里确实有树，且全部落在森林矩形内', () => {
    const total = WORLD_LAYOUT.forests.reduce((sum, forest) => sum + forest.trees.length, 0);
    expect(total).toBeGreaterThan(200);
    for (const forest of WORLD_LAYOUT.forests) {
      for (const tree of forest.trees) {
        expect(tree.x).toBeGreaterThan(forest.rect.x);
        expect(tree.x).toBeLessThan(forest.rect.x + forest.rect.w);
        expect(tree.y).toBeGreaterThan(forest.rect.y);
        expect(tree.y).toBeLessThan(forest.rect.y + forest.rect.h);
      }
    }
  });
});
