import { describe, expect, it } from 'vitest';
import {
  APARTMENT_GARDEN,
  APARTMENT_GARDEN_PATH,
  APARTMENT_ROOM_COUNT,
  APARTMENT_SPECS,
  APARTMENT_WINDOW_COLS,
  APARTMENT_WINDOW_COUNT,
  APARTMENT_WINDOW_ROWS,
  apartmentByDoorNo,
  apartmentBySlot,
  apartmentWindowAt,
} from '../world/apartment';
import { apartmentDoorHotspotId, apartmentDoorSlotAt, hotspotsOfKind } from '../world/hotspots';
import { isBlocked } from '../world/collision';
import { WORLD_LAYOUT, WORLD_CENTER, isOnLand } from '../world/layout';
import { pointInPolygon, rectContains, type Point, type WorldRect } from '../world/geometry';

/**
 * 公寓布局（ADR-0095 / ADR-0098 / ADR-0101）：只留 301 一栋，楼里进不去，
 * 探头只从外立面窗口露出；撤掉的五栋变成门前的口袋花园（纯装饰、零碰撞）。
 *
 * 这组断言只钉「位置与可达性」——楼体不压路/水/别的建筑、门口站得住、
 * 20 个窗口整整齐齐落在楼体上且互不重叠、花园与石板小径各就各位且不长树。
 */

function rectsOverlap(a: WorldRect, b: WorldRect, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad &&
    b.x < a.x + a.w + pad &&
    a.y < b.y + b.h + pad &&
    b.y < a.y + a.h + pad
  );
}

/** 楼体里有没有被路面/水面咬到：按 10px 网格撒点判多边形 */
function overlapsPolygon(rect: WorldRect, polygon: ReadonlyArray<Point>): boolean {
  for (let y = rect.y; y <= rect.y + rect.h; y += 10) {
    for (let x = rect.x; x <= rect.x + rect.w; x += 10) {
      if (pointInPolygon(x, y, polygon)) return true;
    }
  }
  return false;
}

/** 自己那栋楼的实心楼体：不算「压到别的碰撞体」 */
function isOwnWall(own: WorldRect, solid: WorldRect): boolean {
  return (
    own.x - 1 <= solid.x &&
    solid.x + solid.w <= own.x + own.w + 1 &&
    own.y - 1 <= solid.y &&
    solid.y + solid.h <= own.y + own.h + 1
  );
}

const OTHER_BUILDINGS = WORLD_LAYOUT.buildings.filter((building) => building.name !== '牛马公寓');
const BUILDING = APARTMENT_SPECS[0]!;

describe('牛马公寓布局（ADR-0095 / ADR-0098 / ADR-0101）', () => {
  it('只留一栋，门牌 301', () => {
    expect(APARTMENT_ROOM_COUNT).toBe(1);
    expect(APARTMENT_SPECS).toHaveLength(1);
    expect(BUILDING.slot).toBe(0);
    expect(BUILDING.doorNo).toBe(301);
    expect(apartmentBySlot(BUILDING.slot)).toBe(BUILDING);
    expect(apartmentByDoorNo(301)).toBe(BUILDING);
    // 302 起不再有楼：旧门牌一律查不到，越界 slot 夹回唯一一栋
    expect(apartmentByDoorNo(302)).toBeUndefined();
    expect(apartmentByDoorNo(306)).toBeUndefined();
    expect(apartmentByDoorNo(299)).toBeUndefined();
    expect(apartmentBySlot(5)).toBe(BUILDING);
  });

  it('楼体铺在中央广场周边，不堆到岛角', () => {
    const cx = BUILDING.rect.x + BUILDING.rect.w / 2;
    const cy = BUILDING.rect.y + BUILDING.rect.h / 2;
    expect(Math.hypot(cx - WORLD_CENTER.x, cy - WORLD_CENTER.y)).toBeLessThanOrEqual(1700);
  });

  it('不压别的建筑、路面、水面与既有碰撞体', () => {
    const rect = BUILDING.rect;
    expect(isOnLand(rect.x, rect.y), '301 栋贴着岛界').toBe(true);
    expect(isOnLand(rect.x + rect.w, rect.y + rect.h), '301 栋贴着岛界').toBe(true);
    for (const building of OTHER_BUILDINGS) {
      expect(rectsOverlap(rect, building.rect, 24), `301 栋压到 ${building.name}`).toBe(false);
    }
    for (const lake of WORLD_LAYOUT.lakes) {
      expect(overlapsPolygon(rect, lake.points), '301 栋长在水里').toBe(false);
    }
    for (const path of WORLD_LAYOUT.paths) {
      expect(overlapsPolygon(rect, path.polygon), '301 栋压在路面上').toBe(false);
    }
    for (const solid of WORLD_LAYOUT.solids) {
      if (isOwnWall(rect, solid)) continue;
      expect(rectsOverlap(rect, solid), '301 栋压到既有碰撞体').toBe(false);
    }
  });

  it('楼体整块实心：人走不进楼里，门口台阶站得住', () => {
    const { rect, outside } = BUILDING;
    expect(isOnLand(outside.x, outside.y, 20), '门口落到岛外').toBe(true);
    expect(isBlocked(outside.x, outside.y), '门口台阶被挡住').toBe(false);
    expect(isBlocked(rect.x + rect.w / 2, rect.y + rect.h / 2), '楼里还能走').toBe(true);
    // 探针离墙 24px：玩家半径 9，走得过就算「墙外有站人的地方」
    const probes: Array<[string, number, number]> = [
      ['北', rect.x + rect.w / 2, rect.y - 24],
      ['西', rect.x - 24, rect.y + rect.h / 2],
      ['东', rect.x + rect.w + 24, rect.y + rect.h / 2],
      ['南', outside.x, rect.y + rect.h + 60],
    ];
    for (const [side, x, y] of probes) {
      expect(isBlocked(x, y), `301 栋${side}侧被堵住`).toBe(false);
    }
  });

  it('门口热区只剩一条，且只认这一扇门', () => {
    const doors = hotspotsOfKind('apartmentDoor');
    expect(doors).toHaveLength(1);
    expect(doors[0]!.id).toBe(apartmentDoorHotspotId(0));
    expect(apartmentDoorSlotAt(BUILDING.door.x, BUILDING.door.y)).toBe(0);
    // 远处按 F 不该算站在门口，旧五栋的原址也不该再有热区
    expect(apartmentDoorSlotAt(WORLD_CENTER.x, WORLD_CENTER.y)).toBe(-1);
    expect(apartmentDoorSlotAt(3600, 4800)).toBe(-1);
  });

  it('4×5 共 20 个窗口，全部落在楼体上且互不重叠', () => {
    expect(APARTMENT_WINDOW_ROWS * APARTMENT_WINDOW_COLS).toBe(APARTMENT_WINDOW_COUNT);
    expect(BUILDING.windows).toHaveLength(APARTMENT_WINDOW_COUNT);
    const rect = BUILDING.rect;
    const seen = new Set<string>();
    for (const [index, window] of BUILDING.windows.entries()) {
      expect(window.index).toBe(index);
      expect(rectContains(rect, window.cx, window.cy), '窗口在楼外').toBe(true);
      expect(window.x).toBeGreaterThan(rect.x);
      expect(window.y).toBeGreaterThan(rect.y);
      expect(window.x + window.w).toBeLessThan(rect.x + rect.w);
      expect(window.y + window.h).toBeLessThan(rect.y + rect.h);
      expect(seen.has(`${window.x},${window.y}`)).toBe(false);
      seen.add(`${window.x},${window.y}`);
    }
    // 上层的 y 更小、右边的 x 更大：编号顺序（从下往上、从左往右）可读
    const bottom = BUILDING.windows[0]!;
    const topFloor = BUILDING.windows[APARTMENT_WINDOW_COUNT - 1]!;
    expect(topFloor.y).toBeLessThan(bottom.y);
    expect(BUILDING.windows[1]!.x).toBeGreaterThan(bottom.x);
    expect(BUILDING.windows[1]!.y).toBe(bottom.y);
  });

  it('窗口越界查询返回 undefined，不会读到别栋的窗', () => {
    expect(apartmentWindowAt(0, -1)).toBeUndefined();
    expect(apartmentWindowAt(0, APARTMENT_WINDOW_COUNT)).toBeUndefined();
    expect(apartmentWindowAt(0, Number.NaN)).toBeUndefined();
    expect(apartmentWindowAt(0, 0)?.index).toBe(0);
    // 越界 slot 夹回 0 而不是越界读
    expect(apartmentWindowAt(4, 0)?.index).toBe(0);
  });
});

describe('公寓门前口袋花园（ADR-0101）', () => {
  it('落在生活区里，与楼体留出 16px 台阶，南沿不压生活大街', () => {
    expect(isOnLand(APARTMENT_GARDEN.x, APARTMENT_GARDEN.y, 20)).toBe(true);
    expect(isOnLand(APARTMENT_GARDEN.x + APARTMENT_GARDEN.w, APARTMENT_GARDEN.y + APARTMENT_GARDEN.h, 20)).toBe(
      true,
    );
    expect(rectsOverlap(APARTMENT_GARDEN, BUILDING.rect), '花园压到楼体').toBe(false);
    expect(APARTMENT_GARDEN.y - (BUILDING.rect.y + BUILDING.rect.h)).toBe(16);
    for (const paving of WORLD_LAYOUT.paved) {
      expect(rectsOverlap(APARTMENT_GARDEN, paving), '花园压到铺装').toBe(false);
    }
    for (const lake of WORLD_LAYOUT.lakes) {
      expect(overlapsPolygon(APARTMENT_GARDEN, lake.points), '花园长在水里').toBe(false);
    }
  });

  it('石板小径从门口台阶直通花园南沿，中线对齐 301 门牌', () => {
    expect(rectContains(APARTMENT_GARDEN, APARTMENT_GARDEN_PATH.x, APARTMENT_GARDEN_PATH.y)).toBe(true);
    expect(
      rectContains(
        APARTMENT_GARDEN,
        APARTMENT_GARDEN_PATH.x + APARTMENT_GARDEN_PATH.w,
        APARTMENT_GARDEN_PATH.y + APARTMENT_GARDEN_PATH.h,
      ),
    ).toBe(true);
    expect(APARTMENT_GARDEN_PATH.x + APARTMENT_GARDEN_PATH.w / 2).toBe(BUILDING.door.x);
    // 起点在门口台阶之上，终点正好落在花园南沿
    expect(APARTMENT_GARDEN_PATH.y).toBeLessThanOrEqual(BUILDING.outside.y);
    expect(APARTMENT_GARDEN_PATH.y + APARTMENT_GARDEN_PATH.h).toBe(APARTMENT_GARDEN.y + APARTMENT_GARDEN.h);
  });

  it('花园是纯装饰：地面能自由踩，不新增碰撞', () => {
    // 沿小径中线从门口走到花园南沿，每一步都站得住
    for (let y = BUILDING.outside.y; y <= APARTMENT_GARDEN_PATH.y + APARTMENT_GARDEN_PATH.h - 8; y += 24) {
      expect(isBlocked(BUILDING.door.x, y), `小径 ${y} 处被挡住`).toBe(false);
    }
    // 花园里没有楼体之外的新碰撞体
    for (const solid of WORLD_LAYOUT.solids) {
      if (isOwnWall(BUILDING.rect, solid)) continue;
      expect(rectsOverlap(APARTMENT_GARDEN, solid), '花园里多了一块碰撞体').toBe(false);
    }
  });

  it('花园里不长树，但留了一畦花圃', () => {
    const allTrees = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];
    for (const tree of allTrees) {
      expect(rectContains(APARTMENT_GARDEN, tree.x, tree.y), `树 ${tree.x},${tree.y} 长进花园`).toBe(false);
    }
    const patches = WORLD_LAYOUT.flowerFields.filter((field) => {
      const cx = field.rect.x + field.rect.w / 2;
      const cy = field.rect.y + field.rect.h / 2;
      return rectContains(APARTMENT_GARDEN, cx, cy);
    });
    expect(patches.length).toBeGreaterThanOrEqual(1);
    for (const patch of patches) {
      expect(rectsOverlap(patch.rect, APARTMENT_GARDEN_PATH), '花圃压到石板小径').toBe(false);
      expect(rectsOverlap(patch.rect, BUILDING.rect), '花圃压到楼体').toBe(false);
    }
  });
});
