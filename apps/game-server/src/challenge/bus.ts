import {
  P2P_GAME_TYPE,
  P2P_INVITE_REASON,
  P2P_INVITE_TTL_MS,
  P2P_INVITE_RANGE_PX,
  P2P_MAX_ACTIVE_MATCHES,
  P2P_MAX_PENDING_INVITES,
  P2P_MAX_WAGER,
  P2P_MATCH_END,
  P2P_MATCH_PHASE,
  encodeP2PDuelState,
  encodeP2PInviteNotify,
  encodeP2PInviteResult,
  encodeP2PMatch,
  encodeP2PShowdown,
  type P2PActionRequest,
  type P2PDuelStatePacket,
  type P2PInviteRequest,
  type P2PRespondRequest,
  type P2PShowdownPacket,
} from '@niuma/shared-types';
import type { EconomyService } from '../economy/service';
import type { Player } from '../sim/world';
import type {
  ActiveMatch,
  ChallengeContext,
  ChallengeHandler,
  DuelCombatPort,
  DuelVentResolution,
  ShowdownInput,
} from './types';

/** 同一玩家的互动包最短间隔：邀请 / 打赏 / 道具 / 购买共用这个闸门 */
export const P2P_PACKET_INTERVAL_MS = 500;
/** 处理器忘记结算时的兜底：超过 endsAt 这么久就强制退款，绝不锁死玩家 */
const MATCH_HARD_TIMEOUT_MS = 5_000;

/** 挑战巴士的托管 key：一局一个，结算 / 退款只碰自己，不影响赌桌与擂台 */
export function p2pEscrowKey(matchId: number): string {
  return `p2p:${Math.max(0, Math.floor(matchId))}`;
}

interface PendingInvite {
  id: number;
  from: Player;
  to: Player;
  gameType: number;
  wager: number;
  extra: number;
  expiresAt: number;
}

export interface ChallengeBusOptions {
  send(player: Player, packet: Uint8Array): void;
  economy: EconomyService;
  findPlayer(id: number): Player | undefined;
  /** 可注入随机源：占位玩法的裁决在测试里必须确定 */
  random?: () => number;
  /**
   * 一局结算完成（无论赌注是否为 0）：每日悬赏的「赢一局」挂在这里。
   *
   * `winner` 为 null 表示平局 / 超时 / 取消——那种情况不算赢，不发进度。
   */
  onSettled?(winner: Player | null, loser: Player | null, gameType: number, now: number): void;
}

/**
 * 通用 P2P 互动总线（ADR-0083）。
 *
 * 状态只有两段：`PendingInvite`（15 秒 TTL）与 `ActiveMatch`（赌注已托管）。
 * 所有退出路径（拒绝 / 超时 / 取消 / 掉线）都会清空 `busyMatchId` 与 `pendingInviteId`，
 * 因此玩家不可能被一场失败的对局永久卡住。
 */
export class ChallengeBus {
  private readonly pending = new Map<number, PendingInvite>();
  private readonly active = new Map<number, ActiveMatch>();
  private readonly handlers = new Map<number, ChallengeHandler>();
  private nextInviteId = 1;
  private nextMatchId = 1;

  constructor(private readonly options: ChallengeBusOptions) {}

  register(handler: ChallengeHandler): void {
    this.handlers.set(handler.gameType, handler);
  }

  handlerName(gameType: number): string | undefined {
    return this.handlers.get(gameType)?.name;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** 发起邀请；返回 0 表示邀请已送达被邀请方，其余值是需要回给发起方的错误码 */
  invite(from: Player, request: P2PInviteRequest, now: number): number {
    const reject = (reason: number): number => {
      this.sendResult(from, 0, false, reason);
      return reason;
    };
    const target = this.options.findPlayer(request.targetId);
    if (request.targetId === from.id) return reject(P2P_INVITE_REASON.Self);
    if (!target || target.wsId === 0) return reject(P2P_INVITE_REASON.Offline);
    if (from.pendingInviteId !== 0 || from.busyMatchId !== 0) return reject(P2P_INVITE_REASON.Busy);
    if (target.pendingInviteId !== 0 || target.busyMatchId !== 0) {
      return reject(P2P_INVITE_REASON.TargetBusy);
    }
    if (!this.handlers.has(request.gameType)) return reject(P2P_INVITE_REASON.UnknownGame);
    if (request.wager < 0 || request.wager > P2P_MAX_WAGER) {
      return reject(P2P_INVITE_REASON.InvalidWager);
    }
    if (from.coins < request.wager) return reject(P2P_INVITE_REASON.NotEnoughCoins);
    const distance = Math.hypot(target.x - from.x, target.y - from.y);
    if (distance > P2P_INVITE_RANGE_PX) return reject(P2P_INVITE_REASON.OutOfRange);
    if (this.pending.size >= P2P_MAX_PENDING_INVITES) return reject(P2P_INVITE_REASON.Limit);

    const id = this.nextInviteId++;
    this.pending.set(id, {
      id,
      from,
      to: target,
      gameType: request.gameType,
      wager: Math.floor(request.wager),
      extra: request.extra,
      expiresAt: now + P2P_INVITE_TTL_MS,
    });
    from.pendingInviteId = id;
    target.pendingInviteId = id;
    this.options.send(
      target,
      encodeP2PInviteNotify({
        inviteId: id,
        fromId: from.id,
        fromName: from.name,
        gameType: request.gameType,
        wager: Math.floor(request.wager),
        extra: request.extra,
        ttlMs: P2P_INVITE_TTL_MS,
      }),
    );
    return P2P_INVITE_REASON.None;
  }

  respond(player: Player, request: P2PRespondRequest, now: number): void {
    const invite = this.pending.get(request.inviteId);
    // 只认被邀请方：别人拿到 inviteId 也不能替人接受
    if (!invite || invite.to.id !== player.id) {
      this.sendResult(player, request.inviteId, false, P2P_INVITE_REASON.Expired);
      return;
    }
    if (now >= invite.expiresAt) {
      this.dropPending(invite);
      this.sendResult(invite.from, invite.id, false, P2P_INVITE_REASON.Expired);
      // 应战方恰好在到期这一刻点了「接受」：浮窗已按本地 TTL 收起，但也要收到一条
      // Expired 回执，否则他不知道这一下没接上（客户端 challenge.ts 据此弹「邀请已超时」）
      this.sendResult(player, invite.id, false, P2P_INVITE_REASON.Expired);
      return;
    }
    if (!request.accept) {
      this.dropPending(invite);
      this.sendResult(invite.from, invite.id, false, P2P_INVITE_REASON.Declined);
      return;
    }
    const initiator = invite.from;
    const responder = invite.to;
    if (initiator.busyMatchId !== 0 || initiator.wsId === 0) {
      this.dropPending(invite);
      this.sendResult(initiator, invite.id, false, P2P_INVITE_REASON.Offline);
      // 应战方已点了接受却等不到开赛：给一条 Offline 说明发起方掉线 / 在忙
      this.sendResult(responder, invite.id, false, P2P_INVITE_REASON.Offline);
      return;
    }
    if (responder.busyMatchId !== 0) {
      // 理论上不可能（pending 与 busy 互斥），但状态被外部改写时仍要能安全退出
      this.dropPending(invite);
      this.sendResult(initiator, invite.id, false, P2P_INVITE_REASON.TargetBusy);
      this.sendResult(responder, invite.id, false, P2P_INVITE_REASON.TargetBusy);
      return;
    }
    if (this.active.size >= P2P_MAX_ACTIVE_MATCHES) {
      this.dropPending(invite);
      this.sendResult(initiator, invite.id, false, P2P_INVITE_REASON.Limit);
      this.sendResult(responder, invite.id, false, P2P_INVITE_REASON.Limit);
      return;
    }
    const economy = this.options.economy;
    // 先把局号定下来：托管 key 要用它，保证同一局的冻结 / 退款 / 结算只碰自己的 key
    const matchId = this.nextMatchId++;
    const escrowKey = p2pEscrowKey(matchId);
    // 0 赌注是合法的「切磋」：没有托管可冻结，直接开赛
    if (invite.wager > 0) {
      // 先冻结发起方；被邀请方余额不足时原路退回，不能留下半场托管
      if (!economy.freezeEscrow(initiator, escrowKey, invite.wager)) {
        this.dropPending(invite);
        this.sendResult(initiator, invite.id, false, P2P_INVITE_REASON.NotEnoughCoins);
        this.sendResult(responder, invite.id, false, P2P_INVITE_REASON.NotEnoughCoins);
        return;
      }
      if (!economy.freezeEscrow(responder, escrowKey, invite.wager)) {
        economy.refundEscrow(initiator, escrowKey);
        this.dropPending(invite);
        this.sendResult(initiator, invite.id, false, P2P_INVITE_REASON.NotEnoughCoins);
        this.sendResult(responder, invite.id, false, P2P_INVITE_REASON.NotEnoughCoins);
        return;
      }
    }
    this.dropPending(invite);
    this.sendResult(initiator, invite.id, true, P2P_INVITE_REASON.None);

    const handler = this.handlers.get(invite.gameType);
    const match: ActiveMatch = {
      id: matchId,
      gameType: invite.gameType,
      wager: invite.wager,
      extra: invite.extra,
      a: initiator,
      b: responder,
      startedAt: now,
      endsAt: now + (handler?.durationMs ?? 0),
      data: {},
      resolved: false,
    };
    this.active.set(match.id, match);
    initiator.busyMatchId = match.id;
    responder.busyMatchId = match.id;
    this.broadcastMatch(match, now, P2P_MATCH_PHASE.Started, 0, P2P_MATCH_END.Normal);
    handler?.onStart?.(match, this.contextFor(match, now));
  }

  /** 猜拳出拳 / 未来玩法的单字节行动；不在对局中或行动非法时静默丢弃 */
  action(player: Player, request: P2PActionRequest, now: number): void {
    const match = this.active.get(request.matchId);
    if (!match || match.resolved) return;
    if (match.a.id !== player.id && match.b.id !== player.id) return;
    const handler = this.handlers.get(match.gameType);
    handler?.onAction?.(match, player, request.action, this.contextFor(match, now));
  }

  /** 切磋战斗端口：模拟层只依赖这三个方法，不反向 import 总线实现 */
  get duelPort(): DuelCombatPort {
    return {
      isDueling: (player) => this.findDuelMatch(player) !== null,
      opponentOf: (player) => {
        const match = this.findDuelMatch(player);
        if (!match) return null;
        return match.a.id === player.id ? match.b : match.a;
      },
      hit: (attacker, target, now) => this.tryDuelHit(attacker, target, now),
    };
  }

  private findDuelMatch(player: Player): ActiveMatch | null {
    const matchId = player.busyMatchId;
    if (matchId === 0) return null;
    const match = this.active.get(matchId);
    if (!match || match.resolved || match.gameType !== P2P_GAME_TYPE.Duel) return null;
    return match;
  }

  private tryDuelHit(
    attacker: Player,
    target: Player,
    now: number,
  ): DuelVentResolution | null {
    const match = this.findDuelMatch(attacker);
    if (!match) return null;
    const opponent = match.a.id === attacker.id ? match.b : match.a;
    if (opponent.id !== target.id) return null;
    const handler = this.handlers.get(match.gameType);
    if (!handler?.onVentHit) return null;
    return handler.onVentHit(match, attacker, target, this.contextFor(match, now));
  }

  /** 50ms Tick 只做三件事：过期邀请、处理器推进、硬超时兜底 */
  tick(now: number): void {
    if (this.pending.size === 0 && this.active.size === 0) return;
    for (const invite of [...this.pending.values()]) {
      if (now < invite.expiresAt) continue;
      this.dropPending(invite);
      this.sendResult(invite.from, invite.id, false, P2P_INVITE_REASON.Expired);
    }
    for (const match of [...this.active.values()]) {
      if (match.resolved) continue;
      const handler = this.handlers.get(match.gameType);
      const ctx = this.contextFor(match, now);
      handler?.onTick(match, ctx);
      // 处理器没在 endsAt 收尾时兜底退款：玩家状态比玩法结果重要
      if (!match.resolved && now > match.endsAt + MATCH_HARD_TIMEOUT_MS) {
        this.settle(match, 0, P2P_MATCH_END.Timeout, now);
      }
    }
  }

  /** 断线：邀请直接作废，对局按「对手掉线」判负结算，双方都不会被锁住 */
  onDisconnect(player: Player, now: number): void {
    for (const invite of [...this.pending.values()]) {
      if (invite.from.id !== player.id && invite.to.id !== player.id) continue;
      this.dropPending(invite);
      const other = invite.from.id === player.id ? invite.to : invite.from;
      other.pendingInviteId = 0;
      if (other.wsId !== 0) {
        this.sendResult(other, invite.id, false, P2P_INVITE_REASON.Expired);
      }
    }
    for (const match of [...this.active.values()]) {
      if (match.a.id !== player.id && match.b.id !== player.id) continue;
      const opponent = match.a.id === player.id ? match.b : match.a;
      this.settle(match, opponent.id, P2P_MATCH_END.OpponentLeft, now);
    }
  }

  private contextFor(match: ActiveMatch, now: number): ChallengeContext {
    return {
      now,
      finish: (winnerId, endReason) => this.settle(match, winnerId, endReason, now),
      cancel: (endReason) => this.settle(match, 0, endReason, now),
      send: (player, packet) => {
        if (player.wsId !== 0) this.options.send(player, packet);
      },
      broadcast: (packet) => this.broadcastAroundMatch(match, packet),
      showdown: (input) => this.showdown(match, input),
      duelState: (hpA, hpB, flags) => this.duelState(match, hpA, hpB, flags, now),
      random: this.options.random ?? Math.random,
    };
  }

  /** 双方 + 双方 AOI 去重后广播；离线玩家由 wsId 闸门跳过 */
  private broadcastAroundMatch(match: ActiveMatch, packet: Uint8Array): void {
    const targets = new Set<Player>([match.a, match.b]);
    for (const id of match.a.known) {
      const viewer = this.options.findPlayer(id);
      if (viewer) targets.add(viewer);
    }
    for (const id of match.b.known) {
      const viewer = this.options.findPlayer(id);
      if (viewer) targets.add(viewer);
    }
    for (const player of targets) {
      if (player.wsId !== 0) this.options.send(player, packet);
    }
  }

  private showdown(match: ActiveMatch, input: ShowdownInput): void {
    const packet: P2PShowdownPacket = {
      matchId: match.id,
      gameType: match.gameType,
      round: input.round,
      aId: match.a.id,
      bId: match.b.id,
      winnerId: input.winnerId,
      flags: input.flags,
      dice: [...(input.dice ?? [])],
      aAction: input.aAction ?? 0,
      bAction: input.bAction ?? 0,
      durationMs: input.durationMs,
    };
    this.broadcastAroundMatch(match, encodeP2PShowdown(packet));
  }

  private duelState(
    match: ActiveMatch,
    hpA: number,
    hpB: number,
    flags: number,
    now: number,
  ): void {
    const packet: P2PDuelStatePacket = {
      matchId: match.id,
      aId: match.a.id,
      bId: match.b.id,
      hpA,
      hpB,
      remainingMs: Math.max(0, match.endsAt - now),
      flags,
    };
    this.broadcastAroundMatch(match, encodeP2PDuelState(packet));
  }

  /** 税后奖池：payoutBps 缺省为全额，骰子 / 猜拳 / 切磋均为 9500 */
  private payoutOf(match: ActiveMatch, pot: number): number {
    const bps = this.handlers.get(match.gameType)?.payoutBps ?? 10_000;
    return Math.floor((pot * Math.max(0, Math.min(10_000, bps))) / 10_000);
  }

  private settle(match: ActiveMatch, winnerId: number, endReason: number, now: number): void {
    if (match.resolved) return;
    match.resolved = true;
    this.active.delete(match.id);
    match.a.busyMatchId = 0;
    match.b.busyMatchId = 0;
    const economy = this.options.economy;
    // 空赌注不产生任何钱包变动，避免无意义的快照风暴
    if (match.wager > 0) {
      const pot = match.wager * 2;
      const key = p2pEscrowKey(match.id);
      if (winnerId === match.a.id) {
        // 缺一方托管时不按 pot 凭空发钱，改为各退各的 key
        if (economy.settleEscrow(match.a, match.b, key, this.payoutOf(match, pot)) === 0) {
          economy.refundEscrow(match.a, key);
          economy.refundEscrow(match.b, key);
        }
      } else if (winnerId === match.b.id) {
        if (economy.settleEscrow(match.b, match.a, key, this.payoutOf(match, pot)) === 0) {
          economy.refundEscrow(match.a, key);
          economy.refundEscrow(match.b, key);
        }
      } else {
        economy.refundEscrow(match.a, key);
        economy.refundEscrow(match.b, key);
      }
    }
    const handler = this.handlers.get(match.gameType);
    handler?.onCancel?.(match, endReason, this.contextFor(match, now));
    // 悬赏进度：只有明确的胜者才算「赢一局」，平局 / 超时不算
    const winner =
      winnerId !== 0 && winnerId === match.a.id
        ? match.a
        : winnerId !== 0 && winnerId === match.b.id
          ? match.b
          : null;
    const loser = winner === match.a ? match.b : winner === match.b ? match.a : null;
    this.options.onSettled?.(winner, loser, match.gameType, now);
    this.broadcastMatch(match, now, P2P_MATCH_PHASE.Finished, winnerId, endReason);
  }

  private dropPending(invite: PendingInvite): void {
    this.pending.delete(invite.id);
    if (invite.from.pendingInviteId === invite.id) invite.from.pendingInviteId = 0;
    if (invite.to.pendingInviteId === invite.id) invite.to.pendingInviteId = 0;
  }

  private sendResult(player: Player, inviteId: number, accepted: boolean, reason: number): void {
    if (player.wsId === 0) return;
    this.options.send(player, encodeP2PInviteResult({ inviteId, accepted, reason }));
  }

  private broadcastMatch(
    match: ActiveMatch,
    now: number,
    phase: number,
    winnerId: number,
    endReason: number,
  ): void {
    const remainingMs = Math.max(0, match.endsAt - now);
    for (const [self, opponent] of [
      [match.a, match.b],
      [match.b, match.a],
    ] as const) {
      if (self.wsId === 0) continue;
      this.options.send(
        self,
        encodeP2PMatch({
          matchId: match.id,
          gameType: match.gameType,
          phase,
          remainingMs,
          selfId: self.id,
          opponentId: opponent.id,
          opponentName: opponent.name,
          wager: match.wager,
          winnerId,
          endReason,
        }),
      );
    }
  }
}
