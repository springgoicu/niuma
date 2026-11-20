import {
  DIRECTION,
  GHOST_MODE,
  POSE,
  VEHICLE_ACTION,
  VEHICLE_BOOST_COOLDOWN_MS,
  VEHICLE_BOOST_DURATION_MS,
  VEHICLE_ENTER_RANGE,
  VEHICLE_FLAG_BOOST,
  VEHICLE_FLAG_HORN,
  VEHICLE_FLAG_SIREN,
  VEHICLE_HORN_COOLDOWN_MS,
  VEHICLE_KIND,
  VEHICLE_SPAWNS,
  VEHICLE_SPECS,
  clampWorldX,
  clampWorldY,
  directionFromVector,
  encodeVehicleState,
  isWaterAt,
  resolveMotionInto,
  type MotionTarget,
  type SeatStateEntry,
  type VehicleSnapshot,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { SeatRegistry } from './seats';
import type { Transport } from './view';
import type { Player, World } from './world';

interface VehicleEntity {
  readonly vehicleId: number;
  readonly kind: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly spawnDir: number;
  driverId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: number;
  flags: number;
  boostUntil: number;
  boostCdUntil: number;
  hornUntil: number;
  hornCdUntil: number;
  lastTouchedAt: number;
  lastSentQx: number;
  lastSentQy: number;
  lastSentDriver: number;
  lastSentFlags: number;
}

const MOTION: MotionTarget = { x: 0, y: 0 };
const NEAR_SCRATCH = new Set<number>();
const SEAT_RELEASED: SeatStateEntry[] = [];
const IDLE_RESPAWN_MS = 120_000;
const BUMP_COOLDOWN_MS = 1_800;

export interface VehicleBumpHooks {
  onBumpPedestrian?: (driver: Player, victim: Player, speed: number, now: number) => void;
  onExitSeat?: (entries: SeatStateEntry[]) => void;
}

/**
 * 16 辆全岛共享载具权威物理引擎（20Hz Zero-GC）：
 * - 共享电驴 / 黄漆叉车 / 保安电动巡逻车 / 老板敞篷跑车；
 * - 漂移惯性加减速 + 贴墙滑动 + 水面保护；
 * - 高速冲撞路人自动触发搞笑摔倒 + 警星通缉。
 */
export class VehicleRuntime {
  private readonly list: VehicleEntity[];
  private readonly byId = new Map<number, VehicleEntity>();
  private readonly snapshots: VehicleSnapshot[];
  private readonly bumpCdByPair = new Map<number, number>();
  private stateDirty = false;
  private lastBroadcastAt = 0;

  constructor(private readonly hooks: VehicleBumpHooks = {}) {
    this.list = VEHICLE_SPAWNS.map((s) => ({
      vehicleId: s.vehicleId,
      kind: s.kind,
      spawnX: s.x,
      spawnY: s.y,
      spawnDir: s.dir,
      driverId: 0,
      x: s.x,
      y: s.y,
      vx: 0,
      vy: 0,
      dir: s.dir,
      flags: s.kind === VEHICLE_KIND.PatrolCart ? VEHICLE_FLAG_SIREN : 0,
      boostUntil: 0,
      boostCdUntil: 0,
      hornUntil: 0,
      hornCdUntil: 0,
      lastTouchedAt: 0,
      lastSentQx: Math.round(s.x),
      lastSentQy: Math.round(s.y),
      lastSentDriver: 0,
      lastSentFlags: s.kind === VEHICLE_KIND.PatrolCart ? VEHICLE_FLAG_SIREN : 0,
    }));
    for (const v of this.list) this.byId.set(v.vehicleId, v);
    this.snapshots = this.list.map((v) => ({
      vehicleId: v.vehicleId,
      kind: v.kind,
      driverId: v.driverId,
      x: v.x,
      y: v.y,
      vx: 0,
      vy: 0,
      dir: v.dir,
      flags: v.flags,
    }));
  }

  getVehicle(id: number): VehicleEntity | undefined {
    return this.byId.get(id);
  }

  buildFullPacket(): Uint8Array {
    for (let i = 0; i < this.list.length; i += 1) {
      const v = this.list[i]!;
      const snap = this.snapshots[i]!;
      snap.driverId = v.driverId;
      snap.x = v.x;
      snap.y = v.y;
      snap.vx = Math.round(v.vx);
      snap.vy = Math.round(v.vy);
      snap.dir = v.dir;
      snap.flags = v.flags;
    }
    return encodeVehicleState({ vehicles: this.snapshots });
  }

  private broadcastAll(world: World, transport: Transport): void {
    const pkt = this.buildFullPacket();
    for (const p of world.players.values()) {
      if (p.wsId !== 0) transport.send(p.wsId, pkt);
    }
    for (let i = 0; i < this.list.length; i += 1) {
      const v = this.list[i]!;
      v.lastSentQx = Math.round(v.x);
      v.lastSentQy = Math.round(v.y);
      v.lastSentDriver = v.driverId;
      v.lastSentFlags = v.flags;
    }
    this.stateDirty = false;
  }

  ejectDriver(player: Player, now: number, world?: World, transport?: Transport): boolean {
    if (player.vehicleId === 0) return false;
    const v = this.byId.get(player.vehicleId);
    player.vehicleId = 0;
    if (v && v.driverId === player.id) {
      v.driverId = 0;
      v.lastTouchedAt = now;
      v.boostUntil = 0;
      v.flags &= ~VEHICLE_FLAG_BOOST;
      this.stateDirty = true;
    }
    // 找一个离车身侧面最近的空地落脚
    resolveMotionInto(MOTION, v ? v.x : player.x, v ? v.y : player.y, (v ? v.x : player.x) + 22, (v ? v.y : player.y) + 18);
    player.x = MOTION.x;
    player.y = MOTION.y;
    player.applyState(player.direction, POSE.Idle, false);
    player.markDirtyIfChanged();
    if (world && transport) this.broadcastAll(world, transport);
    return true;
  }

  handleAction(
    player: Player,
    action: number,
    vehicleId: number,
    now: number,
    world: World,
    transport: Transport,
    seats?: SeatRegistry,
  ): boolean {
    if (player.isNpc) return false;

    if (action === VEHICLE_ACTION.Exit) {
      if (player.vehicleId === 0) return false;
      return this.ejectDriver(player, now, world, transport);
    }

    if (action === VEHICLE_ACTION.Enter) {
      if (
        player.incapacitated ||
        player.ghostMode !== GHOST_MODE.Alive ||
        now < player.fallUntil ||
        player.vehicleId !== 0 ||
        player.roomId !== 0
      ) {
        return false;
      }
      const target =
        vehicleId > 0
          ? this.byId.get(vehicleId)
          : this.findNearestFree(player.x, player.y);
      if (!target || target.driverId !== 0) return false;
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      if (dx * dx + dy * dy > VEHICLE_ENTER_RANGE * VEHICLE_ENTER_RANGE) return false;

      if (player.seat !== 0 && seats) {
        SEAT_RELEASED.length = 0;
        seats.stand(player, SEAT_RELEASED);
        if (SEAT_RELEASED.length > 0) this.hooks.onExitSeat?.(SEAT_RELEASED);
      }

      target.driverId = player.id;
      target.lastTouchedAt = now;
      player.vehicleId = target.vehicleId;
      player.x = target.x;
      player.y = target.y;
      player.driveTargetX = target.x;
      player.driveTargetY = target.y;
      player.driveTargetAt = now;
      player.fishingState = 0;
      player.applyState(target.dir as 0 | 1 | 2 | 3, POSE.Sit, false);
      player.markDirtyIfChanged();
      this.broadcastAll(world, transport);
      return true;
    }

    if (player.vehicleId === 0) return false;
    const v = this.byId.get(player.vehicleId);
    if (!v || v.driverId !== player.id) return false;

    if (action === VEHICLE_ACTION.Horn) {
      if (now < v.hornCdUntil) return false;
      v.hornUntil = now + 420;
      v.hornCdUntil = now + VEHICLE_HORN_COOLDOWN_MS;
      v.flags |= VEHICLE_FLAG_HORN;
      this.broadcastAll(world, transport);
      return true;
    }

    if (action === VEHICLE_ACTION.Boost) {
      if (now < v.boostCdUntil) return false;
      v.boostUntil = now + VEHICLE_BOOST_DURATION_MS;
      v.boostCdUntil = now + VEHICLE_BOOST_COOLDOWN_MS;
      v.flags |= VEHICLE_FLAG_BOOST;
      this.broadcastAll(world, transport);
      return true;
    }

    return false;
  }

  private findNearestFree(x: number, y: number): VehicleEntity | undefined {
    let best: VehicleEntity | undefined;
    let bestD2 = VEHICLE_ENTER_RANGE * VEHICLE_ENTER_RANGE;
    for (let i = 0; i < this.list.length; i += 1) {
      const v = this.list[i]!;
      if (v.driverId !== 0) continue;
      const dx = v.x - x;
      const dy = v.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    return best;
  }

  /** 20Hz 载具动力学积分 + 碰撞路人：Zero-GC */
  tick(dtMs: number, now: number, world: World, grid: SpatialGrid, transport: Transport): void {
    const dt = Math.min(0.1, Math.max(0.01, dtMs / 1000));
    let anyChanged = this.stateDirty;

    for (let i = 0; i < this.list.length; i += 1) {
      const v = this.list[i]!;
      const spec = VEHICLE_SPECS[v.kind]!;

      if (v.hornUntil > 0 && now >= v.hornUntil) {
        v.hornUntil = 0;
        v.flags &= ~VEHICLE_FLAG_HORN;
        anyChanged = true;
      }
      if (v.boostUntil > 0 && now >= v.boostUntil) {
        v.boostUntil = 0;
        v.flags &= ~VEHICLE_FLAG_BOOST;
        anyChanged = true;
      }

      const driver = v.driverId > 0 ? world.get(v.driverId) : undefined;
      if (v.driverId > 0 && (!driver || driver.incapacitated || driver.ghostMode !== GHOST_MODE.Alive)) {
        if (driver) driver.vehicleId = 0;
        v.driverId = 0;
        v.lastTouchedAt = now;
        v.flags &= ~VEHICLE_FLAG_BOOST;
        anyChanged = true;
      }

      if (driver && v.driverId === driver.id) {
        const steering = now - driver.driveTargetAt < 450;
        const dx = steering ? driver.driveTargetX - v.x : 0;
        const dy = steering ? driver.driveTargetY - v.y : 0;
        const dist = Math.hypot(dx, dy);
        if (steering && dist > 6) {
          const boost = v.boostUntil > now;
          const cap = boost ? spec.boostSpeed : spec.maxSpeed;
          const ax = (dx / dist) * spec.accel * (boost ? 1.35 : 1);
          const ay = (dy / dist) * spec.accel * (boost ? 1.35 : 1);
          v.vx += ax * dt;
          v.vy += ay * dt;
          const speed = Math.hypot(v.vx, v.vy);
          if (speed > cap) {
            v.vx = (v.vx / speed) * cap;
            v.vy = (v.vy / speed) * cap;
          }
          v.dir = directionFromVector(v.vx, v.vy, v.dir as 0 | 1 | 2 | 3);
        } else {
          const damp = Math.max(0, 1 - spec.friction * dt);
          v.vx *= damp;
          v.vy *= damp;
          if (Math.hypot(v.vx, v.vy) < 8) {
            v.vx = 0;
            v.vy = 0;
          }
        }
      } else {
        // 无人驾驶惯性滑行 + 超时归位
        if (v.vx !== 0 || v.vy !== 0) {
          const damp = Math.max(0, 1 - spec.friction * 1.4 * dt);
          v.vx *= damp;
          v.vy *= damp;
          if (Math.hypot(v.vx, v.vy) < 8) {
            v.vx = 0;
            v.vy = 0;
          }
        } else if (
          v.lastTouchedAt > 0 &&
          now - v.lastTouchedAt >= IDLE_RESPAWN_MS &&
          (Math.abs(v.x - v.spawnX) > 36 || Math.abs(v.y - v.spawnY) > 36)
        ) {
          v.x = v.spawnX;
          v.y = v.spawnY;
          v.dir = v.spawnDir;
          v.lastTouchedAt = 0;
          anyChanged = true;
        }
      }

      if (v.vx !== 0 || v.vy !== 0) {
        const nextX = clampWorldX(v.x + v.vx * dt);
        const nextY = clampWorldY(v.y + v.vy * dt);
        resolveMotionInto(MOTION, v.x, v.y, nextX, nextY, spec.radius);
        // 车辆不下水（只在陆地路面/草坪跑，跌水边缘沿岸阻挡）
        if (!isWaterAt(MOTION.x, MOTION.y)) {
          if (Math.abs(MOTION.x - v.x) < 0.05 && Math.abs(v.vx) > 20) v.vx = 0;
          if (Math.abs(MOTION.y - v.y) < 0.05 && Math.abs(v.vy) > 20) v.vy = 0;
          v.x = MOTION.x;
          v.y = MOTION.y;
        } else {
          v.vx = 0;
          v.vy = 0;
        }

        if (driver && v.driverId === driver.id) {
          driver.x = v.x;
          driver.y = v.y;
          driver.applyState(v.dir as 0 | 1 | 2 | 3, POSE.Sit, false);
          driver.markDirtyIfChanged();
          if (grid.update(driver.id, driver.x, driver.y)) driver.needsViewRefresh = true;

          const speed = Math.hypot(v.vx, v.vy);
          if (speed >= 150 && this.hooks.onBumpPedestrian) {
            if (this.bumpCdByPair.size > 256) this.bumpCdByPair.clear();
            NEAR_SCRATCH.clear();
            grid.queryNear(v.x, v.y, spec.radius + 14, NEAR_SCRATCH);
            for (const otherId of NEAR_SCRATCH) {
              if (otherId === driver.id) continue;
              const victim = world.get(otherId);
              if (!victim || victim.vehicleId > 0 || victim.incapacitated || victim.ghostMode !== GHOST_MODE.Alive) continue;
              if (now < victim.fallUntil || now < victim.immunityUntilMs) continue;
              const dx = victim.x - v.x;
              const dy = victim.y - v.y;
              if (dx * dx + dy * dy > (spec.radius + 10) * (spec.radius + 10)) continue;
              const pairKey = (v.vehicleId << 12) | victim.id;
              const cdUntil = this.bumpCdByPair.get(pairKey) ?? 0;
              if (now < cdUntil) continue;
              this.bumpCdByPair.set(pairKey, now + BUMP_COOLDOWN_MS);
              this.hooks.onBumpPedestrian(driver, victim, speed, now);
            }
          }
        }
      }

      if (
        Math.round(v.x) !== v.lastSentQx ||
        Math.round(v.y) !== v.lastSentQy ||
        v.driverId !== v.lastSentDriver ||
        v.flags !== v.lastSentFlags
      ) {
        anyChanged = true;
      }
    }

    if (anyChanged && now - this.lastBroadcastAt >= 48) {
      this.lastBroadcastAt = now;
      this.broadcastAll(world, transport);
    }
  }
}
