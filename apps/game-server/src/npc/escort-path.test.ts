import { describe, expect, it } from 'bun:test';
import { JAIL, JAIL_ANCHOR, isBlocked } from '@niuma/shared-types';
import { findEscortPath, warmEscortGrid } from './escort-path';

const OUTSIDE = { x: 4270, y: 4950 };
const ROAD = { x: 4096, y: 4950 };
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

describe('押送寻路（ADR-0072）', () => {
  it('从南向主路穿过西门走到反省点', () => {
    warmEscortGrid();
    const path = findEscortPath(ROAD, JAIL_ANCHOR);
    expect(path).not.toBeNull();
    const points = path!;
    // 首尾是精确点，不是网格中心
    expect(points[0]).toEqual(ROAD);
    expect(points[points.length - 1]).toEqual(JAIL_ANCHOR);
    // 直线正好穿过门洞（4920–4980），所以允许被简化成两段
    expectSegmentsClear(points);
  });

  it('从主路进屋北侧：不能斜穿北墙，必须从西门进', () => {
    const path = findEscortPath(ROAD, INSIDE_NORTH);
    expect(path).not.toBeNull();
    const points = path!;
    expect(points.length).toBeGreaterThan(2);
    expectSegmentsClear(points);
    // 一端在墙外、一端在墙内，中间必然经过西墙门洞
    expect(points.some((point) => point.x < JAIL.x)).toBe(true);
    expect(points.some((point) => point.x > JAIL.x + 40)).toBe(true);
    expect(pathLength(points)).toBeGreaterThan(450);
  });

  it('从屋北外侧绕到屋南外侧：不穿北/东/南墙，只能绕行或走西门', () => {
    const path = findEscortPath(
      { x: JAIL_ANCHOR.x, y: JAIL.y - 80 },
      { x: JAIL_ANCHOR.x, y: JAIL.y + JAIL.h + 80 },
    );
    expect(path).not.toBeNull();
    const points = path!;
    expectSegmentsClear(points);
    // 起终点被院落挤到最近的可走格，直线约 400px；绕行明显更长
    expect(pathLength(points)).toBeGreaterThan(700);
  });

  it('门框与墙体本身不可走，门口铺装可走', () => {
    expect(isBlocked(OUTSIDE.x, OUTSIDE.y)).toBe(false);
    expect(isBlocked(JAIL.x, 4912)).toBe(true);
    expect(isBlocked(JAIL.x, 4988)).toBe(true);
  });

  it('起终点相同也返回可消费的两点路径', () => {
    const path = findEscortPath(ROAD, ROAD);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThanOrEqual(2);
    expect(path![0]).toEqual(ROAD);
  });
});
