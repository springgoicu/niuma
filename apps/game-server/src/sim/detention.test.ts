import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  JAIL_ANCHORS,
  JAIL_PHASE,
  OpCode,
  POSE,
  decodeJail,
  packState,
  quantizeCoord,
  type JailPacket,
  type MovePacket,
} from '@niuma/shared-types';
import { SpatialGrid } from '../spatial/grid';
import { Detention, type EscortEvent } from './detention';
import { applyMove } from './movement';
import { World, type Player } from './world';

interface Harness {
  world: World;
  grid: SpatialGrid;
  player: Player;
  bystander: Player;
  detention: Detention;
  sent: Array<{ wsId: number; packet: JailPacket }>;
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
  const dispatched: number[] = [];
  const cancelled: number[] = [];
  const dispatchGuard = { id: 42 };

  const detention = new Detention({
    world,
    grid,
    transport: {
      send(wsId: number, data: Uint8Array) {
        // 系统提示与小黑屋包共用一条连接，这里只关心后者
        if (data[0] !== OpCode.S2C_JAIL) return;
        sent.push({ wsId, packet: decodeJail(data) });
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

  return { world, grid, player, bystander, detention, sent, dispatched, cancelled, dispatchGuard };
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
