import {
  ACTIVITY_KIND,
  CLINIC_RESPAWN_POINT,
  ECONOMY_REWARD,
  GHOST_MODE,
  POSE,
  SYSTEM_NOTICE_KIND,
  WALLET_REASON,
  encodeGhostState,
  encodeSystemNotice,
  formatSystemNotice,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

const FLATLINE_WINDOW_MS = 20_000;
const GHOST_WINDOW_MS = 15_000;
const CPR_RANGE_PX = 84;
const CPR_PROGRESS_STEP = 34;

export interface GhostHooks {
  onEjectVehicle?: (player: Player, now: number) => void;
  onCancelClinic?: (playerId: number, now: number) => void;
  onBroadcastActivity?: (actor: Player, kind: number, now: number) => void;
  onGrantCoins?: (player: Player, amount: number, reason: number) => void;
  onUpdateGrid?: (player: Player) => void;
}

/**
 * 街头重伤倒地 / 灵魂出窍 / 好心同事 CPR 心肺复苏急救系统。
 */
export class GhostRuntime {
  constructor(private readonly hooks: GhostHooks = {}) {}

  private broadcastState(player: Player, now: number, world: World, transport: Transport): void {
    const pkt = this.packetFor(player, now);
    if (player.wsId !== 0) transport.send(player.wsId, pkt);
    for (const id of player.known) {
      const other = world.get(id);
      if (other && other.wsId !== 0) transport.send(other.wsId, pkt);
    }
  }

  packetFor(player: Player, now: number): Uint8Array {
    const leftMs = player.ghostMode !== GHOST_MODE.Alive ? Math.max(0, player.flatlineUntil - now) : 0;
    return encodeGhostState({
      id: player.id,
      mode: player.ghostMode,
      cprProgress: player.cprProgress,
      leftMs: Math.min(0xffff, leftMs),
    });
  }

  enterFlatline(player: Player, now: number, world: World, transport: Transport): void {
    if (player.isNpc || player.ghostMode !== GHOST_MODE.Alive) return;
    this.hooks.onEjectVehicle?.(player, now);
    player.ghostMode = GHOST_MODE.Flatline;
    player.flatlineUntil = now + FLATLINE_WINDOW_MS;
    player.cprProgress = 0;
    player.cprRescuerId = 0;
    player.applyState(player.direction, POSE.Lie, false);
    player.markDirtyIfChanged();
    this.broadcastState(player, now, world, transport);

    if (player.wsId !== 0) {
      const msg = formatSystemNotice(SYSTEM_NOTICE_KIND.FlatlineDown);
      if (msg) {
        transport.send(
          player.wsId,
          encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.FlatlineDown, entityId: player.id, text: msg }),
        );
      }
    }
  }

  enterGhostPhase(player: Player, now: number, world: World, transport: Transport): void {
    if (player.ghostMode !== GHOST_MODE.Flatline) return;
    this.hooks.onCancelClinic?.(player.id, now);
    player.incapacitated = false;
    player.carriedBy = 0;
    player.ghostMode = GHOST_MODE.Ghost;
    player.flatlineUntil = now + GHOST_WINDOW_MS;
    player.applyState(player.direction, POSE.Idle, false);
    player.markDirtyIfChanged();
    this.broadcastState(player, now, world, transport);
  }

  performCpr(
    rescuer: Player,
    targetId: number,
    now: number,
    world: World,
    transport: Transport,
  ): boolean {
    if (rescuer.ghostMode !== GHOST_MODE.Alive || rescuer.incapacitated || rescuer.vehicleId > 0) return false;
    const target = world.get(targetId);
    if (!target || target.id === rescuer.id || target.ghostMode === GHOST_MODE.Alive) return false;
    const dx = target.x - rescuer.x;
    const dy = target.y - rescuer.y;
    if (dx * dx + dy * dy > CPR_RANGE_PX * CPR_RANGE_PX) return false;

    target.cprRescuerId = rescuer.id;
    target.cprProgress = Math.min(100, target.cprProgress + CPR_PROGRESS_STEP);
    if (target.cprProgress >= 100) {
      target.ghostMode = GHOST_MODE.Alive;
      target.flatlineUntil = 0;
      target.cprProgress = 0;
      target.cprRescuerId = 0;
      target.incapacitated = false;
      target.carriedBy = 0;
      target.immunityUntilMs = now + 4_000;
      this.hooks.onCancelClinic?.(target.id, now);
      target.applyState(target.direction, POSE.Idle, false);
      target.markDirtyIfChanged();
      this.broadcastState(target, now, world, transport);
      this.hooks.onGrantCoins?.(rescuer, ECONOMY_REWARD.CprRescue, WALLET_REASON.CprRescue);
      this.hooks.onBroadcastActivity?.(rescuer, ACTIVITY_KIND.CprRescue, now);
    } else {
      this.broadcastState(target, now, world, transport);
    }
    return true;
  }

  /** 20Hz 状态机流转：倒地 → 幽灵 → 回急救站门口苏醒，Zero-GC */
  tick(world: World, now: number, transport: Transport): void {
    for (const player of world.players.values()) {
      if (player.ghostMode === GHOST_MODE.Alive) continue;
      if (now < player.flatlineUntil) continue;
      if (player.ghostMode === GHOST_MODE.Flatline) {
        this.enterGhostPhase(player, now, world, transport);
        continue;
      }
      // 幽灵倒计时结束 → 自动传送回新版急诊大门无障碍区苏醒
      player.ghostMode = GHOST_MODE.Alive;
      player.flatlineUntil = 0;
      player.cprProgress = 0;
      player.cprRescuerId = 0;
      player.incapacitated = false;
      player.x = CLINIC_RESPAWN_POINT.x;
      player.y = CLINIC_RESPAWN_POINT.y;
      player.applyState(player.direction, POSE.Idle, false);
      player.markDirtyIfChanged();
      player.needsViewRefresh = true;
      this.hooks.onUpdateGrid?.(player);
      this.broadcastState(player, now, world, transport);
      if (player.wsId !== 0) {
        const msg = formatSystemNotice(SYSTEM_NOTICE_KIND.GhostExpired);
        if (msg) {
          transport.send(
            player.wsId,
            encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.GhostExpired, entityId: player.id, text: msg }),
          );
        }
      }
    }
  }
}
