import { describe, expect, it } from 'vitest';
import {
  DIRECTION,
  PLAYER_RADIUS,
  SIT_RANGE,
  WORLD_LAYOUT,
  decodeSeatState,
  encodeSeatState,
  findNearestSeat,
  isBlocked,
  isOnLand,
  isWaterAt,
  seatById,
  type SolidRect,
} from '../index';

const { seats, solids, props, desks } = WORLD_LAYOUT;

function rectsOverlap(a: SolidRect, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('座位布局', () => {
  it('座位 id 从 1 连续编号，seatById 可反查', () => {
    expect(seats.length).toBeGreaterThanOrEqual(40);
    seats.forEach((seat, index) => {
      expect(seat.id).toBe(index + 1);
      expect(seatById(seat.id)).toBe(seat);
    });
    expect(seatById(0)).toBeUndefined();
    expect(seatById(seats.length + 1)).toBeUndefined();
  });

  it('每个座位都在陆地上、不压墙与桌，且能容下角色', () => {
    for (const seat of seats) {
      expect(isOnLand(seat.x, seat.y, 20)).toBe(true);
      expect(isWaterAt(seat.x, seat.y)).toBe(false);
      expect(isBlocked(seat.x, seat.y, PLAYER_RADIUS)).toBe(false);
    }
  });

  it('座位两两不重叠', () => {
    for (let i = 0; i < seats.length; i += 1) {
      for (let j = i + 1; j < seats.length; j += 1) {
        const a = seats[i]!;
        const b = seats[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
      }
    }
  });

  it('工位椅引用的桌子存在且与椅子一一对应', () => {
    const chairs = seats.filter((seat) => seat.kind === 'chair' && seat.desk >= 0);
    expect(chairs.length).toBe(desks.length);
    for (const seat of chairs) {
      const desk = desks[seat.desk];
      expect(desk).toBeDefined();
      expect(Math.hypot(seat.x - desk!.x, seat.y - desk!.y)).toBeLessThan(120);
    }
  });

  it('马桶位于卫生间内，面朝北墙', () => {
    const toilets = seats.filter((seat) => seat.kind === 'toilet');
    expect(toilets.length).toBe(4);
    for (const seat of toilets) {
      expect(seat.facing).toBe(DIRECTION.Up);
      expect(seat.desk).toBe(-1);
    }
  });
});

describe('地图碰撞与装饰', () => {
  it('所有碰撞矩形四角都在陆地上', () => {
    for (const solid of solids) {
      for (const [x, y] of [
        [solid.x, solid.y],
        [solid.x + solid.w, solid.y],
        [solid.x, solid.y + solid.h],
        [solid.x + solid.w, solid.y + solid.h],
      ] as const) {
        expect(isOnLand(x, y)).toBe(true);
      }
    }
  });

  it('南北门通道不被任何碰撞体挡住', () => {
    const lane = { x: 4032, y: 3404, w: 128, h: 1384 };
    for (const solid of solids) expect(rectsOverlap(solid, lane)).toBe(false);
  });

  it('装饰物落在陆地上，且不陷进碰撞体（售货机本体即碰撞体，除外）', () => {
    for (const prop of props) {
      expect(isOnLand(prop.x, prop.y, 20)).toBe(true);
      expect(isWaterAt(prop.x, prop.y)).toBe(false);
      if (prop.kind === 'vending') continue;
      for (const solid of solids) {
        const inside = prop.x > solid.x && prop.x < solid.x + solid.w && prop.y > solid.y && prop.y < solid.y + solid.h;
        expect(inside).toBe(false);
      }
    }
  });

  it('研发园的会议室与卫生间归入各自区域', () => {
    const meeting = WORLD_LAYOUT.regions.find((region) => region.name === '会议室');
    const restroom = WORLD_LAYOUT.regions.find((region) => region.name === '卫生间');
    expect(meeting).toBeDefined();
    expect(restroom).toBeDefined();
  });
});

describe('findNearestSeat', () => {
  const first = seats[0]!;

  it('返回距离最近的空闲座位', () => {
    const picked = findNearestSeat(first.x + 5, first.y + 5, () => true);
    expect(picked?.id).toBe(first.id);
  });

  it('跳过已占用座位', () => {
    const picked = findNearestSeat(first.x, first.y, (id) => id !== first.id);
    expect(picked).toBeDefined();
    expect(picked!.id).not.toBe(first.id);
  });

  it('超出入座半径时返回 undefined', () => {
    const farX = 0;
    const farY = 0;
    expect(findNearestSeat(farX, farY, () => true)).toBeUndefined();
    expect(SIT_RANGE).toBeGreaterThan(0);
  });
});

describe('座位状态包', () => {
  it('编解码往返一致', () => {
    const entries = [
      { seatId: 1, occupant: 7 },
      { seatId: 40, occupant: 0 },
    ];
    expect(decodeSeatState(encodeSeatState(entries))).toEqual(entries);
  });

  it('空列表也能编码', () => {
    expect(decodeSeatState(encodeSeatState([]))).toEqual([]);
  });
});
