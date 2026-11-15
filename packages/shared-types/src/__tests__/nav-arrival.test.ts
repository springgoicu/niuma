import { describe, expect, it } from 'vitest';
import { LOUNGE, MEETING_ROOM, RESTROOM, SOUTH_YARD_PAVING, WORKROOM } from '../world/campus';
import { BOSS_ARENA } from '../world/boss';
import { RING_ARENA, RING_EXIT, RING_NEAR_PX } from '../world/ring';
import { isBlocked, PLAYER_RADIUS } from '../world/collision';
import { isOnLand, isWaterAt, NAV_TARGETS, SHRINE_ALTAR, type NavTargetId } from '../world/layout';
import { rectContains } from '../world/geometry';

/** 四间房：到达点必须落在自己房间里，且不能退回几何中心 */
const ROOM_OF: Partial<Record<NavTargetId, { x: number; y: number; w: number; h: number }>> = {
  meeting: MEETING_ROOM,
  restroom: RESTROOM,
  lounge: LOUNGE,
  workroom: WORKROOM,
};

/** 户外设施：到达点必须是陆地、不下水，且离岸至少一个身位 */
const OUTDOOR: NavTargetId[] = ['park', 'bossArena', 'ring'];

/** 点到矩形的最短距离：用来断言擂台落点在报名半径内 */
function distanceToRect(
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  x: number,
  y: number,
): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

describe('园区导览到达点（ADR-0040 / ADR-0078）', () => {
  it('12 个目标：id 唯一、名称非空、到达点都落在岛内', () => {
    // 四间房 + 供案 + 游乐园 + 发泄区 + 八角笼 + 赌场 + 两栋小院 + 公寓（ADR-0087）
    expect(NAV_TARGETS.map((target) => target.id)).toEqual([
      'workroom',
      'meeting',
      'restroom',
      'lounge',
      'shrine',
      'park',
      'bossArena',
      'ring',
      'diceHall',
      'villa1',
      'villa2',
      'apartment',
    ]);
    expect(new Set(NAV_TARGETS.map((target) => target.id)).size).toBe(NAV_TARGETS.length);
    for (const target of NAV_TARGETS) {
      expect(target.name.length).toBeGreaterThan(0);
      expect(isOnLand(target.arrive.x, target.arrive.y, PLAYER_RADIUS)).toBe(true);
    }
  });

  it('到达点不撞墙、桌、隔断、器械底座与有占地的道具', () => {
    for (const target of NAV_TARGETS) {
      expect(isBlocked(target.arrive.x, target.arrive.y)).toBe(false);
    }
  });

  it('室内四间：到达点落在房间矩形内，且不退化成房间中心', () => {
    for (const target of NAV_TARGETS) {
      const room = ROOM_OF[target.id];
      if (!room) continue;
      expect(rectContains(room, target.arrive.x, target.arrive.y)).toBe(true);
      expect(target.arrive.x === target.x && target.arrive.y === target.y).toBe(false);
    }
  });

  it('园区地标：到达点在陆地，不落进水面', () => {
    for (const id of OUTDOOR) {
      const target = NAV_TARGETS.find((item) => item.id === id);
      if (!target) throw new Error(`缺少导览目标：${id}`);
      expect(isWaterAt(target.arrive.x, target.arrive.y)).toBe(false);
    }
  });

  it('发泄区：到达点在垫内，也在研发园铺装上', () => {
    const bossArena = NAV_TARGETS.find((item) => item.id === 'bossArena');
    if (!bossArena) throw new Error('缺少发泄区导览目标');
    expect(rectContains(BOSS_ARENA, bossArena.arrive.x, bossArena.arrive.y)).toBe(true);
    expect(rectContains(SOUTH_YARD_PAVING, bossArena.arrive.x, bossArena.arrive.y)).toBe(true);
  });

  it('擂台：到达点在围绳外，且落在报名半径内', () => {
    const ring = NAV_TARGETS.find((item) => item.id === 'ring');
    if (!ring) throw new Error('缺少擂台导览目标');
    // 非参赛者不能踏入围绳：落点必须在场外，否则寻路会把人顶在绳边
    expect(rectContains(RING_ARENA, ring.arrive.x, ring.arrive.y)).toBe(false);
    expect(distanceToRect(RING_ARENA, ring.arrive.x, ring.arrive.y)).toBeLessThanOrEqual(RING_NEAR_PX);
    // 到达点就是场边报名点，落地即可按 F
    expect(ring.arrive).toEqual({ x: RING_EXIT.x, y: RING_EXIT.y });
  });

  it('财神供案：到达点在工作区内，落在案面正前方', () => {
    const shrine = NAV_TARGETS.find((item) => item.id === 'shrine');
    if (!shrine) throw new Error('缺少财神供案导览目标');
    expect(rectContains(WORKROOM, shrine.arrive.x, shrine.arrive.y)).toBe(true);
    expect(shrine.arrive.x).toBe(SHRINE_ALTAR.x);
    // 案面底边以南、房间南沿以北：站过去就正对香炉
    expect(shrine.arrive.y).toBeGreaterThan(SHRINE_ALTAR.y);
    expect(shrine.arrive.y).toBeLessThan(WORKROOM.y + WORKROOM.h);
  });
});
