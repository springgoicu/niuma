import {
  BOSS,
  BOSS_SHOCK,
  BOSS_SHOCK_PHASE,
  POSE,
  encodeBossShock,
  resolveMotionInto,
  type MotionTarget,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { Transport } from './view';
import type { World } from './world';

const MOTION: MotionTarget = { x: 0, y: 0 };

/**
 * 画饼冲击波（ADR-0088）。
 *
 * 老板血量每降 25% 触发一次：先全服广播 2 秒红色预警圈，让站在圈里的人有时间按 Space；
 * 预警到期的那一帧才结算——圈内没跳起来的人被震退并躺地 1.5 秒。
 *
 * 三个约束：
 * - 预警只向前推进一次，同一帧不会因为多次命中叠出两层圈（`armed` 期间直接忽略）；
 * - 判定放在服务端：客户端上报的跳跃位只表达「我在跳」，免疫与否由这里裁决；
 * - 走与移动相同的碰撞求解器，撞墙时自然衰减，不会把人推进墙里。
 */
export class BossShockRuntime {
  /** 预警到期时刻；0 表示当前没有预警 */
  private warnUntil = 0;
  // 圈心取老板躯干中心而不是脚底线：`BOSS.y` 是脚底，直接用它会让圆圈整体偏上
  private centerX = BOSS.x;
  private centerY = BOSS.y - BOSS.height / 2;

  constructor(
    private readonly world: World,
    private readonly transport: Transport,
    private readonly grid: SpatialGrid,
  ) {}

  get armed(): boolean {
    return this.warnUntil > 0;
  }

  /** 预警：广播一次 2 秒红色圈；已在预警中的重复触发直接忽略 */
  arm(now: number): void {
    if (this.warnUntil > 0) return;
    this.warnUntil = now + BOSS_SHOCK.WarnMs;
    this.broadcast(BOSS_SHOCK_PHASE.Warn, BOSS_SHOCK.WarnMs, 0);
  }

  /** Tick：只在预警到期那一帧结算一次 */
  tick(now: number): void {
    if (this.warnUntil === 0 || now < this.warnUntil) return;
    this.warnUntil = 0;
    const hits = this.resolve(now);
    this.broadcast(BOSS_SHOCK_PHASE.Hit, 0, hits);
  }

  private resolve(now: number): number {
    let hits = 0;
    const radiusSq = BOSS_SHOCK.Radius * BOSS_SHOCK.Radius;
    for (const player of this.world.players.values()) {
      // NPC 只是氛围：没有钱包也没有 HUD，被震趴只会在玩家眼前凭空倒一片
      if (player.isNpc) continue;
      const dx = player.x - this.centerX;
      const dy = player.y - this.centerY;
      if (dx * dx + dy * dy > radiusSq) continue;
      // 已经躺着的、昏迷的、治疗中的不再重复结算
      if (now < player.stunUntil || player.incapacitated) continue;
      // Space 跳起即免疫：跳跃位由移动包整帧保持，所以直接读当前位
      if (player.jump || now < player.jumpUntilMs) continue;
      const length = Math.hypot(dx, dy);
      // 站在圆心时给一个默认方向，避免除零把人钉在原地
      const nx = length > 1 ? dx / length : 0;
      const ny = length > 1 ? dy / length : 1;
      resolveMotionInto(
        MOTION,
        player.x,
        player.y,
        player.x + nx * BOSS_SHOCK.KnockbackPx,
        player.y + ny * BOSS_SHOCK.KnockbackPx,
      );
      player.x = MOTION.x;
      player.y = MOTION.y;
      player.applyState(player.direction, POSE.Lie, false);
      player.stunUntil = now + BOSS_SHOCK.StunMs;
      player.dirty = true;
      if (this.grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      hits += 1;
    }
    return hits;
  }

  /** 全服广播：冲击波是园区共享事件，不走 AOI */
  private broadcast(phase: number, remainingMs: number, hits: number): void {
    const packet = encodeBossShock({
      phase,
      x: this.centerX,
      y: this.centerY,
      radius: BOSS_SHOCK.Radius,
      remainingMs,
      hits,
    });
    for (const player of this.world.players.values()) {
      if (player.wsId === 0) continue;
      this.transport.send(player.wsId, packet);
    }
  }
}
