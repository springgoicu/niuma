import { describe, expect, it } from 'vitest';
import { LOUNGE, MEETING_ROOM, RESTROOM, SOUTH_YARD_PAVING, WORKROOM } from '../world/campus';
import { BOSS_ARENA } from '../world/boss';
import { isBlocked, PLAYER_RADIUS } from '../world/collision';
import { isOnLand, isWaterAt, NAV_TARGETS, type NavTargetId } from '../world/layout';
import { rectContains } from '../world/geometry';

/** 四间房：到达点必须落在自己房间里，且不能退回几何中心 */
const ROOM_OF: Partial<Record<NavTargetId, { x: number; y: number; w: number; h: number }>> = {
  meeting: MEETING_ROOM,
  restroom: RESTROOM,
  lounge: LOUNGE,
  workroom: WORKROOM,
};

/** 户外/独立地标：到达点必须是陆地、不下水，且离岸至少一个身位 */
const OUTDOOR: NavTargetId[] = [
  'park',
  'southYard',
  'theater',
  'jail',
  'pavilion',
  'lakeMoping',
  'lakeChensi',
  'lakeLianyi',
  'bossArena',
];

describe('园区导览到达点（ADR-0040 / ADR-0067）', () => {
  it('13 个目标：id 唯一、名称非空、到达点都落在岛内', () => {
    expect(NAV_TARGETS).toHaveLength(13);
    expect(new Set(NAV_TARGETS.map((target) => target.id)).size).toBe(13);
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

  it('发泄区搬进研发园：到达点在垫内，研发园目标不抢垫子', () => {
    const bossArena = NAV_TARGETS.find((item) => item.id === 'bossArena');
    const southYard = NAV_TARGETS.find((item) => item.id === 'southYard');
    if (!bossArena || !southYard) throw new Error('缺少泄区或研发园导览目标');
    expect(rectContains(BOSS_ARENA, bossArena.arrive.x, bossArena.arrive.y)).toBe(true);
    expect(rectContains(SOUTH_YARD_PAVING, bossArena.arrive.x, bossArena.arrive.y)).toBe(true);
    // 两个目标都在研发园里，但「研发园」必须落在垫外，避免两行都指向同一块垫子
    expect(rectContains(BOSS_ARENA, southYard.arrive.x, southYard.arrive.y)).toBe(false);
  });
});
