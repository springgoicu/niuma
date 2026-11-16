import {
  DIRECTION, POSE, RING_AWARD_MS, RING_BET_MAX, RING_BET_MIN, RING_CAPACITY, RING_DAMAGE, RING_EXIT,
  RING_MAX_HP, RING_PHASE, RING_PODIUM_SLOTS, RING_ROUND_MS, RING_SIDE, RING_START_SLOTS,
  clampToRing, encodeRing, isNearRing, rankByHp, splitPool,
  type RingPacket, type RingPhase,
} from '@niuma/shared-types';
import type { Player, World } from './world';
import type { Transport } from './view';

/** 报名费的托管 key：按玩家实体分账，离场退费不会误伤别人或自己的注额 */
export function ringFeeKey(playerId: number): string {
  return `ring:${Math.max(0, Math.floor(playerId))}`;
}
/** 观战押注的托管 key：同样按玩家实体分账 */
export function ringBetKey(playerId: number): string {
  return `ring:bet:${Math.max(0, Math.floor(playerId))}`;
}

interface RingMember {
  id: number;
  name: string;
  hp: number;
  enteredAt: number;
  eliminatedAt: number | null;
  rank: number;
  dealt: number;
  slot: number;
  /** 红 / 蓝两角：先报名的是红方（擂主） */
  side: number;
  /** 匿名设备号：离线结算 / 奖牌按它入账，空串表示匿名会话 */
  deviceId: string;
  /** 报名费（已冻结在 ring 托管 key 上） */
  fee: number;
}

/** 一笔需要原路退回的报名费：断线 / 走空时按设备号退，玩家不在线也能退 */
export interface RingFeeRefund {
  /** 报名时的实体 id：托管 key 用它分账，离线后仍然有效 */
  playerId: number;
  deviceId: string;
  amount: number;
}

/** 观战押注：一人一局一注，注额在进表前已由经济层冻结 */
interface RingBet {
  side: number;
  amount: number;
}

/**
 * 一场比赛的彩池结算结果。
 *
 * 由 `RingRuntime` 在 settle 时算好，服务端回调里照着入账——
 * 运行时本身不碰钱包，单测可以直接断言这份结构。
 */
export interface RingPoolResult {
  matchId: number;
  redPool: number;
  bluePool: number;
  winnerSide: number;
  /** 押中的人的派彩（含本金），已按注额比例分完整个池 */
  payouts: Array<{ id: number; amount: number }>;
  /** 无人押中时全额退款的人 */
  refunds: number[];
  /** 押错一侧的人：托管要在结算时清账，不能留到下次重启被 refundAllEscrow 退回 */
  losers: number[];
}

export type RingEnterFailure = 'already' | 'full' | 'phase' | 'far';
export type RingEnterResult = { ok: true; started: boolean } | { ok: false; reason: RingEnterFailure };
export interface RingHitResult { hp: number; eliminated: boolean }
export interface RingTickResult { changed: boolean; moved: Player[] }

/** 离场结果：只有开打前的离场才退报名费 */
export interface RingLeaveResult {
  ok: boolean;
  refundFee: boolean;
}

/**
 * 断线清理结果。
 *
 * `abandonedFees` 只在「比赛中两人都断线、这局再也打不完」时非空：
 * 服务端拿它把报名费按设备号原路退回，避免钱包永久少一笔。
 */
export interface RingRemoveResult {
  removed: boolean;
  refundFee: boolean;
  abandonedFees: RingFeeRefund[];
}

/** 落盘用的名次摘要：只留名字与名次，重放不了战斗过程，也不需要 */
export interface RingLastMatchState {
  matchId: number;
  endedAt: number;
  top: { name: string; rank: number; hp: number }[];
}

/** 落盘用的擂台状态：局号必须连续，进行中的比赛不复活 */
export interface RingSaveState {
  matchId: number;
  nextMatchId: number;
  lastMatch: RingLastMatchState | null;
}

/** 结算回调：服务端据此把名次记进匿名档案，测试不传即可 */
export interface RingSettleEntry {
  /** 实体 id：在线时用于发包与传送；离线后可能已不在 world 里 */
  id: number;
  /** 报名时的实体 id：离线后也不变，托管 key `ring:<playerId>` 用它 */
  playerId: number;
  /** 匿名设备号：离线入账 / 奖牌聚合的唯一键，空串表示匿名会话 */
  deviceId: string;
  name: string;
  rank: number;
  /** 本人在 ring 托管 key 上的报名费，冠军拿全部、其余人清账 */
  fee: number;
}

/**
 * 红蓝 1v1 擂台状态机：idle → waiting → running → award → idle。
 * 只活在服务端内存；入场、扣血、倒计时、名次与传送全由这里裁决。
 *
 * `RING_ROUND_MS` 是本局上限而不是固定时长：只要站着的只剩 1 人（冠军已定），
 * 下一次 `tick` 就立刻结算，不必等倒计时走完（ADR-0076）。
 */
export class RingRuntime {
  phase: RingPhase = RING_PHASE.Idle;
  matchId = 0;
  /** 上一局名次摘要：settle 时写入，落盘后重启仍能看到上一局谁站上了领奖台 */
  lastMatch: RingLastMatchState | null = null;
  private members: RingMember[] = [];
  private nextMatchId = 1;
  private phaseEndsAt = 0;
  private lastBroadcastAt = 0;
  private moved: Player[] = [];
  /** 观战押注：`matchId` 变了就整表作废，不允许跨局带注 */
  private readonly bets = new Map<number, RingBet>();
  private betMatchId = 0;
  /**
   * 已离场但本局还没结算的报名费。
   *
   * 比赛中断线不退款（他可能是被对手打退的），但如果两人都走了，
   * 这一局再也打不完，服务端要把这些费用原路退回；冠军结算时它们进冠军彩池。
   */
  private readonly droppedFees: RingFeeRefund[] = [];
  /** 上一场的彩池结算结果：服务端回调读它入账，下一次开赛清空 */
  lastPool: RingPoolResult | null = null;
  /** 擂主连胜：同一人连续夺冠的次数；键是设备号（重连也算同一个人） */
  streak = 0;
  streakKey = '';
  /**
   * 状态版本号：只在「阶段/名单真的变了」时 +1。
   *
   * Tick 的 1Hz 心跳也会返回 changed=true，如果服务端按 changed 落盘，
   * 就会变成每秒一次写盘；版本号让落盘只跟着真正的状态变化走。
   */
  private revisionCounter = 0;

  constructor(private readonly onSettled?: (entries: readonly RingSettleEntry[]) => void) {}

  get count(): number { return this.members.length; }
  get endsAt(): number { return this.phaseEndsAt; }
  get revision(): number { return this.revisionCounter; }
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

  /** 红蓝各一人：第 1 人等待，第 2 人落地启动 120 秒；满员后报名一律判 full。 */
  enter(player: Player, now: number, fee: number): RingEnterResult {
    const verdict = this.canEnter(player);
    if (verdict !== true) return verdict;
    const slot = this.firstFreeSlot();
    this.members.push({
      id: player.id, name: player.name, hp: RING_MAX_HP, enteredAt: now,
      eliminatedAt: null, rank: 0, dealt: 0, slot,
      deviceId: player.deviceId,
      fee: Math.max(0, Math.floor(fee)),
      // 先上台的是红方（擂主），第二个挑战者是蓝方
      side: slot === 0 ? RING_SIDE.Red : RING_SIDE.Blue,
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
      // 新的一场：押注表与上一场结算清空，观战者从现在起才能押
      this.bets.clear();
      this.betMatchId = this.matchId;
      this.lastPool = null;
    }
    this.lastBroadcastAt = now;
    this.revisionCounter += 1;
    return { ok: true, started };
  }

  /**
   * 等待期可以取消报名，颁奖期可以领奖后提前离场；比赛中按「不得离开」拒绝。
   *
   * 只有 Waiting 期离场才退报名费：Award 期的名次与奖金已经结算，
   * 这时候退费就是凭空造币（ADR-0104 修复的原漏洞）。
   */
  leave(player: Player, now: number): RingLeaveResult {
    if (this.phase !== RING_PHASE.Waiting && this.phase !== RING_PHASE.Award) {
      return { ok: false, refundFee: false };
    }
    const index = this.members.findIndex((member) => member.id === player.id);
    if (index < 0) return { ok: false, refundFee: false };
    const refundFee = this.phase === RING_PHASE.Waiting;
    this.members.splice(index, 1);
    this.teleport(player, RING_EXIT);
    // 全员走光就直接回空闲：颁奖窗口已经没有意义，再留着会让报名继续被拒
    if (this.members.length === 0) {
      this.phase = RING_PHASE.Idle;
      this.phaseEndsAt = 0;
      this.droppedFees.length = 0;
    }
    this.lastBroadcastAt = now;
    this.revisionCounter += 1;
    return { ok: true, refundFee };
  }

  /**
   * 观战押注：只有比赛进行中、场外玩家、且本局没押过才受理。
   *
   * 注额冻结由经济层在调用前完成（与报名费同一套「先扣后记」纪律），
   * 这里只做资格判定与登记，因此单测不需要钱包。
   */
  placeBet(player: Player, side: number, amount: number, now: number): boolean {
    const verdict = this.betVerdict(player, side, amount, now);
    if (verdict !== 'ok') return false;
    this.bets.set(player.id, { side, amount: Math.floor(amount) });
    return true;
  }

  /** 押注资格：给 UI 与服务端共用一份判定 */
  betVerdict(player: Player, side: number, amount: number, now: number): 'ok' | 'phase' | 'member' | 'placed' | 'amount' {
    if (this.phase !== RING_PHASE.Running || now >= this.phaseEndsAt) return 'phase';
    if (this.has(player.id)) return 'member';
    if (side !== RING_SIDE.Red && side !== RING_SIDE.Blue) return 'amount';
    const stake = Math.floor(amount);
    if (!Number.isFinite(stake) || stake < RING_BET_MIN || stake > RING_BET_MAX) return 'amount';
    if (this.bets.has(player.id)) return 'placed';
    return 'ok';
  }

  betOf(id: number): RingBet | null {
    return this.bets.get(id) ?? null;
  }

  /** 断线 / 离场：把注额原样退回（返回金额，0 表示没押） */
  dropBet(id: number): number {
    const bet = this.bets.get(id);
    if (!bet) return 0;
    this.bets.delete(id);
    return bet.amount;
  }

  /** 当前彩池：给 HUD 与押注弹窗用 */
  pools(): { red: number; blue: number } {
    let red = 0;
    let blue = 0;
    for (const bet of this.bets.values()) {
      if (bet.side === RING_SIDE.Red) red += bet.amount;
      else blue += bet.amount;
    }
    return { red, blue };
  }

  private settlePool(winnerSide: number): RingPoolResult | null {
    if (this.betMatchId !== this.matchId || this.bets.size === 0) {
      this.bets.clear();
      return null;
    }
    const { red, blue } = this.pools();
    const pool = red + blue;
    const winners = [...this.bets.entries()]
      .filter(([, bet]) => bet.side === winnerSide)
      .map(([id, bet]) => ({ id, amount: bet.amount }));
    const winnerIds = new Set(winners.map((entry) => entry.id));
    const result: RingPoolResult =
      winners.length === 0
        ? {
            matchId: this.matchId,
            redPool: red,
            bluePool: blue,
            winnerSide,
            payouts: [],
            refunds: [...this.bets.keys()],
            losers: [],
          }
        : {
            matchId: this.matchId,
            redPool: red,
            bluePool: blue,
            winnerSide,
            payouts: splitPool(winners, pool),
            refunds: [],
            losers: [...this.bets.keys()].filter((id) => !winnerIds.has(id)),
          };
    this.bets.clear();
    return result;
  }

  /**
   * 断线清理：不补位、不奖励；走空回 idle，剩 1 人仍让计时跑完。
   *
   * - Waiting 期断线：这一局没开打，报名费原路退回；
   * - Running 期断线：费用留在本局，冠军结算时一并拿走；
   * - 两人都断线：这局再也打不完，把两人（以及此前断线者）的费用一起退回。
   */
  removePlayer(id: number, now: number): RingRemoveResult {
    const index = this.members.findIndex((member) => member.id === id);
    if (index < 0) return { removed: false, refundFee: false, abandonedFees: [] };
    const [member] = this.members.splice(index, 1);
    const phaseWhenLeaving = this.phase;
    if (this.members.length === 0) {
      this.phase = RING_PHASE.Idle;
      this.phaseEndsAt = 0;
    }
    this.lastBroadcastAt = now;
    this.revisionCounter += 1;
    const fee = member ? { playerId: member.id, deviceId: member.deviceId, amount: member.fee } : null;
    if (phaseWhenLeaving === RING_PHASE.Waiting) {
      return { removed: true, refundFee: true, abandonedFees: [] };
    }
    if (phaseWhenLeaving === RING_PHASE.Running && fee) {
      this.droppedFees.push(fee);
      if (this.members.length === 0) {
        const abandonedFees = [...this.droppedFees];
        this.droppedFees.length = 0;
        return { removed: true, refundFee: false, abandonedFees };
      }
    }
    return { removed: true, refundFee: false, abandonedFees: [] };
  }

  /** 落盘快照：局号 + 上一局名次，不包含进行中的名单（重连的人都已不在） */
  snapshotForSave(): RingSaveState {
    return { matchId: this.matchId, nextMatchId: this.nextMatchId, lastMatch: this.lastMatch };
  }

  /**
   * 从快照恢复：只接局号与摘要。
   *
   * 停机时还在打的局一律收尾为 idle——参赛者的连接已经断了，复活这场「幽灵比赛」
   * 只会让下一个进场的人在空台上等 120 秒。
   */
  restore(state: RingSaveState): void {
    this.matchId = Math.max(0, Math.floor(state.matchId));
    this.nextMatchId = Math.max(1, Math.floor(state.nextMatchId));
    this.lastMatch = state.lastMatch;
    this.members = [];
    this.phase = RING_PHASE.Idle;
    this.phaseEndsAt = 0;
    this.revisionCounter += 1;
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
   * 免得白送一个冠军；判定本身只扫 ≤2 个成员，不需要额外状态。
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
    // 冠军角与连胜：同一人（按设备号，重连也算同一个人）连续夺冠才累加
    const championId = ranked[0]?.id ?? 0;
    const champion = this.members.find((member) => member.id === championId);
    const championPlayer = championId !== 0 ? world.get(championId) : undefined;
    const championKey = champion?.deviceId || championPlayer?.deviceId || `#${championId}`;
    if (championId !== 0) {
      if (this.streakKey === championKey) this.streak += 1;
      else {
        this.streakKey = championKey;
        this.streak = 1;
      }
    }
    this.lastPool = this.settlePool(champion ? champion.side : RING_SIDE.Red);
    const top: RingLastMatchState['top'] = [];
    const settleEntries: RingSettleEntry[] = [];
    for (const entry of ranked) {
      const member = this.members.find((item) => item.id === entry.id);
      if (member) member.rank = entry.rank;
      const player = world.get(entry.id);
      const name = player?.name ?? member?.name ?? '';
      if (member) top.push({ name, rank: entry.rank, hp: member.hp });
      // 结算条目要覆盖离线者：冠军断线也要拿到奖金与奖牌（ADR-0104）
      settleEntries.push({
        id: entry.id,
        playerId: entry.id,
        deviceId: member?.deviceId ?? player?.deviceId ?? '',
        name,
        rank: entry.rank,
        fee: member?.fee ?? 0,
      });
      if (!player) continue;
      const slot = RING_PODIUM_SLOTS[entry.rank - 1];
      if (slot) this.teleport(player, slot);
      this.moved.push(player);
    }
    // 已断线者的报名费仍属本局彩池：冠军拿走，别把它们留在托管里
    for (const dropped of this.droppedFees) {
      settleEntries.push({
        id: 0,
        playerId: dropped.playerId,
        deviceId: dropped.deviceId,
        name: '',
        rank: 0,
        fee: dropped.amount,
      });
    }
    this.droppedFees.length = 0;
    this.lastMatch = { matchId: this.matchId, endedAt: now, top };
    this.revisionCounter += 1;
    if (settleEntries.length > 0) this.onSettled?.(settleEntries);
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
    this.revisionCounter += 1;
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
