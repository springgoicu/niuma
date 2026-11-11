import { describe, expect, it } from 'vitest';
import { NAV_TARGETS, type NavTargetId } from '../world/layout';
import { LOUNGE, MEETING_ROOM, RESTROOM, WORKROOM } from '../world/campus';
import { isBlocked, resolveMotion } from '../world/collision';
import { rectContains } from '../world/geometry';

/** 每个导览目标对应的房间矩形：到达点必须落在自己房间里 */
const ROOM_OF: Record<NavTargetId, { x: number; y: number; w: number; h: number }> = {
  meeting: MEETING_ROOM,
  restroom: RESTROOM,
  lounge: LOUNGE,
  workroom: WORKROOM,
};

/** 门洞外侧的落脚点：用来验证「从门口直线走到到达点」不会被墙挡住 */
const DOOR_OUTSIDE: Record<NavTargetId, { x: number; y: number }> = {
  // 会议室南门（墙外 x 4726–4786）
  meeting: { x: 4756, y: 3862 },
  // 卫生间北门（墙外 x 4596–4656）
  restroom: { x: 4626, y: 4330 },
  // 宿舍区北门（墙外 x 3536–3596）
  lounge: { x: 3566, y: 4330 },
  // 工作区无墙：从南侧空地直接走进开放区
  workroom: { x: 3566, y: 3862 },
};

describe('园区导览到达点（ADR-0040 / ADR-0044）', () => {
  it('四个目标都带室内到达点，且落在对应房间矩形内', () => {
    expect(NAV_TARGETS).toHaveLength(4);
    for (const target of NAV_TARGETS) {
      expect(rectContains(ROOM_OF[target.id], target.arrive.x, target.arrive.y)).toBe(true);
      // 到达点不能退化成房间中心：中心分别是工位桌、会议桌、床铺与洗手池
      expect(target.arrive.x === target.x && target.arrive.y === target.y).toBe(false);
    }
  });

  it('到达点不撞墙、桌、隔断与有占地的道具', () => {
    for (const target of NAV_TARGETS) {
      expect(isBlocked(target.arrive.x, target.arrive.y)).toBe(false);
    }
  });

  it('从门洞外侧能直线走进到达点，不会被墙卡在门外', () => {
    for (const target of NAV_TARGETS) {
      const outside = DOOR_OUTSIDE[target.id];
      expect(isBlocked(outside.x, outside.y)).toBe(false);
      const moved = resolveMotion(outside.x, outside.y, target.arrive.x, target.arrive.y);
      const gap = Math.hypot(moved.x - target.arrive.x, moved.y - target.arrive.y);
      expect(gap).toBeLessThan(1);
    }
  });
});
