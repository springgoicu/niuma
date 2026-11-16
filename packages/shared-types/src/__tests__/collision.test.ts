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
import { MEETING_ROOM } from '../world/campus';

const CENTER = WORLD_CENTER;
const OFFICE = WORLD_LAYOUT.office;
const SOUTH = OFFICE.y + OFFICE.h;
const EAST = OFFICE.x + OFFICE.w;
const WEST = OFFICE.x;

describe('中央广场与五向出街', () => {
  it('广场四向出口都没有围栏挡路', () => {
    // ADR-0097：广场是市政中心，四向各接一条街，广场边缘本身不产生碰撞
    const reach = 420;
    expect(isBlocked(CENTER.x, CENTER.y - reach)).toBe(false);
    expect(isBlocked(CENTER.x, CENTER.y + reach)).toBe(false);
    expect(isBlocked(CENTER.x - reach, CENTER.y)).toBe(false);
    expect(isBlocked(CENTER.x + reach, CENTER.y)).toBe(false);
    expect(resolveMotion(CENTER.x, CENTER.y - 200, CENTER.x, CENTER.y - reach).y).toBeLessThan(
      CENTER.y - reach + 40,
    );
    expect(resolveMotion(CENTER.x, CENTER.y + 200, CENTER.x, CENTER.y + reach).y).toBeGreaterThan(
      CENTER.y + reach - 40,
    );
  });

  it('企业楼没有外墙：会议室、发泄室与走廊连成一片可自由穿行', () => {
    // ADR-0103：整栋楼改成开放平面，原来的外墙位置现在是可走的地面
    expect(isBlocked(MEETING_ROOM.x + 40, MEETING_ROOM.y + 2)).toBe(false);
    expect(isBlocked(WEST + 40, SOUTH - 2)).toBe(false);
    // 走廊东端与楼内都能直接走进去
    expect(isBlocked(EAST + 10, OFFICE.y + 380)).toBe(false);
    expect(isBlocked(EAST - 40, OFFICE.y + 380)).toBe(false);
  });

  it('工位桌仍然挡人，小件装饰不产生隐形墙', () => {
    for (const desk of WORLD_LAYOUT.desks.slice(0, 8)) {
      expect(isBlocked(desk.x, desk.y)).toBe(true);
    }
    // ADR-0097 拆掉南院树篱后，五区不再用整圈树篱做软分区
    const hedges = WORLD_LAYOUT.props.filter((prop) => prop.kind === 'hedge');
    expect(hedges).toHaveLength(0);
    const lamps = WORLD_LAYOUT.props.filter((prop) => prop.kind === 'lamp');
    expect(lamps.length).toBeGreaterThan(20);
    for (const lamp of lamps) expect(isBlocked(lamp.x, lamp.y)).toBe(false);
  });

  it('十字主路可以横穿广场，不被任何建筑挡住', () => {
    // 南北通道：北入口 → 广场 → 南向生活区（x 4096 全程无碰撞，拱门立柱让开主路）
    const vertical = resolveMotion(CENTER.x, CENTER.y - 500, CENTER.x, CENTER.y + 500);
    expect(vertical.y).toBeGreaterThan(CENTER.y + 460);
    // 东西通道：企业区前庭 → 广场 → 服务广场
    const horizontal = resolveMotion(CENTER.x - 500, CENTER.y, CENTER.x + 500, CENTER.y);
    expect(horizontal.x).toBeGreaterThan(CENTER.x + 460);
  });
});

describe('内角辅助滑行（ADR-0099）', () => {
  it('斜着贴凸墙角推进时不会一下停死，位移不超过步长', () => {
    // 301 栋东南角 (3500, 4920)：楼体整块实心，外面是巷道与草地。
    // 站位离两条边各 7px（斜距 9.9 > 半径 9，站得住），朝墙角斜走时
    // 4px 整步与两条单轴滑行会同时被挡 —— 这正是旧实现「顶住不动」的位置。
    const fromX = 3507;
    const fromY = 4927;
    expect(isBlocked(fromX, fromY)).toBe(false);
    const toX = fromX - 12;
    const toY = fromY - 12;
    expect(isBlocked(fromX - 4, fromY - 4)).toBe(true);

    const out = resolveMotion(fromX, fromY, toX, toY);
    const moved = Math.hypot(out.x - fromX, out.y - fromY);
    // 1px 侧移能挤进墙角，于是不再原地卡死
    expect(moved).toBeGreaterThan(0);
    // 侧移计入位移预算：总位移永远不超过这一帧给的步长
    expect(moved).toBeLessThanOrEqual(Math.hypot(toX - fromX, toY - fromY) + 0.001);
    expect(isBlocked(out.x, out.y)).toBe(false);
  });

  it('空旷处照旧走满整段，侧移不参与正常移动', () => {
    const out = resolveMotion(CENTER.x, CENTER.y, CENTER.x + 24, CENTER.y);
    expect(out.x).toBeCloseTo(CENTER.x + 24, 6);
    expect(out.y).toBeCloseTo(CENTER.y, 6);
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
  it('区域名按中央广场 / 场所 / 大区的优先级命中', () => {
    const lake = WORLD_LAYOUT.lakes[0]!.rect;
    expect(regionAt(CENTER.x, CENTER.y)).toBe('中央迎宾广场');
    expect(regionAt(lake.x + lake.w / 2, lake.y + lake.h / 2)).toBe('摸鱼湖');
    // 企业楼里的工作区 / 楼前庭的企业区（避开茶台与神龛的具名小区域）
    expect(regionAt(2900, 3400)).toBe('工作区');
    expect(regionAt(3566, 3656)).toBe('企业区');
    // 游乐区：骰子馆亭具名，街面兜底到区名
    expect(regionAt(2810, 2810)).toBe('摸鱼骰子馆');
    expect(regionAt(3500, 3060)).toBe('游乐区');
    // 服务区与野地
    expect(regionAt(4700, 4450)).toBe('服务区');
    expect(regionAt(2700, 4400)).toBe('园区野地');
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
