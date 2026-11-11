import { describe, expect, it } from 'bun:test';
import {
  DIRECTION,
  POSE,
  SPAWN_CENTER,
  SPAWN_RADIUS,
  WORLD_LAYOUT,
  isBlocked,
  isOnLand,
  isWaterAt,
  regionAt,
  seatById,
  seatPose,
} from '@niuma/shared-types';
import { resolveSpawn, spawnPoint } from './resume';
import { SeatRegistry } from './seats';
import { World } from './world';

function spawn(world: World, x: number, y: number) {
  const player = world.create('牛马', { species: 'cow' } as never, 0, x, y);
  if (!player) throw new Error('spawn failed');
  return player;
}

/** 随便取一个确定不可站立的点：世界外 */
const OFFSHORE = { x: -64, y: -64 };

function isStandable(x: number, y: number): boolean {
  return isOnLand(x, y) && !isBlocked(x, y) && !isWaterAt(x, y);
}

describe('spawnPoint', () => {
  it('always lands on a walkable spot inside the world', () => {
    for (let i = 0; i < 20; i += 1) {
      const point = spawnPoint(300);
      expect(isStandable(point.x, point.y)).toBe(true);
    }
  });

  it('默认出生半径把新玩家放在北门入园口，而不是工位环里', () => {
    for (let i = 0; i < 60; i += 1) {
      const point = spawnPoint(SPAWN_RADIUS);
      expect(regionAt(point.x, point.y)).toBe('牛马园北门');
      // findFreePoint 最坏会沿 24px 一圈挪一次
      expect(Math.hypot(point.x - SPAWN_CENTER.x, point.y - SPAWN_CENTER.y)).toBeLessThanOrEqual(
        SPAWN_RADIUS + 24,
      );
      expect(isStandable(point.x, point.y)).toBe(true);
    }
  });
});

describe('resolveSpawn', () => {
  it('falls back to a fresh spawn when the client has no resume', () => {
    const resolved = resolveSpawn(undefined, () => true, 300);
    expect(isStandable(resolved.x, resolved.y)).toBe(true);
    expect(resolved.direction).toBe(DIRECTION.Down);
    expect(resolved.pose).toBe(POSE.Idle);
    expect(resolved.seat).toBeNull();
  });

  it('keeps the reported spot and facing when the ground is walkable', () => {
    const home = spawnPoint(300);
    const resolved = resolveSpawn(
      { x: home.x, y: home.y, direction: DIRECTION.Left, pose: POSE.Idle, seatId: 0 },
      () => true,
      300,
    );
    expect(resolved.x).toBe(home.x);
    expect(resolved.y).toBe(home.y);
    expect(resolved.direction).toBe(DIRECTION.Left);
    expect(resolved.pose).toBe(POSE.Idle);
    expect(resolved.seat).toBeNull();
  });

  it('drops the walk pose so a resume never starts mid stride', () => {
    const home = spawnPoint(300);
    const resolved = resolveSpawn(
      { x: home.x, y: home.y, direction: DIRECTION.Up, pose: POSE.Walk, seatId: 0 },
      () => true,
      300,
    );
    expect(resolved.pose).toBe(POSE.Idle);
    expect(resolved.direction).toBe(DIRECTION.Up);
  });

  it('keeps a ground sit pose since there is no seat to re-check', () => {
    const home = spawnPoint(300);
    const resolved = resolveSpawn(
      { x: home.x, y: home.y, direction: DIRECTION.Right, pose: POSE.Sit, seatId: 0 },
      () => true,
      300,
    );
    expect(resolved.pose).toBe(POSE.Sit);
    expect(resolved.seat).toBeNull();
  });

  it('snaps back to the exact seat when it is still free', () => {
    const seat = WORLD_LAYOUT.seats[0]!;
    const resolved = resolveSpawn(
      { x: 0, y: 0, direction: DIRECTION.Down, pose: POSE.Sit, seatId: seat.id },
      () => true,
      300,
    );
    expect(resolved.seat?.id).toBe(seat.id);
    expect(resolved.x).toBe(seat.x);
    expect(resolved.y).toBe(seat.y);
    expect(resolved.direction).toBe(seat.facing);
    expect(resolved.pose).toBe(seatPose(seat.kind));
  });

  it('stands next to the seat instead of stealing it when someone else took it', () => {
    const seat = WORLD_LAYOUT.seats[0]!;
    const resolved = resolveSpawn(
      { x: seat.x, y: seat.y, direction: DIRECTION.Left, pose: POSE.Sit, seatId: seat.id },
      () => false,
      300,
    );
    expect(resolved.seat).toBeNull();
    expect(resolved.pose).toBe(POSE.Idle);
    expect(resolved.direction).toBe(DIRECTION.Left);
    expect(isStandable(resolved.x, resolved.y)).toBe(true);
  });

  it('rescues an out-of-world coordinate to walkable ground', () => {
    const resolved = resolveSpawn(
      { x: OFFSHORE.x, y: OFFSHORE.y, direction: DIRECTION.Right, pose: POSE.Idle, seatId: 0 },
      () => true,
      300,
    );
    expect(isStandable(resolved.x, resolved.y)).toBe(true);
    expect(resolved.direction).toBe(DIRECTION.Right);
  });

  it('ignores a seat id that no longer exists', () => {
    const resolved = resolveSpawn(
      { x: 0, y: 0, direction: DIRECTION.Down, pose: POSE.Sit, seatId: 65000 },
      () => true,
      300,
    );
    expect(seatById(65000)).toBeUndefined();
    expect(resolved.seat).toBeNull();
    expect(isStandable(resolved.x, resolved.y)).toBe(true);
  });
});

describe('SeatRegistry release ownership', () => {
  it('只释放自己占住的座位，不误清别人刚抢到的座位', () => {
    const world = new World();
    const seats = new SeatRegistry();
    const seat = WORLD_LAYOUT.seats[0]!;
    const stale = spawn(world, seat.x, seat.y);
    const current = spawn(world, seat.x, seat.y);

    seats.occupy(stale, seat, 1000, []);
    // 真实路径：旧连接先 release，新连接随后占住同一座位；权威表已归 current
    seats.occupy(current, seat, 2000, []);

    const changes = seats.release(stale, []);
    expect(changes).toEqual([]);
    expect(seats.isFree(seat.id)).toBe(false);
    expect(current.seat).toBe(seat.id);
  });
});
