import { describe, expect, it } from 'vitest';
import {
  WORLD_LAYOUT,
  distanceSqToPolygon,
  isOnLand,
  isOnPlaza,
  isWaterAt,
  pointInPolygon,
  rectContains,
  rectExpanded,
  type TreeInstance,
} from '../index';
import { SOUTH_YARD } from '../world/campus';

/**
 * 空地密度（ADR-0028 / ADR-0047）：岛缩小后不允许再出现「走一段只有草」的走廊。
 *
 * 采样 64px 栅格，一个格算「有内容」的条件是：水、路、广场、建筑、铺装、
 * 树丛、花海、南庭院这类功能区，或落在任意树冠 / 道具 / 工位的 80px 邻域内。
 * 剩下的纯草格既没有可读的地形，也没有可交互的物件。
 */

const CELL = 64;
/** 道具与树冠的覆盖半径：视觉上「看得出这里有东西」的距离 */
const COVER_RADIUS = 80;
const WINDOW = 512;

const TREES: TreeInstance[] = [
  ...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees),
  ...WORLD_LAYOUT.looseTrees,
];

const PROPS = [
  ...WORLD_LAYOUT.props.map((prop) => ({ x: prop.x, y: prop.y })),
  ...WORLD_LAYOUT.planters,
  ...WORLD_LAYOUT.desks,
];

function covered(x: number, y: number): boolean {
  if (isWaterAt(x, y)) return true;
  for (const path of WORLD_LAYOUT.paths) {
    if (pointInPolygon(x, y, path.polygon)) return true;
    if (distanceSqToPolygon(x, y, path.polygon) < 24 * 24) return true;
  }
  for (const grove of WORLD_LAYOUT.groves) {
    const dx = grove.x - x;
    const dy = grove.y - y;
    if (dx * dx + dy * dy < (grove.radius + 24) * (grove.radius + 24)) return true;
  }
  for (const field of WORLD_LAYOUT.flowerFields) if (rectContains(field.rect, x, y)) return true;
  if (isOnPlaza(x, y)) return true;
  if (rectContains(WORLD_LAYOUT.office, x, y)) return true;
  if (rectContains(SOUTH_YARD, x, y)) return true;
  for (const building of WORLD_LAYOUT.buildings) if (rectContains(building.rect, x, y)) return true;
  for (const area of WORLD_LAYOUT.paved) if (rectContains(rectExpanded(area, 24), x, y)) return true;
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
  // ADR-0047：密林拆成 2–5 棵的树簇后，纯草比例必然上升；
  // 阈值从 ADR-0028 的 20% / 45% 重新标定为 48% / 85%，
  // 保留「不允许出现整片无内容的 512 窗口」这条底线，同时给开阔草地留呼吸感。
  it('纯草格不超过全部陆地的 48%', () => {
    const empty = SAMPLES.filter((sample) => sample.empty).length;
    const ratio = empty / SAMPLES.length;
    expect(ratio).toBeLessThan(0.48);
  });

  // ADR-0064：北湾 / 东湾 / 南中湾填成陆地后，园区多了两片开阔草甸，
  // 单元窗口的最差值从 0.85 抬到 0.90——仍保留「不允许整片无内容」这条底线。
  it('任意 512×512 陆地窗口的纯草格不超过 90%', () => {
    const { x, y, w, h } = WORLD_LAYOUT.island.bounds;
    let worst = 0;
    for (let wy = y; wy + WINDOW <= y + h; wy += WINDOW) {
      for (let wx = x; wx + WINDOW <= x + w; wx += WINDOW) {
        const cells = SAMPLES.filter(
          (sample) => sample.x >= wx && sample.x < wx + WINDOW && sample.y >= wy && sample.y < wy + WINDOW,
        );
        if (cells.length === 0) continue;
        const empty = cells.filter((sample) => sample.empty).length;
        const ratio = empty / cells.length;
        if (ratio > worst) worst = ratio;
      }
    }
    expect(worst).toBeLessThan(0.9);
  });

  it('水系拆成三湖，河流与桥码头归零', () => {
    expect(WORLD_LAYOUT.lakes.length).toBe(3);
    const raw = WORLD_LAYOUT as unknown as Record<string, unknown>;
    expect(raw.rivers).toBeUndefined();
    expect(raw.bridges).toBeUndefined();
    expect(raw.docks).toBeUndefined();
  });

  it('树丛与花海数量达到新布局目标', () => {
    expect(WORLD_LAYOUT.groves.length).toBeGreaterThanOrEqual(12);
    expect(WORLD_LAYOUT.flowerFields.length).toBeGreaterThanOrEqual(6);
    expect(TREES.length).toBeGreaterThanOrEqual(90);
    expect(WORLD_LAYOUT.looseTrees.length).toBeGreaterThanOrEqual(30);
    for (const grove of WORLD_LAYOUT.groves) {
      expect(grove.trees.length).toBeGreaterThanOrEqual(2);
      expect(grove.trees.length).toBeLessThanOrEqual(5);
    }
  });
});
