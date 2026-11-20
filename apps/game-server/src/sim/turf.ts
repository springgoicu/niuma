import {
  ACTIVITY_KIND,
  ECONOMY_REWARD,
  GRAFFITI_WALLS,
  HOTSPOT_SERVER_SLACK,
  PLAYER_EFFECT,
  SYSTEM_NOTICE_KIND,
  WALLET_REASON,
  encodePlayerEffect,
  encodeSystemNotice,
  encodeTurfState,
  formatSystemNotice,
  hotspotById,
  isWithinHotspot,
  type TurfEntry,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

interface WallRecord {
  readonly wallId: number;
  ownerId: number;
  ownerDeviceId: string;
  ownerName: string;
  lastSprayAt: number;
}

const WALL_SPRAY_COOLDOWN_MS = 25_000;
const DIVIDEND_INTERVAL_MS = 60_000;
const DIVIDEND_PER_WALL = 8;

export interface TurfHooks {
  grantCoins: (player: Player, amount: number, reason: number) => void;
  onBroadcastActivity?: (actor: Player, kind: number, now: number) => void;
}

/**
 * 12 面街头涂鸦地盘墙占领战：喷涂即时爆赏金，名下墙面每分钟自动寄来街区小费分红。
 */
export class TurfRuntime {
  private readonly walls: WallRecord[];
  private readonly packetScratch: TurfEntry[];
  private readonly lastBypassByPlayer = new Set<number>();
  private lastDividendAt = 0;

  constructor(private readonly hooks: TurfHooks) {
    this.walls = GRAFFITI_WALLS.map((w) => ({
      wallId: w.wallId,
      ownerId: 0,
      ownerDeviceId: '',
      ownerName: '',
      lastSprayAt: 0,
    }));
    this.packetScratch = this.walls.map((w) => ({
      wallId: w.wallId,
      ownerId: w.ownerId,
      ownerName: w.ownerName,
    }));
  }

  /** 限定金漆喷罐（item 12）激活「无冷却抢喷」一次 */
  armSprayBoost(playerId: number): void {
    this.lastBypassByPlayer.add(playerId);
  }

  buildPacket(): Uint8Array {
    for (let i = 0; i < this.walls.length; i += 1) {
      const w = this.walls[i]!;
      const out = this.packetScratch[i]!;
      out.ownerId = w.ownerId;
      out.ownerName = w.ownerName;
    }
    return encodeTurfState({ walls: this.packetScratch });
  }

  private broadcastAll(world: World, transport: Transport): void {
    const pkt = this.buildPacket();
    for (const p of world.players.values()) {
      if (p.wsId !== 0) transport.send(p.wsId, pkt);
    }
  }

  handleSpray(
    player: Player,
    wallId: number,
    now: number,
    world: World,
    transport: Transport,
  ): boolean {
    if (player.isNpc || player.incapacitated || player.ghostMode !== 0) return false;
    const record = this.walls[wallId];
    if (!record) return false;
    const hotspot = hotspotById(`graffiti-wall-${wallId}`);
    if (!hotspot || !isWithinHotspot(hotspot, player.x, player.y, HOTSPOT_SERVER_SLACK)) return false;

    const boosted = this.lastBypassByPlayer.delete(player.id);
    if (!boosted && record.lastSprayAt > 0 && now - record.lastSprayAt < WALL_SPRAY_COOLDOWN_MS) return false;

    const sameOwner =
      (player.deviceId && record.ownerDeviceId === player.deviceId) ||
      (!player.deviceId && record.ownerId === player.id);
    if (sameOwner) return false;

    record.ownerId = player.id;
    record.ownerDeviceId = player.deviceId;
    record.ownerName = player.name;
    record.lastSprayAt = now;

    this.hooks.grantCoins(player, ECONOMY_REWARD.TurfSpray, WALLET_REASON.TurfSpray);
    const fx = encodePlayerEffect({
      effect: PLAYER_EFFECT.Spray,
      sourceId: player.id,
      targetId: player.id,
      extraId: wallId,
      durationMs: 0,
      isTarget: true,
      blocked: false,
    });
    if (player.wsId !== 0) transport.send(player.wsId, fx);
    this.broadcastAll(world, transport);
    this.hooks.onBroadcastActivity?.(player, ACTIVITY_KIND.TurfCapture, now);
    return true;
  }

  /** 每 60s 为在线涂鸦墙主结算一次街区小费分红（Zero-GC） */
  tick(world: World, now: number, transport: Transport): void {
    if (this.lastDividendAt === 0) {
      this.lastDividendAt = now;
      return;
    }
    if (now - this.lastDividendAt < DIVIDEND_INTERVAL_MS) return;
    this.lastDividendAt = now;

    for (const player of world.players.values()) {
      if (player.isNpc || player.wsId === 0) continue;
      let count = 0;
      for (let i = 0; i < this.walls.length; i += 1) {
        const w = this.walls[i]!;
        if (w.ownerName === '') continue;
        if (player.deviceId ? w.ownerDeviceId === player.deviceId : w.ownerId === player.id) {
          count += 1;
        }
      }
      if (count > 0) {
        this.hooks.grantCoins(player, count * DIVIDEND_PER_WALL, WALLET_REASON.TurfDividend);
        const msg = formatSystemNotice(SYSTEM_NOTICE_KIND.TurfDividend);
        if (msg) {
          transport.send(
            player.wsId,
            encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.TurfDividend, entityId: player.id, text: msg }),
          );
        }
      }
    }
  }
}
