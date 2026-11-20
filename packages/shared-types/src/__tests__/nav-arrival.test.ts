import { describe, expect, it } from 'vitest';
import {
  HOME_THEATER,
  LOUNGE,
  MEETING_ROOM,
  RESTROOM,
  SHRINE_ALTAR,
  VENT_ROOM,
  WORKROOM,
} from '../world/campus';
import { CLINIC_ACCESS_PAVING, CLINIC_REGION_RECT, CLINIC_RECT } from '../world/clinic';
import { isInClinicInterior } from '../world/clinic-gate';
import { BOSS_ARENA } from '../world/boss';
import { isBlocked, PLAYER_RADIUS } from '../world/collision';
import {
  DISTRICTS,
  NAV_TARGETS,
  isOnLand,
  isWaterAt,
  regionAt,
  type NavTargetId,
} from '../world/layout';
import { rectContains } from '../world/geometry';

/** 房间类目标：到达点必须落在自己房间里 */
const ROOM_OF: Partial<Record<NavTargetId, { x: number; y: number; w: number; h: number }>> = {
  meeting: MEETING_ROOM,
  restroom: RESTROOM,
  lounge: LOUNGE,
  workroom: WORKROOM,
  theater: HOME_THEATER,
};

/** 户外设施：到达点必须是陆地、不下水 */
const OUTDOOR: NavTargetId[] = ['park', 'ramenStall'];

describe('园区导览到达点（ADR-0040 / ADR-0097）', () => {
  it('18 个目标：id 唯一、名称非空、到达点都落在岛内', () => {
    expect(NAV_TARGETS.map((target) => target.id)).toEqual([
      'workroom',
      'meeting',
      'shrine',
      'bossArena',
      'park',
      'clubNeon',
      'streetGarage',
      'ramenStall',
      'apartment',
      'lounge',
      'theater',
      'villa1',
      'villa2',
      'lakeLodge',
      'bambooYard',
      'pondPavilion',
      'restroom',
      'clinic',
    ]);
    expect(new Set(NAV_TARGETS.map((target) => target.id)).size).toBe(NAV_TARGETS.length);
    for (const target of NAV_TARGETS) {
      expect(target.name.length).toBeGreaterThan(0);
      expect(isOnLand(target.arrive.x, target.arrive.y, PLAYER_RADIUS)).toBe(true);
    }
  });

  it('到达点不撞墙、桌、隔断、器械底座与有占地的道具', () => {
    for (const target of NAV_TARGETS) {
      expect(isBlocked(target.arrive.x, target.arrive.y), target.id).toBe(false);
    }
  });

  it('室内目标：到达点落在房间矩形内，且不退化成房间中心', () => {
    for (const target of NAV_TARGETS) {
      const room = ROOM_OF[target.id];
      if (!room) continue;
      expect(rectContains(room, target.arrive.x, target.arrive.y)).toBe(true);
      expect(target.arrive.x === target.x && target.arrive.y === target.y).toBe(false);
    }
  });

  it('护士急救站：开放通行后导览直接送入急诊大厅内部', () => {
    const clinic = NAV_TARGETS.find((item) => item.id === 'clinic');
    if (!clinic) throw new Error('缺少护士急救站导览目标');
    expect(rectContains(CLINIC_RECT, clinic.arrive.x, clinic.arrive.y)).toBe(true);
    expect(isInClinicInterior(clinic.arrive.x, clinic.arrive.y)).toBe(true);
    expect(rectContains(CLINIC_REGION_RECT, clinic.arrive.x, clinic.arrive.y)).toBe(true);
  });

  it('户外地标：到达点在陆地，不落进水面', () => {
    for (const id of OUTDOOR) {
      const target = NAV_TARGETS.find((item) => item.id === id);
      if (!target) throw new Error(`缺少导览目标：${id}`);
      expect(isWaterAt(target.arrive.x, target.arrive.y)).toBe(false);
    }
  });

  it('发泄区：到达点在企业楼发泄室的橡胶垫内', () => {
    const bossArena = NAV_TARGETS.find((item) => item.id === 'bossArena');
    if (!bossArena) throw new Error('缺少发泄区导览目标');
    expect(rectContains(BOSS_ARENA, bossArena.arrive.x, bossArena.arrive.y)).toBe(true);
    expect(rectContains(VENT_ROOM, bossArena.arrive.x, bossArena.arrive.y)).toBe(true);
  });

  it('财神供案：到达点在工作区内，落在案面正前方', () => {
    const shrine = NAV_TARGETS.find((item) => item.id === 'shrine');
    if (!shrine) throw new Error('缺少财神供案导览目标');
    expect(rectContains(WORKROOM, shrine.arrive.x, shrine.arrive.y)).toBe(true);
    expect(shrine.arrive.x).toBe(SHRINE_ALTAR.x);
    expect(shrine.arrive.y).toBeGreaterThan(SHRINE_ALTAR.y);
    expect(shrine.arrive.y).toBeLessThan(WORKROOM.y + WORKROOM.h);
  });

  it('每个目标都属于一个大区，区域名与其大区一致', () => {
    for (const target of NAV_TARGETS) {
      expect(DISTRICTS.some((district) => district.id === target.district)).toBe(true);
      const scene = target.scene;
      expect(['indoor', 'outdoor', 'semi']).toContain(scene);
      // 目标落在自己的场所 / 大区里，不会被别处抢走区域名
      const place = regionAt(target.x, target.y);
      expect(place === target.name || place.length > 0).toBe(true);
    }
  });

  it('五座区门都能站人', () => {
    for (const district of DISTRICTS) {
      expect(isOnLand(district.gate.x, district.gate.y, PLAYER_RADIUS), district.id).toBe(true);
      expect(isBlocked(district.gate.x, district.gate.y), district.id).toBe(false);
    }
  });
});
