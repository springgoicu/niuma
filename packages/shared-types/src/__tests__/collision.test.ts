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
  isOnBridge,
  isOnLand,
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
    // 南北通道：北门 → 中庭 → 南侧庭院（x 4032–4160 全程无碰撞）
    const vertical = resolveMotion(CENTER.x, NORTH - 60, CENTER.x, SOUTH + 60);
    expect(vertical.y).toBeGreaterThan(SOUTH);
    // 东西通道：西侧土路 → 中庭 → 东侧土路
    const horizontal = resolveMotion(WEST - 60, CENTER.y, EAST + 60, CENTER.y);
    expect(horizontal.x).toBeGreaterThan(EAST);
  });
});

describe('水体', () => {
  it('湖面可以涉水进入', () => {
    expect(isWaterAt(5450, 5575)).toBe(true);
    const result = resolveMotion(5450, 5150, 5450, 5650);
    // 水不再是障碍：从北岸一路走进湖心，而不是停在水边
    expect(result.y).toBeGreaterThan(5575);
    expect(isWaterAt(result.x, result.y)).toBe(true);
  });

  it('主河木桥可以过河', () => {
    const bridge = WORLD_LAYOUT.bridges[0]!;
    const midY = bridge.y + bridge.h / 2;
    const result = resolveMotion(bridge.x - 100, midY, bridge.x + bridge.w + 100, midY);
    expect(result.x).toBeGreaterThan(bridge.x + bridge.w + 90);
  });

  it('晨会溪两座桥都能过', () => {
    const bridges = WORLD_LAYOUT.bridges.slice(1, 3);
    expect(bridges.length).toBe(2);
    for (const bridge of bridges) {
      const midX = bridge.x + bridge.w / 2;
      const result = resolveMotion(midX, bridge.y - 100, midX, bridge.y + bridge.h + 100);
      expect(result.y).toBeGreaterThan(bridge.y + bridge.h + 90);
    }
  });

  it('护园溪三座桥都能过，南向复用晨会溪桥形成四向环水', () => {
    // D 北门桥、E 西桥、F 东桥：通行方向由桥的长宽决定（北桥竖直、东西桥水平）
    const [north, west, east] = WORLD_LAYOUT.bridges.slice(3);
    expect(north && west && east).toBeTruthy();
    for (const bridge of [north!, west!, east!]) {
      const midX = bridge.x + bridge.w / 2;
      const midY = bridge.y + bridge.h / 2;
      const vertical = bridge.h > bridge.w;
      const result = vertical
        ? resolveMotion(midX, bridge.y - 100, midX, bridge.y + bridge.h + 100)
        : resolveMotion(bridge.x - 100, midY, bridge.x + bridge.w + 100, midY);
      if (vertical) expect(result.y).toBeGreaterThan(bridge.y + bridge.h + 90);
      else expect(result.x).toBeGreaterThan(bridge.x + bridge.w + 90);
    }
    // 南向没有新桥：既有晨会溪桥同时承担环河第四向
    const south = WORLD_LAYOUT.bridges[1]!;
    expect(south.x).toBeLessThan(4096);
    expect(south.x + south.w).toBeGreaterThan(4096);
  });

  it('桥面以外的河段也可以涉水', () => {
    // 主河在 y=3000 处的水面约 x 2609–2833：从东岸向西走进河里，不再被无形墙挡住
    const result = resolveMotion(2870, 3000, 2700, 3000);
    expect(result.x).toBeLessThan(2760);
    expect(isWaterAt(result.x, 3000)).toBe(true);
  });

  it('湖心与河心都算涉水', () => {
    expect(isWadingAt(5450, 5575)).toBe(true);
    expect(isWadingAt(2700, 3000)).toBe(true);
  });

  it('桥上与码头上不算涉水', () => {
    for (const bridge of WORLD_LAYOUT.bridges) {
      const midX = bridge.x + bridge.w / 2;
      const midY = bridge.y + bridge.h / 2;
      expect(isWaterAt(midX, midY)).toBe(true);
      expect(isOnBridge(midX, midY)).toBe(true);
      expect(isWadingAt(midX, midY)).toBe(false);
    }
    for (const dock of WORLD_LAYOUT.docks) {
      const midX = dock.x + dock.w / 2;
      const midY = dock.y + dock.h / 2;
      expect(isWadingAt(midX, midY)).toBe(false);
    }
  });

  it('码头伸进水面但可以站上去', () => {
    const dock = WORLD_LAYOUT.docks[1]!;
    const midX = dock.x + dock.w / 2;
    const midY = dock.y + dock.h / 2;
    expect(isWaterAt(midX, midY)).toBe(true);
    expect(isOnBridge(midX, midY)).toBe(true);
    expect(isBlocked(midX, midY)).toBe(false);
  });

  it('海水仍是世界边界', () => {
    expect(isOnLand(100, 100)).toBe(false);
    expect(isBlocked(100, 100)).toBe(true);
    // 从岛内往海里走，最终必须停在陆地上
    const result = resolveMotion(300, 300, 100, 100);
    expect(isOnLand(result.x, result.y)).toBe(true);
  });
});

describe('出生点与坐标兜底', () => {
  it('北门 SPAWN_RADIUS 内的随机出生点都能落到空地上', () => {
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
      // 北门口袋没有碰撞道具，服务端也是先采样再判一次可站立
      const spawn = findFreePoint(x, y);
      expect(isBlocked(spawn.x, spawn.y)).toBe(false);
      // 水虽可涉，出生点仍要避开水面（findFreePoint 默认 avoidWater）
      expect(isWaterAt(spawn.x, spawn.y)).toBe(false);
      // 出生圈不能再被推回工位环：整个圆都在北门区域里，挪位最多一圈（24px）
      expect(regionAt(spawn.x, spawn.y)).toBe('牛马园北门');
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

  it('北门横幅与指路牌都立在欢迎区内，且让开出生圈', () => {
    const { banner, signpost } = WELCOME_LANDMARKS;
    for (const point of [
      { x: banner.x, y: banner.y },
      { x: signpost.x, y: signpost.y - 40 },
      signpost,
    ]) {
      expect(isOnLand(point.x, point.y)).toBe(true);
      expect(regionAt(point.x, point.y)).toBe('牛马园北门');
      expect(isWaterAt(point.x, point.y)).toBe(false);
    }
    // 布幡要盖住整个门洞，而不是只挂在土路中间
    expect(banner.x - banner.width / 2).toBeLessThanOrEqual(3960);
    expect(banner.x + banner.width / 2).toBeGreaterThanOrEqual(4232);
    // 指路牌在门东肩，不占出生圆
    expect(Math.hypot(signpost.x - SPAWN_CENTER.x, signpost.y - SPAWN_CENTER.y)).toBeGreaterThan(SPAWN_RADIUS);
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
    expect(regionAt(4700, 2200)).toBe('加班林');
    expect(regionAt(2200, 4300)).toBe('园区野地');
  });

  it('树木不会长进广场、办公区、水面与道路上', () => {
    const trees = [
      ...WORLD_LAYOUT.forests.flatMap((forest) => forest.trees),
      ...WORLD_LAYOUT.wildTrees,
    ];
    expect(trees.length).toBeGreaterThan(200);
    for (const tree of trees) {
      expect(rectContains(WORLD_LAYOUT.plaza, tree.x, tree.y)).toBe(false);
      expect(rectContains(WORLD_LAYOUT.office, tree.x, tree.y)).toBe(false);
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
    const gapSq = 112 * 112;
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
  it('三个海湾与岛外都不可进入', () => {
    const samples = [
      [3950, 2500], // 北湾
      [5750, 4200], // 东湾
      [4000, 6050], // 南中湾
      [1200, 6000], // 岛外（西南侧）
      [100, 100], // 岛外
    ] as const;
    for (const [x, y] of samples) {
      expect(isOnLand(x, y)).toBe(false);
      expect(isBlocked(x, y)).toBe(true);
    }
  });

  it('从岸边向海走会被挡住', () => {
    const north = resolveMotion(3950, 3300, 3950, 1800);
    expect(north.y).toBeGreaterThan(3158);

    const west = resolveMotion(2400, 3900, 2100, 3900);
    expect(west.x).toBeGreaterThan(2146);

    const south = resolveMotion(5500, 6100, 5500, 6300);
    expect(south.y).toBeLessThan(6168);
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
    for (const dock of WORLD_LAYOUT.docks) {
      expect(isOnLand(dock.x, dock.y, 24)).toBe(true);
      expect(isOnLand(dock.x + dock.w, dock.y + dock.h, 24)).toBe(true);
    }
    for (const path of WORLD_LAYOUT.paths) {
      expect(isOnLand(path.x, path.y, 24)).toBe(true);
      expect(isOnLand(path.x + path.w, path.y + path.h, 24)).toBe(true);
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

  it('岛外输入会被夹回陆地', () => {
    const point = findFreePoint(100, 100);
    expect(isOnLand(point.x, point.y)).toBe(true);
    expect(isBlocked(point.x, point.y)).toBe(false);
  });

  it('就近挪位默认避水，显式允许时才接受水面', () => {
    const safe = findFreePoint(5450, 5575);
    expect(isWaterAt(safe.x, safe.y)).toBe(false);
    // 移动求解的卡死恢复会传 avoidWater=false：水里可以站，不必兜底回广场
    const allowed = findFreePoint(5450, 5575, 9, false);
    expect(isWaterAt(allowed.x, allowed.y)).toBe(true);
  });

  it('海岸线包围盒覆盖全部内容', () => {
    expect(ISLAND.bounds.x).toBeLessThan(WORLD_LAYOUT.plaza.x);
    expect(ISLAND.bounds.y).toBeLessThan(WORLD_LAYOUT.plaza.y);
    expect(ISLAND.bounds.x + ISLAND.bounds.w).toBeGreaterThan(WORLD_LAYOUT.plaza.x + WORLD_LAYOUT.plaza.w);
    expect(ISLAND.bounds.y + ISLAND.bounds.h).toBeGreaterThan(WORLD_LAYOUT.plaza.y + WORLD_LAYOUT.plaza.h);
  });
});
