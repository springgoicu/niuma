import { describe, expect, it } from 'vitest';
import { findFreePoint, isBlocked, resolveMotion } from '../world/collision';
import { pointInPolygon, rectContains } from '../world/geometry';
import { ISLAND, SPAWN_RADIUS, WORLD_CENTER, WORLD_LAYOUT, isOnLand, isWaterAt, regionAt } from '../world/layout';

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
    // x=3600 落在两张南排桌子之间的走道上，只会被栏板挡住
    const result = resolveMotion(3600, SOUTH - 80, 3600, SOUTH + 120);
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
    const lake = WORLD_LAYOUT.lakes[0]!;
    const result = resolveMotion(lake.rect.x + lake.rect.w / 2, lake.rect.y - 120, lake.rect.x + lake.rect.w / 2, lake.rect.y + 200);
    expect(result.y).toBeLessThan(lake.rect.y + 80);
  });

  it('桥面可以过河', () => {
    const bridge = WORLD_LAYOUT.bridges[0]!;
    const midY = bridge.y + bridge.h / 2;
    const result = resolveMotion(bridge.x - 100, midY, bridge.x + bridge.w + 100, midY);
    expect(result.x).toBeGreaterThan(bridge.x + bridge.w + 90);
  });

  it('桥面以外的河段挡人', () => {
    // 起点贴着东岸（离水 30px，树不会长这么近），一路向西应该停在水边
    const result = resolveMotion(2920, 3000, 2600, 3000);
    expect(result.x).toBeGreaterThan(2860);
    expect(result.x).toBeLessThan(2920);
    expect(isWaterAt(result.x, 3000)).toBe(false);
  });
});

describe('出生点与坐标兜底', () => {
  it('中心 SPAWN_RADIUS 内的随机出生点都能落到空地上', () => {
    let seed = 0x1f2e3d4c;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i += 1) {
      const angle = next() * Math.PI * 2;
      const distance = Math.sqrt(next()) * SPAWN_RADIUS;
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
    const lake = WORLD_LAYOUT.lakes[0]!.rect;
    expect(regionAt(CENTER.x, CENTER.y)).toBe('办公区');
    expect(regionAt(lake.x + lake.w / 2, lake.y + lake.h / 2)).toBe('摸鱼湖');
    expect(regionAt(2000, 2000)).toBe('加班林');
    expect(regionAt(1600, 3600)).toBe('园区野地');
  });

  it('树木不会长进广场、水面与道路上', () => {
    const trees = [
      ...WORLD_LAYOUT.forests.flatMap((forest) => forest.trees),
      ...WORLD_LAYOUT.wildTrees,
    ];
    expect(trees.length).toBeGreaterThan(200);
    for (const tree of trees) {
      expect(rectContains(WORLD_LAYOUT.plaza, tree.x, tree.y)).toBe(false);
      expect(rectContains(WORLD_LAYOUT.fence.rect, tree.x, tree.y)).toBe(false);
      for (const path of WORLD_LAYOUT.paths) {
        expect(rectContains(path, tree.x, tree.y)).toBe(false);
      }
      expect(isWaterAt(tree.x, tree.y)).toBe(false);
      for (const lake of WORLD_LAYOUT.lakes) {
        expect(pointInPolygon(tree.x, tree.y, lake.points)).toBe(false);
      }
    }
  });

  it('孤树散布全岛，参与碰撞且不进林地与花海', () => {
    expect(WORLD_LAYOUT.wildTrees.length).toBeGreaterThan(60);
    const gapSq = 170 * 170;
    for (const tree of WORLD_LAYOUT.wildTrees) {
      expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
      expect(isBlocked(tree.x, tree.y)).toBe(true);
      for (const forest of WORLD_LAYOUT.forests) {
        expect(rectContains(forest.rect, tree.x, tree.y)).toBe(false);
      }
      for (const field of WORLD_LAYOUT.flowerFields) {
        expect(rectContains(field.rect, tree.x, tree.y)).toBe(false);
      }
    }
    for (let i = 0; i < WORLD_LAYOUT.wildTrees.length; i += 1) {
      for (let j = i + 1; j < WORLD_LAYOUT.wildTrees.length; j += 1) {
        const a = WORLD_LAYOUT.wildTrees[i]!;
        const b = WORLD_LAYOUT.wildTrees[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        expect(dx * dx + dy * dy).toBeGreaterThan(gapSq);
      }
    }
  });

  it('花海落在空草地上，且不阻挡行走', () => {
    expect(WORLD_LAYOUT.flowerFields.length).toBeGreaterThanOrEqual(3);
    for (const field of WORLD_LAYOUT.flowerFields) {
      const { x, y, w, h } = field.rect;
      for (const [px, py] of [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ] as const) {
        expect(isOnLand(px, py, 24)).toBe(true);
      }
      const cx = x + w / 2;
      const cy = y + h / 2;
      expect(isWaterAt(cx, cy)).toBe(false);
      expect(rectContains(WORLD_LAYOUT.plaza, cx, cy)).toBe(false);
      for (const path of WORLD_LAYOUT.paths) expect(rectContains(path, cx, cy)).toBe(false);
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

describe('海岛边界', () => {
  it('四个海湾与岛外都不可进入', () => {
    const samples = [
      [3950, 1200], // 北湾
      [7350, 4000], // 东湾
      [4000, 7500], // 南中湾
      [1200, 6000], // 西南湾
      [100, 100], // 岛外
    ] as const;
    for (const [x, y] of samples) {
      expect(isOnLand(x, y)).toBe(false);
      expect(isBlocked(x, y)).toBe(true);
    }
  });

  it('从岸边向海走会被挡住', () => {
    const north = resolveMotion(3950, 2900, 3950, 1000);
    expect(north.y).toBeGreaterThan(2756);

    const west = resolveMotion(1600, 2000, 1200, 2000);
    expect(west.x).toBeGreaterThan(1310);

    const south = resolveMotion(6000, 6600, 6000, 7400);
    expect(south.y).toBeLessThan(7056);
  });

  it('所有静态地形都在岸线以内，且离海至少 24px', () => {
    for (const forest of WORLD_LAYOUT.forests) {
      for (const tree of forest.trees) {
        expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
      }
    }
    for (const river of WORLD_LAYOUT.rivers) {
      // 河口两点在岛外（通海），只校验岛内的中心线站点
      for (const [px, py] of river.centerline.slice(1, -1)) {
        expect(isOnLand(px, py, 24)).toBe(true);
      }
    }
    for (const lake of WORLD_LAYOUT.lakes) {
      for (const [px, py] of lake.points) {
        expect(isOnLand(px, py, 24)).toBe(true);
      }
    }
    for (const bridge of WORLD_LAYOUT.bridges) {
      expect(isOnLand(bridge.x, bridge.y, 24)).toBe(true);
      expect(isOnLand(bridge.x + bridge.w, bridge.y + bridge.h, 24)).toBe(true);
    }
    for (const path of WORLD_LAYOUT.paths) {
      expect(isOnLand(path.x, path.y, 24)).toBe(true);
      expect(isOnLand(path.x + path.w, path.y + path.h, 24)).toBe(true);
    }
    for (const planter of WORLD_LAYOUT.planters) {
      expect(isOnLand(planter.x, planter.y, 24)).toBe(true);
    }
    for (const segment of WORLD_LAYOUT.fence.segments) {
      expect(isOnLand(segment.x1, segment.y1, 24)).toBe(true);
      expect(isOnLand(segment.x2, segment.y2, 24)).toBe(true);
    }
    expect(isOnLand(WORLD_LAYOUT.plaza.x, WORLD_LAYOUT.plaza.y, 24)).toBe(true);
    expect(isOnLand(WORLD_LAYOUT.plaza.x + WORLD_LAYOUT.plaza.w, WORLD_LAYOUT.plaza.y + WORLD_LAYOUT.plaza.h, 24)).toBe(true);
  });

  it('岛外输入会被夹回陆地', () => {
    const point = findFreePoint(100, 100);
    expect(isOnLand(point.x, point.y)).toBe(true);
    expect(isBlocked(point.x, point.y)).toBe(false);
  });

  it('海岸线包围盒覆盖全部内容', () => {
    expect(ISLAND.bounds.x).toBeLessThan(WORLD_LAYOUT.plaza.x);
    expect(ISLAND.bounds.y).toBeLessThan(WORLD_LAYOUT.plaza.y);
    expect(ISLAND.bounds.x + ISLAND.bounds.w).toBeGreaterThan(WORLD_LAYOUT.plaza.x + WORLD_LAYOUT.plaza.w);
    expect(ISLAND.bounds.y + ISLAND.bounds.h).toBeGreaterThan(WORLD_LAYOUT.plaza.y + WORLD_LAYOUT.plaza.h);
  });
});
