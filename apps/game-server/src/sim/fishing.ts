import {
  ACTIVITY_KIND,
  ECONOMY_REWARD,
  FISH_LOOT_KIND,
  FISHING_ACTION,
  FISHING_PIERS,
  FISHING_STATE,
  HOTSPOT_SERVER_SLACK,
  POSE,
  WALLET_REASON,
  encodeFishingState,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

const ABORT_DIST_SQ = 128 * 128;
const BITE_WINDOW_MS = 2_400;
const RESULT_HOLD_MS = 1_400;

interface LootEntry {
  kind: number;
  coins: number;
  weight: number;
}

const LOOT_TABLE: ReadonlyArray<LootEntry> = [
  { kind: FISH_LOOT_KIND.OldKeyboard, coins: 15, weight: 30 },
  { kind: FISH_LOOT_KIND.SlimeCarp, coins: 25, weight: 35 },
  { kind: FISH_LOOT_KIND.CyberCrab, coins: 40, weight: 20 },
  { kind: FISH_LOOT_KIND.BossMug, coins: 65, weight: 10 },
  { kind: FISH_LOOT_KIND.GoldKoi, coins: 140, weight: 5 },
];

export interface FishingHooks {
  grantCoins: (player: Player, amount: number, reason: number) => void;
  onBroadcastActivity?: (actor: Player, kind: number, now: number) => void;
}

/**
 * 3 处临湖木栈道摸鱼钓鱼系统：挥杆 → 浮漂晃动咬钩 → 提竿爆金币。
 */
export class FishingRuntime {
  constructor(private readonly hooks: FishingHooks) {}

  packetFor(player: Player, rewardKind = 0): Uint8Array {
    return encodeFishingState({
      id: player.id,
      state: player.fishingState,
      spotId: player.fishingSpotId,
      biteAtMs: player.fishingBiteAt >>> 0,
      rewardKind,
    });
  }

  private broadcast(player: Player, world: World, transport: Transport, rewardKind = 0): void {
    const pkt = this.packetFor(player, rewardKind);
    if (player.wsId !== 0) transport.send(player.wsId, pkt);
    for (const id of player.known) {
      const other = world.get(id);
      if (other && other.wsId !== 0) transport.send(other.wsId, pkt);
    }
  }

  private rollLoot(seed: number): LootEntry {
    const r = Math.abs(Math.imul(seed ^ 0x9e3779b9, 1103515245) >> 16) % 100;
    let acc = 0;
    for (const entry of LOOT_TABLE) {
      acc += entry.weight;
      if (r < acc) return entry;
    }
    return LOOT_TABLE[1]!;
  }

  handleAction(
    player: Player,
    action: number,
    spotId: number,
    now: number,
    world: World,
    transport: Transport,
  ): boolean {
    if (player.isNpc) return false;
    if (action === FISHING_ACTION.Cancel) {
      this.cancel(player, world, transport);
      return true;
    }

    if (action === FISHING_ACTION.Cast) {
      if (player.vehicleId > 0 || player.incapacitated || player.ghostMode !== 0) return false;
      const pier = FISHING_PIERS.find((p) => p.id === spotId);
      if (!pier) return false;
      const dx = player.x - pier.castSpot.x;
      const dy = player.y - pier.castSpot.y;
      if (dx * dx + dy * dy > (pier.radius + HOTSPOT_SERVER_SLACK) ** 2) return false;

      const waitMs = 2_400 + (Math.abs((player.id * 997 + Math.floor(now / 17)) % 3_200));
      player.fishingState = FISHING_STATE.Waiting;
      player.fishingSpotId = pier.id;
      player.fishingBiteAt = now + waitMs;
      player.applyState(player.direction, POSE.Idle, false);
      player.markDirtyIfChanged();
      this.broadcast(player, world, transport, 0);
      return true;
    }

    if (action === FISHING_ACTION.Reel) {
      if (player.fishingState === FISHING_STATE.Biting) {
        const loot = this.rollLoot(player.id * 131 + Math.floor(now));
        player.fishingState = FISHING_STATE.Caught;
        player.fishingBiteAt = now + RESULT_HOLD_MS;
        this.hooks.grantCoins(player, loot.coins || ECONOMY_REWARD.Quest, WALLET_REASON.FishingSell);
        this.broadcast(player, world, transport, loot.kind);
        if (loot.kind === FISH_LOOT_KIND.GoldKoi) {
          this.hooks.onBroadcastActivity?.(player, ACTIVITY_KIND.FishingCatch, now);
        }
        return true;
      }
      if (player.fishingState === FISHING_STATE.Waiting) {
        player.fishingState = FISHING_STATE.Missed;
        player.fishingBiteAt = now + RESULT_HOLD_MS;
        this.broadcast(player, world, transport, 0);
        return true;
      }
    }

    return false;
  }

  cancel(player: Player, world: World, transport: Transport): void {
    if (player.fishingState === FISHING_STATE.Idle) return;
    player.fishingState = FISHING_STATE.Idle;
    player.fishingBiteAt = 0;
    this.broadcast(player, world, transport, 0);
  }

  /** 20Hz 状态驱动：离站自动收杆 / 等咬钩 → 上钩窗口 → 脱钩复位 */
  tick(world: World, now: number, transport: Transport): void {
    for (const player of world.players.values()) {
      if (player.isNpc || player.fishingState === FISHING_STATE.Idle) continue;
      if (player.incapacitated || player.ghostMode !== 0 || player.vehicleId > 0) {
        this.cancel(player, world, transport);
        continue;
      }
      const pier = FISHING_PIERS[player.fishingSpotId];
      if (pier) {
        const dx = player.x - pier.castSpot.x;
        const dy = player.y - pier.castSpot.y;
        if (dx * dx + dy * dy > ABORT_DIST_SQ) {
          this.cancel(player, world, transport);
          continue;
        }
      }
      if (player.fishingState === FISHING_STATE.Waiting && now >= player.fishingBiteAt) {
        player.fishingState = FISHING_STATE.Biting;
        player.fishingBiteAt = now + BITE_WINDOW_MS;
        this.broadcast(player, world, transport, 0);
      } else if (player.fishingState === FISHING_STATE.Biting && now >= player.fishingBiteAt) {
        player.fishingState = FISHING_STATE.Missed;
        player.fishingBiteAt = now + RESULT_HOLD_MS;
        this.broadcast(player, world, transport, 0);
      } else if (
        (player.fishingState === FISHING_STATE.Caught || player.fishingState === FISHING_STATE.Missed) &&
        now >= player.fishingBiteAt
      ) {
        this.cancel(player, world, transport);
      }
    }
  }
}
