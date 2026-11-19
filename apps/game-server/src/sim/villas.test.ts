import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  VILLA_INCOME_INTERVAL_MS,
  VILLA_SPECS,
  WALLET_REASON,
  villaBuyPrice,
  villaBuyoutRefund,
} from '@niuma/shared-types';
import { VillaRuntime } from './villas';
import { World } from './world';

function setup() {
  const world = new World();
  const ownerRewards: Array<{ deviceId: string; amount: number; reason: number }> = [];
  const runtime = new VillaRuntime({
    spend(player, amount) {
      if (player.coins < amount) return false;
      player.coins -= amount;
      return true;
    },
    grant(player, amount) {
      player.coins += amount;
    },
    creditOwner(deviceId, amount, reason) {
      ownerRewards.push({ deviceId, amount, reason });
    },
  });
  return { world, ownerRewards, runtime };
}

describe('VillaRuntime 8 处分阶房产与 1.5x 收购', () => {
  it('按地段分阶扣费，购买后立即可生成摇钱树产出', () => {
    const { world, runtime } = setup();
    const club = VILLA_SPECS.find((s) => s.id === 2)!;
    const player = world.create('夜店老板', DEFAULT_APPEARANCE.cow, 11, club.gate.x, club.gate.y)!;
    player.deviceId = '1111222233334444';
    player.coins = club.price + 200;

    const outcome = runtime.buyResult(player, club.id, 10_000);
    expect(outcome.ok).toBe(true);
    expect(player.coins).toBe(200);
    expect(runtime.record(club.id)?.ownerDeviceId).toBe(player.deviceId);

    // 站去摇钱树旁 2 分钟后可收取 2 * spec.income
    player.x = club.tree.x;
    player.y = club.tree.y;
    const collected = runtime.collect(player, club.id, 10_000 + 2 * VILLA_INCOME_INTERVAL_MS);
    expect(collected).toBe(club.income * 2);
    expect(player.coins).toBe(200 + club.income * 2);
  });

  it('他人冠名的房产支持 1.5x 溢价收购，原房主获 1.2x + 未收收益', () => {
    const { world, ownerRewards, runtime } = setup();
    const stall = VILLA_SPECS.find((s) => s.id === 4)!;
    const buyer1 = world.create('先手摊主', DEFAULT_APPEARANCE.cow, 11, stall.gate.x, stall.gate.y)!;
    buyer1.deviceId = 'aaaa000011112222';
    buyer1.coins = stall.price;
    expect(runtime.buyResult(buyer1, stall.id, 1_000).ok).toBe(true);

    // 经过 3 分钟累积产出后，先手摊主自己不能重复收购
    const buyer2 = world.create('接盘大亨', DEFAULT_APPEARANCE.cow, 12, stall.gate.x, stall.gate.y)!;
    buyer2.deviceId = 'bbbb000011112222';
    const buyoutPrice = villaBuyPrice(stall, true);
    buyer2.coins = buyoutPrice;

    const now = 1_000 + 3 * VILLA_INCOME_INTERVAL_MS;
    expect(runtime.buyResult(buyer1, stall.id, now)).toEqual({ ok: false, reason: 'alreadyMine' });

    const buyout = runtime.buyResult(buyer2, stall.id, now);
    expect(buyout).toMatchObject({
      ok: true,
      buyout: true,
      price: buyoutPrice,
      prevOwnerName: '先手摊主',
      prevOwnerDeviceId: buyer1.deviceId,
    });
    expect(buyer2.coins).toBe(0);
    expect(runtime.record(stall.id)?.ownerDeviceId).toBe(buyer2.deviceId);
    expect(ownerRewards).toEqual([
      {
        deviceId: buyer1.deviceId,
        amount: villaBuyoutRefund(stall) + stall.income * 3,
        reason: WALLET_REASON.VillaBuyout,
      },
    ]);
  });

  it('支持全部 8 栋房产独立确权、上锁与快照生成', () => {
    const { world, runtime } = setup();
    const owner = world.create('大包租公', DEFAULT_APPEARANCE.cow, 11, 0, 0)!;
    owner.deviceId = 'cccc000011112222';
    owner.coins = 50_000;

    for (const spec of VILLA_SPECS) {
      owner.x = spec.gate.x;
      owner.y = spec.gate.y;
      expect(runtime.buy(owner, spec.id, 1_000)).toBe(true);
      expect(runtime.toggleLock(owner, spec.id)).toBe(true);
    }
    expect(runtime.lockedSolids()).toHaveLength(VILLA_SPECS.length);
    const snap = runtime.snapshotFor(owner, 1_000 + VILLA_INCOME_INTERVAL_MS);
    expect(snap.villas).toHaveLength(8);
    expect(snap.villas[2]?.pending).toBe(VILLA_SPECS[2]!.income);
  });
});
