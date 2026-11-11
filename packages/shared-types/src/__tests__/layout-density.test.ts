import { describe, expect, it } from 'vitest';
import {
  WORLD_LAYOUT,
  isOnLand,
  isWaterAt,
  rectContains,
  rectExpanded,
  type TreeInstance,
} from '../index';
import { CAMPUS_RECT } from '../world/campus';

/**
 * 空地密度（ADR-0028）：岛缩小后不允许再出现「走一段只有草」的走廊。
 *
 * 采样 64px 栅格，一个格算「有内容」的条件是：水、路、桥、码头、建筑、铺装、
 * 林地、花海、办公区/广场这类功能区，或落在任意树冠 / 道具 / 工位的 80px 邻域内。
 * 剩下的纯草格既没有可读的地形，也没有可交互的物件。
 */

const CELL = 64;
/** 道具与树冠的覆盖半径：视觉上「看得出这里有东西」的距离 */
const COVER_RADIUS = 80;
const WINDOW = 512;

const TREES: TreeInstance[] = [
  ...WORLD_LAYOUT.forests.flatMap((forest) => forest.trees),
  ...WORLD_LAYOUT.wildTrees,
];

const PROPS = [
  ...WORLD_LAYOUT.props.map((prop) => ({ x: prop.x, y: prop.y })),
  ...WORLD_LAYOUT.planters,
  ...WORLD_LAYOUT.desks,
];

function covered(x: number, y: number): boolean {
  if (isWaterAt(x, y)) return true;
  for (const path of WORLD_LAYOUT.paths) if (rectContains(rectExpanded(path, 24), x, y)) return true;
  for (const bridge of WORLD_LAYOUT.bridges) if (rectContains(bridge, x, y)) return true;
  for (const dock of WORLD_LAYOUT.docks) if (rectContains(dock, x, y)) return true;
  for (const forest of WORLD_LAYOUT.forests) if (rectContains(forest.rect, x, y)) return true;
  for (const field of WORLD_LAYOUT.flowerFields) if (rectContains(field.rect, x, y)) return true;
  if (rectContains(WORLD_LAYOUT.office, x, y)) return true;
  if (rectContains(WORLD_LAYOUT.plaza, x, y)) return true;
  if (rectContains(CAMPUS_RECT, x, y)) return true;
  for (const building of WORLD_LAYOUT.buildings) if (rectContains(building.rect, x, y)) return true;
  for (const area of WORLD_LAYOUT.paved) if (rectContains(area, x, y)) return true;
  for (const prop of PROPS) {
    const dx = prop.x - x;
    const dy = prop.y - y;
    if (dx * dx + dy * dy < COVER_RADIUS * COVER_RADIUS) return true;
  }
  for (const tree of TREES) {
    const dx = tree.x - x;
    const dy = tree.y - y;
    if (dx * dx + dy * dy < COVER_RADIUS * COVER_RADIUS) return true;
  }
  return false;
}

interface Sample {
  x: number;
  y: number;
  empty: boolean;
}

const SAMPLES: Sample[] = [];
{
  const { x, y, w, h } = WORLD_LAYOUT.island.bounds;
  for (let py = y + CELL / 2; py < y + h; py += CELL) {
    for (let px = x + CELL / 2; px < x + w; px += CELL) {
      if (!isOnLand(px, py)) continue;
      SAMPLES.push({ x: px, y: py, empty: !covered(px, py) });
    }
  }
}

describe('空地密度', () => {
  it('纯草格不超过全部陆地的 20%', () => {
    const empty = SAMPLES.filter((sample) => sample.empty).length;
    const ratio = empty / SAMPLES.length;
    expect(ratio).toBeLessThan(0.2);
  });

  it('任意 512×512 陆地窗口的纯草格不超过 45%', () => {
    const { x, y, w, h } = WORLD_LAYOUT.island.bounds;
    let worst = 0;
    for (let wy = y; wy + WINDOW <= y + h; wy += WINDOW) {
      for (let wx = x; wx + WINDOW <= x + w; wx += WINDOW) {
        const cells = SAMPLES.filter((sample) => sample.x >= wx && sample.x < wx + WINDOW && sample.y >= wy && sample.y < wy + WINDOW);
        if (cells.length === 0) continue;
        const empty = cells.filter((sample) => sample.empty).length;
        const ratio = empty / cells.length;
        if (ratio > worst) worst = ratio;
      }
    }
    expect(worst).toBeLessThan(0.45);
  });

  it('水系与桥梁数量达到加密目标', () => {
    expect(WORLD_LAYOUT.rivers.length).toBe(2);
    expect(WORLD_LAYOUT.lakes.length).toBe(6);
    expect(WORLD_LAYOUT.bridges.length).toBe(3);
    expect(WORLD_LAYOUT.docks.length).toBe(2);
  });

  it('林地与花海数量达到加密目标', () => {
    expect(WORLD_LAYOUT.forests.length).toBe(7);
    expect(WORLD_LAYOUT.flowerFields.length).toBe(4);
    const trees = WORLD_LAYOUT.forests.reduce((sum, forest) => sum + forest.trees.length, 0);
    expect(trees).toBeGreaterThan(200);
    expect(WORLD_LAYOUT.wildTrees.length).toBeGreaterThan(60);
  });
});
