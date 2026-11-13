import { describe, expect, it } from 'bun:test';
import {
  BOSS,
  BOSS_MAX_HP,
  BOSS_SOLID,
  DEFAULT_APPEARANCE,
  DIRECTION,
  OpCode,
  POSE,
  VENT_KNOCKBACK_PX,
  VENT_STUN_MS,
  WORLD_LAYOUT,
  decodeBoss,
  isBlocked,
  packState,
  seatById,
  seatPose,
  unpackState,
  type MovePacket,
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
  env: { world: World; grid: SpatialGrid },
  transport: Transport,
  now: number,
): void {
  resolveVents(env.world, env.grid, transport, now);
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

  it('入座即免伤：工位椅、床位、马桶、凳子上的人都不会被创飞', () => {
    for (const kind of ['chair', 'bed', 'toilet', 'stool'] as const) {
      const seat = WORLD_LAYOUT.seats.find((item) => item.kind === kind);
      expect(seat).toBeDefined();
      if (!seat) continue;

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

      const { sent, transport } = recorder();
      ventTick({ world, grid }, transport, 10_000);

      // 座位不释放、姿态不变、位置不动、不进硬直
      expect(victim.seat).toBe(seat.id);
      expect(victim.pose).toBe(seatPose(kind));
      expect(victim.x).toBe(seat.x);
      expect(victim.y).toBe(seat.y);
      expect(victim.stunUntil).toBe(0);
      // 打到入座者按空放发：targetId 为 0
      expect(sent.length).toBeGreaterThan(0);
      for (const item of sent) {
        expect(item.data[3]).toBe(0);
        expect(item.data[4]).toBe(0);
      }
    }
  });

  it('最近的人入座时判空放：不会穿透去打他身后的人', () => {
    const seat = WORLD_LAYOUT.seats.find((item) => item.kind === 'chair')!;
    const world = new World();
    const grid = new SpatialGrid();
    const seats = new SeatRegistry();
    const sitter = world.create('乙', DEFAULT_APPEARANCE.cow, 12, seat.x, seat.y)!;
    const behind = world.create('丙', DEFAULT_APPEARANCE.cow, 13, seat.x + 24, seat.y)!;
    const attacker = world.create('甲', DEFAULT_APPEARANCE.cow, 11, seat.x - 24, seat.y)!;
    attacker.applyState(DIRECTION.Right, POSE.Idle, false, true);
    for (const target of [sitter, behind]) {
      attacker.known.add(target.id);
      target.known.add(attacker.id);
      grid.insert(target.id, target.x, target.y);
    }
    grid.insert(attacker.id, attacker.x, attacker.y);
    seats.occupy(sitter, seatById(seat.id)!, 1000, []);

    const { sent, transport } = recorder();
    ventTick({ world, grid }, transport, 10_000);

    expect(sitter.seat).toBe(seat.id);
    expect(behind.pose).toBe(POSE.Idle);
    expect(behind.stunUntil).toBe(0);
    expect(behind.x).toBe(seat.x + 24);
    for (const item of sent) {
      expect(item.data[3]).toBe(0);
      expect(item.data[4]).toBe(0);
    }
  });

  it('席地而坐没有座位，不算入座：照样会被创飞', () => {
    const env = arena();
    const { transport } = recorder();
    env.b.applyState(DIRECTION.Right, POSE.Sit, false);

    ventTick(env, transport, 10_000);

    expect(env.b.seat).toBe(0);
    expect(env.b.pose).toBe(POSE.Lie);
    expect(env.b.stunUntil).toBe(10_000 + VENT_STUN_MS);
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

describe('发泄区老板', () => {
  function bossFight(direction = DIRECTION.Up) {
    const world = new World();
    const grid = new SpatialGrid();
    // 站在老板脚底南侧 12px：贴住脚底碰撞，向上出招正好踢到肚子
    const attacker = world.create(
      '甲',
      DEFAULT_APPEARANCE.cow,
      11,
      BOSS.x,
      BOSS_SOLID.y + BOSS_SOLID.h + 12,
    )!;
    attacker.applyState(direction, POSE.Idle, false, true);
    grid.insert(attacker.id, attacker.x, attacker.y);
    return { world, grid, attacker };
  }

  function bossEvents(sent: Sent[]) {
    return sent
      .filter((item) => item.data[0] === OpCode.S2C_BOSS)
      .map((item) => ({ wsId: item.wsId, ...decodeBoss(item.data) }));
  }

  it('踢中一次扣 1 点，并把新血量发给所有真人连接', () => {
    const env = bossFight();
    const bystander = env.world.create('旁观', DEFAULT_APPEARANCE.cow, 13, 4096, 4096)!;
    const { sent, transport } = recorder();

    ventTick(env, transport, 10_000);

    expect(env.world.boss.hp).toBe(BOSS_MAX_HP - 1);
    const events = bossEvents(sent);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.wsId).sort()).toEqual([11, 13]);
    for (const event of events) {
      expect(event).toMatchObject({ hp: BOSS_MAX_HP - 1, attackerId: env.attacker.id, died: false });
    }
    // 旁观者不在出招者视野内，仍应收到老板血包：血量是全园区共享状态
    expect(bystander.known.size).toBe(0);
  });

  it('扇形内优先打玩家：老板不掉血', () => {
    const env = bossFight();
    const victim = env.world.create('乙', DEFAULT_APPEARANCE.cow, 12, BOSS.x, env.attacker.y - 24)!;
    env.attacker.known.add(victim.id);
    victim.known.add(env.attacker.id);
    env.grid.insert(victim.id, victim.x, victim.y);
    const { sent, transport } = recorder();

    ventTick(env, transport, 10_000);

    expect(victim.pose).toBe(POSE.Lie);
    expect(env.world.boss.hp).toBe(BOSS_MAX_HP);
    expect(bossEvents(sent)).toHaveLength(0);
  });

  it('入座者挡刀时按空放处理：老板不隔空掉血', () => {
    const env = bossFight();
    const sitter = env.world.create('乙', DEFAULT_APPEARANCE.cow, 12, BOSS.x, env.attacker.y - 24)!;
    sitter.seat = 99;
    env.attacker.known.add(sitter.id);
    sitter.known.add(env.attacker.id);
    env.grid.insert(sitter.id, sitter.x, sitter.y);
    const { sent, transport } = recorder();

    ventTick(env, transport, 10_000);

    expect(env.world.boss.hp).toBe(BOSS_MAX_HP);
    expect(bossEvents(sent)).toHaveLength(0);
    // 仍然发一条 targetId=0 的发泄包，让出招者播破空动作
    const vent = sent.find((item) => item.data[0] === OpCode.S2C_VENT);
    expect(vent).toBeDefined();
    expect(vent!.data[3]).toBe(0);
    expect(vent!.data[4]).toBe(0);
  });

  it('距离外或背对老板都不掉血', () => {
    const far = bossFight();
    far.attacker.x = BOSS.x - 120;
    far.attacker.y = BOSS_SOLID.y + BOSS_SOLID.h + 12;
    const farTransport = recorder();
    ventTick(far, farTransport.transport, 10_000);
    expect(far.world.boss.hp).toBe(BOSS_MAX_HP);
    expect(bossEvents(farTransport.sent)).toHaveLength(0);

    const back = bossFight(DIRECTION.Down);
    const backTransport = recorder();
    ventTick(back, backTransport.transport, 10_000);
    expect(back.world.boss.hp).toBe(BOSS_MAX_HP);
    expect(bossEvents(backTransport.sent)).toHaveLength(0);
  });

  it('归零后继续踢只播动作，不再扣血也不再发血包', () => {
    const env = bossFight();
    for (let i = 0; i < BOSS_MAX_HP; i += 1) env.world.boss.hit(env.attacker.id, 10_000);
    expect(env.world.boss.hp).toBe(0);
    const { sent, transport } = recorder();

    ventTick(env, transport, 10_000);

    expect(env.world.boss.hp).toBe(0);
    expect(bossEvents(sent)).toHaveLength(0);
    expect(sent.some((item) => item.data[0] === OpCode.S2C_VENT)).toBe(true);
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
