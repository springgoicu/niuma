import { describe, expect, it } from 'vitest';
import {
  APARTMENT_ALLEY,
  APARTMENT_ROOM_COUNT,
  APARTMENT_SPECS,
  APARTMENT_WINDOW_COLS,
  APARTMENT_WINDOW_COUNT,
  APARTMENT_WINDOW_ROWS,
  apartmentByDoorNo,
  apartmentBySlot,
  apartmentWindowAt,
} from '../world/apartment';
import { apartmentDoorSlotAt, apartmentDoorHotspotId, hotspotsOfKind } from '../world/hotspots';
import { isBlocked } from '../world/collision';
import { WORLD_LAYOUT, WORLD_CENTER, isOnLand } from '../world/layout';
import { pointInPolygon, rectContains, type Point, type WorldRect } from '../world/geometry';

/**
 * 公寓布局（ADR-0095 / ADR-0098）：六栋单户小楼绕中央广场铺开，楼里进不去，
 * 探头只从外立面窗口露出。
 *
 * 这组断言只钉「位置与可达性」——楼体互不重叠、不压路/水/别的建筑、门口站得住、
 * 20 个窗口整整齐齐落在楼体上且互不重叠，避免以后挪楼时把某栋塞进湖里或堵住别人的门。
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

describe('牛马公寓布局（ADR-0095 / ADR-0098）', () => {
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

  it('楼体两两不相交，栋间留出不小于 48px 的巷子（ADR-0099）', () => {
    for (let i = 0; i < APARTMENT_SPECS.length; i += 1) {
      for (let j = i + 1; j < APARTMENT_SPECS.length; j += 1) {
        const a = APARTMENT_SPECS[i]!.rect;
        const b = APARTMENT_SPECS[j]!.rect;
        expect(rectsOverlap(a, b), `${i + 1} 栋与 ${j + 1} 栋重叠`).toBe(false);
        expect(rectGap(a, b), `${i + 1} 栋与 ${j + 1} 栋贴得太近`).toBeGreaterThanOrEqual(APARTMENT_ALLEY);
      }
    }
  });

  it('301/302 与 304/305 之间的巷道正好是 APARTMENT_ALLEY，别处都更宽', () => {
    // 同一排的中列巷道是全场最窄的一条：贴墙斜走时的余量由它决定
    expect(APARTMENT_SPECS[1]!.rect.x - (APARTMENT_SPECS[0]!.rect.x + APARTMENT_SPECS[0]!.rect.w)).toBe(
      APARTMENT_ALLEY,
    );
    expect(APARTMENT_SPECS[4]!.rect.x - (APARTMENT_SPECS[3]!.rect.x + APARTMENT_SPECS[3]!.rect.w)).toBe(
      APARTMENT_ALLEY,
    );
    // 东排（303 / 306）与中列之间必须比巷道更宽，否则「中列挪 8px」会把东侧挤窄
    expect(APARTMENT_SPECS[2]!.rect.x - (APARTMENT_SPECS[1]!.rect.x + APARTMENT_SPECS[1]!.rect.w)).toBeGreaterThan(
      APARTMENT_ALLEY,
    );
    expect(APARTMENT_SPECS[5]!.rect.x - (APARTMENT_SPECS[4]!.rect.x + APARTMENT_SPECS[4]!.rect.w)).toBeGreaterThan(
      APARTMENT_ALLEY,
    );
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
        expect(rectsOverlap(rect, building.rect, 24), `${spec.doorNo} 栋压到 ${building.name}`).toBe(
          false,
        );
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

  it('楼体整块实心：人走不进楼里，门口台阶站得住', () => {
    for (const spec of APARTMENT_SPECS) {
      const { rect } = spec;
      expect(isOnLand(spec.outside.x, spec.outside.y, 20), `${spec.doorNo} 门口落到岛外`).toBe(true);
      expect(isBlocked(spec.outside.x, spec.outside.y), `${spec.doorNo} 门口台阶被挡住`).toBe(false);
      expect(isBlocked(rect.x + rect.w / 2, rect.y + rect.h / 2), `${spec.doorNo} 楼里还能走`).toBe(
        true,
      );
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

  it('门口热区只认脚下这扇门，且六栋各有一条', () => {
    const doors = hotspotsOfKind('apartmentDoor');
    expect(doors).toHaveLength(6);
    for (const spec of APARTMENT_SPECS) {
      expect(doors.map((def) => def.id)).toContain(apartmentDoorHotspotId(spec.slot));
      expect(apartmentDoorSlotAt(spec.door.x, spec.door.y)).toBe(spec.slot);
    }
    // 远处按 F 不该算站在门口
    expect(apartmentDoorSlotAt(WORLD_CENTER.x, WORLD_CENTER.y)).toBe(-1);
  });

  it('每栋 4×5 共 20 个窗口，全部落在楼体上且互不重叠', () => {
    expect(APARTMENT_WINDOW_ROWS * APARTMENT_WINDOW_COLS).toBe(APARTMENT_WINDOW_COUNT);
    for (const spec of APARTMENT_SPECS) {
      expect(spec.windows).toHaveLength(APARTMENT_WINDOW_COUNT);
      const rect = spec.rect;
      const seen = new Set<string>();
      for (const [index, window] of spec.windows.entries()) {
        expect(window.index).toBe(index);
        expect(rectContains(rect, window.cx, window.cy), `${spec.doorNo} 号窗在楼外`).toBe(true);
        expect(window.x).toBeGreaterThan(rect.x);
        expect(window.y).toBeGreaterThan(rect.y);
        expect(window.x + window.w).toBeLessThan(rect.x + rect.w);
        expect(window.y + window.h).toBeLessThan(rect.y + rect.h);
        expect(seen.has(`${window.x},${window.y}`)).toBe(false);
        seen.add(`${window.x},${window.y}`);
      }
      // 上层的 y 更小、右边的 x 更大：编号顺序（从下往上、从左往右）可读
      const bottom = spec.windows[0]!;
      const topFloor = spec.windows[APARTMENT_WINDOW_COUNT - 1]!;
      expect(topFloor.y).toBeLessThan(bottom.y);
      expect(spec.windows[1]!.x).toBeGreaterThan(bottom.x);
      expect(spec.windows[1]!.y).toBe(bottom.y);
    }
  });

  it('窗口越界查询返回 undefined，不会读到别栋的窗', () => {
    expect(apartmentWindowAt(0, -1)).toBeUndefined();
    expect(apartmentWindowAt(0, APARTMENT_WINDOW_COUNT)).toBeUndefined();
    expect(apartmentWindowAt(0, Number.NaN)).toBeUndefined();
    expect(apartmentWindowAt(0, 0)?.index).toBe(0);
  });
});
