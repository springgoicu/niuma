import {
  HOTSPOT_SERVER_SLACK,
  WALLET_REASON,
  WORLD_EVENT,
  WORLD_EVENT_KIND,
  WORLD_EVENT_PHASE,
  encodeEventClaimResult,
  encodeLoudspeaker,
  encodeWorldEvent,
  isOnPlaza,
  isWorkDeskSeat,
  redPacketSpots,
  worldEventTitle,
  type RedPacketSpot,
} from '@niuma/shared-types';
import type { EconomyService } from '../economy/service';
import type { Transport } from './view';
import type { Player, World } from './world';

/** 红包距离校验的额外余量：与热区包同一个思路，网络延迟不算作弊 */
const CLAIM_SLACK = 120;
/** 结算横幅停留时长 */
const RESOLVE_BANNER_MS = 2000;
/** 摸鱼点名最多播几个人：全服弹幕不是用来挂人的地方 */
const MAX_CALLED_OUT = 2;

export interface WorldEventOptions {
  world: World;
  transport: Transport;
  economy: EconomyService;
  /** 可注入随机源：单测里事件顺序与红包金额必须确定 */
  random?: () => number;
  /** 首次事件的延迟，默认一个完整周期；测试可以传 0 */
  firstDelayMs?: number;
  now?: number;
}

/**
 * 全局随机事件调度器（ADR-0088）。
 *
 * 不自己开定时器：挂主 Tick，按 `now` 单向推进。这样时钟可注入、单测不需要
 * `setTimeout`，也不会出现「两个计时器各自以为自己是权威」的分裂状态。
 *
 * 一场事件的三个阶段：
 * - Announce：3 秒横幅预热，告诉玩家马上要发生什么；
 * - Active：红包雨 45 秒 / 查岗 10 秒倒计时，只有这一段能抢红包；
 * - Resolve：2 秒结果横幅，然后进入下一周期。
 *
 * 红包不做服务端实体：25 个点由 `redPacketSpots(seed)` 确定性撒出，
 * 客户端据此绘制，服务端只维护 25 位的已领取位图 + 距离校验，领取是 O(1)。
 */
export class WorldEventScheduler {
  private readonly world: World;
  private readonly transport: Transport;
  private readonly economy: EconomyService;
  private readonly random: () => number;

  private phase = 0;
  private kind = 0;
  private phaseUntil = 0;
  private nextAt: number;
  private seed = 0;
  private spots: RedPacketSpot[] = [];
  /** 25 个红包的已领取位图：一个 u32 就够 */
  private claimedMask = 0;
  /** 查岗结算的全勤人数，用于结果横幅 */
  private bonusCount = 0;
  /** 最近一次 Tick 的时刻：调试快照读它，绝不在状态里偷偷读 `Date.now()` */
  private lastNow = 0;

  constructor(options: WorldEventOptions) {
    this.world = options.world;
    this.transport = options.transport;
    this.economy = options.economy;
    this.random = options.random ?? Math.random;
    this.lastNow = options.now ?? Date.now();
    this.nextAt = this.lastNow + (options.firstDelayMs ?? WORLD_EVENT.PeriodMs);
  }

  /** 当前事件快照：入场补发与调试用 */
  get snapshot(): { kind: number; phase: number; remainingMs: number; seed: number } {
    return {
      kind: this.kind,
      phase: this.phase,
      remainingMs: Math.max(0, this.phaseUntil - this.lastNow),
      seed: this.seed,
    };
  }

  /** 入场补发：晚进来的人也要看到当前横幅与红包 */
  sendTo(player: Player, now: number): void {
    if (this.phase === 0) return;
    this.transport.send(player.wsId, this.bannerPacket(now));
  }

  /** 主 Tick：每个阶段只在跨越边界的那一 Tick 做一次广播 */
  tick(now: number): void {
    this.lastNow = now;
    if (this.phase === 0) {
      if (now < this.nextAt) return;
      this.start(now);
      return;
    }
    if (now < this.phaseUntil) return;

    if (this.phase === WORLD_EVENT_PHASE.Announce) {
      this.phase = WORLD_EVENT_PHASE.Active;
      this.phaseUntil =
        now +
        (this.kind === WORLD_EVENT_KIND.RedPacketRain
          ? WORLD_EVENT.RedPacketDurationMs
          : WORLD_EVENT.InspectionWarnMs);
      this.claimedMask = 0;
      this.bonusCount = 0;
      this.broadcast(now);
      return;
    }

    if (this.phase === WORLD_EVENT_PHASE.Active) {
      // 查岗在倒计时结束那一刻结算：坐工位的发钱，广场乱晃的点名
      if (this.kind === WORLD_EVENT_KIND.Inspection) this.settleInspection(now);
      this.phase = WORLD_EVENT_PHASE.Resolve;
      this.phaseUntil = now + RESOLVE_BANNER_MS;
      this.broadcast(now);
      return;
    }

    // Resolve → 进入下一周期：周期从结算结束重新计时，10 分钟一场
    this.phase = 0;
    this.kind = 0;
    this.phaseUntil = 0;
    this.nextAt = now + WORLD_EVENT.PeriodMs;
  }

  /** 抢红包：距离、序号、是否已被领走三条同时成立才发钱 */
  claim(player: Player, index: number, now: number): boolean {
    if (this.phase !== WORLD_EVENT_PHASE.Active) return false;
    if (this.kind !== WORLD_EVENT_KIND.RedPacketRain) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this.spots.length) return false;
    const bit = 1 << index;
    if ((this.claimedMask & bit) !== 0) return false;
    const spot = this.spots[index]!;
    const dx = player.x - spot.x;
    const dy = player.y - spot.y;
    const reach = WORLD_EVENT.RedPacketPickRange + CLAIM_SLACK;
    if (dx * dx + dy * dy > reach * reach) return false;

    this.claimedMask |= bit;
    const span = WORLD_EVENT.RedPacketMax - WORLD_EVENT.RedPacketMin + 1;
    const amount =
      WORLD_EVENT.RedPacketMin + Math.floor(this.random() * span);
    this.economy.grantCoins(player, amount, WALLET_REASON.RedPacket);

    // 自己收到 mine=true，视野内其他人收到 mine=false：旁观者也能看到红包被抢走
    this.transport.send(
      player.wsId,
      encodeEventClaimResult({ index, amount, mine: true }),
    );
    const spectatorPacket = encodeEventClaimResult({ index, amount, mine: false });
    for (const id of player.known) {
      const viewer = this.world.get(id);
      if (viewer) this.transport.send(viewer.wsId, spectatorPacket);
    }
    return true;
  }

  private start(now: number): void {
    // 两种事件等概率；`kind` 只取 1 / 2，横幅文案与客户端图标按它分支
    this.kind =
      this.random() < 0.5 ? WORLD_EVENT_KIND.RedPacketRain : WORLD_EVENT_KIND.Inspection;
    this.seed = Math.floor(this.random() * 0xffff) | 0;
    this.spots =
      this.kind === WORLD_EVENT_KIND.RedPacketRain ? redPacketSpots(this.seed) : [];
    this.claimedMask = 0;
    this.bonusCount = 0;
    this.phase = WORLD_EVENT_PHASE.Announce;
    this.phaseUntil = now + WORLD_EVENT.AnnounceMs;
    this.broadcast(now);
    console.log(
      `[event] ${worldEventTitle(this.kind)} start seed=${this.seed} spots=${this.spots.length}`,
    );
  }

  /** 突击查岗结算：坐工位领全勤，广场上乱晃的被点名 */
  private settleInspection(now: number): void {
    let bonus = 0;
    const slackers: Player[] = [];
    for (const player of this.world.players.values()) {
      if (player.isNpc) continue;
      if (player.seat !== 0 && isWorkDeskSeat(player.seat)) {
        this.economy.grantCoins(player, WORLD_EVENT.InspectionReward, WALLET_REASON.InspectionBonus);
        bonus += 1;
        continue;
      }
      if (isOnPlaza(player.x, player.y)) slackers.push(player);
    }
    this.bonusCount = bonus;
    for (const slacker of slackers.slice(0, MAX_CALLED_OUT)) {
      this.broadcastLoudspeaker(
        `老板：${slacker.name}，上班时间在广场乱晃？`,
      );
    }
    console.log(`[event] inspection bonus=${bonus} called=${Math.min(slackers.length, MAX_CALLED_OUT)}`);
  }

  /** 全服弹幕：与道具「大喇叭」同一个下行包，fromId = 0 表示官方播报 */
  private broadcastLoudspeaker(text: string): void {
    const packet = encodeLoudspeaker({ fromId: 0, text });
    for (const player of this.world.players.values()) {
      if (player.wsId === 0) continue;
      this.transport.send(player.wsId, packet);
    }
  }

  /**
   * 横幅额外数值的语义按事件分开：
   * - 红包雨：剩余还能抢的个数（`amount` 在客户端画成「还剩 N 个」）；
   * - 查岗：结算阶段的全勤人数，其余阶段为 0。
   */
  private bannerPacket(now: number): Uint8Array {
    let amount = 0;
    if (this.kind === WORLD_EVENT_KIND.RedPacketRain) {
      amount = Math.max(0, this.spots.length - popcount25(this.claimedMask));
    } else if (this.phase === WORLD_EVENT_PHASE.Resolve) {
      amount = this.bonusCount;
    }
    return encodeWorldEvent({
      kind: this.kind,
      phase: this.phase,
      remainingSec: Math.max(0, Math.ceil((this.phaseUntil - now) / 1000)),
      seed: this.seed,
      amount,
    });
  }

  private broadcast(now: number): void {
    const packet = this.bannerPacket(now);
    for (const player of this.world.players.values()) {
      if (player.wsId === 0) continue;
      this.transport.send(player.wsId, packet);
    }
  }
}

/** 25 位位图的置位数：红包剩余数量靠它算，不遍历 25 个点 */
function popcount25(mask: number): number {
  let value = mask >>> 0;
  let count = 0;
  while (value !== 0) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

/** 红包领取的服务端校验半径：客户端提示与测试共用 */
export const RED_PACKET_REACH = WORLD_EVENT.RedPacketPickRange + CLAIM_SLACK;
/** 与热区包一致的延迟余量口径（仅用于文档与测试断言） */
export const RED_PACKET_SLACK = HOTSPOT_SERVER_SLACK;
