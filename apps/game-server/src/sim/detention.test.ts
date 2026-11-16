import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  ENTITY_ROLE_GUARD,
  ENTITY_ROLE_NURSE,
  JAIL_ANCHORS,
  JAIL_PHASE,
  OpCode,
  POSE,
  RING_EXIT,
  RING_START_SLOTS,
  SYSTEM_NOTICE_KIND,
  decodeJail,
  decodeSystemNotice,
  packState,
  quantizeCoord,
  type JailPacket,
  type MovePacket,
  type SystemNoticePacket,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { ASSAULT, Detention, type EscortEvent } from './detention';
import { applyMove } from './movement';
import { World, type Player } from './world';

interface Harness {
  world: World;
  grid: SpatialGrid;
  player: Player;
  bystander: Player;
  detention: Detention;
  sent: Array<{ wsId: number; packet: JailPacket }>;
  /** 系统提示：打人警告只发本人、押送通播发给旁观者，两类都要能验 */
  notices: Array<{ wsId: number; packet: SystemNoticePacket }>;
  dispatched: number[];
  cancelled: number[];
  dispatchGuard: { id: number };
}

function setup(options: { witness?: boolean } = {}): Harness {
  const world = new World();
  const grid = new SpatialGrid();
  const player = world.create('甲', DEFAULT_APPEARANCE.cow, 11, 4096, 4096)!;
  const bystander = world.create('乙', DEFAULT_APPEARANCE.cow, 12, 4116, 4096)!;
  if (options.witness === false) {
    bystander.x = 4600;
    bystander.y = 4096;
  }
  grid.insert(player.id, player.x, player.y);
  grid.insert(bystander.id, bystander.x, bystander.y);
  player.known.add(bystander.id);
  bystander.known.add(player.id);

  const sent: Array<{ wsId: number; packet: JailPacket }> = [];
  const notices: Array<{ wsId: number; packet: SystemNoticePacket }> = [];
  const dispatched: number[] = [];
  const cancelled: number[] = [];
  const dispatchGuard = { id: 42 };

  const detention = new Detention({
    world,
    grid,
    transport: {
      send(wsId: number, data: Uint8Array) {
        // 系统提示与小黑屋包共用一条连接，按 opcode 分流
        if (data[0] === OpCode.S2C_JAIL) sent.push({ wsId, packet: decodeJail(data) });
        else if (data[0] === OpCode.S2C_SYSTEM_NOTICE) {
          notices.push({ wsId, packet: decodeSystemNotice(data) });
        }
      },
    },
    releaseSeat: () => {},
    escort: {
      dispatch(targetId: number) {
        dispatched.push(targetId);
        return dispatchGuard.id;
      },
      cancel(targetId: number) {
        cancelled.push(targetId);
      },
    },
  });

  // 先跑一次观察窗初始化：生产里每个玩家入场后的第一 Tick 就会建立基线姿态，
  // 之后才开始认「坐→站」的跃迁，夹具也照同一条路径走。
  detention.observe(0);

  return { world, grid, player, bystander, detention, sent, notices, dispatched, cancelled, dispatchGuard };
}

function sit(h: Harness, at: number): void {
  h.player.applyState(DIRECTION.Down, POSE.Sit, false);
  h.detention.observe(at);
}

function stand(h: Harness, at: number): void {
  h.player.applyState(DIRECTION.Down, POSE.Idle, false);
  h.detention.observe(at);
}

/** 完成一次完整坐→站；返回站起时刻，方便按间隔排下一次 */
function cycle(h: Harness, at: number, duration = 400, gap = 200): number {
  sit(h, at);
  const standAt = at + duration;
  stand(h, standAt);
  return standAt + gap;
}

function phasesOf(h: Harness, wsId: number): number[] {
  return h.sent.filter((entry) => entry.wsId === wsId).map((entry) => entry.packet.phase);
}

describe('小黑屋判定（不设禁足时长）', () => {
  it('第 3 次循环只警告本人，不惊动旁人', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 3; index += 1) at = cycle(h, at);
    // cycle() 返回的是下一次坐下时刻，最后一次站起在 at-gap
    const selfPhases = phasesOf(h, 11);
    expect(selfPhases).toEqual([JAIL_PHASE.Warn]);
    expect(h.sent.some((entry) => entry.wsId === 12)).toBe(false);
    expect(h.dispatched.length).toBe(0);
  });

  it('第 6 次循环确认并派给最近保安，旁人收到 self=false', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    expect(h.dispatched).toEqual([h.player.id]);
    const selfPhases = phasesOf(h, 11);
    expect(selfPhases).toEqual([JAIL_PHASE.Warn, JAIL_PHASE.Dispatch]);

    const other = h.sent.find((entry) => entry.wsId === 12 && entry.packet.phase === JAIL_PHASE.Dispatch);
    expect(other).toBeDefined();
    expect(other!.packet.self).toBe(false);
    expect(other!.packet.entityId).toBe(h.player.id);
    expect(other!.packet.guardId).toBe(h.dispatchGuard.id);
  });

  it('3 秒内第 4 次循环提前确认', () => {
    const h = setup();
    let at = 100;
    for (let index = 0; index < 4; index += 1) at = cycle(h, at, 300, 150);
    expect(h.dispatched).toEqual([h.player.id]);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Dispatch);
  });

  it('坐得太短 / 太久都不计数', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at, 80, 160);
    for (let index = 0; index < 3; index += 1) at = cycle(h, at, 1500, 200);
    expect(h.sent).toEqual([]);
    expect(h.dispatched).toEqual([]);
  });

  it('身边没人就不算“在别人旁边”', () => {
    const h = setup({ witness: false });
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    expect(h.sent).toEqual([]);
    expect(h.dispatched).toEqual([]);
  });

  it('位置漂移超过 32px 会清零，不从旧点位累计', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 3; index += 1) at = cycle(h, at);
    expect(phasesOf(h, 11)).toEqual([JAIL_PHASE.Warn]);

    // 挪到 44px 外：仍在围观者 56px 内，但已超过首点漂移
    h.player.x += 44;
    for (let index = 0; index < 3; index += 1) at = cycle(h, at);
    expect(phasesOf(h, 11)).not.toContain(JAIL_PHASE.Dispatch);
  });

  it('拖到反省点后立即放人：无倒计时、无禁足，下一步就能走', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    const now = at + 100;

    const grab: EscortEvent = { kind: 'grab', guardId: 42, targetId: h.player.id, now };
    h.detention.handleEscort(grab);
    expect(h.player.pose).toBe(POSE.Lie);
    expect(h.player.stunUntil).toBeGreaterThan(now);

    const arrive: EscortEvent = { kind: 'arrive', guardId: 42, targetId: h.player.id, now: now + 3000 };
    h.detention.handleEscort(arrive);

    const anchor = JAIL_ANCHORS[0]!;
    expect(h.player.x).toBe(anchor.x);
    expect(h.player.y).toBe(anchor.y);
    expect(h.player.stunUntil).toBe(0);
    expect(h.player.pose).toBe(POSE.Idle);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Released);

    const move: MovePacket = {
      id: h.player.id,
      x: quantizeCoord(anchor.x + 20),
      y: quantizeCoord(anchor.y),
      state: packState(DIRECTION.Right, POSE.Idle, true),
      clientSequence: 1,
    };
    const result = applyMove(h.player, move, now + 3100);
    expect(result.accepted).toBe(true);
    expect(h.player.x).toBeGreaterThan(anchor.x);
  });

  it('半路中止也清硬直，并通知本人与旁人', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    h.detention.handleEscort({ kind: 'grab', guardId: 42, targetId: h.player.id, now: at + 100 });

    h.detention.handleEscort({
      kind: 'abort',
      guardId: 42,
      targetId: h.player.id,
      now: at + 200,
      reason: 'timeout',
    });

    expect(h.player.stunUntil).toBe(0);
    expect(h.player.pose).toBe(POSE.Idle);
    expect(h.cancelled).toEqual([h.player.id]);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Released);
  });

  it('押送员被创倒送医：半路放人、撤案，只给本人一条押送中断提示（ADR-0113）', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    const grabbedAt = at + 100;
    h.detention.handleEscort({ kind: 'grab', guardId: 42, targetId: h.player.id, now: grabbedAt });

    h.detention.handleEscort({
      kind: 'abort',
      guardId: 42,
      targetId: h.player.id,
      now: grabbedAt + 300,
      reason: 'guard_down',
    });

    expect(h.player.stunUntil).toBe(0);
    expect(h.player.pose).toBe(POSE.Idle);
    expect(h.cancelled).toEqual([h.player.id]);
    const released = () => h.sent.filter((entry) => entry.packet.phase === JAIL_PHASE.Released);
    // 本人 + 旁人各一份：本人靠它解锁，旁人靠它消掉头顶气泡
    expect(released()).toHaveLength(2);

    // 提示只发本人：旁人不该收到「这次先放你一马」
    const broken = h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.EscortBroken);
    expect(broken.map((entry) => entry.wsId)).toEqual([11]);
    expect(broken[0]!.packet.text).toContain('先放你一马');

    // 案子已撤销：下一 Tick 不会换保安重新接单，也不会再发第二次 Released
    h.detention.update(grabbedAt + 400);
    expect(h.dispatched).toHaveLength(1);
    expect(h.cancelled).toEqual([h.player.id]);
    expect(released()).toHaveLength(2);
  });

  it('被押者自己昏迷送医：撤案但不扶站、不吸附反省点，提示交给急救链（ADR-0113）', () => {
    const h = setup();
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    const grabbedAt = at + 100;
    h.detention.handleEscort({ kind: 'grab', guardId: 42, targetId: h.player.id, now: grabbedAt });

    // 被第三方创倒：硬直 + 昏迷由 vent / clinic 那边写，姿态应保持躺姿
    h.player.incapacitated = true;
    h.player.applyState(DIRECTION.Down, POSE.Lie, false);

    h.detention.handleEscort({
      kind: 'abort',
      guardId: 42,
      targetId: h.player.id,
      now: grabbedAt + 300,
      reason: 'target_down',
    });

    expect(h.player.stunUntil).toBe(0);
    expect(h.player.pose).toBe(POSE.Lie);
    expect(h.player.x).toBe(4096);
    expect(h.player.y).toBe(4096);
    expect(h.cancelled).toEqual([h.player.id]);
    expect(h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.EscortBroken)).toHaveLength(0);

    // 同一 Tick 里 clinic 的昏迷包还没发出去：释放包延后，别让客户端把躺姿扶正
    expect(phasesOf(h, 11)).not.toContain(JAIL_PHASE.Released);
    expect(phasesOf(h, 12)).not.toContain(JAIL_PHASE.Released);

    // 下一 Tick 的 observe 补发：本人解锁 + 旁人消气泡，各一份
    h.detention.observe(grabbedAt + 400);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Released);
    expect(phasesOf(h, 12)).toContain(JAIL_PHASE.Released);
    // 补发不改姿态：昏迷者仍躺着
    expect(h.player.pose).toBe(POSE.Lie);
  });

  it('保安全忙时排队，空出来再派单', () => {
    const h = setup();
    h.dispatchGuard.id = 0;
    let at = 1000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    expect(phasesOf(h, 11)).not.toContain(JAIL_PHASE.Dispatch);

    h.dispatchGuard.id = 7;
    h.detention.update(at + 100);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Dispatch);
    expect(h.sent.find((entry) => entry.wsId === 11 && entry.packet.phase === JAIL_PHASE.Dispatch)!.packet.guardId).toBe(7);
  });
});

describe('打人触发执法（ADR-0074）', () => {
  /** 直接走公开入口：命中几何由 vent 负责，这里只验执法账本 */
  function hit(h: Harness, victimId: number, at: number): void {
    h.detention.onVentHit(h.world.get(h.player.id)!, h.world.get(victimId)!, at);
  }

  it('第 2 次命中只私下警告本人：旁人不收、不派单', () => {
    const h = setup();
    hit(h, h.bystander.id, 1_000);
    expect(h.notices).toEqual([]);
    expect(h.dispatched).toEqual([]);

    hit(h, h.bystander.id, 3_000);

    const warns = h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.AssaultWarn);
    expect(warns.map((entry) => entry.wsId)).toEqual([11]);
    expect(warns[0]!.packet.text).toContain('不许动手');
    expect(h.dispatched).toEqual([]);
    expect(phasesOf(h, 11)).toEqual([]);
  });

  it('第 3 次命中确认：通播打人提示并派给最近保安', () => {
    const h = setup();
    hit(h, h.bystander.id, 1_000);
    hit(h, h.bystander.id, 3_000);
    hit(h, h.bystander.id, 5_000);

    expect(h.dispatched).toEqual([h.player.id]);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Dispatch);
    const fight = h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.DetainedFight);
    // 通播只发看得见他的人：本人靠 Dispatch 阶段包知道自己被盯上
    expect(fight.map((entry) => entry.wsId)).toEqual([12]);
    expect(fight[0]!.packet.text).toContain('不许动手');
  });

  it('超过 2 分钟窗口的老命中不算：重新从第 1 次开始数', () => {
    const h = setup();
    hit(h, h.bystander.id, 0);
    hit(h, h.bystander.id, 1_000);
    // 第 3 次落在窗口外：前两下已过期，这一下只是新窗口的第 1 次
    hit(h, h.bystander.id, ASSAULT.WINDOW_MS + 2_000);
    expect(h.dispatched).toEqual([]);
    expect(h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.AssaultWarn)).toHaveLength(1);

    // 再打一次才凑成新窗口的第 2 次，警告重新出现
    hit(h, h.bystander.id, ASSAULT.WINDOW_MS + 3_000);
    expect(h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.AssaultWarn)).toHaveLength(2);
  });

  it('打不同的人分别计数，不跨目标合并', () => {
    const h = setup();
    const third = h.world.create('丙', DEFAULT_APPEARANCE.cow, 13, 4_200, 4_200)!;
    hit(h, h.bystander.id, 1_000);
    hit(h, h.bystander.id, 2_000);
    hit(h, third.id, 3_000);

    // 对丙只有 1 次，不能拿乙的两次凑满 3 次
    expect(h.dispatched).toEqual([]);
    expect(h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.AssaultWarn)).toHaveLength(1);
  });

  it('打普通同事不计数：只有真人与零容忍角色才进入执法', () => {
    const h = setup();
    const npc = h.world.createNpc('同事', DEFAULT_APPEARANCE.cow, 4_300, 4_300)!;
    hit(h, npc.id, 1_000);
    hit(h, npc.id, 2_000);
    hit(h, npc.id, 3_000);

    expect(h.dispatched).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it('袭医：打护士一次立即建案，只通播打人提示，不发打人警告', () => {
    const h = setup();
    const nurse = h.world.createNpc(
      '值班护士',
      DEFAULT_APPEARANCE.horse,
      4_300,
      4_300,
      '',
      Date.now(),
      undefined,
      ENTITY_ROLE_NURSE,
    )!;
    expect(nurse.role).toBe(ENTITY_ROLE_NURSE);

    hit(h, nurse.id, 1_000);

    expect(h.dispatched).toEqual([h.player.id]);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Dispatch);
    const fight = h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.DetainedFight);
    expect(fight.map((entry) => entry.wsId)).toEqual([12]);
    expect(fight[0]!.packet.text).toContain('不许动手');
    expect(h.notices.some((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.AssaultWarn)).toBe(false);
  });

  it('袭医后押送途中再打护士不重复建案', () => {
    const h = setup();
    const nurse = h.world.createNpc(
      '值班护士',
      DEFAULT_APPEARANCE.horse,
      4_300,
      4_300,
      '',
      Date.now(),
      undefined,
      ENTITY_ROLE_NURSE,
    )!;

    hit(h, nurse.id, 1_000);
    expect(h.dispatched).toHaveLength(1);

    hit(h, nurse.id, 2_000);

    expect(h.dispatched).toHaveLength(1);
  });

  it('袭警：打保安一次立即建案，只通播打人提示，不发打人警告', () => {
    const h = setup();
    const guard = h.world.createNpc(
      '园区保安',
      DEFAULT_APPEARANCE.cow,
      4_300,
      4_300,
      '',
      Date.now(),
      undefined,
      ENTITY_ROLE_GUARD,
    )!;
    expect(guard.role).toBe(ENTITY_ROLE_GUARD);

    hit(h, guard.id, 1_000);

    expect(h.dispatched).toEqual([h.player.id]);
    expect(phasesOf(h, 11)).toContain(JAIL_PHASE.Dispatch);
    const fight = h.notices.filter((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.DetainedFight);
    expect(fight.map((entry) => entry.wsId)).toEqual([12]);
    expect(fight[0]!.packet.text).toContain('不许动手');
    expect(h.notices.some((entry) => entry.packet.kind === SYSTEM_NOTICE_KIND.AssaultWarn)).toBe(false);
  });

  it('袭警后押送途中再打保安不重复建案', () => {
    const h = setup();
    const guard = h.world.createNpc(
      '园区保安',
      DEFAULT_APPEARANCE.cow,
      4_300,
      4_300,
      '',
      Date.now(),
      undefined,
      ENTITY_ROLE_GUARD,
    )!;

    hit(h, guard.id, 1_000);
    expect(h.dispatched).toHaveLength(1);

    hit(h, guard.id, 2_000);

    expect(h.dispatched).toHaveLength(1);
  });

  it('已在押送流程里的人不再重复建案', () => {
    const h = setup();
    for (let index = 0; index < 3; index += 1) hit(h, h.bystander.id, 1_000 + index * 1_000);
    expect(h.dispatched).toHaveLength(1);

    hit(h, h.bystander.id, 5_000);
    hit(h, h.bystander.id, 6_000);

    expect(h.dispatched).toHaveLength(1);
  });

  it('攻击者断线后账本清空，回来从零开始', () => {
    const h = setup();
    hit(h, h.bystander.id, 1_000);
    // 断线：wsId 归零，5 秒节流的清理应把这条旧账丢掉
    h.player.wsId = 0;
    h.detention.update(6_000);
    h.player.wsId = 11;

    hit(h, h.bystander.id, 7_000);

    expect(h.notices).toEqual([]);
    expect(h.dispatched).toEqual([]);
  });
});

describe('擂台赛期间保安不执法（ADR-0075）', () => {
  /** 报名只认围绳附近的服务端传送：夹具先把人挪到场边，再走同一条入场路径 */
  function enterRing(h: Harness, at: number): void {
    h.player.x = RING_EXIT.x;
    h.player.y = RING_EXIT.y;
    expect(h.world.ring.enter(h.player, at, 0).ok).toBe(true);
  }

  it('名单内的玩家不累计坐站循环，也不派单', () => {
    const h = setup();
    enterRing(h, 1_000);
    // 围观者贴到起跑位旁：排除「身边没人」这个不触发原因
    h.bystander.x = RING_START_SLOTS[0]!.x + 20;
    h.bystander.y = RING_START_SLOTS[0]!.y;

    let at = 1_100;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);

    expect(h.sent).toEqual([]);
    expect(h.dispatched).toEqual([]);
  });

  it('已确认的案子在上擂台后撤销：保安原地松手，只发一次 Released', () => {
    const h = setup();
    let at = 1_000;
    for (let index = 0; index < 6; index += 1) at = cycle(h, at);
    expect(h.dispatched).toEqual([h.player.id]);

    enterRing(h, at);
    h.detention.update(at);

    expect(h.cancelled).toEqual([h.player.id]);
    const released = () => h.sent.filter((entry) => entry.packet.phase === JAIL_PHASE.Released);
    // 本人 + 旁观者各一份
    expect(released()).toHaveLength(2);

    // 案子只撤销一次：后续 Tick 不重复发 Released，也不重复取消
    h.detention.update(at + 50);
    expect(h.cancelled).toEqual([h.player.id]);
    expect(released()).toHaveLength(2);
  });
});
