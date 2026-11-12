import { describe, expect, it } from 'vitest';
import {
  CAMPUS_RECT,
  LOUNGE,
  MEETING_ROOM,
  RESTROOM,
  RESTROOM_STALLS,
  ROOM_H,
  ROOM_W,
  WALL_THICKNESS,
  WORKROOM,
} from '../world/campus';
import {
  WORLD_CENTER,
  WORLD_LAYOUT,
  regionAt,
} from '../world/layout';
import { rectContains, rectExpanded, type WorldRect } from '../world/geometry';

/**
 * 四角院落（ADR-0044）：一院四房、门朝中庭、工作区无墙、卫生间三区、
 * 上下铺成对、四区各一块 logo 立牌。这里只断言空间关系，不重复测渲染。
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

describe('四角院落（ADR-0044）', () => {
  it('四间房各贴院落一角，尺寸一致', () => {
    for (const room of [WORKROOM, MEETING_ROOM, LOUNGE, RESTROOM]) {
      expect(room.w).toBe(ROOM_W);
      expect(room.h).toBe(ROOM_H);
      expect(rectContains(rectExpanded(CAMPUS_RECT, 1), room.x, room.y)).toBe(true);
    }
    // 西北 / 东北 / 西南 / 东南
    expect(WORKROOM.x).toBe(CAMPUS_RECT.x);
    expect(WORKROOM.y).toBe(CAMPUS_RECT.y);
    expect(MEETING_ROOM.x + MEETING_ROOM.w).toBe(CAMPUS_RECT.x + CAMPUS_RECT.w);
    expect(MEETING_ROOM.y).toBe(CAMPUS_RECT.y);
    expect(LOUNGE.x).toBe(CAMPUS_RECT.x);
    expect(LOUNGE.y + LOUNGE.h).toBe(CAMPUS_RECT.y + CAMPUS_RECT.h);
    expect(RESTROOM.x + RESTROOM.w).toBe(CAMPUS_RECT.x + CAMPUS_RECT.w);
    expect(RESTROOM.y + RESTROOM.h).toBe(CAMPUS_RECT.y + CAMPUS_RECT.h);
  });

  it('工作区是唯一没有墙的房间', () => {
    expect(solids.filter((solid) => solid.kind === 'wall' && rectsOverlap(solid, WORKROOM))).toHaveLength(0);
    for (const room of [MEETING_ROOM, LOUNGE, RESTROOM]) {
      expect(solids.filter((solid) => solid.kind === 'wall' && rectsOverlap(solid, room)).length).toBeGreaterThan(0);
    }
  });

  it('三间房的门都朝中庭，门洞位置没有墙', () => {
    // 会议室南墙、宿舍区与卫生间北墙各留一扇 60px 门洞
    expect(wallAt(MEETING_ROOM.x + 360, MEETING_ROOM.y + ROOM_H - WALL_THICKNESS / 2)).toBe(false);
    expect(wallAt(LOUNGE.x + 230, LOUNGE.y + WALL_THICKNESS / 2)).toBe(false);
    expect(wallAt(RESTROOM.x + 230, RESTROOM.y + WALL_THICKNESS / 2)).toBe(false);
    // 同一面墙的门洞之外仍然是实体墙
    expect(wallAt(MEETING_ROOM.x + 40, MEETING_ROOM.y + ROOM_H - WALL_THICKNESS / 2)).toBe(true);
    expect(wallAt(LOUNGE.x + 40, LOUNGE.y + WALL_THICKNESS / 2)).toBe(true);
    expect(wallAt(RESTROOM.x + 40, RESTROOM.y + WALL_THICKNESS / 2)).toBe(true);
  });

  it('卫生间是男 / 洗手池 / 女 三区，洗手池在中间', () => {
    const sinks = props.filter((prop) => prop.kind === 'sink' && inside(RESTROOM, prop.x, prop.y));
    expect(sinks.length).toBeGreaterThanOrEqual(2);
    for (const sink of sinks) {
      expect(sink.x).toBeGreaterThan(RESTROOM.x + 160);
      expect(sink.x).toBeLessThan(RESTROOM.x + 300);
    }

    const toilets = seats.filter((seat) => seat.kind === 'toilet' && inside(RESTROOM, seat.x, seat.y));
    expect(toilets).toHaveLength(6);
    const west = toilets.filter((seat) => seat.x < RESTROOM.x + ROOM_W / 2);
    const east = toilets.filter((seat) => seat.x > RESTROOM.x + ROOM_W / 2);
    expect(west).toHaveLength(3);
    expect(east).toHaveLength(3);

    // 两道内隔墙各被门洞断成两段 → 房间内部恰好 4 段纵墙
    const innerWalls = solids.filter(
      (solid) =>
        solid.kind === 'wall' &&
        solid.x > RESTROOM.x + WALL_THICKNESS &&
        solid.x + solid.w < RESTROOM.x + ROOM_W - WALL_THICKNESS &&
        solid.y >= RESTROOM.y &&
        solid.y + solid.h <= RESTROOM.y + ROOM_H,
    );
    expect(innerWalls).toHaveLength(4);
  });

  it('卫生间每侧三格坑位（ADR-0053）：隔断夹出三格，格子之间互不重叠', () => {
    expect(RESTROOM_STALLS).toHaveLength(6);
    // 每侧两片隔断，各自进碰撞表；最后一格贴内隔墙，没有隔断
    const partitions = solids.filter(
      (solid) =>
        solid.kind === 'fixture' &&
        solid.w === 6 &&
        solid.y >= RESTROOM.y &&
        solid.y + solid.h <= RESTROOM.y + ROOM_H &&
        solid.x > RESTROOM.x &&
        solid.x < RESTROOM.x + ROOM_W,
    );
    expect(partitions).toHaveLength(4);
    for (const stall of RESTROOM_STALLS) {
      // 第一格贴西墙内侧、最后一格贴内隔墙：两端都正好落在房间净宽内
      expect(stall.x).toBeGreaterThanOrEqual(RESTROOM.x + WALL_THICKNESS);
      expect(stall.x + stall.w).toBeLessThanOrEqual(RESTROOM.x + ROOM_W - WALL_THICKNESS);
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

  it('四区门口各有一块 logo 立牌，图标互不重复且不挡路', () => {
    const logos = props.filter((prop) => prop.kind === 'logo');
    expect(logos).toHaveLength(4);
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
    for (const room of [WORKROOM, MEETING_ROOM, LOUNGE, RESTROOM]) expect(near(room)).toBe(true);
  });

  it('区域名按中央广场 / 房间优先于办公区命中', () => {
    expect(regionAt(WORLD_CENTER.x, WORLD_CENTER.y)).toBe('中央迎宾广场');
    expect(regionAt(WORKROOM.x + 230, WORKROOM.y + 180)).toBe('工作区');
    expect(regionAt(MEETING_ROOM.x + 230, MEETING_ROOM.y + 180)).toBe('会议室');
    expect(regionAt(LOUNGE.x + 230, LOUNGE.y + 180)).toBe('宿舍区');
    expect(regionAt(RESTROOM.x + 230, RESTROOM.y + 180)).toBe('卫生间');
  });
});
