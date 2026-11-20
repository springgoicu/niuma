import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  ECONOMY_REWARD,
  FISHING_ACTION,
  FISHING_PIERS,
  FISHING_STATE,
  GIG_ACTION,
  GIG_KIND,
  GIG_STATE,
  GRAFFITI_WALLS,
  LOADING_DOCK,
  decodeGigState,
} from '@niuma/shared-types';
import { FishingRuntime } from './fishing';
import { GigRuntime } from './gigs';
import { TurfRuntime } from './turf';
import { World } from './world';

describe('Fishing / Turf / Gig 三条全新 GTA 经济线', () => {
  it('栈桥钓鱼完整流程：下杆 → 等咬钩 → 提竿卖钱', () => {
    const world = new World();
    const pier = FISHING_PIERS[0]!;
    const p = world.create('钓佬', DEFAULT_APPEARANCE.cow, 40, pier.castSpot.x, pier.castSpot.y)!;
    let earned = 0;
    const fishing = new FishingRuntime({ grantCoins: (_pl, amt) => (earned += amt) });
    const transport = { send() {} };

    expect(fishing.handleAction(p, FISHING_ACTION.Cast, pier.id, 1_000, world, transport)).toBe(true);
    expect(p.fishingState).toBe(FISHING_STATE.Waiting);
    fishing.tick(world, p.fishingBiteAt + 10, transport);
    expect(p.fishingState).toBe(FISHING_STATE.Biting);
    expect(fishing.handleAction(p, FISHING_ACTION.Reel, pier.id, p.fishingBiteAt + 50, world, transport)).toBe(true);
    expect(p.fishingState).toBe(FISHING_STATE.Caught);
    expect(earned).toBeGreaterThan(0);
  });

  it('12 面街头涂鸦抢占 + 每分钟自动派发分红', () => {
    const world = new World();
    const wall = GRAFFITI_WALLS[0]!;
    const p = world.create('涂鸦客', DEFAULT_APPEARANCE.horse, 41, wall.x, wall.y + 16)!;
    let earned = 0;
    const turf = new TurfRuntime({ grantCoins: (_pl, amt) => (earned += amt) });
    const transport = { send() {} };

    expect(turf.handleSpray(p, wall.wallId, 1_000, world, transport)).toBe(true);
    expect(earned).toBe(ECONOMY_REWARD.TurfSpray);
    turf.tick(world, 2_000, transport);
    turf.tick(world, 65_000, transport);
    expect(earned).toBe(ECONOMY_REWARD.TurfSpray + 8);
  });

  it('快递装卸台接外卖零工并在送达终点领赏金', () => {
    const world = new World();
    const p = world.create('跑腿哥', DEFAULT_APPEARANCE.cow, 42, LOADING_DOCK.hotspot.x, LOADING_DOCK.hotspot.y)!;
    let earned = 0;
    let lastGigPkt: Uint8Array | null = null;
    const gigs = new GigRuntime({ grantCoins: (_pl, amt) => (earned += amt) });
    const transport = {
      send(_ws: number, data: Uint8Array) {
        lastGigPkt = data;
      },
    };

    expect(gigs.handleAction(p, GIG_ACTION.Accept, GIG_KIND.Delivery, 1_000, world, transport)).toBe(true);
    expect(lastGigPkt).not.toBeNull();

    const state = decodeGigState(lastGigPkt!);
    expect(state.state).toBe(GIG_STATE.Active);
    p.x = state.targetX;
    p.y = state.targetY;
    expect(gigs.handleAction(p, GIG_ACTION.Complete, state.targetId, 2_000, world, transport)).toBe(true);
    expect(earned).toBe(ECONOMY_REWARD.GigDelivery);
  });
});
