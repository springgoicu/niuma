import {
  FALL_KIND,
  POSE,
  encodeFallEvent,
} from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

/**
 * 搞笑物理摔倒系统（水洼滑跤 / 香蕉翻滚 / 老板龙卷风）：
 * 仅做瞬时硬直控制与动作广播，Tick 热路径零堆分配。
 */
export class FallsRuntime {
  triggerFall(
    target: Player,
    kind: number,
    durationMs: number,
    now: number,
    world: World,
    transport: Transport,
  ): void {
    const dur = Math.max(400, Math.min(8_000, Math.floor(durationMs)));
    target.fallKind = kind;
    target.fallUntil = now + dur;
    target.applyState(target.direction, POSE.Lie, false);
    target.markDirtyIfChanged();

    const pkt = encodeFallEvent({
      kind,
      targetId: target.id,
      durationMs: dur,
    });
    if (target.wsId !== 0) transport.send(target.wsId, pkt);
    for (const id of target.known) {
      const other = world.get(id);
      if (other && other.wsId !== 0) transport.send(other.wsId, pkt);
    }
  }

  /** 是否正处于搞笑摔倒硬直中 */
  isFallen(player: Player, now: number): boolean {
    return player.fallUntil > now;
  }

  /** 20Hz 清理已到期的摔倒标志：Zero-GC */
  tick(world: World, now: number): void {
    for (const player of world.players.values()) {
      if (player.fallUntil > 0 && now >= player.fallUntil) {
        player.fallUntil = 0;
        player.fallKind = FALL_KIND.Slip;
        if (!player.incapacitated && player.ghostMode === 0) {
          player.applyState(player.direction, POSE.Idle, false);
          player.markDirtyIfChanged();
        }
      }
    }
  }
}
