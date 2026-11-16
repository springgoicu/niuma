import { clampCoins, isDeviceId } from '@niuma/shared-types';
import { createEphemeralWallet, Wallet, walletFromSave, type WalletSaveState } from '../economy/wallet';

/**
 * 钱包账本（ADR-0104）。
 *
 * 与 `ProfileBook` 分开：档案是匿名口碑（赞 / 奖牌，90 天 TTL），
 * 钱包是资产（余额 / 四维 / 背包 / 装扮 / 托管），不能因为一段时间没来就清零。
 *
 * 容量按 `lastSeenAt` 淘汰，但有三条硬保护：
 * 1. 托管不为零的记录不淘汰——那是我欠玩家的钱；
 * 2. 在线记录不淘汰；
 * 3. 保护项占满容量时允许暂时超限并告警，不为了「不超容量」丢资产。
 */
export interface WalletBookOptions {
  /** 最多保留多少个设备号的钱包，默认 1024 */
  capacity: number;
  /** 首次导入的余额上限，默认 100000 */
  importMax: number;
  /** 关闭后全部退化为临时钱包，回到 ADR-0082 的浏览器永久层 */
  persist: boolean;
  /** 服务端毫秒；测试注入 */
  now: () => number;
  /** 有记录变化时回调（服务端用它打 world-state 脏标记） */
  onChange?: () => void;
  /** 告警出口，默认 console.warn */
  warn?: (message: string) => void;
}

export interface WalletAcquireResult {
  wallet: Wallet;
  /** true = 本次新建（只有新建才允许从 HELLO 经济段导入） */
  created: boolean;
}

const DEFAULT_CAPACITY = 1024;
const DEFAULT_IMPORT_MAX = 100_000;

export class WalletBook {
  readonly capacity: number;
  readonly importMax: number;
  private readonly persistEnabled: boolean;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly warn: (message: string) => void;
  private readonly wallets = new Map<string, Wallet>();

  constructor(options: WalletBookOptions) {
    this.capacity = Math.max(1, Math.floor(options.capacity || DEFAULT_CAPACITY));
    this.importMax = Math.max(0, Math.floor(options.importMax || DEFAULT_IMPORT_MAX));
    this.persistEnabled = options.persist;
    this.now = options.now;
    this.onChange = options.onChange ?? (() => {});
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  get size(): number {
    return this.wallets.size;
  }

  get persist(): boolean {
    return this.persistEnabled;
  }

  /**
   * 进园取钱包。
   *
   * - 持久化关闭 / 没有合法设备号：给一份临时钱包，不写表；
   * - 已有记录：服务端账本胜出，`created = false`，调用方不得再用 HELLO 覆盖；
   * - 首次见到：建表并返回 `created = true`，调用方按导入上限灌入存量余额。
   */
  acquire(id: string, name: string, now = this.now()): WalletAcquireResult {
    if (!this.persistEnabled || !isDeviceId(id)) {
      return { wallet: createEphemeralWallet(), created: true };
    }
    const existing = this.wallets.get(id);
    if (existing) {
      existing.lastSeenAt = now;
      if (name) existing.name = name.slice(0, 48);
      this.onChange();
      return { wallet: existing, created: false };
    }
    const wallet = new Wallet(id);
    wallet.name = name.slice(0, 48);
    wallet.lastSeenAt = now;
    this.wallets.set(id, wallet);
    this.evictIfNeeded();
    this.onChange();
    return { wallet, created: true };
  }

  get(id: string | undefined): Wallet | undefined {
    return id ? this.wallets.get(id) : undefined;
  }

  /**
   * 离线入账：目标不在线时只改账本，不产生任何包。
   * 返回实际入账金额；没有记录 / 已封顶时返回 0。
   */
  credit(id: string | undefined, amount: number): number {
    if (!id) return 0;
    const wallet = this.wallets.get(id);
    if (!wallet) return 0;
    const delta = Math.floor(amount);
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    const next = clampCoins(wallet.coins + delta);
    const granted = next - wallet.coins;
    if (granted <= 0) return 0;
    wallet.coins = next;
    this.onChange();
    return granted;
  }

  /** 进园 / 离园刷新最近时刻，供容量淘汰排序 */
  touch(wallet: Wallet, now = this.now()): void {
    if (!this.persistEnabled || wallet.id === '') return;
    if (wallet.lastSeenAt === now) return;
    wallet.lastSeenAt = now;
    this.onChange();
  }

  /** 落盘快照：按设备号排序，同一状态写出的 JSON 稳定 */
  toJSON(): WalletSaveState[] {
    return [...this.wallets.values()]
      .map((wallet) => wallet.toJSON())
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * 读档恢复：整表替换，逐条过 `walletFromSave`。
   *
   * 坏条目只丢弃并告警；一份坏钱包不该让整个园区回到空场。
   */
  restore(entries: readonly unknown[] | undefined): void {
    this.wallets.clear();
    if (!Array.isArray(entries)) return;
    let skipped = 0;
    for (const entry of entries) {
      const wallet = walletFromSave(entry);
      if (!wallet) {
        skipped += 1;
        continue;
      }
      this.wallets.set(wallet.id, wallet);
    }
    if (skipped > 0) this.warn(`[wallet] 读档跳过 ${skipped} 条坏记录`);
    this.evictIfNeeded();
  }

  /**
   * 启停恢复：把上次进程留下的托管原路退回余额。
   *
   * 崩服时进行中的赌局 / 擂台不会复活，冻结中的钱必须回到玩家余额，
   * 否则钱包会永久少一笔。
   */
  refundAllEscrow(): number {
    let total = 0;
    for (const wallet of this.wallets.values()) total += wallet.refundAllEscrow();
    if (total > 0) this.onChange();
    return total;
  }

  /** 在线集合由服务端提供；只淘汰「离线、无托管、最久没来」的记录 */
  prune(isOnline: (id: string) => boolean, now = this.now()): number {
    if (this.wallets.size <= this.capacity) return 0;
    const candidates = [...this.wallets.values()]
      .filter((wallet) => wallet.escrowTotal() === 0 && !isOnline(wallet.id))
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const overflow = this.wallets.size - this.capacity;
    let removed = 0;
    for (const wallet of candidates) {
      if (removed >= overflow) break;
      this.wallets.delete(wallet.id);
      removed += 1;
    }
    if (removed > 0) {
      this.onChange();
      this.warn(`[wallet] 容量淘汰 ${removed} 条最久未进园的记录`);
    }
    const left = this.wallets.size - this.capacity;
    if (left > 0) {
      this.warn(`[wallet] 容量 ${this.capacity} 已满，仍有 ${left} 条在线 / 托管中的记录受保护`);
    }
    void now;
    return removed;
  }

  private evictIfNeeded(): void {
    if (this.wallets.size <= this.capacity) return;
    // 新记录进来时还不知道谁在线，按「最近 10 分钟进过园」保护；Tick 里的 prune 会再收一次
    const fresh = this.now() - 10 * 60_000;
    const candidates = [...this.wallets.values()]
      .filter((wallet) => wallet.escrowTotal() === 0 && wallet.lastSeenAt < fresh)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const overflow = this.wallets.size - this.capacity;
    for (let i = 0; i < Math.min(overflow, candidates.length); i += 1) {
      this.wallets.delete(candidates[i]!.id);
    }
  }
}
