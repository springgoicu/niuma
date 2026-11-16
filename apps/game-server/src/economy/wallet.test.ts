import { describe, expect, it } from 'bun:test';
import { Wallet, createEphemeralWallet, walletFromSave } from './wallet';

describe('Wallet 聚合（ADR-0104）', () => {
  it('首次导入有上限，四维 / 背包 / 装扮都过协议清洗', () => {
    const wallet = new Wallet('a1b2c3d4e5f60718');
    wallet.importProfile(
      {
        coins: 999_999,
        stats: { atkSpeedLv: 99, workEffLv: 2, critLv: 3, armorLv: 4 },
        inventory: { ice_americano: 500, unknown: 9 },
        unlockedCosmetics: ['top', 'not_a_real_sku'],
        dailyQuests: { day: '', progress: {}, claimed: [] },
      },
      1_000,
      123,
    );
    expect(wallet.coins).toBe(1_000);
    expect(wallet.stats.atkSpeedLv).toBe(10);
    expect(wallet.inventory).toEqual({ ice_americano: 99 });
    expect(wallet.unlockedCosmetics).toEqual(['top']);
    expect(wallet.importedAt).toBe(123);
  });

  it('托管按 key 分账：退一张桌不会碰擂台报名费', () => {
    const wallet = new Wallet('a1b2c3d4e5f60718');
    wallet.coins = 1_000;
    expect(wallet.addEscrow('dice:0:1', 100)).toBe(true);
    expect(wallet.addEscrow('ring:1', 50)).toBe(true);
    expect(wallet.coins).toBe(850);
    expect(wallet.escrowTotal()).toBe(150);

    expect(wallet.refundEscrow('dice:0:1')).toBe(100);
    expect(wallet.coins).toBe(950);
    expect(wallet.escrowOf('ring:1')).toBe(50);

    expect(wallet.takeEscrow('ring:1')).toBe(50);
    expect(wallet.escrowOf('ring:1')).toBe(0);
    expect(wallet.coins).toBe(950);
  });

  it('余额不足或非法 key 不产生托管', () => {
    const wallet = new Wallet('a1b2c3d4e5f60718');
    wallet.coins = 10;
    expect(wallet.addEscrow('dice:0:1', 11)).toBe(false);
    expect(wallet.addEscrow('bad-key', 1)).toBe(false);
    expect(wallet.escrowTotal()).toBe(0);
    expect(wallet.coins).toBe(10);
  });

  it('崩服恢复把全部托管原路退回', () => {
    const wallet = new Wallet('a1b2c3d4e5f60718');
    wallet.coins = 1_000;
    wallet.addEscrow('dice:1:1', 200);
    wallet.addEscrow('ring:1', 50);
    expect(wallet.refundAllEscrow()).toBe(250);
    expect(wallet.coins).toBe(1_000);
    expect(wallet.escrowTotal()).toBe(0);
  });

  it('坏档：非法设备号整条丢弃，未知托管 key 只丢那一笔', () => {
    expect(walletFromSave({ id: 'not-hex' })).toBeNull();
    const wallet = walletFromSave({
      id: 'a1b2c3d4e5f60718',
      coins: 88,
      stats: { atkSpeedLv: 1 },
      inventory: { ice_americano: 2 },
      unlockedCosmetics: ['crown'],
      escrow: [
        { key: 'dice:0:1', amount: 30 },
        { key: '../../etc/passwd', amount: 999 },
        { key: 'p2p:7', amount: 12 },
      ],
      importedAt: 5,
      lastSeenAt: 6,
    });
    expect(wallet).not.toBeNull();
    expect(wallet!.coins).toBe(88);
    expect(wallet!.escrowOf('dice:0:1')).toBe(30);
    expect(wallet!.escrowOf('p2p:7')).toBe(12);
    expect(wallet!.escrowTotal()).toBe(42);
  });

  it('匿名临时钱包不落盘', () => {
    const wallet = createEphemeralWallet();
    expect(wallet.id).toBe('');
    expect(wallet.coins).toBe(0);
  });
});
