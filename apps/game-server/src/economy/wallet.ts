import {
  clampCoins,
  emptyStats,
  findCosmeticSkuByKey,
  isDeviceId,
  sanitizeEconomyProfile,
  type EconomyProfile,
  type EconomyStats,
} from '@niuma/shared-types';

/**
 * 一份可落盘的钱包账本（ADR-0104）。
 *
 * 与 `Player` 分离：`Player` 是会话实体，会进对象池、断线即回收；
 * `Wallet` 按匿名设备号活得更久，重启后由 `WalletBook` 从 `world-state.json` 恢复。
 *
 * 不变量：
 * - 余额与托管中的金额都来自服务端裁决，入口一律过 `sanitize` / `clamp`；
 * - 托管按 key 分账（`dice:0` / `ring` / `p2p:<matchId>`），任一玩法只清自己的 key；
 * - 托管金额只增不减，直到 `takeEscrow` 一次取走，避免重复退款。
 */
export interface WalletSaveState {
  id: string;
  name: string;
  coins: number;
  stats: EconomyStats;
  inventory: Record<string, number>;
  unlockedCosmetics: string[];
  /** 冻结中的押注 / 报名费；服务端启动时统一原路退回 */
  escrow: Array<{ key: string; amount: number }>;
  /** 0 表示这份账本不是从 HELLO 导入的（例如首个版本就为空） */
  importedAt: number;
  lastSeenAt: number;
}

/**
 * 托管 key 的合法形状：按「玩法 + 局 / 桌 + 玩家实体」分账。
 *
 * 同一设备开两个标签页时共享同一份钱包，如果两笔注额共用一个 key，
 * 任一笔结算 / 退款都会把另一笔的本金一起清掉；把 player id 放进 key
 * 才能保证「一笔注额只对应一次冻结与一次结算」。
 */
const ESCROW_KEY = /^(dice:[01]:\d{1,10}|ring:\d{1,10}|ring:bet:\d{1,10}|p2p:\d{1,10})$/;

export function isEscrowKey(key: string): boolean {
  return ESCROW_KEY.test(key);
}

/** 单个托管 key 的金额上限：与全局余额上限同一把尺子，防止坏档写爆 */
const MAX_ESCROW = 999_999_999;

export class Wallet {
  readonly id: string;
  name = '';
  coins = 0;
  stats: EconomyStats = emptyStats();
  inventory: Record<string, number> = {};
  unlockedCosmetics: string[] = [];
  readonly escrow = new Map<string, number>();
  importedAt = 0;
  lastSeenAt = 0;

  constructor(id: string) {
    this.id = id;
  }

  /** 托管总额：给 HUD / 调试读，不参与扣款 */
  escrowTotal(): number {
    let total = 0;
    for (const amount of this.escrow.values()) total += amount;
    return total;
  }

  escrowOf(key: string): number {
    return this.escrow.get(key) ?? 0;
  }

  /** 冻结：金额从可用余额扣出，记在指定 key 上；余额不够时不产生副作用 */
  addEscrow(key: string, amount: number): boolean {
    if (!isEscrowKey(key)) return false;
    const stake = Math.floor(amount);
    if (!Number.isFinite(stake) || stake <= 0) return false;
    if (this.coins < stake) return false;
    this.coins -= stake;
    this.escrow.set(key, Math.min(MAX_ESCROW, this.escrowOf(key) + stake));
    return true;
  }

  /** 退款：只退指定 key，重复调用第二次就是 0 */
  refundEscrow(key: string): number {
    const refund = this.escrow.get(key) ?? 0;
    if (refund <= 0) return 0;
    this.escrow.delete(key);
    this.coins = clampCoins(this.coins + refund);
    return refund;
  }

  /** 结算清账：只把指定 key 作废，不碰其它玩法的托管 */
  clearEscrow(key: string): void {
    this.escrow.delete(key);
  }

  /** 取走指定 key 的托管并清账（派彩前调用，防止重复结算） */
  takeEscrow(key: string): number {
    const amount = this.escrow.get(key) ?? 0;
    this.escrow.delete(key);
    return amount;
  }

  /** 崩服恢复：所有残留托管原路退回余额，返回退回总额 */
  refundAllEscrow(): number {
    let total = 0;
    for (const amount of this.escrow.values()) total += Math.max(0, Math.floor(amount));
    this.escrow.clear();
    if (total > 0) this.coins = clampCoins(this.coins + total);
    return total;
  }

  /**
   * 一次性导入：只允许 `WalletBook` 在「首次见到该设备」时调用。
   *
   * 导入上限由调用方给：存量玩家的浏览器余额是唯一已知值，但无账号架构下
   * 也意味着改包可以伪造，所以导入必须有天花板。
   */
  importProfile(profile: EconomyProfile | undefined, cap: number, now: number): void {
    const clean = sanitizeEconomyProfile(profile);
    this.coins = Math.min(clampCoins(clean.coins), Math.max(0, Math.floor(cap)));
    this.stats = clean.stats;
    this.inventory = clean.inventory;
    // 只认货架里的装扮 key：历史 `furn:<id>` 可以留在浏览器，但不进服务端账本
    this.unlockedCosmetics = clean.unlockedCosmetics.filter((key) => findCosmeticSkuByKey(key) !== undefined);
    this.importedAt = now;
    this.lastSeenAt = now;
  }

  /** 发 `S2C_WALLET_SYNC` 时读的快照；每日任务不属于钱包，留在浏览器 */
  profile(): EconomyProfile {
    return {
      coins: this.coins,
      stats: this.stats,
      inventory: this.inventory,
      unlockedCosmetics: this.unlockedCosmetics,
      dailyQuests: { day: '', progress: {}, claimed: [] },
    };
  }

  /** 落盘快照：托管按 key 排序，保证同一状态写出的 JSON 稳定 */
  toJSON(): WalletSaveState {
    const escrow = [...this.escrow.entries()]
      .filter(([key, amount]) => isEscrowKey(key) && Number.isFinite(amount) && amount > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, amount]) => ({ key, amount: Math.min(MAX_ESCROW, Math.floor(amount)) }));
    return {
      id: this.id,
      name: this.name,
      coins: clampCoins(this.coins),
      stats: this.stats,
      inventory: this.inventory,
      unlockedCosmetics: [...this.unlockedCosmetics],
      escrow,
      importedAt: Number.isFinite(this.importedAt) ? Math.max(0, Math.floor(this.importedAt)) : 0,
      lastSeenAt: Number.isFinite(this.lastSeenAt) ? Math.max(0, Math.floor(this.lastSeenAt)) : 0,
    };
  }
}

/**
 * 坏档 / 老档 → 可接管的钱包。
 *
 * 只接受合法设备号与数字；余额、等级、道具数量都过协议层的同一把尺子，
 * 托管 key 按白名单过滤，未知 key 直接丢弃而不是把整份钱包判坏。
 */
export function walletFromSave(raw: unknown): Wallet | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<WalletSaveState>;
  if (typeof source.id !== 'string' || !isDeviceId(source.id)) return null;
  const wallet = new Wallet(source.id);
  const clean = sanitizeEconomyProfile({
    coins: source.coins,
    stats: source.stats,
    inventory: source.inventory,
    unlockedCosmetics: source.unlockedCosmetics,
  });
  wallet.coins = clean.coins;
  wallet.stats = clean.stats;
  wallet.inventory = clean.inventory;
  wallet.unlockedCosmetics = clean.unlockedCosmetics.filter(
    (key) => findCosmeticSkuByKey(key) !== undefined,
  );
  wallet.name = typeof source.name === 'string' ? source.name.slice(0, 48) : '';
  wallet.importedAt = Number.isFinite(source.importedAt) ? Math.max(0, Math.floor(source.importedAt!)) : 0;
  wallet.lastSeenAt = Number.isFinite(source.lastSeenAt) ? Math.max(0, Math.floor(source.lastSeenAt!)) : 0;
  if (Array.isArray(source.escrow)) {
    for (const entry of source.escrow) {
      if (!entry || typeof entry !== 'object') continue;
      const { key, amount } = entry as { key?: unknown; amount?: unknown };
      if (typeof key !== 'string' || !isEscrowKey(key)) continue;
      const value = typeof amount === 'number' && Number.isFinite(amount) ? Math.floor(amount) : 0;
      if (value <= 0) continue;
      // 托管金额在冻结时已从余额扣过；坏档不把差额补回，只在总额上限内接管
      wallet.escrow.set(key, Math.min(MAX_ESCROW, value));
    }
  }
  return wallet;
}

/** 匿名会话的临时钱包：不落盘、不导入，保留「换设备重新开始」的旧体验 */
export function createEphemeralWallet(profile?: EconomyProfile, cap = Number.POSITIVE_INFINITY): Wallet {
  const wallet = new Wallet('');
  wallet.importProfile(profile, cap, 0);
  wallet.importedAt = 0;
  return wallet;
}


