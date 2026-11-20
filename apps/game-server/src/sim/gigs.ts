import {
  ACTIVITY_KIND,
  ECONOMY_REWARD,
  GIG_ACTION,
  GIG_DROP_POINTS,
  GIG_KIND,
  GIG_STATE,
  HOTSPOT_SERVER_SLACK,
  WALLET_REASON,
  encodeGigState,
  hotspotsOfKind,
  isWithinHotspot,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

interface ActiveGig {
  kind: number;
  state: number;
  targetX: number;
  targetY: number;
  reward: number;
  deadlineAt: number;
  targetId: number;
  lastSentSec: number;
}

const DELIVERY_DEADLINE_MS = 90_000;
const PATROL_DEADLINE_MS = 60_000;
const COMPLETE_RADIUS_PX = 104;

export interface GigHooks {
  grantCoins: (player: Player, amount: number, reason: number) => void;
  onBroadcastActivity?: (actor: Player, kind: number, now: number) => void;
  pickWantedTarget?: (world: World, selfId: number) => Player | null;
}

/**
 * 街头零工任务引擎：快递装卸台送餐跑腿 & 保安车库协助悬赏，鼓励踩油门飙车串联全岛！
 */
export class GigRuntime {
  private readonly active = new Map<number, ActiveGig>();

  constructor(private readonly hooks: GigHooks) {}

  clearPlayer(playerId: number): void {
    this.active.delete(playerId);
  }

  private sendState(player: Player, gig: ActiveGig | undefined, now: number, transport: Transport): void {
    if (player.wsId === 0) return;
    if (!gig) {
      transport.send(
        player.wsId,
        encodeGigState({
          kind: GIG_KIND.None,
          state: GIG_STATE.None,
          targetX: 0,
          targetY: 0,
          reward: 0,
          timeLeftSec: 0,
          targetId: 0,
        }),
      );
      return;
    }
    const leftSec = Math.max(0, Math.ceil((gig.deadlineAt - now) / 1000));
    transport.send(
      player.wsId,
      encodeGigState({
        kind: gig.kind,
        state: gig.state,
        targetX: gig.targetX,
        targetY: gig.targetY,
        reward: gig.reward,
        timeLeftSec: leftSec,
        targetId: gig.targetId,
      }),
    );
  }

  handleAction(
    player: Player,
    action: number,
    targetId: number,
    now: number,
    world: World,
    transport: Transport,
  ): boolean {
    if (player.isNpc) return false;

    if (action === GIG_ACTION.Abandon) {
      this.active.delete(player.id);
      this.sendState(player, undefined, now, transport);
      return true;
    }

    if (action === GIG_ACTION.Accept) {
      const existing = this.active.get(player.id);
      if (existing && existing.state === GIG_STATE.Active && now < existing.deadlineAt) return false;

      const nearDock = hotspotsOfKind('loadingDock').some((h) =>
        isWithinHotspot(h, player.x, player.y, HOTSPOT_SERVER_SLACK),
      );
      const nearGarage = hotspotsOfKind('securityGarage').some((h) =>
        isWithinHotspot(h, player.x, player.y, HOTSPOT_SERVER_SLACK),
      );

      if (targetId === GIG_KIND.PatrolAssist || (nearGarage && !nearDock)) {
        if (!nearGarage) return false;
        const suspect = this.hooks.pickWantedTarget?.(world, player.id);
        const drop = suspect ?? GIG_DROP_POINTS[(player.id + Math.floor(now / 100)) % GIG_DROP_POINTS.length]!;
        const gig: ActiveGig = {
          kind: GIG_KIND.PatrolAssist,
          state: GIG_STATE.Active,
          targetX: drop.x,
          targetY: drop.y,
          reward: ECONOMY_REWARD.GigPatrol,
          deadlineAt: now + PATROL_DEADLINE_MS,
          targetId: suspect ? suspect.id : 0,
          lastSentSec: 60,
        };
        this.active.set(player.id, gig);
        this.sendState(player, gig, now, transport);
        return true;
      }

      if (!nearDock) return false;
      const idx = Math.abs(player.id * 7 + Math.floor(now / 37)) % GIG_DROP_POINTS.length;
      const drop = GIG_DROP_POINTS[idx]!;
      const gig: ActiveGig = {
        kind: GIG_KIND.Delivery,
        state: GIG_STATE.Active,
        targetX: drop.x,
        targetY: drop.y,
        reward: ECONOMY_REWARD.GigDelivery,
        deadlineAt: now + DELIVERY_DEADLINE_MS,
        targetId: idx,
        lastSentSec: 90,
      };
      this.active.set(player.id, gig);
      this.sendState(player, gig, now, transport);
      return true;
    }

    if (action === GIG_ACTION.Complete) {
      const gig = this.active.get(player.id);
      if (!gig || gig.state !== GIG_STATE.Active) return false;
      if (now > gig.deadlineAt) {
        this.active.delete(player.id);
        this.sendState(player, undefined, now, transport);
        return false;
      }
      // 追踪悬赏零工如果追踪的是在线玩家，允许实时跟踪其当前位置
      if (gig.kind === GIG_KIND.PatrolAssist && gig.targetId > 0) {
        const suspect = world.get(gig.targetId);
        if (suspect) {
          gig.targetX = suspect.x;
          gig.targetY = suspect.y;
        }
      }
      const dx = gig.targetX - player.x;
      const dy = gig.targetY - player.y;
      if (dx * dx + dy * dy > (COMPLETE_RADIUS_PX + HOTSPOT_SERVER_SLACK * 0.5) ** 2) return false;

      const reason = gig.kind === GIG_KIND.PatrolAssist ? WALLET_REASON.GigPatrol : WALLET_REASON.GigDelivery;
      this.hooks.grantCoins(player, gig.reward, reason);
      gig.state = GIG_STATE.Completed;
      this.sendState(player, gig, now, transport);
      this.hooks.onBroadcastActivity?.(player, ACTIVITY_KIND.GigComplete, now);
      this.active.delete(player.id);
      return true;
    }

    return false;
  }

  /** 按秒刷新零工倒计时与超时清理：Zero-GC */
  tick(world: World, now: number, transport: Transport): void {
    for (const [playerId, gig] of this.active) {
      const player = world.get(playerId);
      if (!player) {
        this.active.delete(playerId);
        continue;
      }
      if (now >= gig.deadlineAt) {
        this.active.delete(playerId);
        this.sendState(player, undefined, now, transport);
        continue;
      }
      const sec = Math.max(0, Math.ceil((gig.deadlineAt - now) / 1000));
      if (sec !== gig.lastSentSec) {
        gig.lastSentSec = sec;
        this.sendState(player, gig, now, transport);
      }
    }
  }
}
