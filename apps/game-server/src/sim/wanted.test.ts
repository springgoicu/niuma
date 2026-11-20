import { describe, expect, it } from 'vitest';
import {
  CHANGING_BOOTHS,
  CLEAR_STAR_METHOD,
  DEFAULT_APPEARANCE,
  ECONOMY_REWARD,
  OpCode,
  PAYPHONES,
  decodeWantedState,
  encodeWantedState,
} from '@niuma/shared-types';
import { WantedRuntime } from './wanted';
import { World } from './world';

describe('WantedRuntime 通缉与消星赏金', () => {
  it('累犯升星上限 5★，3★+ 播报，过期逐星衰减', () => {
    const world = new World();
    const sent: Uint8Array[] = [];
    const activities: number[] = [];
    const p = world.create('逃犯', DEFAULT_APPEARANCE.cow, 10, 4096, 4096)!;

    const wanted = new WantedRuntime({
      spendCoins: () => true,
      grantCoins: () => {},
      onBroadcastActivity: (_actor, kind) => activities.push(kind),
    });

    wanted.addStar(p, 2, 1_000, world, { send: (_ws, pkt) => sent.push(pkt) });
    expect(p.wantedStars).toBe(2);
    expect(p.wantedBounty).toBe(2 * ECONOMY_REWARD.BountyPerStar);

    wanted.addStar(p, 4, 2_000, world, { send: (_ws, pkt) => sent.push(pkt) });
    expect(p.wantedStars).toBe(5);
    expect(activities.length).toBe(1);

    // 超过衰减时刻降 1 星
    wanted.tick(world, p.wantedExpiresAt + 10, { send: (_ws, pkt) => sent.push(pkt) });
    expect(p.wantedStars).toBe(4);
    expect(sent.some((pkt) => pkt[0] === OpCode.S2C_WANTED_STATE && decodeWantedState(pkt).stars === 4)).toBe(true);
    expect(encodeWantedState({ id: p.id, stars: 4, bounty: 160, clearCdSec: 0 }).byteLength).toBeGreaterThan(0);
  });

  it('换装亭降 3★、公用电话全清、同行击倒兑现赏金', () => {
    const world = new World();
    let coins = 500;
    const p = world.create('匪徒', DEFAULT_APPEARANCE.cow, 11, CHANGING_BOOTHS[0]!.hotspot.x, CHANGING_BOOTHS[0]!.hotspot.y)!;
    const hunter = world.create('赏金猎人', DEFAULT_APPEARANCE.horse, 12, p.x, p.y)!;
    let hunterEarned = 0;

    const wanted = new WantedRuntime({
      spendCoins: (_pl, amt) => {
        if (coins < amt) return false;
        coins -= amt;
        return true;
      },
      grantCoins: (_pl, amt) => {
        hunterEarned += amt;
      },
    });
    const transport = { send() {} };
    wanted.addStar(p, 4, 1_000, world, transport);
    expect(wanted.handleClearRequest(p, CLEAR_STAR_METHOD.Booth, 2_000, world, transport)).toBe(true);
    expect(p.wantedStars).toBe(1);
    expect(coins).toBe(500 - ECONOMY_REWARD.ClearStarBoothCost);

    // 公用电话需清冷却后生效
    p.x = PAYPHONES[0]!.x;
    p.y = PAYPHONES[0]!.y;
    expect(wanted.handleClearRequest(p, CLEAR_STAR_METHOD.Payphone, 3_000, world, transport)).toBe(false);
    expect(wanted.handleClearRequest(p, CLEAR_STAR_METHOD.Payphone, 30_000, world, transport)).toBe(true);
    expect(p.wantedStars).toBe(0);

    // 悬赏兑现
    wanted.addStar(p, 3, 35_000, world, transport);
    const bounty = wanted.claimBounty(hunter, p, 36_000, world, transport);
    expect(bounty).toBe(3 * ECONOMY_REWARD.BountyPerStar);
    expect(hunterEarned).toBe(bounty);
    expect(p.wantedStars).toBe(0);
  });
});
