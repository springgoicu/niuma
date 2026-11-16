import { describe, expect, it } from 'vitest';
import {
  CAMPUS_RECT,
  COMPANY_CORRIDOR,
  CORRIDOR_H,
  HOME_THEATER,
  JAIL,
  LOUNGE,
  MEETING_ROOM,
  RESTROOM,
  RESTROOM_H,
  RESTROOM_STALLS,
  RESTROOM_W,
  ROOM_H,
  ROOM_W,
  VENT_ROOM,
  WALL_THICKNESS,
  WORKROOM,
} from '../world/campus';
import { PLAYER_RADIUS } from '../world/collision';
import { WORLD_CENTER, WORLD_LAYOUT, regionAt } from '../world/layout';
import { rectContains, rectExpanded, type WorldRect } from '../world/geometry';

/**
 * 企业楼与三处独立房间（ADR-0097 / ADR-0099 / ADR-0103）：
 * - 企业楼是一栋 920×776 的两层小楼：北排工作区 / 会议室，中间一条 56px 走廊，南排一整间发泄室；
 * - 宿舍区、影音室、卫生间、小黑屋各自独立成栋，落在各自的大区里；
 * - ADR-0103 之后只有卫生间与小黑屋还砌墙，其余房间都是开放平面，边界交给地面材质。
 */

const { solids, seats, props } = WORLD_LAYOUT;

function rectsOverlap(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function wallAt(x: number, y: number): boolean {
  return solids.some(
    (solid) => solid.kind === 'wall' && x >= solid.x && x < solid.x + solid.w && y >= solid.y && y < solid.y + solid.h,
  );
}

function inside(rect: WorldRect, x: number, y: number): boolean {
  return rectContains(rect, x, y);
}

describe('企业楼（ADR-0097）', () => {
  it('北排两间 460×360 并排，中间 56px 走廊，南排整间发泄室 920×360', () => {
    for (const room of [WORKROOM, MEETING_ROOM]) {
      expect(room.w).toBe(ROOM_W);
      expect(room.h).toBe(ROOM_H);
    }
    // 工作区贴楼西北角，会议室贴东北角，两间左右相接
    expect(WORKROOM.x).toBe(CAMPUS_RECT.x);
    expect(WORKROOM.y).toBe(CAMPUS_RECT.y);
    expect(MEETING_ROOM.x).toBe(WORKROOM.x + WORKROOM.w);
    expect(MEETING_ROOM.y).toBe(CAMPUS_RECT.y);
    expect(MEETING_ROOM.x + MEETING_ROOM.w).toBe(CAMPUS_RECT.x + CAMPUS_RECT.w);
    // 走廊正好夹在南北两排之间（ADR-0099：40 → 56）
    expect(COMPANY_CORRIDOR.y).toBe(CAMPUS_RECT.y + ROOM_H);
    expect(COMPANY_CORRIDOR.h).toBe(CORRIDOR_H);
    expect(COMPANY_CORRIDOR.h).toBe(56);
    // 楼体只由两排房间 + 走廊决定：多出来的 16px 全部给走廊，房间不缩水
    expect(CAMPUS_RECT.h).toBe(ROOM_H * 2 + CORRIDOR_H);
    // 发泄室占满整排，宽 = 楼宽
    expect(VENT_ROOM.w).toBe(CAMPUS_RECT.w);
    expect(VENT_ROOM.h).toBe(ROOM_H);
    expect(VENT_ROOM.y).toBe(COMPANY_CORRIDOR.y + COMPANY_CORRIDOR.h);
    expect(VENT_ROOM.y + VENT_ROOM.h).toBe(CAMPUS_RECT.y + CAMPUS_RECT.h);
    // 通行余量：走廊净宽要容得下「两人交错」= 4 个半径，并留出 ≥8px 的贴墙余量
    expect(COMPANY_CORRIDOR.h).toBeGreaterThanOrEqual(PLAYER_RADIUS * 4 + 8);
  });

  it('宿舍区与卫生间各自独立，不贴在企业楼里', () => {
    expect(rectsOverlap(LOUNGE, CAMPUS_RECT)).toBe(false);
    expect(rectsOverlap(RESTROOM, CAMPUS_RECT)).toBe(false);
    expect(RESTROOM.w).toBe(RESTROOM_W);
    expect(RESTROOM.h).toBe(RESTROOM_H);
  });

  it('ADR-0103：开放平面的房间矩形内没有任何墙体', () => {
    for (const room of [WORKROOM, MEETING_ROOM, VENT_ROOM, LOUNGE, HOME_THEATER]) {
      const walls = solids.filter((solid) => solid.kind === 'wall' && rectsOverlap(solid, room));
      expect(walls.length, `${regionAt(room.x + room.w / 2, room.y + room.h / 2)} 不该再有外墙`).toBe(0);
    }
    // 卫生间与小黑屋是仅有的两间还砌墙的房间
    for (const room of [RESTROOM, JAIL]) {
      expect(solids.filter((solid) => solid.kind === 'wall' && rectsOverlap(solid, room)).length).toBeGreaterThan(0);
    }
  });

  it('卫生间仍朝北开门、小黑屋仍从西墙进，开放房间四面沿线上都没有墙', () => {
    expect(wallAt(RESTROOM.x + 180, RESTROOM.y + WALL_THICKNESS / 2)).toBe(false);
    expect(wallAt(RESTROOM.x + 40, RESTROOM.y + WALL_THICKNESS / 2)).toBe(true);
    expect(wallAt(JAIL.x + WALL_THICKNESS / 2, JAIL.y + 160)).toBe(false);
    expect(wallAt(JAIL.x + WALL_THICKNESS / 2, JAIL.y + 60)).toBe(true);
    for (const room of [MEETING_ROOM, VENT_ROOM, LOUNGE, HOME_THEATER]) {
      expect(wallAt(room.x + 40, room.y + WALL_THICKNESS / 2)).toBe(false);
      expect(wallAt(room.x + 40, room.y + room.h - WALL_THICKNESS / 2)).toBe(false);
      expect(wallAt(room.x + WALL_THICKNESS / 2, room.y + 40)).toBe(false);
      expect(wallAt(room.x + room.w - WALL_THICKNESS / 2, room.y + 40)).toBe(false);
    }
  });

  it('卫生间是男 / 洗手池 / 女 三区，洗手池在中间', () => {
    const sinks = props.filter((prop) => prop.kind === 'sink' && inside(RESTROOM, prop.x, prop.y));
    expect(sinks.length).toBeGreaterThanOrEqual(2);
    // 中央区夹在两道内隔墙之间：x+110（墙左沿）.. x+220（第二道墙右沿）
    for (const sink of sinks) {
      expect(sink.x).toBeGreaterThan(RESTROOM.x + WALL_THICKNESS + 100);
      expect(sink.x).toBeLessThan(RESTROOM.x + WALL_THICKNESS + 110 + 100);
    }

    const toilets = seats.filter((seat) => seat.kind === 'toilet' && inside(RESTROOM, seat.x, seat.y));
    expect(toilets).toHaveLength(4);
    const west = toilets.filter((seat) => seat.x < RESTROOM.x + RESTROOM.w / 2);
    const east = toilets.filter((seat) => seat.x > RESTROOM.x + RESTROOM.w / 2);
    expect(west).toHaveLength(2);
    expect(east).toHaveLength(2);

    // 两道内隔墙各被门洞断成两段 → 房间内部恰好 4 段纵墙
    const innerWalls = solids.filter(
      (solid) =>
        solid.kind === 'wall' &&
        solid.x > RESTROOM.x + WALL_THICKNESS &&
        solid.x + solid.w < RESTROOM.x + RESTROOM.w - WALL_THICKNESS &&
        solid.y >= RESTROOM.y &&
        solid.y + solid.h <= RESTROOM.y + RESTROOM.h,
    );
    expect(innerWalls).toHaveLength(4);
  });

  it('卫生间每侧两格坑位：隔断夹出两格，格子之间互不重叠', () => {
    expect(RESTROOM_STALLS).toHaveLength(4);
    const partitions = solids.filter(
      (solid) =>
        solid.kind === 'fixture' &&
        solid.w === 6 &&
        solid.y >= RESTROOM.y &&
        solid.y + solid.h <= RESTROOM.y + RESTROOM.h &&
        solid.x > RESTROOM.x &&
        solid.x < RESTROOM.x + RESTROOM.w,
    );
    expect(partitions).toHaveLength(2);
    for (const stall of RESTROOM_STALLS) {
      expect(stall.x).toBeGreaterThanOrEqual(RESTROOM.x + WALL_THICKNESS);
      expect(stall.x + stall.w).toBeLessThanOrEqual(RESTROOM.x + RESTROOM.w - WALL_THICKNESS);
      if (stall.partition) expect(solids).toContainEqual(stall.partition);
    }
    for (let i = 0; i < RESTROOM_STALLS.length; i += 1) {
      for (let j = i + 1; j < RESTROOM_STALLS.length; j += 1) {
        expect(rectsOverlap(RESTROOM_STALLS[i]!, RESTROOM_STALLS[j]!)).toBe(false);
      }
    }
  });

  it('宿舍区是两组上下铺：同 x 的两张床相距 44，并各配一架爬梯', () => {
    const beds = seats.filter((seat) => seat.kind === 'bed' && inside(LOUNGE, seat.x, seat.y));
    expect(beds).toHaveLength(4);
    const byX = new Map<number, number[]>();
    for (const bed of beds) {
      const list = byX.get(bed.x) ?? [];
      list.push(bed.y);
      byX.set(bed.x, list);
    }
    expect(byX.size).toBe(1);
    const ys = [...byX.values()][0]!.sort((a, b) => a - b);
    expect(ys).toHaveLength(4);
    expect(ys[1]! - ys[0]!).toBe(44);
    expect(ys[3]! - ys[2]!).toBe(44);

    const ladders = props.filter((prop) => prop.kind === 'ladder' && inside(LOUNGE, prop.x, prop.y));
    expect(ladders).toHaveLength(2);
    for (const ladder of ladders) {
      expect(beds.some((bed) => Math.hypot(bed.x - ladder.x, bed.y - ladder.y) < 80)).toBe(true);
    }
  });

  it('每处场所门口都有一块 logo 立牌，图标不出四种且不挡路', () => {
    const logos = props.filter((prop) => prop.kind === 'logo');
    expect(logos).toHaveLength(5);
    expect(new Set(logos.map((logo) => logo.variant)).size).toBe(4);
    for (const logo of logos) {
      expect(logo.variant).toBeGreaterThanOrEqual(0);
      expect(logo.variant).toBeLessThan(4);
      // 立牌不参与碰撞：没有任何碰撞体压住它
      for (const solid of solids) {
        expect(inside(solid, logo.x, logo.y)).toBe(false);
      }
    }
    const near = (room: WorldRect) => logos.some((logo) => inside(rectExpanded(room, 80), logo.x, logo.y));
    for (const room of [WORKROOM, MEETING_ROOM, VENT_ROOM, LOUNGE, RESTROOM]) expect(near(room)).toBe(true);
  });

  it('区域名按中央广场 / 场所优先于大区命中', () => {
    expect(regionAt(WORLD_CENTER.x, WORLD_CENTER.y)).toBe('中央迎宾广场');
    expect(regionAt(WORKROOM.x + 230, WORKROOM.y + 180)).toBe('工作区');
    expect(regionAt(MEETING_ROOM.x + 230, MEETING_ROOM.y + 180)).toBe('会议室');
    expect(regionAt(VENT_ROOM.x + 230, VENT_ROOM.y + 180)).toBe('发泄区');
    expect(regionAt(LOUNGE.x + 230, LOUNGE.y + 180)).toBe('宿舍区');
    expect(regionAt(RESTROOM.x + 230, RESTROOM.y + 180)).toBe('卫生间');
  });
});
