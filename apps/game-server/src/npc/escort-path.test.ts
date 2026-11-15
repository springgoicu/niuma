import { describe, expect, it } from 'bun:test';
import {
  CLINIC_ACCESS_PAVING,
  CLINIC_DROP,
  JAIL,
  JAIL_ANCHOR,
  JAIL_DOOR,
  JAIL_DOOR_PAVING,
  NAV_ARRIVALS,
  NAV_TARGETS,
  SPAWN_CENTER,
  WORLD_LAYOUT,
  isBlocked,
} from '@niuma/shared-types';
import { findEscortPath, warmEscortGrid } from './escort-path';

/** 保安从服务广场走过来：门前铺装再往西 100px */
const ROAD = { x: JAIL_DOOR_PAVING.x - 100, y: JAIL_DOOR_PAVING.y + 30 };
const OUTSIDE = { x: JAIL_DOOR_PAVING.x + 20, y: JAIL_DOOR_PAVING.y + 30 };
const INSIDE_NORTH = { x: JAIL_ANCHOR.x, y: JAIL.y + 60 };

/** 4px 采样：光看拐点不够，两拐点之间的连线也不能穿墙 */
function expectSegmentsClear(points: Array<{ x: number; y: number }>): void {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      expect(isBlocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)).toBe(false);
    }
  }
}

function pathLength(points: Array<{ x: number; y: number }>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  }
  return length;
}

describe('押送寻路（ADR-0072 / ADR-0097）', () => {
  it('从服务广场穿过西门走到反省点', () => {
    warmEscortGrid();
    const path = findEscortPath(ROAD, JAIL_ANCHOR);
    expect(path).not.toBeNull();
    const points = path!;
    // 首尾是精确点，不是网格中心
    expect(points[0]).toEqual(ROAD);
    expect(points[points.length - 1]).toEqual(JAIL_ANCHOR);
    expectSegmentsClear(points);
  });

  it('从广场进屋北侧：不能斜穿北墙，必须从西门进', () => {
    const path = findEscortPath(ROAD, INSIDE_NORTH);
    expect(path).not.toBeNull();
    const points = path!;
    expect(points.length).toBeGreaterThan(2);
    expectSegmentsClear(points);
    // 一端在墙外、一端在墙内，中间必然经过西墙门洞
    expect(points.some((point) => point.x < JAIL.x)).toBe(true);
    expect(points.some((point) => point.x > JAIL.x + 40)).toBe(true);
    expect(pathLength(points)).toBeGreaterThan(300);
  });

  it('从屋北外侧绕到屋南外侧：不穿北/东/南墙，只能绕行或走西门', () => {
    const path = findEscortPath(
      { x: JAIL_ANCHOR.x, y: JAIL.y - 80 },
      { x: JAIL_ANCHOR.x, y: JAIL.y + JAIL.h + 80 },
    );
    expect(path).not.toBeNull();
    const points = path!;
    expectSegmentsClear(points);
    // 直线约 400px，绕西门必须明显更长
    expect(pathLength(points)).toBeGreaterThan(600);
  });

  it('门框与墙体本身不可走，门口铺装可走', () => {
    expect(isBlocked(OUTSIDE.x, OUTSIDE.y)).toBe(false);
    expect(isBlocked(JAIL.x, JAIL_DOOR.from - 12)).toBe(true);
    expect(isBlocked(JAIL.x, JAIL_DOOR.to + 12)).toBe(true);
  });

  it('起终点相同也返回可消费的两点路径', () => {
    const path = findEscortPath(ROAD, ROAD);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    expect(path![0]).toEqual(ROAD);
  });
});

/**
 * 门口防卡位的押送侧回归（与 apps/web 的 `door-clearance.test.ts` 成对）。
 *
 * 押送网格是 24px、按格心采样：60px 门洞在网格上只剩 1–2 个可走格。
 * 这里不写任何门洞坐标，直接拿 12 个导览到达点当终点，
 * 保证「老板把谁拖去小黑屋 / 送去急救站」这类跨门任务都还有解；
 * 无解时 `findEscortPath` 返回 null，保安会放弃任务——那正是最该提前炸掉的回归。
 */
describe('押送穿门（24px 网格仍过得了 60px 门洞）', () => {
  it('从出生点到 12 个导览目标都有押送路线，且沿线不穿墙', () => {
    warmEscortGrid();
    for (const target of NAV_TARGETS) {
      const path = findEscortPath(SPAWN_CENTER, target.arrive);
      expect(path, `押送不到 ${target.name}`).not.toBeNull();
      expectSegmentsClear(path!);
    }
  });

  it('卫生间北门：门外 40px 与门内到达点之间能连上', () => {
    // 房间矩形按显示名反查（与室内美术 / 灯光同一把稳定键），不另写一份坐标
    const restroom = WORLD_LAYOUT.buildings.find((item) => item.name === '卫生间');
    expect(restroom).toBeDefined();
    const outside = { x: restroom!.rect.x + 180, y: restroom!.rect.y - 40 };
    const path = findEscortPath(outside, NAV_ARRIVALS.restroom);
    expect(path).not.toBeNull();
    expectSegmentsClear(path!);
    // 真的穿过了北墙那条线，而不是绕到别处
    expect(path!.some((point) => point.y > restroom!.rect.y)).toBe(true);
    expect(path!.some((point) => point.y < restroom!.rect.y)).toBe(true);
  });

  it('急救站人行门：东侧广场 → 站内落点能连上', () => {
    const outside = { x: CLINIC_ACCESS_PAVING.x - 40, y: CLINIC_ACCESS_PAVING.y + 28 };
    const path = findEscortPath(outside, CLINIC_DROP);
    expect(path).not.toBeNull();
    expectSegmentsClear(path!);
    expect(path!.some((point) => point.x > CLINIC_ACCESS_PAVING.x + 10)).toBe(true);
  });
});
