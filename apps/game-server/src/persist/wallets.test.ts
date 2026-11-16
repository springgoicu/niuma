import { describe, expect, it } from 'bun:test';
import { WalletBook } from './wallets';

const A = '0000000000000001';
const B = '0000000000000002';
const C = '0000000000000003';

function book(capacity = 8, persist = true): WalletBook {
  return new WalletBook({
    capacity,
    importMax: 1_000,
    persist,
    now: () => 1_000,
    warn: () => {},
  });
}

describe('WalletBook（ADR-0104）', () => {
  it('首次 acquire 才允许导入，二次返回同一条账本', () => {
    const wallets = book();
    const first = wallets.acquire(A, '牛马');
    expect(first.created).toBe(true);
    first.wallet.importProfile(
      {
        coins: 5_000,
        stats: { atkSpeedLv: 0, workEffLv: 0, critLv: 0, armorLv: 0 },
        inventory: {},
        unlockedCosmetics: [],
        dailyQuests: { day: '', progress: {}, claimed: [] },
      },
      1_000,
      10,
    );
    expect(first.wallet.coins).toBe(1_000);

    const second = wallets.acquire(A, '改名');
    expect(second.created).toBe(false);
    expect(second.wallet).toBe(first.wallet);
    expect(second.wallet.coins).toBe(1_000);
    expect(second.wallet.name).toBe('改名');
  });

  it('没有合法设备号 / 关闭持久化时给临时钱包，不写表', () => {
    const wallets = book();
    expect(wallets.acquire('', '匿名').wallet.id).toBe('');
    expect(wallets.acquire('not-hex', '匿名').wallet.id).toBe('');
    expect(wallets.size).toBe(0);

    const off = book(8, false);
    const result = off.acquire(A, '牛马');
    expect(result.wallet.id).toBe('');
    expect(off.size).toBe(0);
  });

  it('离线入账只改账本，不改在线钱包的其它字段', () => {
    const wallets = book();
    const wallet = wallets.acquire(A, '牛马').wallet;
    wallet.coins = 10;
    expect(wallets.credit(A, 25)).toBe(25);
    expect(wallet.coins).toBe(35);
    expect(wallets.credit('0000000000000009', 25)).toBe(0);
  });

  it('启动退款把残留托管退回余额', () => {
    const wallets = book();
    const wallet = wallets.acquire(A, '牛马').wallet;
    wallet.coins = 100;
    wallet.addEscrow('dice:0:1', 30);
    wallet.addEscrow('ring:1', 20);
    expect(wallets.refundAllEscrow()).toBe(50);
    expect(wallet.coins).toBe(100);
    expect(wallet.escrowTotal()).toBe(0);
  });

  it('容量淘汰跳过在线与有托管的记录', () => {
    const wallets = book(2);
    wallets.acquire(A, '甲');
    wallets.acquire(B, '乙');
    wallets.acquire(C, '丙');
    // 三条都在 10 分钟保护期内，evictIfNeeded 不淘汰
    expect(wallets.size).toBe(3);

    const b = wallets.get(B)!;
    b.lastSeenAt = 0;
    b.coins = 100;
    b.addEscrow('ring:1', 10);
    const a = wallets.get(A)!;
    a.lastSeenAt = 0;
    // 容量淘汰由 Tick 定期调用：在线、托管中的记录受保护
    wallets.prune((id) => id === C, 1_000_000);
    expect(wallets.get(A)).toBeUndefined();
    expect(wallets.get(B)).toBeDefined();
    expect(wallets.get(C)).toBeDefined();
  });

  it('落盘快照按设备号排序，恢复后逐条清洗', () => {
    const wallets = book();
    wallets.acquire(B, '乙');
    wallets.acquire(A, '甲');
    const snapshot = wallets.toJSON();
    expect(snapshot.map((entry) => entry.id)).toEqual([A, B]);

    const restored = book();
    restored.restore([...snapshot, { id: 'broken' }, null]);
    expect(restored.size).toBe(2);
    expect(restored.get(A)?.name).toBe('甲');
  });
});
