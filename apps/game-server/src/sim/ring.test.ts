import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_APPEARANCE,
  RING_AWARD_MS,
  RING_EXIT,
  RING_MAX_HP,
  RING_PHASE,
  RING_PODIUM_SLOTS,
  RING_ROUND_MS,
  RING_START_SLOTS,
} from '@niuma/shared-types';
import { RingRuntime } from './ring';
import { World, type Player } from './world';

const T0 = 1_000_000;

/** 站在场边报名点：所有用例都从同一个可按 F 的位置进场 */
function setup(): { world: World; ring: RingRuntime; players: Player[] } {
  const world = new World();
  const players: Player[] = [];
  for (let index = 0; index < 4; index += 1) {
    const player = world.create(
      `挑战者${index + 1}`,
      DEFAULT_APPEARANCE.cow,
      100 + index,
      RING_EXIT.x,
      RING_EXIT.y,
    );
    if (!player) throw new Error('fixture player rejected');
    players.push(player);
  }
  return { world, ring: world.ring, players };
}

function enter(ring: RingRuntime, player: Player, now: number): { started: boolean } {
  const result = ring.enter(player, now);
  if (!result.ok) throw new Error(`enter rejected: ${result.reason}`);
  return result;
}

/** 按 id 取名次：快照按入场顺序排，不能直接拿下标当名次 */
function rankOf(members: { id: number; rank: number }[], id: number): number {
  return members.find((member) => member.id === id)?.rank ?? 0;
}

describe('擂台入场与开赛', () => {
  it('第 1 人进场只进入 waiting，并传送到 0 号起跑位', () => {
    const { ring, players } = setup();
    expect(enter(ring, players[0]!, T0).started).toBe(false);
    expect(ring.phase).toBe(RING_PHASE.Waiting);
    expect(ring.count).toBe(1);
    expect(players[0]!.x).toBe(RING_START_SLOTS[0]!.x);
    expect(players[0]!.y).toBe(RING_START_SLOTS[0]!.y);
  });

  it('第 2 人落地即开赛，严格从此刻起算 120 秒', () => {
    const { ring, players } = setup();
    enter(ring, players[0]!, T0);
    expect(enter(ring, players[1]!, T0 + 2_000).started).toBe(true);
    expect(ring.phase).toBe(RING_PHASE.Running);
    expect(ring.endsAt).toBe(T0 + 2_000 + RING_ROUND_MS);
  });

  it('第 3 人可在倒计时中途补入，落到空槽', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    enter(ring, players[2]!, T0 + 30_000);
    expect(ring.phase).toBe(RING_PHASE.Running);
    expect(ring.count).toBe(3);
    const packet = ring.snapshot(T0 + 30_000, world);
    expect(packet.members.map((member) => member.slot ?? -1)).toEqual([0, 1, 2]);
  });

  it('满员、重复与远处都拒绝报名', () => {
    const { world, ring, players } = setup();
    // 距离先于容量判断，所以「远处」要在有人进场前验证
    const far = world.create('远处的人', DEFAULT_APPEARANCE.cow, 0, 500, 500)!;
    expect(ring.canEnter(far)).toEqual({ ok: false, reason: 'far' });

    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    enter(ring, players[2]!, T0);
    expect(ring.canEnter(players[3]!)).toEqual({ ok: false, reason: 'full' });
    expect(ring.canEnter(players[0]!)).toEqual({ ok: false, reason: 'already' });
  });
});

describe('擂台血量与淘汰', () => {
  it('每次命中扣 1，归零后不再接受伤害', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    let hp = RING_MAX_HP;
    for (let hit = 0; hit < RING_MAX_HP; hit += 1) {
      const result = ring.applyHit(players[1]!, players[0]!, T0 + hit)!;
      expect(result.hp).toBe(hp - 1);
      expect(result.eliminated).toBe(hp - 1 === 0);
      hp -= 1;
    }
    expect(ring.applyHit(players[1]!, players[0]!, T0 + 20)).toBeNull();
    const victim = ring.snapshot(T0 + 21, world).members.find(
      (member) => member.id === players[0]!.id,
    )!;
    expect(victim.hp).toBe(0);
    expect(victim.eliminated).toBe(true);
  });

  it('场外的人打不到场内，场内的人也打不到场外', () => {
    const { ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    expect(ring.applyHit(players[2]!, players[0]!, T0)).toBeNull();
    expect(ring.applyHit(players[0]!, players[2]!, T0)).toBeNull();
  });

  it('等待阶段没有伤害', () => {
    const { ring, players } = setup();
    enter(ring, players[0]!, T0);
    expect(ring.applyHit(players[1]!, players[0]!, T0)).toBeNull();
  });
});

describe('擂台结算与颁奖', () => {
  it('打空最后一个对手后下一拍立刻结算，不必等满 120 秒', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0 + 2_000);
    for (let hit = 0; hit < RING_MAX_HP; hit += 1) {
      ring.applyHit(players[0]!, players[1]!, T0 + 2_100 + hit);
    }
    // 淘汰只标血量，结算统一留在 tick 的唯一入口
    expect(ring.phase).toBe(RING_PHASE.Running);

    const settledAt = T0 + 2_200;
    expect(settledAt).toBeLessThan(ring.endsAt);
    const result = ring.tick(settledAt, world);
    expect(result.changed).toBe(true);
    expect(ring.phase).toBe(RING_PHASE.Award);
    expect(ring.endsAt).toBe(settledAt + RING_AWARD_MS);
    // 领奖台传送与名次仍然照常发生
    expect(players[0]!.x).toBe(RING_PODIUM_SLOTS[0]!.x);
    expect(ring.isFrozen(players[1]!.id)).toBe(true);
    expect(ring.isFrozen(players[2]!.id)).toBe(false);
  });

  it('三人局先倒一人不结束，剩下的两人继续打', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    enter(ring, players[2]!, T0);
    for (let hit = 0; hit < RING_MAX_HP; hit += 1) {
      ring.applyHit(players[0]!, players[2]!, T0 + 100 + hit);
    }
    ring.tick(T0 + 200, world);
    expect(ring.phase).toBe(RING_PHASE.Running);

    // 只剩 1 人站立的那一拍才结算：乙冠军，甲（后倒）亚军，丙季军
    for (let hit = 0; hit < RING_MAX_HP; hit += 1) {
      ring.applyHit(players[1]!, players[0]!, T0 + 300 + hit);
    }
    ring.tick(T0 + 400, world);
    expect(ring.phase).toBe(RING_PHASE.Award);
    const packet = ring.snapshot(T0 + 400, world);
    expect(rankOf(packet.members, players[1]!.id)).toBe(1);
    expect(rankOf(packet.members, players[0]!.id)).toBe(2);
    expect(rankOf(packet.members, players[2]!.id)).toBe(3);
  });

  it('按剩余血量排前三，并逐个传送到对应台阶', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    enter(ring, players[2]!, T0 + 10_000);
    // 甲满血 10，乙挨 1 下 9，丙挨 2 下 8：名次直接由血量决定
    ring.applyHit(players[0]!, players[1]!, T0 + 10_001);
    ring.applyHit(players[1]!, players[2]!, T0 + 10_002);
    ring.applyHit(players[0]!, players[2]!, T0 + 10_003);

    ring.tick(ring.endsAt, world);
    const packet = ring.snapshot(ring.endsAt, world);
    expect(rankOf(packet.members, players[0]!.id)).toBe(1);
    expect(rankOf(packet.members, players[1]!.id)).toBe(2);
    expect(rankOf(packet.members, players[2]!.id)).toBe(3);

    for (const member of packet.members) {
      const player = world.get(member.id)!;
      const podium = RING_PODIUM_SLOTS[member.rank - 1]!;
      expect(player.x).toBe(podium.x);
      expect(player.y).toBe(podium.y);
    }
  });

  it('同分时站立者优先，其次先入场者优先', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    enter(ring, players[2]!, T0);
    // 甲、乙各掉 1 血，丙满血：血量差距先决定名次
    ring.applyHit(players[1]!, players[0]!, T0 + 1);
    ring.applyHit(players[0]!, players[1]!, T0 + 2);

    ring.tick(ring.endsAt, world);
    const packet = ring.snapshot(ring.endsAt, world);
    expect(rankOf(packet.members, players[2]!.id)).toBe(1);
    expect(rankOf(packet.members, players[0]!.id)).toBe(2);
    expect(rankOf(packet.members, players[1]!.id)).toBe(3);
  });

  it('颁奖期间冻结移动判定，4 秒后送回出口并清空席位', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    ring.tick(ring.endsAt, world);
    expect(ring.phase).toBe(RING_PHASE.Award);
    expect(ring.endsAt).toBe(T0 + RING_ROUND_MS + RING_AWARD_MS);

    ring.tick(ring.endsAt, world);
    expect(ring.phase).toBe(RING_PHASE.Idle);
    expect(ring.count).toBe(0);
    for (const player of players.slice(0, 2)) {
      expect(player.x).toBe(RING_EXIT.x);
      expect(player.y).toBe(RING_EXIT.y);
    }
  });
});

describe('擂台离场与断线', () => {
  it('等待期可以取消并送回出口，开赛后不能主动离场', () => {
    const { ring, players } = setup();
    enter(ring, players[0]!, T0);
    expect(ring.leave(players[0]!, T0 + 100)).toBe(true);
    expect(players[0]!.x).toBe(RING_EXIT.x);
    expect(ring.phase).toBe(RING_PHASE.Idle);

    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    expect(ring.leave(players[0]!, T0 + 200)).toBe(false);
  });

  it('颁奖期可以领奖离场，全员走光立刻回空闲', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    ring.tick(ring.endsAt, world);
    expect(ring.phase).toBe(RING_PHASE.Award);

    const awardAt = ring.endsAt - RING_AWARD_MS;
    expect(ring.leave(players[1]!, awardAt + 500)).toBe(true);
    expect(players[1]!.x).toBe(RING_EXIT.x);
    expect(players[1]!.y).toBe(RING_EXIT.y);
    // 走一个人，颁奖窗口对剩下的人照旧；离场者不再被冻结也不再占席位
    expect(ring.phase).toBe(RING_PHASE.Award);
    expect(ring.count).toBe(1);
    expect(ring.isFrozen(players[1]!.id)).toBe(false);
    expect(ring.snapshot(awardAt + 500, world).members.map((member) => member.id)).toEqual([
      players[0]!.id,
    ]);

    expect(ring.leave(players[0]!, awardAt + 800)).toBe(true);
    expect(ring.phase).toBe(RING_PHASE.Idle);
    expect(ring.count).toBe(0);
  });

  it('断线移除后剩 1 人仍走完计时，清空则立刻回 idle', () => {
    const { ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    expect(ring.removePlayer(players[0]!.id, T0 + 1)).toBe(true);
    expect(ring.phase).toBe(RING_PHASE.Running);
    expect(ring.endsAt).toBe(T0 + RING_ROUND_MS);
    expect(ring.removePlayer(players[1]!.id, T0 + 2)).toBe(true);
    expect(ring.phase).toBe(RING_PHASE.Idle);
    expect(ring.count).toBe(0);
  });
});

describe('擂台快照', () => {
  it('running 下 remainingMs 随 now 递减，其余阶段为 0', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    expect(ring.snapshot(T0, world).remainingMs).toBe(RING_ROUND_MS);
    expect(ring.snapshot(T0 + 60_000, world).remainingMs).toBe(RING_ROUND_MS - 60_000);
    enter(ring, players[2]!, T0 + 60_000);
    expect(ring.snapshot(T0 + 60_000, world).members).toHaveLength(3);
    ring.tick(ring.endsAt, world);
    expect(ring.snapshot(ring.endsAt, world).remainingMs).toBe(0);
  });

  it('等待阶段不提供倒计时，matchId 在开赛前已分配', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    const packet = ring.snapshot(T0, world);
    expect(packet.phase).toBe(RING_PHASE.Waiting);
    expect(packet.remainingMs).toBe(0);
    expect(packet.matchId).toBeGreaterThan(0);
  });

  it('颁奖结束后空闲快照不带席位', () => {
    const { world, ring, players } = setup();
    enter(ring, players[0]!, T0);
    enter(ring, players[1]!, T0);
    ring.tick(ring.endsAt, world);
    ring.tick(ring.endsAt, world);
    expect(ring.snapshot(T0, world)).toMatchObject({ phase: RING_PHASE.Idle, members: [] });
  });
});

/**
 * 快照恢复（ADR-0081）：局号连续、上局摘要还在，但进行中的比赛一律收尾为 idle。
 * 参赛者的连接停机时已经全断了，复活「幽灵比赛」只会让下一个人空等 120 秒。
 */
describe('擂台快照恢复', () => {
  it('只接局号与摘要：名单清空、阶段归 idle', () => {
    const ring = new RingRuntime();
    const lastMatch = { matchId: 40, endedAt: T0, top: [{ name: '牛马', rank: 1, hp: 10 }] };
    ring.restore({ matchId: 41, nextMatchId: 42, lastMatch });
    expect(ring.phase).toBe(RING_PHASE.Idle);
    expect(ring.count).toBe(0);
    expect(ring.endsAt).toBe(0);
    expect(ring.matchId).toBe(41);
    expect(ring.snapshotForSave()).toEqual({ matchId: 41, nextMatchId: 42, lastMatch });
  });

  it('恢复后开新局从快照的下一号继续，不从 1 重数', () => {
    const { ring, players } = setup();
    ring.restore({ matchId: 41, nextMatchId: 42, lastMatch: null });
    enter(ring, players[0]!, T0);
    expect(ring.matchId).toBe(42);
  });

  it('坏档里的负数局号被夹回合法值', () => {
    const ring = new RingRuntime();
    ring.restore({ matchId: -3, nextMatchId: 0, lastMatch: null });
    expect(ring.matchId).toBe(0);
    expect(ring.snapshotForSave().nextMatchId).toBe(1);
  });
});
