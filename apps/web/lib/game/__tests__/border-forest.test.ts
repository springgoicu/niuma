import { describe, expect, it } from 'bun:test';
import { ISLAND } from '@niuma/shared-types';
import { FOREST_MAX_TREES, FOREST_TREE_VARIANTS, buildBorderForest } from '../border-forest';

const BOUNDS = ISLAND.bounds;
const TREES = buildBorderForest(BOUNDS);
/** 最大相邻间距 = 步长 64 + 两侧抖动各 14，留 4px 余量 */
const MAX_GAP = 64 + 14 * 2 + 4;

function outside(x: number, y: number): boolean {
  return x <= BOUNDS.x || x >= BOUNDS.x + BOUNDS.w || y <= BOUNDS.y || y >= BOUNDS.y + BOUNDS.h;
}

describe('边界密林', () => {
  it('同种子逐次一致：每次启动长出来的林墙完全一样', () => {
    expect(buildBorderForest(BOUNDS)).toEqual(TREES);
  });

  it('全部落在矩形之外：可行走区域里不会冒出密林树影', () => {
    for (const tree of TREES) expect(outside(tree.x, tree.y)).toBe(true);
  });

  it('数量在上限内，四条边都有树', () => {
    expect(TREES.length).toBeGreaterThan(300);
    expect(TREES.length).toBeLessThanOrEqual(FOREST_MAX_TREES);
    expect(TREES.some((tree) => tree.y < BOUNDS.y)).toBe(true);
    expect(TREES.some((tree) => tree.y > BOUNDS.y + BOUNDS.h)).toBe(true);
    expect(TREES.some((tree) => tree.x < BOUNDS.x)).toBe(true);
    expect(TREES.some((tree) => tree.x > BOUNDS.x + BOUNDS.w)).toBe(true);
  });

  it('两排都铺满，相邻树影之间不留缺口', () => {
    for (const depth of [0, 1] as const) {
      const north = TREES.filter((tree) => tree.depth === depth && tree.y < BOUNDS.y);
      expect(north.length).toBeGreaterThan(50);
      north.sort((a, b) => a.x - b.x);
      for (let i = 1; i < north.length; i += 1) {
        expect(north[i]!.x - north[i - 1]!.x).toBeLessThanOrEqual(MAX_GAP);
      }
    }
  });

  it('树冠变体索引不越界', () => {
    for (const tree of TREES) {
      expect(tree.variant).toBeGreaterThanOrEqual(0);
      expect(tree.variant).toBeLessThan(FOREST_TREE_VARIANTS);
    }
  });
});
