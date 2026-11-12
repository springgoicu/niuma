import { describe, expect, it } from 'vitest';
import { isBlocked } from '../world/collision';
import { pointInPolygon, rectContains } from '../world/geometry';
import {
  AVENUE_TREE_COUNT,
  GROVE_MIN_GAP,
  ISLAND,
  PLAZA_RADIUS,
  SPAWN_CENTER,
  SPAWN_RADIUS,
  WELCOME_LANDMARKS,
  WORLD_CENTER,
  WORLD_LAYOUT,
  distanceSqToWater,
  isOnLand,
  isOnPlaza,
  isWadingAt,
  isWaterAt,
  regionAt,
} from '../world/layout';
import { CAMPUS_RECT, LOUNGE, MEETING_ROOM, RESTROOM, WORKROOM } from '../world/campus';

/**
 * 中央枢纽不变量（ADR-0047）：
 * 岛界不动、出生在岛心石砖圆庭、三湖无河、树簇 2–5 棵且全树间隙 ≥80、
 * 路径不落水不出岛、中央地标不堵南向主路。
 */

const ROOMS = [WORKROOM, MEETING_ROOM, LOUNGE, RESTROOM];
const SPAWN_RING: ReadonlyArray<readonly [number, number]> = [
  [56, 0],
  [52, 20],
  [40, 40],
  [20, 52],
  [0, 56],
  [-20, 52],
  [-40, 40],
  [-52, 20],
  [-56, 0],
  [-52, -20],
  [-40, -40],
  [-20, -52],
  [0, -56],
  [20, -52],
  [40, -40],
  [52, -20],
];

function strictInside(rect: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x > rect.x + 1 && x < rect.x + rect.w - 1 && y > rect.y + 1 && y < rect.y + rect.h - 1;
}

describe('岛界锁定', () => {
  it('外海岸线仍是 3805×4212', () => {
    expect(ISLAND.bounds).toEqual({ x: 2146, y: 1956, w: 3805, h: 4212 });
    expect(ISLAND.points.length).toBe(16);
    // 四个海湾仍然不可进入
    for (const [x, y] of [
      [3950, 2500],
      [5750, 4200],
      [4000, 6050],
      [1200, 6000],
    ] as const) {
      expect(isOnLand(x, y)).toBe(false);
    }
  });
});

describe('中央迎宾广场与出生点', () => {
  it('出生点在岛心，且 56px 圆内没有碰撞与水面', () => {
    expect(Math.hypot(SPAWN_CENTER.x - WORLD_CENTER.x, SPAWN_CENTER.y - WORLD_CENTER.y)).toBeLessThan(60);
    expect(isOnLand(SPAWN_CENTER.x, SPAWN_CENTER.y)).toBe(true);
    expect(isBlocked(SPAWN_CENTER.x, SPAWN_CENTER.y)).toBe(false);
    expect(isWaterAt(SPAWN_CENTER.x, SPAWN_CENTER.y)).toBe(false);
    for (const [dx, dy] of SPAWN_RING) {
      const x = SPAWN_CENTER.x + dx;
      const y = SPAWN_CENTER.y + dy;
      expect(isBlocked(x, y)).toBe(false);
      expect(isWaterAt(x, y)).toBe(false);
      expect(regionAt(x, y)).toBe('中央迎宾广场');
    }
    expect(SPAWN_RADIUS).toBe(56);
  });

  it('720px 石砖圆庭是圆形判定，包围盒只是粗筛', () => {
    expect(PLAZA_RADIUS).toBe(360);
    expect(WORLD_LAYOUT.plazaRadius).toBe(PLAZA_RADIUS);
    expect(WORLD_LAYOUT.plaza).toEqual({
      x: WORLD_CENTER.x - PLAZA_RADIUS,
      y: WORLD_CENTER.y - PLAZA_RADIUS,
      w: PLAZA_RADIUS * 2,
      h: PLAZA_RADIUS * 2,
    });
    expect(isOnPlaza(WORLD_CENTER.x, WORLD_CENTER.y)).toBe(true);
    expect(isOnPlaza(WORLD_CENTER.x + PLAZA_RADIUS, WORLD_CENTER.y)).toBe(true);
    expect(isOnPlaza(WORLD_CENTER.x + PLAZA_RADIUS + 1, WORLD_CENTER.y)).toBe(false);
    // 圆外接正方形的角不属于广场
    expect(isOnPlaza(WORLD_LAYOUT.plaza.x, WORLD_LAYOUT.plaza.y)).toBe(false);
    expect(regionAt(WORLD_CENTER.x, WORLD_CENTER.y)).toBe('中央迎宾广场');
  });

  it('迎宾拱门、导览牌与打卡柱都在中央迎宾带内，且拱门不堵南向主路', () => {
    const { arch, directory, checkin } = WELCOME_LANDMARKS;
    for (const point of [arch, directory, checkin]) {
      expect(isOnLand(point.x, point.y)).toBe(true);
      expect(regionAt(point.x, point.y)).toBe('中央迎宾广场');
      expect(isWaterAt(point.x, point.y)).toBe(false);
    }
    // 拱门在石砖圆内，导览牌/打卡柱在圆庭外缘，仍属同一个迎宾带
    expect(isOnPlaza(arch.x, arch.y)).toBe(true);
    expect(arch.width).toBeGreaterThan(240);
    expect(arch.height).toBeGreaterThan(80);
    // 拱门横跨中轴，但两根立柱必须让开 112px 的南向主路
    expect(arch.x - arch.width / 2).toBeLessThan(4040);
    expect(arch.x + arch.width / 2).toBeGreaterThan(4152);
    for (let y = 4460; y <= 5000; y += 20) {
      expect(isBlocked(4096, y)).toBe(false);
    }
  });

  it('广场陈设对称，售货机 / 咖啡机 / 长椅都在出生圈外', () => {
    const hub = WORLD_LAYOUT.props.filter((prop) => Math.abs(prop.x - WORLD_CENTER.x) < 380 && Math.abs(prop.y - WORLD_CENTER.y) < 380);
    for (const kind of ['vending', 'coffee', 'bench'] as const) {
      const count = hub.filter((prop) => prop.kind === kind).length;
      expect(count).toBeGreaterThanOrEqual(2);
    }
    for (const prop of hub) {
      expect(Math.hypot(prop.x - SPAWN_CENTER.x, prop.y - SPAWN_CENTER.y)).toBeGreaterThan(SPAWN_RADIUS);
    }
  });
});

describe('三处内嵌景观湖', () => {
  it('恰好三湖，全部在陆地上且名称可读', () => {
    expect(WORLD_LAYOUT.lakes.length).toBe(3);
    const names = ['摸鱼湖', '沉思浅塘', '涟漪湖'];
    WORLD_LAYOUT.lakes.forEach((lake, index) => {
      expect(lake.points.length).toBeGreaterThanOrEqual(12);
      for (const [x, y] of lake.points) expect(isOnLand(x, y, 24)).toBe(true);
      const cx = lake.rect.x + lake.rect.w / 2;
      const cy = lake.rect.y + lake.rect.h / 2;
      expect(isWaterAt(cx, cy)).toBe(true);
      expect(distanceSqToWater(cx, cy)).toBe(0);
      expect(regionAt(cx, cy)).toBe(names[index]);
      expect(isOnPlaza(cx, cy)).toBe(false);
      expect(rectContains(CAMPUS_RECT, cx, cy)).toBe(false);
    });
  });

  it('水面保持可涉水（ADR-0030 继续有效）', () => {
    for (const lake of WORLD_LAYOUT.lakes) {
      const cx = lake.rect.x + lake.rect.w / 2;
      const cy = lake.rect.y + lake.rect.h / 2;
      expect(isWadingAt(cx, cy)).toBe(true);
      expect(isBlocked(cx, cy)).toBe(false);
    }
  });

  it('不再有河流、桥与码头字段', () => {
    const raw = WORLD_LAYOUT as unknown as Record<string, unknown>;
    expect(raw.rivers).toBeUndefined();
    expect(raw.bridges).toBeUndefined();
    expect(raw.docks).toBeUndefined();
  });
});

describe('散落树簇', () => {
  const trees = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];

  it('每簇 2–5 棵，数量足以撑起林荫', () => {
    expect(WORLD_LAYOUT.groves.length).toBeGreaterThanOrEqual(12);
    for (const grove of WORLD_LAYOUT.groves) {
      expect(grove.trees.length).toBeGreaterThanOrEqual(2);
      expect(grove.trees.length).toBeLessThanOrEqual(5);
    }
    expect(trees.length).toBeGreaterThanOrEqual(90);
    // 林荫道必须真的种出来：偏移量被留白规则全拒会是静默回归
    expect(AVENUE_TREE_COUNT).toBeGreaterThan(0);
  });

  it('树丛中心两两不小于 GROVE_MIN_GAP', () => {
    for (let i = 0; i < WORLD_LAYOUT.groves.length; i += 1) {
      for (let j = i + 1; j < WORLD_LAYOUT.groves.length; j += 1) {
        const a = WORLD_LAYOUT.groves[i]!;
        const b = WORLD_LAYOUT.groves[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(GROVE_MIN_GAP);
      }
    }
  });

  it('树不会长进道具与花箱的占地里', () => {
    for (const tree of trees) {
      for (const prop of WORLD_LAYOUT.props) {
        expect(Math.hypot(prop.x - tree.x, prop.y - tree.y)).toBeGreaterThan(20);
      }
      for (const planter of WORLD_LAYOUT.planters) {
        expect(Math.hypot(planter.x - tree.x, planter.y - tree.y)).toBeGreaterThan(20);
      }
    }
  });

  it('全树两两间隙不小于 80px，树心不落水不进建筑', () => {
    for (const tree of trees) {
      expect(isOnLand(tree.x, tree.y, 24)).toBe(true);
      expect(isBlocked(tree.x, tree.y)).toBe(true);
      expect(isWaterAt(tree.x, tree.y)).toBe(false);
      expect(isOnPlaza(tree.x, tree.y)).toBe(false);
      expect(rectContains(WORLD_LAYOUT.office, tree.x, tree.y)).toBe(false);
      for (const room of ROOMS) expect(strictInside(room, tree.x, tree.y)).toBe(false);
      for (const path of WORLD_LAYOUT.paths) expect(pointInPolygon(tree.x, tree.y, path.polygon)).toBe(false);
    }
    for (let i = 0; i < trees.length; i += 1) {
      for (let j = i + 1; j < trees.length; j += 1) {
        const a = trees[i]!;
        const b = trees[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(80 * 80);
      }
    }
  });
});

describe('放射状路网与花海', () => {
  it('路径中心线全部在陆地、不落湖、不穿房间', () => {
    expect(WORLD_LAYOUT.paths.length).toBeGreaterThanOrEqual(8);
    for (const path of WORLD_LAYOUT.paths) {
      expect(path.halfWidth).toBeGreaterThan(0);
      expect(path.polygon.length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of path.centerline) {
        expect(isOnLand(x, y, 24)).toBe(true);
        expect(isWaterAt(x, y)).toBe(false);
        for (const room of ROOMS) expect(strictInside(room, x, y)).toBe(false);
      }
      // 带状多边形也不能咬进房间：中心线过了墙、带面仍可能压墙
      for (const [x, y] of path.polygon) {
        for (const room of ROOMS) expect(strictInside(room, x, y)).toBe(false);
      }
    }
  });

  it('花海落在空草地上，不压广场与路径', () => {
    expect(WORLD_LAYOUT.flowerFields.length).toBeGreaterThanOrEqual(6);
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
});
