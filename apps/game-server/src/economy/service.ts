import {
  STAT_KEYS,
  WALLET_REASON,
  clampCoins,
  clampItemCount,
  encodeWalletSync,
  findCosmeticSkuById,
  findItemSku,
  findItemSkuById,
  statUpgradePrice,
  type EconomyProfile,
  type StatKey,
  type WalletSyncPacket,
} from '@niuma/shared-types';
import type { Player } from '../sim/world';
import type { Wallet } from './wallet';

/** 发钱包包的注入点：服务层不直接摸 socket，测试可以传一个只记录的小函数 */
export type WalletSender = (wsId: number, packet: Uint8Array) => void;
/** 账本变化注入点：服务端用它打 `world-state.json` 脏标记 */
export type WalletChangeSink = (wallet: Wallet) => void;

/**
 * 牛马币的统一入口（ADR-0082 / ADR-0104）。
 *
 * 所有余额变动都必须走这里：`trySpendCoins` 先判后减，负余额在类型层面不可能出现；
 * 每次变动统一广播完整钱包快照，客户端不需要做增量合并。
 *
 * 托管按 key 分账（`dice:0` / `ring` / `p2p:<matchId>`）：一个玩法只清自己的 key，
 * 不再出现「赌桌结算把擂台报名费一起清掉」。
 */
export class EconomyService {
  constructor(
    private readonly send: WalletSender,
    private readonly onChange?: WalletChangeSink,
  ) {}

  /** 当前可用余额（托管中的赌注已经从 coins 扣出，不会重复花） */
  availableCoins(player: Player): number {
    return player.coins;
  }

  walletOf(player: Player): WalletSyncPacket {
    return {
      coins: player.coins,
      stats: player.stats,
      reason: WALLET_REASON.Init,
      inventory: player.inventory,
      unlockedCosmetics: player.unlockedCosmetics,
    };
  }

  /** 推送完整钱包快照；只发给本人，不进入视野广播 */
  push(player: Player, reason: number): void {
    // 先标脏再发包：NPC / 离线玩家也要把账本变化带进下一次落盘
    this.onChange?.(player.wallet);
    if (player.wsId === 0) return;
    this.send(
      player.wsId,
      encodeWalletSync({
        coins: player.coins,
        stats: player.stats,
        reason,
        inventory: player.inventory,
        unlockedCosmetics: player.unlockedCosmetics,
      }),
    );
  }

  grantCoins(player: Player, amount: number, reason: number): number {
    const delta = Math.floor(amount);
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    const next = clampCoins(player.coins + delta);
    const granted = next - player.coins;
    if (granted <= 0) return 0;
    player.coins = next;
    this.push(player, reason);
    return granted;
  }

  trySpendCoins(player: Player, amount: number, reason: number): boolean {
    const cost = Math.floor(amount);
    if (!Number.isFinite(cost) || cost <= 0) return false;
    if (player.coins < cost) return false;
    player.coins -= cost;
    this.push(player, reason);
    return true;
  }

  /** 属性升级：等级封顶 / 余额不足都只返回 false，不改任何字段 */
  upgradeStat(player: Player, statIndex: number): boolean {
    const key = STAT_KEYS[statIndex] as StatKey | undefined;
    if (!key) return false;
    const level = player.stats[key];
    if (level >= 10) return false;
    const price = statUpgradePrice(key, level);
    if (player.coins < price) return false;
    player.coins -= price;
    player.stats[key] = level + 1;
    this.push(player, WALLET_REASON.ShopUpgrade);
    return true;
  }

  /** 商店购买：caller 已校验 sku；这里只负责扣钱与入包 */
  buyItem(player: Player, itemId: number, count: number): boolean {
    const sku = findItemSkuById(itemId);
    if (!sku) return false;
    const quantity = Math.max(1, Math.min(9, Math.floor(count)));
    const cost = sku.price * quantity;
    if (player.coins < cost) return false;
    player.coins -= cost;
    player.inventory[sku.key] = Math.min(99, (player.inventory[sku.key] ?? 0) + quantity);
    this.push(player, WALLET_REASON.ShopItem);
    return true;
  }

  addItem(player: Player, itemKey: string, count: number, reason: number): boolean {
    const sku = findItemSku(itemKey);
    if (!sku) return false;
    const quantity = clampItemCount(count);
    if (quantity <= 0) return false;
    player.inventory[sku.key] = Math.min(99, (player.inventory[sku.key] ?? 0) + quantity);
    this.push(player, reason);
    return true;
  }

  /** 消耗道具：库存不足返回 false；扣减与推送一气呵成 */
  consumeItem(player: Player, itemId: number, reason: number): boolean {
    const sku = findItemSkuById(itemId);
    if (!sku) return false;
    const owned = player.inventory[sku.key] ?? 0;
    if (owned <= 0) return false;
    if (owned === 1) delete player.inventory[sku.key];
    else player.inventory[sku.key] = owned - 1;
    this.push(player, reason);
    return true;
  }

  /**
   * 冻结赌注：从可用余额扣出，记在指定玩法的 key 上。
   *
   * key 由调用方给：`dice:0` / `dice:1` / `ring` / `p2p:<matchId>`。
   * 余额不够或 key 非法时不产生任何副作用。
   */
  freezeEscrow(player: Player, key: string, amount: number): boolean {
    if (!player.wallet.addEscrow(key, amount)) return false;
    this.push(player, WALLET_REASON.EscrowFreeze);
    return true;
  }

  /** 退款：只退指定 key，重复调用第二次就是 0，不碰其它玩法 */
  refundEscrow(player: Player, key: string): number {
    const refund = player.wallet.refundEscrow(key);
    if (refund <= 0) return 0;
    this.push(player, WALLET_REASON.EscrowRefund);
    return refund;
  }

  /**
   * 结算：赢家拿走两份赌注。
   *
   * 先确认本局双方的 key 都有托管再动账：缺一条说明冻结没成功或已被别处清掉，
   * 这时直接返回 0，由调用方按平局退款——绝不按 `pot` 凭空发钱。
   */
  settleEscrow(winner: Player, loser: Player, key: string, pot: number): number {
    const winnerStake = winner.wallet.escrowOf(key);
    const loserStake = loser.wallet.escrowOf(key);
    if (winnerStake <= 0 || loserStake <= 0) return 0;
    winner.wallet.takeEscrow(key);
    loser.wallet.takeEscrow(key);
    const payout = Math.max(0, Math.floor(pot));
    winner.coins = clampCoins(winner.coins + payout);
    this.push(winner, WALLET_REASON.MatchReward);
    this.push(loser, WALLET_REASON.MatchLoss);
    return Math.min(payout, winnerStake + loserStake);
  }

  /** 进园 HELLO 后的第一次对齐：回一条 init 快照，纠正客户端的乐观本地值 */
  syncOnJoin(player: Player): void {
    this.push(player, WALLET_REASON.Init);
  }

  /**
   * 清账：把指定 key 的托管直接作废（押注输掉时用）。
   *
   * 与 `refundEscrow` 相对：那个是「不开局了，钱还你」，这个是「局开了，钱输了」。
   * 不发包——输家余额在冻结时就扣过了，这里只是把 key 归零。
   */
  clearEscrow(player: Player, key: string): void {
    if (player.wallet.escrowOf(key) <= 0) return;
    player.wallet.clearEscrow(key);
    this.onChange?.(player.wallet);
  }

  /**
   * 彩池派彩：先取走本 key 的托管再把奖金入账。
   *
   * 赌桌与八角笼押注都走这里：注额在 freeze 时已扣，派彩只做加法，
   * 因此无论结算逻辑被调用几次都不会重复发钱（第二次 `takeEscrow` 就是 0）。
   */
  payoutFromPool(player: Player, key: string, amount: number, reason: number): number {
    const stake = player.wallet.takeEscrow(key);
    const payout = Math.floor(amount);
    if (stake <= 0) {
      // 这个 key 已经没有托管：说明同一笔派彩已经被结算过，直接拒绝，
      // 不再按 payout 二次入账（否则重复回调 / 重放就是凭空发钱）。
      return 0;
    }
    if (!Number.isFinite(payout) || payout <= 0) {
      // 没有派彩就把本金原路退回，别让一次空结算把注额吃掉
      player.coins = clampCoins(player.coins + stake);
      this.push(player, WALLET_REASON.ArenaBetRefund);
      return 0;
    }
    const next = clampCoins(player.coins + payout);
    const granted = next - player.coins;
    if (granted <= 0) return 0;
    player.coins = next;
    this.push(player, reason);
    return granted;
  }

  /** 装扮解锁：只认 `COSMETIC_SKUS` 里的 id，重复购买返回 false（不扣钱） */
  buyCosmetic(player: Player, cosmeticId: number): boolean {
    const sku = findCosmeticSkuById(cosmeticId);
    if (!sku) return false;
    if (player.unlockedCosmetics.includes(sku.key)) return false;
    if (player.coins < sku.price) return false;
    player.coins -= sku.price;
    player.unlockedCosmetics = [...player.unlockedCosmetics, sku.key].slice(0, 24);
    this.push(player, WALLET_REASON.Cosmetic);
    return true;
  }

  profileOf(player: Player): EconomyProfile {
    return player.economyProfile();
  }
}
