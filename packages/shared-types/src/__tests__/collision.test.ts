import { describe, expect, it } from 'vitest';
import { findFreePoint, isBlocked, resolveMotion } from '../world/collision';
import { pointInPolygon, rectContains } from '../world/geometry';
import {
  ISLAND,
  SPAWN_CENTER,
  SPAWN_RADIUS,
  WELCOME_LANDMARKS,
  WORLD_CENTER,
  WORLD_LAYOUT,
  isOnLand,
  isOnPlaza,
  isWadingAt,
  isWaterAt,
  regionAt,
} from '../world/layout';

const CENTER = WORLD_CENTER;
const OFFICE = WORLD_LAYOUT.office;
const SOUTH = OFFICE.y + OFFICE.h;
const NORTH = OFFICE.y;
const EAST = OFFICE.x + OFFICE.w;
const WEST = OFFICE.x;

describe('开放式办公区', () => {
  it('四个方向都没有围栏挡路', () => {
    // ADR-0028：栏板删除后，办公区四边只是树篱与花箱的软分区，本身不产生碰撞
    expect(isBlocked(CENTER.x, NORTH)).toBe(false);
    expect(isBlocked(CENTER.x, SOUTH)).toBe(false);
    expect(isBlocked(WEST, CENTER.y)).toBe(false);
    expect(isBlocked(EAST, CENTER.y)).toBe(false);
    expect(resolveMotion(CENTER.x, NORTH - 60, CENTER.x, NORTH + 60).y).toBeGreaterThan(NORTH);
    expect(resolveMotion(CENTER.x, SOUTH - 60, CENTER.x, SOUTH + 60).y).toBeGreaterThan(SOUTH);
  });

  it('工位桌仍然挡人，南园树篱只是视觉分区', () => {
    for (const desk of WORLD_LAYOUT.desks.slice(0, 8)) {
      expect(isBlocked(desk.x, desk.y)).toBe(true);
    }
    const hedges = WORLD_LAYOUT.props.filter((prop) => prop.kind === 'hedge');
    expect(hedges.length).toBeGreaterThan(40);
    for (const hedge of hedges) expect(isBlocked(hedge.x, hedge.y)).toBe(false);
  });

  it('四角房间之间留出十字通道，可以横穿院落', () => {
    // 南北通道：北门 → 中庭 → 南侧庭院（x 4096 全程无碰撞，拱门立柱让开主路）
    const vertical = resolveMotion(CENTER.x, NORTH - 60, CENTER.x, SOUTH + 60);
    expect(vertical.y).toBeGreaterThan(SOUTH);
    // 东西通道：西侧土路 → 中庭 → 东侧土路
    const horizontal = resolveMotion(WEST - 60, CENTER.y, EAST + 60, CENTER.y);
    expect(horizontal.x).toBeGreaterThan(EAST);
  });
});

describe('水体', () => {
  it('三处湖面都可以涉水进入', () => {
    for (const lake of WORLD_LAYOUT.lakes) {
      const cx = lake.rect.x + lake.rect.w / 2;
      const cy = lake.rect.y + lake.rect.h / 2;
      expect(isWaterAt(cx, cy)).toBe(true);
      expect(isBlocked(cx, cy)).toBe(false);
      const result = resolveMotion(cx, lake.rect.y - 120, cx, cy);
      expect(isWaterAt(result.x, result.y)).toBe(true);
      expect(isWadingAt(result.x, result.y)).toBe(true);
    }
  });

  it('湖心算涉水，岸边不算', () => {
    for (const lake of WORLD_LAYOUT.lakes) {
      const cx = lake.rect.x + lake.rect.w / 2;
      const cy = lake.rect.y + lake.rect.h / 2;
      expect(isWadingAt(cx, cy)).toBe(true);
      expect(isWadingAt(cx, lake.rect.y - 40)).toBe(false);
    }
  });

  it('不再有桥与码头，所有通行都在陆地上', () => {
    const raw = WORLD_LAYOUT as unknown as Record<string, unknown>;
    expect(raw.bridges).toBeUndefined();
    expect(raw.docks).toBeUndefined();
    expect(raw.rivers).toBeUndefined();
  });

  it('矩形边界之外仍是世界边界', () => {
    expect(isOnLand(100, 100)).toBe(false);
    expect(isBlocked(100, 100)).toBe(true);
    const result = resolveMotion(300, 300, 100, 100);
    expect(isOnLand(result.x, result.y)).toBe(true);
  });
});

describe('出生点与坐标兜底', () => {
  it('中央广场 SPAWN_RADIUS 内的随机出生点都能落到空地上', () => {
    let seed = 0x1f2e3d4c;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i += 1) {
      const angle = next() * Math.PI * 2;
      const distance = Math.sqrt(next()) * SPAWN_RADIUS;
      const x = SPAWN_CENTER.x + Math.cos(angle) * distance;
      const y = SPAWN_CENTER.y + Math.sin(angle) * distance;
      const spawn = findFreePoint(x, y);
      expect(isBlocked(spawn.x, spawn.y)).toBe(false);
      // 水虽可涉，出生点仍要避开水面（findFreePoint 默认 avoidWater）
      expect(isWaterAt(spawn.x, spawn.y)).toBe(false);
      expect(regionAt(spawn.x, spawn.y)).toBe('中央迎宾广场');
      expect(Math.hypot(spawn.x - x, spawn.y - y)).toBeLessThan(48);
    }
  });

  it('出生圈不再与任何工位桌相交', () => {
    for (const desk of WORLD_LAYOUT.desks) {
      const dx = desk.x - SPAWN_CENTER.x;
      const dy = desk.y - SPAWN_CENTER.y;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(SPAWN_RADIUS + 60);
    }
  });

  it('中央拱门与四向导览牌都立在迎宾带内，且让开出生圈', () => {
    const { arch, directory } = WELCOME_LANDMARKS;
    for (const point of [arch, directory]) {
      expect(isOnLand(point.x, point.y)).toBe(true);
      expect(isWaterAt(point.x, point.y)).toBe(false);
      expect(regionAt(point.x, point.y)).toBe('中央迎宾广场');
    }
    expect(isOnPlaza(arch.x, arch.y)).toBe(true);
    // 拱门横跨中轴，立柱让开 112px 的南向主路
    expect(arch.x - arch.width / 2).toBeLessThan(4040);
    expect(arch.x + arch.width / 2).toBeGreaterThan(4152);
    expect(Math.hypot(directory.x - SPAWN_CENTER.x, directory.y - SPAWN_CENTER.y)).toBeGreaterThan(SPAWN_RADIUS);
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
  it('区域名按中央广场 / 湖 / 房间 / 办公区的优先级命中', () => {
    const lake = WORLD_LAYOUT.lakes[0]!.rect;
    expect(regionAt(CENTER.x, CENTER.y)).toBe('中央迎宾广场');
    expect(regionAt(lake.x + lake.w / 2, lake.y + lake.h / 2)).toBe('摸鱼湖');
    expect(regionAt(3566, 3656)).toBe('工作区');
    expect(regionAt(2800, 3500)).toBe('园区野地');
  });

  it('树木不会长进广场、办公区、水面与道路上', () => {
    const trees = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];
    expect(trees.length).toBeGreaterThan(90);
    for (const tree of trees) {
      expect(isOnPlaza(tree.x, tree.y)).toBe(false);
      expect(rectContains(WORLD_LAYOUT.office, tree.x, tree.y)).toBe(false);
      for (const path of WORLD_LAYOUT.paths) {
        expect(pointInPolygon(tree.x, tree.y, path.polygon)).toBe(false);
      }
      expect(isWaterAt(tree.x, tree.y)).toBe(false);
      for (const lake of WORLD_LAYOUT.lakes) {
        expect(pointInPolygon(tree.x, tree.y, lake.points)).toBe(false);
      }
    }
  });

  it('散树参与碰撞，且两两间隙不小于 80px', () => {
    const trees = WORLD_LAYOUT.looseTrees;
    expect(trees.length).toBeGreaterThan(30);
    for (const tree of trees) {
      expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
      expect(isBlocked(tree.x, tree.y)).toBe(true);
      for (const field of WORLD_LAYOUT.flowerFields) {
        expect(rectContains(field.rect, tree.x, tree.y)).toBe(false);
      }
    }
    const gapSq = 80 * 80;
    for (let i = 0; i < trees.length; i += 1) {
      for (let j = i + 1; j < trees.length; j += 1) {
        const a = trees[i]!;
        const b = trees[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(gapSq);
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
      expect(isOnPlaza(cx, cy)).toBe(false);
      for (const path of WORLD_LAYOUT.paths) expect(pointInPolygon(cx, cy, path.polygon)).toBe(false);
    }
  });

  it('树丛每簇 2–5 棵，且全部落在陆地上', () => {
    for (const grove of WORLD_LAYOUT.groves) {
      expect(grove.trees.length).toBeGreaterThanOrEqual(2);
      expect(grove.trees.length).toBeLessThanOrEqual(5);
      for (const tree of grove.trees) expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
    }
  });
});

describe('树与花箱的脚底碰撞', () => {
  it('物体脚底正下方 10px 不再有隐形墙', () => {
    const trees = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];
    for (const tree of trees) {
      // 脚底点本身仍应挡住人，避免碰撞圆整体上移后留下一条可穿的缝
      expect(isBlocked(tree.x, tree.y, 0)).toBe(true);
      expect(isBlocked(tree.x, tree.y + 10, 0)).toBe(false);
    }
    for (const planter of WORLD_LAYOUT.planters) {
      expect(isBlocked(planter.x, planter.y, 0)).toBe(true);
      expect(isBlocked(planter.x, planter.y + 10, 0)).toBe(false);
    }
  });
});

describe('矩形边界', () => {
  it('矩形收窄后四边都是陆地，矩形之外仍不可进入', () => {
    // ADR-0077：岛界 x 2560–5600 / y 2412–5780
    for (const [x, y] of [
      [3400, 2600],
      [5400, 4000],
      [3300, 5400],
    ] as const) {
      expect(isOnLand(x, y)).toBe(true);
    }
    for (const [x, y] of [
      [2000, 3000], // 西侧边界外
      [100, 100], // 西北角外
      [5800, 4000], // 东侧边界外
      [4000, 2300], // 北侧边界外
      [4000, 6000], // 南侧边界外
    ] as const) {
      expect(isOnLand(x, y)).toBe(false);
      expect(isBlocked(x, y)).toBe(true);
    }
  });

  it('从陆地走向四边都会被挡住', () => {
    // 北边界 y = 2412，玩家半径 9：停在边界内侧
    const north = resolveMotion(3950, 2700, 3950, 2300);
    expect(north.y).toBeGreaterThan(2412);

    const west = resolveMotion(2800, 3900, 2500, 3900);
    expect(west.x).toBeGreaterThan(2560);

    const south = resolveMotion(5500, 5600, 5500, 5900);
    expect(south.y).toBeLessThan(5780);

    const east = resolveMotion(5400, 4000, 5700, 4000);
    expect(east.x).toBeLessThan(5600);
  });

  it('所有静态地形都在矩形以内，且离边界至少 24px', () => {
    for (const grove of WORLD_LAYOUT.groves) {
      for (const tree of grove.trees) expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
    }
    for (const tree of WORLD_LAYOUT.looseTrees) expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
    for (const lake of WORLD_LAYOUT.lakes) {
      for (const [px, py] of lake.points) expect(isOnLand(px, py, 24)).toBe(true);
    }
    for (const path of WORLD_LAYOUT.paths) {
      for (const [px, py] of path.centerline) expect(isOnLand(px, py, 24)).toBe(true);
    }
    for (const planter of WORLD_LAYOUT.planters) {
      expect(isOnLand(planter.x, planter.y, 24)).toBe(true);
    }
    expect(isOnLand(WORLD_LAYOUT.office.x, WORLD_LAYOUT.office.y, 24)).toBe(true);
    expect(
      isOnLand(WORLD_LAYOUT.office.x + WORLD_LAYOUT.office.w, WORLD_LAYOUT.office.y + WORLD_LAYOUT.office.h, 24),
    ).toBe(true);
    expect(isOnLand(WORLD_LAYOUT.plaza.x, WORLD_LAYOUT.plaza.y, 24)).toBe(true);
    expect(isOnLand(WORLD_LAYOUT.plaza.x + WORLD_LAYOUT.plaza.w, WORLD_LAYOUT.plaza.y + WORLD_LAYOUT.plaza.h, 24)).toBe(true);
  });

  it('矩形外输入会被夹回陆地', () => {
    const point = findFreePoint(100, 100);
    expect(isOnLand(point.x, point.y)).toBe(true);
    expect(isBlocked(point.x, point.y)).toBe(false);
  });

  it('就近挪位默认避水，显式允许时才接受水面', () => {
    const lake = WORLD_LAYOUT.lakes[0]!;
    const cx = lake.rect.x + lake.rect.w / 2;
    const cy = lake.rect.y + lake.rect.h / 2;
    const safe = findFreePoint(cx, cy);
    expect(isWaterAt(safe.x, safe.y)).toBe(false);
    const allowed = findFreePoint(cx, cy, 9, false);
    expect(isWaterAt(allowed.x, allowed.y)).toBe(true);
  });

  it('陆地包围盒覆盖全部内容', () => {
    expect(ISLAND.bounds.x).toBeLessThan(WORLD_LAYOUT.plaza.x);
    expect(ISLAND.bounds.y).toBeLessThan(WORLD_LAYOUT.plaza.y);
    expect(ISLAND.bounds.x + ISLAND.bounds.w).toBeGreaterThan(WORLD_LAYOUT.plaza.x + WORLD_LAYOUT.plaza.w);
    expect(ISLAND.bounds.y + ISLAND.bounds.h).toBeGreaterThan(WORLD_LAYOUT.plaza.y + WORLD_LAYOUT.plaza.h);
  });
});
