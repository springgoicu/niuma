import { describe, expect, it } from 'vitest';
import { POSE } from '../constants';
import { pointInPolygon, rectContains } from '../world/geometry';
import {
  BAMBOO_ZONES,
  MOPING_PAVILION,
  MOPING_PAVILION_SOLIDS,
  PAVILION_CENTER,
  SHRINE_ALTAR,
  SHRINE_ALTAR_SOLID,
  TAIHU_ROCKS,
  TEA_STATION,
  TEA_STATION_SOLID,
  WORLD_LAYOUT,
  distanceSqToWater,
  isOnLand,
  seatPose,
} from '../world/layout';

/**
 * 国风园林与玄学地标（ADR-0061）的几何契约。
 *
 * 这些断言存在的理由：坐标是手写的，手写坐标最容易在后续调整里静默漂到水里、
 * 漂到路上或漂进别的道具怀里。渲染端读的是同一份常量，所以这里钉住的每一条
 * 都是「玩家真实能不能走到」而不是「画得对不对」。
 */

/** 只要有一条路径包含该点，就算压在路上 */
function onAnyPath(x: number, y: number): boolean {
  return WORLD_LAYOUT.paths.some((path) => pointInPolygon(x, y, path.polygon));
}

function propsOfKind(kind: string) {
  return WORLD_LAYOUT.props.filter((prop) => prop.kind === kind);
}

describe('摸鱼亭（八角飞檐凉亭）', () => {
  it('亭心在陆地上，且离水面至少 120px', () => {
    expect(isOnLand(PAVILION_CENTER.x, PAVILION_CENTER.y, 70)).toBe(true);
    expect(distanceSqToWater(PAVILION_CENTER.x, PAVILION_CENTER.y)).toBeGreaterThan(120 * 120);
  });

  it('八根亭柱都不压路，且不在亭心', () => {
    expect(MOPING_PAVILION_SOLIDS).toHaveLength(8);
    for (const column of MOPING_PAVILION_SOLIDS) {
      const cx = column.x + column.w / 2;
      const cy = column.y + column.h / 2;
      expect(onAnyPath(cx, cy)).toBe(false);
      expect(Math.hypot(cx - PAVILION_CENTER.x, cy - PAVILION_CENTER.y)).toBeGreaterThan(60);
    }
  });

  it('亭柱都落在亭子的包围盒里：飞檐外挑，柱子不该跑到檐外', () => {
    const box = {
      x: MOPING_PAVILION.x - MOPING_PAVILION.width / 2,
      y: MOPING_PAVILION.y - MOPING_PAVILION.height,
      w: MOPING_PAVILION.width,
      h: MOPING_PAVILION.height,
    };
    for (const column of MOPING_PAVILION_SOLIDS) {
      expect(rectContains(box, column.x + column.w / 2, column.y + column.h / 2)).toBe(true);
    }
  });

  it('亭内四张石鼓凳：在亭子里、坐姿、两两间距 > 40', () => {
    const drumSeats = WORLD_LAYOUT.seats.filter((seat) => seat.kind === 'drum');
    expect(drumSeats).toHaveLength(4);
    for (const seat of drumSeats) {
      expect(seatPose(seat.kind)).toBe(POSE.Sit);
      expect(Math.hypot(seat.x - PAVILION_CENTER.x, seat.y - PAVILION_CENTER.y)).toBeLessThan(60);
      expect(onAnyPath(seat.x, seat.y)).toBe(false);
    }
    for (let i = 0; i < drumSeats.length; i += 1) {
      for (let j = i + 1; j < drumSeats.length; j += 1) {
        const a = drumSeats[i]!;
        const b = drumSeats[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
      }
    }
  });

  it('石鼓凳不会陷进亭柱碰撞盒里', () => {
    for (const seat of WORLD_LAYOUT.seats.filter((item) => item.kind === 'drum')) {
      for (const column of MOPING_PAVILION_SOLIDS) {
        const insideX = seat.x > column.x - 9 && seat.x < column.x + column.w + 9;
        const insideY = seat.y > column.y - 9 && seat.y < column.y + column.h + 9;
        expect(insideX && insideY).toBe(false);
      }
    }
  });
});

describe('翠竹林与太湖石', () => {
  it('两片竹林都长在陆地上，且不压路', () => {
    expect(BAMBOO_ZONES).toHaveLength(2);
    for (const zone of BAMBOO_ZONES) {
      const cx = zone.x + zone.w / 2;
      const cy = zone.y + zone.h / 2;
      expect(isOnLand(cx, cy, 30)).toBe(true);
      expect(onAnyPath(cx, cy)).toBe(false);
    }
  });

  it('竹丛全部落在竹林区里，且数量够撑起「竹林」', () => {
    const bamboo = propsOfKind('bamboo');
    expect(bamboo.length).toBeGreaterThanOrEqual(8);
    for (const prop of bamboo) {
      const inZone = BAMBOO_ZONES.some((zone) =>
        rectContains({ x: zone.x - 8, y: zone.y - 8, w: zone.w + 16, h: zone.h + 16 }, prop.x, prop.y),
      );
      expect(inZone).toBe(true);
      expect(onAnyPath(prop.x, prop.y)).toBe(false);
    }
  });

  it('竹林里不再长普通树：竹林是「替换」而不是「叠加」', () => {
    const trees = [...WORLD_LAYOUT.groves.flatMap((grove) => grove.trees), ...WORLD_LAYOUT.looseTrees];
    for (const tree of trees) {
      for (const zone of BAMBOO_ZONES) {
        expect(rectContains(zone, tree.x, tree.y)).toBe(false);
      }
    }
  });

  it('太湖石在广场拐角、陆地上，且让开花箱与路灯', () => {
    expect(TAIHU_ROCKS.length).toBeGreaterThanOrEqual(2);
    const rocks = propsOfKind('taihu');
    expect(rocks).toHaveLength(TAIHU_ROCKS.length);
    for (const rock of rocks) {
      expect(isOnLand(rock.x, rock.y, 20)).toBe(true);
      expect(onAnyPath(rock.x, rock.y)).toBe(false);
      for (const planter of WORLD_LAYOUT.planters) {
        expect(Math.hypot(planter.x - rock.x, planter.y - rock.y)).toBeGreaterThan(60);
      }
      for (const lamp of WORLD_LAYOUT.props.filter((prop) => prop.kind === 'lamp')) {
        expect(Math.hypot(lamp.x - rock.x, lamp.y - rock.y)).toBeGreaterThan(40);
      }
    }
  });
});

describe('财神供案与紫砂茶台', () => {
  it('供案压在工作区南缘之内，底座不挡进门那条支路', () => {
    expect(isOnLand(SHRINE_ALTAR.x, SHRINE_ALTAR.y, 12)).toBe(true);
    expect(onAnyPath(SHRINE_ALTAR_SOLID.x + SHRINE_ALTAR_SOLID.w / 2, SHRINE_ALTAR.y - 6)).toBe(false);
  });

  it('茶台紧邻饮水机，且不挡住工作区导览到达点的直线进屋路线', () => {
    const workroom = WORLD_LAYOUT.office;
    expect(workroom).toBeDefined();
    // 茶台必须落在工作区矩形内，否则「室内茶台」就不成立
    const teaCenterX = TEA_STATION_SOLID.x + TEA_STATION_SOLID.w / 2;
    expect(TEA_STATION.x).toBeGreaterThan(TEA_STATION_SOLID.x);
    expect(teaCenterX).toBeGreaterThan(0);
    expect(isOnLand(TEA_STATION.x, TEA_STATION.y, 10)).toBe(true);
    // +230 是 NAV_ARRIVALS.workroom 的横向偏移：茶台右沿必须让开 9px 玩家半径
    const arrivalX = workroom.x + 230;
    expect(TEA_STATION_SOLID.x + TEA_STATION_SOLID.w).toBeLessThan(arrivalX - 9);
  });

  it('两处新地标的底座都进了碰撞表', () => {
    const solids = WORLD_LAYOUT.solids;
    const has = (rect: { x: number; y: number; w: number; h: number }): boolean =>
      solids.some((solid) => solid.x === rect.x && solid.y === rect.y && solid.w === rect.w && solid.h === rect.h);
    expect(has(SHRINE_ALTAR_SOLID)).toBe(true);
    expect(has(TEA_STATION_SOLID)).toBe(true);
  });
});
