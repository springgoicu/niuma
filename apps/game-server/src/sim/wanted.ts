import {
  ACTIVITY_KIND,
  CLEAR_STAR_METHOD,
  ECONOMY_REWARD,
  SYSTEM_NOTICE_KIND,
  WALLET_REASON,
  encodeSystemNotice,
  encodeWantedState,
  formatSystemNotice,
  hotspotById,
  hotspotsOfKind,
  HOTSPOT_SERVER_SLACK,
  isWithinHotspot,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

const MAX_STARS = 5;
const STAR_DECAY_MS = 45_000;
const CLEAR_COOLDOWN_MS = 20_000;

export interface WantedPorts {
  spendCoins: (player: Player, amount: number, reason: number) => boolean;
  grantCoins: (player: Player, amount: number, reason: number) => void;
  onBroadcastActivity?: (actor: Player, kind: number, now: number) => void;
  onSurrenderJail?: (player: Player, now: number) => void;
}

/**
 * 全园区 1★~5★ 通缉系统：
 * - 动手 / 创人 / 袭医 / 抗拒执法逐级升星；
 * - 支持街头换装亭洗白、公用电话内线消星、自首快速进小黑屋与同行猎杀悬赏；
 * - 4★ 召唤 HR 机械杜宾犬，5★ 召唤老板黄金压路机。
 */
export class WantedRuntime {
  constructor(private readonly ports: WantedPorts) {}

  packetFor(player: Player, now: number): Uint8Array {
    const clearCdSec = player.clearStarCdUntil > now ? Math.ceil((player.clearStarCdUntil - now) / 1000) : 0;
    return encodeWantedState({
      id: player.id,
      stars: player.wantedStars,
      bounty: player.wantedBounty,
      clearCdSec,
    });
  }

  private broadcast(player: Player, now: number, world: World, transport: Transport): void {
    const pkt = this.packetFor(player, now);
    if (player.wsId !== 0) transport.send(player.wsId, pkt);
    for (const id of player.known) {
      const other = world.get(id);
      if (other && other.wsId !== 0) transport.send(other.wsId, pkt);
    }
  }

  addStar(player: Player, delta: number, now: number, world: World, transport: Transport): void {
    if (player.isNpc || delta <= 0) return;
    const prev = player.wantedStars;
    const next = Math.min(MAX_STARS, prev + delta);
    player.wantedStars = next;
    player.wantedBounty = next * ECONOMY_REWARD.BountyPerStar;
    player.wantedExpiresAt = now + (next >= 4 ? 70_000 : STAR_DECAY_MS);
    this.broadcast(player, now, world, transport);
    if (prev < 3 && next >= 3) {
      this.ports.onBroadcastActivity?.(player, ACTIVITY_KIND.WantedPeak, now);
    }
  }

  resetStars(player: Player, now: number, world: World, transport: Transport): void {
    if (player.wantedStars === 0 && player.wantedBounty === 0) return;
    player.wantedStars = 0;
    player.wantedBounty = 0;
    player.wantedExpiresAt = 0;
    this.broadcast(player, now, world, transport);
  }

  /** 街头换装亭 / 公用电话 / 自首洗白 */
  handleClearRequest(
    player: Player,
    method: number,
    now: number,
    world: World,
    transport: Transport,
  ): boolean {
    if (player.wantedStars <= 0) return false;
    if (method === CLEAR_STAR_METHOD.Surrender) {
      this.resetStars(player, now, world, transport);
      this.ports.onSurrenderJail?.(player, now);
      return true;
    }
    if (now < player.clearStarCdUntil) return false;

    if (method === CLEAR_STAR_METHOD.Booth) {
      const near = hotspotsOfKind('changingBooth').some((h) =>
        isWithinHotspot(h, player.x, player.y, HOTSPOT_SERVER_SLACK),
      );
      if (!near) return false;
      if (!this.ports.spendCoins(player, ECONOMY_REWARD.ClearStarBoothCost, WALLET_REASON.ClearStarSpend)) {
        return false;
      }
      // 换装亭一次洗掉最多 3★，超高星级（4-5★）至少留个悬念或用电话彻底清零
      player.wantedStars = Math.max(0, player.wantedStars - 3);
      player.wantedBounty = player.wantedStars * ECONOMY_REWARD.BountyPerStar;
      player.wantedExpiresAt = player.wantedStars > 0 ? now + STAR_DECAY_MS : 0;
      player.clearStarCdUntil = now + CLEAR_COOLDOWN_MS;
      this.broadcast(player, now, world, transport);
      if (player.wsId !== 0) {
        const msg = formatSystemNotice(SYSTEM_NOTICE_KIND.ClearStarBooth);
        if (msg) {
          transport.send(
            player.wsId,
            encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.ClearStarBooth, entityId: player.id, text: msg }),
          );
        }
      }
      return true;
    }

    if (method === CLEAR_STAR_METHOD.Payphone) {
      const near = hotspotsOfKind('payphone').some((h) =>
        isWithinHotspot(h, player.x, player.y, HOTSPOT_SERVER_SLACK),
      );
      if (!near && !hotspotById('payphone-service')) return false;
      if (!near) return false;
      if (!this.ports.spendCoins(player, ECONOMY_REWARD.ClearStarPayphoneCost, WALLET_REASON.BribeSpend)) {
        return false;
      }
      player.clearStarCdUntil = now + CLEAR_COOLDOWN_MS;
      this.resetStars(player, now, world, transport);
      if (player.wsId !== 0) {
        const msg = formatSystemNotice(SYSTEM_NOTICE_KIND.ClearStarPayphone);
        if (msg) {
          transport.send(
            player.wsId,
            encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.ClearStarPayphone, entityId: player.id, text: msg }),
          );
        }
      }
      return true;
    }

    return false;
  }

  /** 同事击倒通缉犯时兑现悬赏 */
  claimBounty(hunter: Player, victim: Player, now: number, world: World, transport: Transport): number {
    if (victim.wantedStars <= 0 || victim.wantedBounty <= 0) return 0;
    if (hunter.isNpc || hunter.id === victim.id) return 0;
    const reward = victim.wantedBounty;
    this.ports.grantCoins(hunter, reward, WALLET_REASON.BountyClaim);
    this.resetStars(victim, now, world, transport);
    return reward;
  }

  /** 20Hz 自然衰减 + 全园最高通缉查询（Zero-GC） */
  tick(world: World, now: number, transport: Transport): void {
    for (const player of world.players.values()) {
      if (player.isNpc || player.wantedStars <= 0) continue;
      if (now < player.wantedExpiresAt) continue;
      player.wantedStars = Math.max(0, player.wantedStars - 1);
      player.wantedBounty = player.wantedStars * ECONOMY_REWARD.BountyPerStar;
      player.wantedExpiresAt = player.wantedStars > 0 ? now + STAR_DECAY_MS : 0;
      this.broadcast(player, now, world, transport);
    }
  }

  /** 零分配查全服通缉热度最高的玩家，供 4★/5★ 特殊围剿逻辑读取 */
  highestWanted(world: World): Player | null {
    let best: Player | null = null;
    let bestStars = 0;
    for (const player of world.players.values()) {
      if (player.isNpc || player.wantedStars <= bestStars) continue;
      bestStars = player.wantedStars;
      best = player;
    }
    return best;
  }
}
