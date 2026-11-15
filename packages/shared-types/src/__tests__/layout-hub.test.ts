import { describe, expect, it } from 'vitest';
import { isBlocked } from '../world/collision';
import { pointInPolygon, rectContains } from '../world/geometry';
import {
  AVENUE_TREE_COUNT,
  GROVE_MIN_GAP,
  ISLAND,
  PLANTER_RADIUS,
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

describe('陆地边界锁定', () => {
  it('矩形陆地收到 ADR-0077 的 3040×3368', () => {
    expect(ISLAND.bounds).toEqual({ x: 2560, y: 2412, w: 3040, h: 3368 });
    expect(ISLAND.points).toEqual([
      [2560, 2412],
      [5600, 2412],
      [5600, 5780],
      [2560, 5780],
    ]);
    // 四角与四边中段都仍是可通行陆地
    for (const [x, y] of [
      [3400, 2600],
      [5400, 4000],
      [3300, 5400],
      [2700, 4500],
    ] as const) {
      expect(isOnLand(x, y)).toBe(true);
    }
    // 矩形之外仍然不可进入
    for (const [x, y] of [
      [2000, 3000],
      [4000, 2300],
      [5800, 4000],
      [100, 100],
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

  it('拱门与四向导览牌都在中央迎宾带内，导览牌不压路、不压立柱与花箱', () => {
    const { arch, directory } = WELCOME_LANDMARKS;
    expect('checkin' in WELCOME_LANDMARKS).toBe(false);
    for (const point of [arch, directory]) {
      expect(isOnLand(point.x, point.y)).toBe(true);
      expect(regionAt(point.x, point.y)).toBe('中央迎宾广场');
      expect(isWaterAt(point.x, point.y)).toBe(false);
    }
    // 拱门在石砖圆内，导览牌在圆庭外缘，仍属同一个迎宾带
    expect(isOnPlaza(arch.x, arch.y)).toBe(true);
    expect(arch.width).toBeGreaterThan(240);
    expect(arch.height).toBeGreaterThan(80);
    // 拱门横跨中轴，但两根立柱必须让开 112px 的南向主路
    expect(arch.x - arch.width / 2).toBeLessThan(4040);
    expect(arch.x + arch.width / 2).toBeGreaterThan(4152);
    for (let y = 4460; y <= 5000; y += 20) {
      expect(isBlocked(4096, y)).toBe(false);
    }

    // 导览牌 96×120 的占地（ADR-0089 加高并南移后）：九点采样不进任何路径多边形，路径顶点也不落进牌面
    expect(directory).toEqual({ x: 4310, y: 4460, width: 96, height: 120 });
    const board = {
      x: directory.x - directory.width / 2,
      y: directory.y - directory.height,
      w: directory.width,
      h: directory.height,
    };
    const samples: Array<readonly [number, number]> = [];
    for (const fx of [0, 0.5, 1]) {
      for (const fy of [0, 0.5, 1]) samples.push([board.x + board.w * fx, board.y + board.h * fy]);
    }
    for (const path of WORLD_LAYOUT.paths) {
      for (const [x, y] of samples) expect(pointInPolygon(x, y, path.polygon)).toBe(false);
      for (const [x, y] of path.polygon) expect(rectContains(board, x, y)).toBe(false);
    }
    // 牌面不能与拱门立柱或其他碰撞盒相交；它自己的碰撞盒坐标与牌面完全一致，跳过
    for (const solid of WORLD_LAYOUT.solids) {
      const self = solid.x === board.x && solid.y === board.y && solid.w === board.w && solid.h === board.h;
      if (self) continue;
      const overlap =
        solid.x < board.x + board.w &&
        solid.x + solid.w > board.x &&
        solid.y < board.y + board.h &&
        solid.y + solid.h > board.y;
      expect(overlap).toBe(false);
    }
    // 花箱是圆形碰撞体：最近的 (4372,4372) 与牌面东缘留 2px
    for (const planter of WORLD_LAYOUT.planters) {
      const nx = Math.max(board.x, Math.min(planter.x, board.x + board.w));
      const ny = Math.max(board.y, Math.min(planter.y, board.y + board.h));
      expect(Math.hypot(planter.x - nx, planter.y - ny)).toBeGreaterThan(PLANTER_RADIUS);
    }
  });

  it('牛马榜公告栏立在广场北缘，不挡出生圈与北向主路', () => {
    const board = WELCOME_LANDMARKS.rankBoard;
    expect(board).toEqual({ x: 3960, y: 3832, width: 128, height: 96 });
    expect(isOnPlaza(board.x, board.y)).toBe(true);
    expect(regionAt(board.x, board.y)).toBe('中央迎宾广场');
    expect(isWaterAt(board.x, board.y)).toBe(false);
    // 牌面顶部与广场北缘齐平，底座离出生点足够远
    expect(board.y - board.height).toBe(WORLD_CENTER.y - PLAZA_RADIUS);
    expect(Math.hypot(board.x - SPAWN_CENTER.x, board.y - SPAWN_CENTER.y)).toBeGreaterThan(SPAWN_RADIUS + 100);
    // 底座挡人，但北向主路中央线（x=4096）从广场一直通到路外
    expect(isBlocked(board.x, board.y - 6)).toBe(true);
    for (let y = board.y - board.height; y <= board.y + 64; y += 8) {
      expect(isBlocked(WORLD_CENTER.x, y)).toBe(false);
    }
    // 牌面四角不压北向主路
    const face = {
      x: board.x - board.width / 2,
      y: board.y - board.height,
      w: board.width,
      h: board.height,
    };
    const northPath = WORLD_LAYOUT.paths[0]!;
    for (const [x, y] of [
      [face.x, face.y],
      [face.x + face.w, face.y],
      [face.x, face.y + face.h],
      [face.x + face.w, face.y + face.h],
    ] as const) {
      expect(pointInPolygon(x, y, northPath.polygon)).toBe(false);
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
