import { describe, expect, it } from 'bun:test';
import {
  DIRECTION,
  POSE,
  WORLD_LAYOUT,
  packState,
  quantizeCoord,
  seatById,
  type Direction,
  type MovePacket,
} from '@niuma/shared-types';
import { applyMove } from './movement';
import { SeatRegistry } from './seats';
import { World } from './world';

function spawn(world: World, x: number, y: number) {
  const player = world.create('牛马', { species: 'cow' } as never, 0, x, y);
  if (!player) throw new Error('spawn failed');
  return player;
}

function movePacket(
  id: number,
  x: number,
  y: number,
  pose: number,
  moving = false,
  emote = false,
  direction: Direction = DIRECTION.Down,
): MovePacket {
  return {
    id,
    x: quantizeCoord(x),
    y: quantizeCoord(y),
    state: packState(direction, pose as never, moving, emote),
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
    // 把每个座位都占满：坐位靠 sit、床位靠 lie，各走各的入口
    for (const seat of WORLD_LAYOUT.seats) {
      const dummy = spawn(world, seat.x, seat.y);
      if (seat.kind === 'bed') seats.lie(dummy, 0);
      else seats.sit(dummy, 0);
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

  it('地面坐姿的起身也要回到站立：没有座位可释放，姿态同样归零', () => {
    const world = new World();
    const seats = new SeatRegistry();
    // 远离所有座位，确保是地面坐姿而不是入座
    const player = spawn(world, 4096, 4096);
    seats.sit(player, 0);
    expect(player.seat).toBe(0);
    expect(player.pose).toBe(POSE.Sit);
    player.dirty = false;

    const changes = seats.stand(player);
    expect(changes).toEqual([]);
    expect(player.pose).toBe(POSE.Idle);
    expect(player.dirty).toBe(true);
  });

  it('地面躺姿的起身也回到站立', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const player = spawn(world, 4096, 4096);
    player.applyState(DIRECTION.Down, POSE.Lie, false);
    player.dirty = false;

    expect(seats.stand(player)).toEqual([]);
    expect(player.pose).toBe(POSE.Idle);
    expect(player.dirty).toBe(true);
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

describe('床位与凳子', () => {
  const bedSeat = () => WORLD_LAYOUT.seats.find((seat) => seat.kind === 'bed')!;

  it('附近有空床时躺下会吸附到床上并落躺姿', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const bed = bedSeat();
    const player = spawn(world, bed.x + 20, bed.y + 20);

    expect(seats.lie(player, 0)).toEqual([{ seatId: bed.id, occupant: player.id }]);
    expect(player.seat).toBe(bed.id);
    expect(player.pose).toBe(POSE.Lie);
    expect(player.x).toBe(bed.x);
    expect(player.y).toBe(bed.y);
  });

  it('按坐不会占床：旁边只有床时退化为地面坐', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const bed = bedSeat();
    const player = spawn(world, bed.x, bed.y);

    expect(seats.sit(player, 0)).toEqual([]);
    expect(player.seat).toBe(0);
    expect(player.pose).toBe(POSE.Sit);
  });

  it('附近没有床时躺下退化为地面躺', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const player = spawn(world, 4096, 4096);

    expect(seats.lie(player, 0)).toEqual([]);
    expect(player.seat).toBe(0);
    expect(player.pose).toBe(POSE.Lie);
  });

  it('床上报坐姿即视为起身并释放床位', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const bed = bedSeat();
    const player = spawn(world, bed.x, bed.y);
    seats.lie(player, 0);

    const result = applyMove(player, movePacket(player.id, bed.x + 6, bed.y, POSE.Sit, false), 1000, seats);
    expect(result.released).toEqual([{ seatId: bed.id, occupant: 0 }]);
    expect(player.seat).toBe(0);
    expect(seats.isFree(bed.id)).toBe(true);
  });

  it('床上报躺姿保持锁定，移动包被拒绝', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const bed = bedSeat();
    const player = spawn(world, bed.x, bed.y);
    seats.lie(player, 0);

    const result = applyMove(player, movePacket(player.id, bed.x + 40, bed.y, POSE.Lie, false), 1000, seats);
    expect(result.accepted).toBe(false);
    expect(player.x).toBe(bed.x);
    expect(player.seat).toBe(bed.id);
    expect(player.pose).toBe(POSE.Lie);
  });

  it('断线释放床位', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const bed = bedSeat();
    const player = spawn(world, bed.x, bed.y);
    seats.lie(player, 0);

    expect(seats.release(player)).toEqual([{ seatId: bed.id, occupant: 0 }]);
    expect(seats.isFree(bed.id)).toBe(true);
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

  it('坐着时上报的朝向不会改写座位朝向：人始终正对家具', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const player = spawn(world, seat.x, seat.y);
    seats.sit(player, 0);
    expect(player.direction).toBe(seat.facing);

    // 客户端就算本地转向（或伪造朝向），座位上的朝向也只能来自 seat.facing
    const forged = seat.facing === DIRECTION.Up ? DIRECTION.Left : DIRECTION.Up;
    applyMove(player, movePacket(player.id, seat.x, seat.y, POSE.Sit, false, false, forged), 1000, seats);

    expect(player.direction).toBe(seat.facing);
    expect(player.seat).toBe(seat.id);
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
