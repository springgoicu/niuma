import {
  STAT_KEYS,
  WALLET_REASON,
  clampCoins,
  clampItemCount,
  encodeWalletSync,
  findCosmeticSkuById,
  findItemSku,
  findItemSkuById,
  furnitureById,
  houseTierSpec,
  statUpgradePrice,
  type EconomyProfile,
  type StatKey,
  type WalletSyncPacket,
} from '@niuma/shared-types';
import type { Player } from '../sim/world';

/** 发钱包包的注入点：服务层不直接摸 socket，测试可以传一个只记录的小函数 */
export type WalletSender = (wsId: number, packet: Uint8Array) => void;

/**
 * 牛马币的统一入口（ADR-0082）。
 *
 * 所有余额变动都必须走这里：`trySpendCoins` 先判后减，负余额在类型层面不可能出现；
 * 每次变动统一广播完整钱包快照，客户端不需要做增量合并。
 */
export class EconomyService {
  constructor(private readonly send: WalletSender) {}

  /** 当前可用余额（托管中的赌注已经从 coins 扣出，不会重复花） */
  availableCoins(player: Player): number {
    return player.coins;
  }

  walletOf(player: Player): WalletSyncPacket {
    return {
      coins: player.coins,
      stats: player.stats,
      houseTier: player.houseTier,
      reason: WALLET_REASON.Init,
      inventory: player.inventory,
    };
  }

  /** 推送完整钱包快照；只发给本人，不进入视野广播 */
  push(player: Player, reason: number): void {
    if (player.wsId === 0) return;
    this.send(
      player.wsId,
      encodeWalletSync({
        coins: player.coins,
        stats: player.stats,
        houseTier: player.houseTier,
        reason,
        inventory: player.inventory,
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

  /** 冻结赌注：从可用余额扣出，记在 escrow 上；余额不够时不产生任何副作用 */
  freezeEscrow(player: Player, amount: number): boolean {
    const stake = Math.floor(amount);
    if (!Number.isFinite(stake) || stake <= 0) return false;
    if (player.coins < stake) return false;
    player.coins -= stake;
    player.escrowedCoins += stake;
    this.push(player, WALLET_REASON.EscrowFreeze);
    return true;
  }

  /** 退款：把该玩家冻结的部分原路放回，重复调用不会重复退 */
  refundEscrow(player: Player): number {
    const refund = player.escrowedCoins;
    if (refund <= 0) return 0;
    player.escrowedCoins = 0;
    player.coins = clampCoins(player.coins + refund);
    this.push(player, WALLET_REASON.EscrowRefund);
    return refund;
  }

  /**
   * 结算：赢家拿走两份赌注。
   *
   * 双方的 escrow 在建局时已经扣过，这里只做「清账 + 入账」，
   * 因此无论调用多少次都不会重复发钱。
   */
  settleEscrow(winner: Player, loser: Player, pot: number): number {
    const payout = Math.max(0, Math.floor(pot));
    const hadStake = winner.escrowedCoins + loser.escrowedCoins;
    winner.escrowedCoins = 0;
    loser.escrowedCoins = 0;
    winner.coins = clampCoins(winner.coins + payout);
    this.push(winner, WALLET_REASON.MatchReward);
    this.push(loser, WALLET_REASON.MatchLoss);
    return Math.min(payout, hadStake);
  }

  /** 进园 HELLO 后的第一次对齐：回一条 init 快照，纠正客户端的乐观本地值 */
  syncOnJoin(player: Player): void {
    this.push(player, WALLET_REASON.Init);
  }

  /**
   * 清账：把托管中的金额直接作废（押注输掉时用）。
   *
   * 与 `refundEscrow` 相对：那个是「不开局了，钱还你」，这个是「局开了，钱输了」。
   * 不发包——输家余额在冻结时就扣过了，这里只是把 escrow 归零。
   */
  clearEscrow(player: Player): void {
    player.escrowedCoins = 0;
  }

  /**
   * 彩池派彩：先清托管再把奖金入账。
   *
   * 赌桌与八角笼押注都走这里：注额在 freeze 时已扣，派彩只做加法，
   * 因此无论结算逻辑被调用几次都不会重复发钱（escrow 第二次就是 0）。
   */
  payoutFromPool(player: Player, amount: number, reason: number): number {
    const payout = Math.floor(amount);
    this.clearEscrow(player);
    if (!Number.isFinite(payout) || payout <= 0) {
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

  /**
   * 家具购买：与装扮共用「已解锁」清单（键名 `furn:<id>`）。
   *
   * 复用 `unlockedCosmetics` 而不是新开字段，是为了不破坏钱包同步包的既有结构；
   * 这条清单本来就是「这台设备解锁了哪些外观件」，家具属于同一类语义。
   */
  buyFurniture(player: Player, furnitureId: number): boolean {
    const sku = furnitureById(furnitureId);
    if (!sku) return false;
    const key = `furn:${sku.id}`;
    if (player.unlockedCosmetics.includes(key)) return false;
    if (player.coins < sku.price) return false;
    player.coins -= sku.price;
    player.unlockedCosmetics = [...player.unlockedCosmetics, key].slice(0, 24);
    this.push(player, WALLET_REASON.Furniture);
    return true;
  }

  /** 户型升级：只允许升到下一档，价格由 `HOUSE_TIERS` 定义 */
  upgradeHouseTier(player: Player): boolean {
    const next = houseTierSpec(player.houseTier + 1);
    if (next.tier <= player.houseTier) return false;
    if (player.coins < next.price) return false;
    player.coins -= next.price;
    player.houseTier = next.tier;
    this.push(player, WALLET_REASON.HouseUpgrade);
    return true;
  }

  profileOf(player: Player): EconomyProfile {
    return player.economyProfile();
  }
}
