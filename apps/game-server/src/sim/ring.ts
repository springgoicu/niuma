import {
  DIRECTION, POSE, RING_AWARD_MS, RING_CAPACITY, RING_DAMAGE, RING_EXIT,
  RING_MAX_HP, RING_PHASE, RING_PODIUM_SLOTS, RING_ROUND_MS, RING_START_SLOTS,
  clampToRing, encodeRing, isNearRing, rankByHp,
  type RingPacket, type RingPhase,
} from '@niuma/shared-types';
import type { Player, World } from './world';
import type { Transport } from './view';

interface RingMember {
  id: number;
  name: string;
  hp: number;
  enteredAt: number;
  eliminatedAt: number | null;
  rank: number;
  dealt: number;
  slot: number;
}

export type RingEnterFailure = 'already' | 'full' | 'phase' | 'far';
export type RingEnterResult = { ok: true; started: boolean } | { ok: false; reason: RingEnterFailure };
export interface RingHitResult { hp: number; eliminated: boolean }
export interface RingTickResult { changed: boolean; moved: Player[] }

/**
 * 三人擂台状态机：idle → waiting → running → award → idle。
 * 只活在服务端内存；入场、扣血、倒计时、名次与传送全由这里裁决。
 *
 * `RING_ROUND_MS` 是本局上限而不是固定时长：只要站着的只剩 1 人（冠军已定），
 * 下一次 `tick` 就立刻结算，不必等倒计时走完（ADR-0076）。
 */
export class RingRuntime {
  phase: RingPhase = RING_PHASE.Idle;
  matchId = 0;
  private members: RingMember[] = [];
  private nextMatchId = 1;
  private phaseEndsAt = 0;
  private lastBroadcastAt = 0;
  private moved: Player[] = [];

  get count(): number { return this.members.length; }
  get endsAt(): number { return this.phaseEndsAt; }
  isRunning(): boolean { return this.phase === RING_PHASE.Running; }
  has(id: number): boolean { return this.members.some((member) => member.id === id); }
  blocksOutside(id: number): boolean { return !this.has(id); }
  isFrozen(id: number): boolean { return this.phase === RING_PHASE.Award && this.has(id); }

  canEnter(player: Player): RingEnterResult | true {
    if (this.has(player.id)) return { ok: false, reason: 'already' };
    if (this.phase === RING_PHASE.Award) return { ok: false, reason: 'phase' };
    if (this.members.length >= RING_CAPACITY) return { ok: false, reason: 'full' };
    if (!isNearRing(player.x, player.y)) return { ok: false, reason: 'far' };
    return true;
  }

  /** 第 1 人等待，第 2 人落地启动 120 秒；第 3 人可在 running 中途补入。 */
  enter(player: Player, now: number): RingEnterResult {
    const verdict = this.canEnter(player);
    if (verdict !== true) return verdict;
    const slot = this.firstFreeSlot();
    this.members.push({
      id: player.id, name: player.name, hp: RING_MAX_HP, enteredAt: now,
      eliminatedAt: null, rank: 0, dealt: 0, slot,
    });
    this.teleport(player, RING_START_SLOTS[slot]!);
    let started = false;
    if (this.phase === RING_PHASE.Idle) {
      this.phase = RING_PHASE.Waiting;
      this.matchId = this.nextMatchId;
      this.nextMatchId = this.nextMatchId >= 0xffff ? 1 : this.nextMatchId + 1;
    }
    if (this.phase === RING_PHASE.Waiting && this.members.length >= 2) {
      this.phase = RING_PHASE.Running;
      this.phaseEndsAt = now + RING_ROUND_MS;
      started = true;
    }
    this.lastBroadcastAt = now;
    return { ok: true, started };
  }

  /** 等待期可以取消报名，颁奖期可以领奖后提前离场；比赛中按「不得离开」拒绝。 */
  leave(player: Player, now: number): boolean {
    if (this.phase !== RING_PHASE.Waiting && this.phase !== RING_PHASE.Award) return false;
    const index = this.members.findIndex((member) => member.id === player.id);
    if (index < 0) return false;
    this.members.splice(index, 1);
    this.teleport(player, RING_EXIT);
    // 全员走光就直接回空闲：颁奖窗口已经没有意义，再留着会让报名继续被拒
    if (this.members.length === 0) {
      this.phase = RING_PHASE.Idle;
      this.phaseEndsAt = 0;
    }
    this.lastBroadcastAt = now;
    return true;
  }

  /** 断线清理：不补位、不奖励；走空回 idle，剩 1 人仍让计时跑完。 */
  removePlayer(id: number, now: number): boolean {
    const index = this.members.findIndex((member) => member.id === id);
    if (index < 0) return false;
    this.members.splice(index, 1);
    if (this.members.length === 0) this.phase = RING_PHASE.Idle;
    this.lastBroadcastAt = now;
    return true;
  }

  /** 唯一扣血入口：只认 running 阶段、双方都在名单内的命中。 */
  applyHit(attacker: Player, victim: Player, now: number): RingHitResult | null {
    if (this.phase !== RING_PHASE.Running) return null;
    const attackerMember = this.members.find((member) => member.id === attacker.id);
    const victimMember = this.members.find((member) => member.id === victim.id);
    if (!attackerMember || !victimMember || victimMember.hp <= 0) return null;
    const damage = Math.min(RING_DAMAGE, victimMember.hp);
    victimMember.hp -= damage;
    attackerMember.dealt += damage;
    const eliminated = victimMember.hp <= 0;
    if (eliminated) {
      victimMember.hp = 0;
      victimMember.eliminatedAt = now;
    }
    return { hp: victimMember.hp, eliminated };
  }

  /**
   * 冠军已定：本局至少 2 人参战，且站着的只剩 1 人（或全部倒下）。
   *
   * 断线剩 1 人时 `members.length === 1`，不算分出胜负——那种情况仍走完计时，
   * 免得白送一个冠军；判定本身只扫 ≤3 个成员，不需要额外状态。
   */
  private isDecided(): boolean {
    if (this.members.length < 2) return false;
    let standing = 0;
    for (const member of this.members) if (member.hp > 0) standing += 1;
    return standing <= 1;
  }

  /** 每 Tick 推进状态机；返回是否广播，以及本 Tick 被传送的玩家。 */
  tick(now: number, world: World): RingTickResult {
    this.moved.length = 0;
    let changed = false;
    // 到点与提前决出共用同一条结算路径：领奖台传送、名次与广播都不另开分支
    if (this.phase === RING_PHASE.Running && (now >= this.phaseEndsAt || this.isDecided())) {
      this.settle(now, world);
      changed = true;
    } else if (this.phase === RING_PHASE.Award && now >= this.phaseEndsAt) {
      this.finishAward(now, world);
      changed = true;
    } else if (this.phase !== RING_PHASE.Idle && now - this.lastBroadcastAt >= 1_000) {
      this.lastBroadcastAt = now;
      changed = true;
    }
    return { changed, moved: this.moved };
  }

  /** 生成下行快照；名字取当前实体名，改名后 1Hz 心跳会自动跟上。 */
  snapshot(now: number, world: World): RingPacket {
    const remainingMs = this.phase === RING_PHASE.Running ? Math.max(0, this.phaseEndsAt - now) : 0;
    return {
      phase: this.phase,
      matchId: this.matchId,
      remainingMs,
      members: this.members
        .slice()
        .sort((a, b) => a.enteredAt - b.enteredAt || a.id - b.id)
        .map((member) => ({
          id: member.id,
          slot: member.slot,
          name: world.get(member.id)?.name ?? member.name,
          hp: member.hp,
          eliminated: member.hp <= 0,
          rank: member.rank,
        })),
    };
  }

  private settle(now: number, world: World): void {
    this.phase = RING_PHASE.Award;
    this.phaseEndsAt = now + RING_AWARD_MS;
    const ranked = rankByHp(this.members);
    for (const entry of ranked) {
      const member = this.members.find((item) => item.id === entry.id);
      if (member) member.rank = entry.rank;
      const player = world.get(entry.id);
      if (!player) continue;
      const slot = RING_PODIUM_SLOTS[entry.rank - 1];
      if (slot) this.teleport(player, slot);
      this.moved.push(player);
    }
  }

  private finishAward(now: number, world: World): void {
    for (const member of this.members) {
      const player = world.get(member.id);
      if (!player) continue;
      this.teleport(player, RING_EXIT);
      this.moved.push(player);
    }
    this.members = [];
    this.phase = RING_PHASE.Idle;
    this.lastBroadcastAt = now;
  }

  /** 传送并冻结旧动作；颁奖阶段结束后再统一回出口。 */
  private teleport(player: Player, target: { x: number; y: number }): void {
    player.x = target.x;
    player.y = target.y;
    player.seat = 0;
    player.stunUntil = 0;
    player.vent = false;
    player.ventPending = false;
    player.applyState(DIRECTION.Down, POSE.Idle, false);
    player.dirty = true;
    player.needsViewRefresh = true;
  }

  private firstFreeSlot(): number {
    for (let i = 0; i < RING_CAPACITY; i += 1) {
      if (!this.members.some((member) => member.slot === i)) return i;
    }
    return Math.min(this.members.length, RING_CAPACITY - 1);
  }
}

/** 全局擂台快照：包很小，发给所有在线连接，HUD 只在近场显示。 */
export function broadcastRing(world: World, transport: Transport, now = Date.now()): void {
  const packet = encodeRing(world.ring.snapshot(now, world));
  for (const player of world.players.values()) {
    if (player.wsId !== 0) transport.send(player.wsId, packet);
  }
}
