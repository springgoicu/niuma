import { describe, expect, it } from 'bun:test';
import { DIRECTION, POSE, WORLD_LAYOUT, packState, quantizeCoord, seatById, type MovePacket } from '@niuma/shared-types';
import { applyMove } from './movement';
import { SeatRegistry } from './seats';
import { World } from './world';

function spawn(world: World, x: number, y: number) {
  const player = world.create('牛马', { species: 'cow' } as never, 0, x, y);
  if (!player) throw new Error('spawn failed');
  return player;
}

function movePacket(id: number, x: number, y: number, pose: number, moving = false, emote = false): MovePacket {
  return {
    id,
    x: quantizeCoord(x),
    y: quantizeCoord(y),
    state: packState(DIRECTION.Down, pose as never, moving, emote),
    clientSequence: undefined,
    clientTimestampMs: undefined,
  };
}

describe('SeatRegistry', () => {
  it('附近有空闲座位时入座并吸附到锚点', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x + 10, seat.y + 10);

    const changes = seats.sit(player, 1000);
    expect(changes).toEqual([{ seatId: seat.id, occupant: player.id }]);
    expect(player.seat).toBe(seat.id);
    expect(player.x).toBe(seat.x);
    expect(player.y).toBe(seat.y);
    expect(player.pose).toBe(POSE.Sit);
    expect(player.direction).toBe(seat.facing);
  });

  it('同一座位只能坐一人', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const first = spawn(world, seat.x, seat.y);
    const second = spawn(world, seat.x + 5, seat.y);

    seats.sit(first, 0);
    seats.sit(second, 0);
    // 第二人找的是别的空闲座位（或就地坐下），不会抢到同一把椅子
    expect(second.seat).not.toBe(seat.id);
    expect(seats.snapshot().filter((entry) => entry.seatId === seat.id)).toEqual([
      { seatId: seat.id, occupant: first.id },
    ]);
  });

  it('附近没有空闲座位时就地坐下，不占座', () => {
    const world = new World();
    const seats = new SeatRegistry();
    // 把每把椅子都坐满：每个假人站在自己的座位上入座
    for (const seat of WORLD_LAYOUT.seats) {
      seats.sit(spawn(world, seat.x, seat.y), 0);
    }
    expect(seats.snapshot().length).toBe(WORLD_LAYOUT.seats.length);

    const player = spawn(world, 4096, 4096);
    const changes = seats.sit(player, 0);
    expect(changes).toEqual([]);
    expect(player.seat).toBe(0);
    expect(player.pose).toBe(POSE.Sit);
    expect(seats.snapshot().length).toBe(WORLD_LAYOUT.seats.length);
  });

  it('起身释放座位并回到站立', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);

    const changes = seats.stand(player);
    expect(changes).toEqual([{ seatId: seat.id, occupant: 0 }]);
    expect(player.seat).toBe(0);
    expect(player.pose).toBe(POSE.Idle);
    expect(seats.isFree(seat.id)).toBe(true);
  });

  it('断线释放座位', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);

    expect(seats.release(player)).toEqual([{ seatId: seat.id, occupant: 0 }]);
    expect(seats.isFree(seat.id)).toBe(true);
    expect(seats.release(player)).toEqual([]);
  });

  it('入场快照只包含已占用座位', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = seatById(1)!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);
    expect(seats.snapshot()).toEqual([{ seatId: seat.id, occupant: player.id }]);
  });
});

describe('座位上的移动规则', () => {
  it('坐着时位置被锁定，移动包被拒绝', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);

    const result = applyMove(player, movePacket(player.id, seat.x + 40, seat.y, POSE.Sit, false), 1000, seats);
    expect(result.accepted).toBe(false);
    expect(player.x).toBe(seat.x);
    expect(player.y).toBe(seat.y);
    expect(player.seat).toBe(seat.id);
  });

  it('坐着时上报站姿即视为起身，并允许随后的移动', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);

    const result = applyMove(player, movePacket(player.id, seat.x - 6, seat.y, POSE.Walk, true), 1000, seats);
    expect(result.released).toEqual([{ seatId: seat.id, occupant: 0 }]);
    expect(player.seat).toBe(0);
    expect(seats.isFree(seat.id)).toBe(true);
  });

  it('坐着时可以原地叫唤', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);

    applyMove(player, movePacket(player.id, seat.x, seat.y, POSE.Sit, false, true), 1000, seats);
    expect(player.emote).toBe(true);
    expect(player.seat).toBe(seat.id);
  });
});
