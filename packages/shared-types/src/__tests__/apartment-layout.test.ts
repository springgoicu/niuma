import { describe, expect, it } from 'vitest';
import {
  APARTMENT_ROOM_COUNT,
  APARTMENT_SPECS,
  ROOM_CELL,
  ROOM_CELL_COUNT,
  ROOM_GRID_COLS,
  ROOM_GRID_ROWS,
  apartmentByDoorNo,
  apartmentBySlot,
  cellCenter,
} from '../world/apartment';
import { isBlocked } from '../world/collision';
import { WORLD_LAYOUT, WORLD_CENTER, isOnLand } from '../world/layout';
import { pointInPolygon, rectContains, type Point, type WorldRect } from '../world/geometry';

/**
 * 公寓布局（ADR-0095）：六栋单户小楼绕中央广场铺开。
 *
 * 这组断言只钉「位置与可达性」——楼体互不重叠、不压路/水/别的建筑、
 * 门口站得住、栋与栋之间留出草地，避免以后挪楼时把某栋塞进湖里或堵住别人的门。
 */

function rectGap(a: WorldRect, b: WorldRect): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

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

/** 自己那栋楼的四面墙：不算「压到别的碰撞体」 */
function isOwnWall(own: WorldRect, solid: WorldRect): boolean {
  return own.x - 1 <= solid.x && solid.x + solid.w <= own.x + own.w + 1 && own.y - 1 <= solid.y && solid.y + solid.h <= own.y + own.h + 1;
}

const OTHER_BUILDINGS = WORLD_LAYOUT.buildings.filter((building) => building.name !== '牛马公寓');

describe('牛马公寓布局（ADR-0095）', () => {
  it('六栋楼、门牌 301–306 一一对应', () => {
    expect(APARTMENT_ROOM_COUNT).toBe(6);
    expect(APARTMENT_SPECS).toHaveLength(6);
    expect(APARTMENT_SPECS.map((spec) => spec.doorNo)).toEqual([301, 302, 303, 304, 305, 306]);
    for (const spec of APARTMENT_SPECS) {
      expect(apartmentBySlot(spec.slot)).toBe(spec);
      expect(apartmentByDoorNo(spec.doorNo)).toBe(spec);
    }
    expect(apartmentByDoorNo(299)).toBeUndefined();
    expect(apartmentByDoorNo(307)).toBeUndefined();
  });

  it('楼体两两不相交，栋间留出不小于 300px 的草地', () => {
    for (let i = 0; i < APARTMENT_SPECS.length; i += 1) {
      for (let j = i + 1; j < APARTMENT_SPECS.length; j += 1) {
        const a = APARTMENT_SPECS[i]!.rect;
        const b = APARTMENT_SPECS[j]!.rect;
        expect(rectsOverlap(a, b), `${i + 1} 栋与 ${j + 1} 栋重叠`).toBe(false);
        expect(rectGap(a, b), `${i + 1} 栋与 ${j + 1} 栋贴得太近`).toBeGreaterThanOrEqual(300);
      }
    }
  });

  it('六栋都铺在中央广场周边，不再堆到岛角', () => {
    for (const spec of APARTMENT_SPECS) {
      const cx = spec.rect.x + spec.rect.w / 2;
      const cy = spec.rect.y + spec.rect.h / 2;
      const distance = Math.hypot(cx - WORLD_CENTER.x, cy - WORLD_CENTER.y);
      expect(distance, `${spec.doorNo} 栋离广场太远`).toBeLessThanOrEqual(1700);
    }
  });

  it('不压别的建筑、路面、水面与既有碰撞体', () => {
    for (const spec of APARTMENT_SPECS) {
      const rect = spec.rect;
      expect(isOnLand(rect.x, rect.y), `${spec.doorNo} 栋贴着岛界`).toBe(true);
      expect(isOnLand(rect.x + rect.w, rect.y + rect.h), `${spec.doorNo} 栋贴着岛界`).toBe(true);
      for (const building of OTHER_BUILDINGS) {
        expect(rectsOverlap(rect, building.rect, 24), `${spec.doorNo} 栋压到 ${building.name}`).toBe(false);
      }
      for (const lake of WORLD_LAYOUT.lakes) {
        expect(overlapsPolygon(rect, lake.points), `${spec.doorNo} 栋长在水里`).toBe(false);
      }
      for (const path of WORLD_LAYOUT.paths) {
        expect(overlapsPolygon(rect, path.polygon), `${spec.doorNo} 栋压在路面上`).toBe(false);
      }
      for (const solid of WORLD_LAYOUT.solids) {
        if (isOwnWall(rect, solid)) continue;
        expect(rectsOverlap(rect, solid), `${spec.doorNo} 栋压到既有碰撞体`).toBe(false);
      }
    }
  });

  it('门口台阶与四面墙外都能站人', () => {
    for (const spec of APARTMENT_SPECS) {
      const { rect } = spec;
      expect(isOnLand(spec.outside.x, spec.outside.y, 20), `${spec.doorNo} 门口落到岛外`).toBe(true);
      expect(isBlocked(spec.outside.x, spec.outside.y), `${spec.doorNo} 门口台阶被挡住`).toBe(false);
      // 探针离墙 24px：玩家半径 9，走得过就算「墙外有站人的地方」
      const probes: Array<[string, number, number]> = [
        ['北', rect.x + rect.w / 2, rect.y - 24],
        ['西', rect.x - 24, rect.y + rect.h / 2],
        ['东', rect.x + rect.w + 24, rect.y + rect.h / 2],
        ['南', spec.outside.x, rect.y + rect.h + 60],
      ];
      for (const [side, x, y] of probes) {
        expect(isBlocked(x, y), `${spec.doorNo} 栋${side}侧被堵住`).toBe(false);
      }
    }
  });

  it('6×4 家具网格完整落在室内矩形里', () => {
    expect(ROOM_GRID_COLS * ROOM_GRID_ROWS).toBe(ROOM_CELL_COUNT);
    expect(ROOM_CELL_COUNT).toBeGreaterThanOrEqual(20);
    for (const spec of APARTMENT_SPECS) {
      const gridRight = spec.gridOrigin.x + ROOM_GRID_COLS * ROOM_CELL;
      const gridBottom = spec.gridOrigin.y + ROOM_GRID_ROWS * ROOM_CELL;
      expect(spec.gridOrigin.x).toBeGreaterThanOrEqual(spec.interior.x);
      expect(spec.gridOrigin.y).toBeGreaterThanOrEqual(spec.interior.y);
      expect(gridRight).toBeLessThanOrEqual(spec.interior.x + spec.interior.w);
      expect(gridBottom).toBeLessThanOrEqual(spec.interior.y + spec.interior.h);
      // 首末格中心必须还在室内：摆件不会被画到墙外
      expect(rectContains(spec.interior, cellCenter(spec, 0).x, cellCenter(spec, 0).y)).toBe(true);
      const last = cellCenter(spec, ROOM_CELL_COUNT - 1);
      expect(rectContains(spec.interior, last.x, last.y)).toBe(true);
    }
  });
});
