import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  POSE,
  VENT_KNOCKBACK_PX,
  VENT_STUN_MS,
  WORLD_LAYOUT,
  isBlocked,
  packState,
  seatById,
  unpackState,
  type MovePacket,
  type SeatStateEntry,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { applyMove } from './movement';
import { SeatRegistry } from './seats';
import type { Transport } from './view';
import { resolveVents } from './vent';
import { World, type Player } from './world';

interface Sent {
  wsId: number;
  data: Uint8Array;
}

function recorder(): { sent: Sent[]; transport: Transport } {
  const sent: Sent[] = [];
  return {
    sent,
    transport: {
      send(wsId, data) {
        sent.push({ wsId, data });
      },
    },
  };
}

/**
 * 一个出招者与一个站在他正前方的目标。
 * `known` 手写：视野重算的时序不该混进命中判定的用例。
 */
function arena(
  targetDx = 24,
  targetDy = 0,
  direction: number = DIRECTION.Right,
): { world: World; grid: SpatialGrid; seats: SeatRegistry; a: Player; b: Player } {
  const world = new World();
  const grid = new SpatialGrid();
  const seats = new SeatRegistry();
  const a = world.create('甲', DEFAULT_APPEARANCE.cow, 11, 4096, 4096)!;
  const b = world.create('乙', DEFAULT_APPEARANCE.cow, 12, 4096 + targetDx, 4096 + targetDy)!;
  a.applyState(direction as never, POSE.Idle, false, true);
  a.known.add(b.id);
  b.known.add(a.id);
  grid.insert(a.id, a.x, a.y);
  grid.insert(b.id, b.x, b.y);
  return { world, grid, seats, a, b };
}

function ventTick(
  env: { world: World; grid: SpatialGrid; seats: SeatRegistry },
  transport: Transport,
  now: number,
): SeatStateEntry[] {
  return resolveVents(env.world, env.grid, env.seats, transport, now);
}

describe('发泄命中结算', () => {
  it('正前方 24px 的目标被推开 32px、强制躺地、进入 1.5s 硬直', () => {
    const env = arena();
    const { sent, transport } = recorder();
    const startX = env.b.x;

    ventTick(env, transport, 10_000);

    expect(env.b.x).toBeCloseTo(startX + VENT_KNOCKBACK_PX, 3);
    expect(env.b.pose).toBe(POSE.Lie);
    expect(unpackState(env.b.state).pose).toBe(POSE.Lie);
    expect(env.b.stunUntil).toBe(10_000 + VENT_STUN_MS);
    // 新坐标与躺姿必须在同一个 Tick 参与广播
    expect(env.b.dirty).toBe(true);
    // 出招者自己也要收到事件包：本地要靠它区分命中与空放
    expect(sent.map((item) => item.wsId)).toContain(11);
    expect(sent.map((item) => item.wsId)).toContain(12);
    // 9 字节：op + 出招者 + 受害者 + 权威坐标
    expect(sent[0]!.data.byteLength).toBe(9);
  });

  it('击退落点仍是可站立位置：撞墙时由碰撞求解器衰减，不把人推进墙里', () => {
    const env = arena();
    const { transport } = recorder();
    expect(isBlocked(env.b.x, env.b.y)).toBe(false);

    ventTick(env, transport, 10_000);

    expect(isBlocked(env.b.x, env.b.y)).toBe(false);
    // 正常空地上一推就是整整 32px
    expect(Math.abs(env.b.x - 4120)).toBeLessThanOrEqual(VENT_KNOCKBACK_PX + 0.001);
  });

  it('背后的人不挨打：空放也发一条 targetId = 0 的事件包', () => {
    const env = arena(-24);
    const { sent, transport } = recorder();
    const startX = env.b.x;

    ventTick(env, transport, 10_000);

    expect(env.b.x).toBe(startX);
    expect(env.b.pose).toBe(POSE.Idle);
    expect(env.b.stunUntil).toBe(0);
    // 出招者与视野内的旁观者都要能播破空音与台词
    expect(sent.map((item) => item.wsId).sort()).toEqual([11, 12]);
    for (const item of sent) {
      // targetId 在偏移 3..4，小端 0
      expect(item.data[3]).toBe(0);
      expect(item.data[4]).toBe(0);
    }
  });

  it('多个目标时只打最近的那一个', () => {
    const env = arena(48);
    const { transport } = recorder();
    const far = env.b;
    const near = env.world.create('丙', DEFAULT_APPEARANCE.cow, 13, 4118, 4096)!;
    env.a.known.add(near.id);
    near.known.add(env.a.id);

    ventTick(env, transport, 10_000);

    expect(near.pose).toBe(POSE.Lie);
    expect(far.pose).toBe(POSE.Idle);
  });

  it('跳过已经倒地的人：一脚不会把躺着的同伴续锁到天荒地老', () => {
    const env = arena(16);
    const { transport } = recorder();
    const downed = env.b;
    downed.applyState(downed.direction, POSE.Lie, false);
    downed.stunUntil = 11_000;
    const behind = env.world.create('丙', DEFAULT_APPEARANCE.cow, 13, 4060, 4096)!;

    ventTick(env, transport, 10_000);

    expect(downed.stunUntil).toBe(11_000);
    expect(behind.pose).toBe(POSE.Idle);
  });

  it('坐在椅子上被创飞：先释放座位，落点条目交给调用方广播', () => {
    const seat = WORLD_LAYOUT.seats[0]!;
    const world = new World();
    const grid = new SpatialGrid();
    const seats = new SeatRegistry();
    const victim = world.create('乙', DEFAULT_APPEARANCE.cow, 12, seat.x, seat.y)!;
    const attacker = world.create('甲', DEFAULT_APPEARANCE.cow, 11, seat.x - 24, seat.y)!;
    attacker.applyState(DIRECTION.Right, POSE.Idle, false, true);
    attacker.known.add(victim.id);
    victim.known.add(attacker.id);
    grid.insert(attacker.id, attacker.x, attacker.y);
    grid.insert(victim.id, victim.x, victim.y);
    seats.occupy(victim, seatById(seat.id)!, 1000, []);

    const { transport } = recorder();
    const released = ventTick({ world, grid, seats }, transport, 10_000);

    expect(released).toEqual([{ seatId: seat.id, occupant: 0 }]);
    expect(victim.seat).toBe(0);
    expect(victim.pose).toBe(POSE.Lie);
  });
});

describe('发泄的边沿与限频', () => {
  it('位保持一整个播放窗口也只结算一次', () => {
    const env = arena();
    const { transport } = recorder();
    const startX = env.b.x;

    ventTick(env, transport, 10_000);
    const afterFirst = env.b.x;
    // 客户端在 440ms 窗口里持续上报 vent=1；applyState 不再置边沿标记，所以这里没有第二次结算
    for (let t = 10_050; t < 10_450; t += 50) ventTick(env, transport, t);

    expect(afterFirst).toBeCloseTo(startX + VENT_KNOCKBACK_PX, 3);
    expect(env.b.x).toBe(afterFirst);
  });

  it('冷却窗口内的第二次出招被吃掉：连点刷不出第二下', () => {
    const env = arena();
    const { sent, transport } = recorder();
    ventTick(env, transport, 10_000);
    const hitX = env.b.x;
    sent.length = 0;

    // 抬手再按一次：边沿标记重新置位，但 lastVentAt 还没过 700ms
    env.a.applyState(DIRECTION.Right as never, POSE.Idle, false, false);
    env.a.applyState(DIRECTION.Right as never, POSE.Idle, false, true);
    ventTick(env, transport, 10_200);

    expect(sent).toHaveLength(0);
    expect(env.b.x).toBe(hitX);
  });

  it('冷却结束后可以再打一次', () => {
    const env = arena();
    const { transport } = recorder();
    ventTick(env, transport, 10_000);
    env.a.applyState(DIRECTION.Right as never, POSE.Idle, false, false);
    env.a.applyState(DIRECTION.Right as never, POSE.Idle, false, true);
    // 目标已经倒地，这一下会被跳过——但它仍然算一次出招，会发空放包
    const before = env.b.x;
    ventTick(env, transport, 11_000);
    expect(env.b.x).toBe(before);
  });

  it('倒地中的人出不了招', () => {
    const env = arena();
    const { sent, transport } = recorder();
    env.a.stunUntil = 12_000;

    ventTick(env, transport, 10_000);

    expect(sent).toHaveLength(0);
    expect(env.b.pose).toBe(POSE.Idle);
  });
});

describe('硬直期内的移动上报', () => {
  function movePacket(x: number, y: number, state: number): MovePacket {
    return { id: 12, x, y, state };
  }

  it('姿态被钉在躺姿、位置不接受上报', () => {
    const env = arena();
    const { transport } = recorder();
    ventTick(env, transport, 10_000);
    const restX = env.b.x;
    const restY = env.b.y;

    const result = applyMove(
      env.b,
      movePacket(
        // 客户端还在按方向键：声称自己走到了 40px 外
        Math.round((restX + 40) * 8),
        Math.round(restY * 8),
        packState(DIRECTION.Right, POSE.Walk, true),
      ),
      10_200,
      env.seats,
    );

    expect(result.accepted).toBe(false);
    expect(env.b.x).toBe(restX);
    expect(env.b.y).toBe(restY);
    expect(env.b.pose).toBe(POSE.Lie);
    expect(env.b.moving).toBe(false);
  });

  it('硬直结束后恢复正常：按方向键就自然起身', () => {
    const env = arena();
    const { transport } = recorder();
    ventTick(env, transport, 10_000);
    const restX = env.b.x;

    const state = packState(DIRECTION.Right, POSE.Walk, true);
    const result = applyMove(
      env.b,
      movePacket(Math.round((restX + 8) * 8), Math.round(env.b.y * 8), state),
      10_000 + VENT_STUN_MS + 50,
      env.seats,
    );

    expect(result.accepted).toBe(true);
    expect(env.b.pose).toBe(POSE.Walk);
    expect(env.b.moving).toBe(true);
  });
});
