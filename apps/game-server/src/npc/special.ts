import {
  BOSS_VAULT,
  BUFF,
  DEFAULT_APPEARANCE,
  DIRECTION,
  ENTITY_ROLE_BOSS_STEAMROLLER,
  ENTITY_ROLE_CLEANER,
  ENTITY_ROLE_DELIVERY,
  ENTITY_ROLE_GUARD,
  ENTITY_ROLE_MANAGER,
  ENTITY_ROLE_PET,
  ENTITY_ROLE_PROGRAMMER,
  ENTITY_ROLE_ROBO_DOG,
  FALL_KIND,
  GHOST_MODE,
  MOVE_SPEED,
  POSE,
  SECURITY_GARAGE,
  SYSTEM_NOTICE_KIND,
  TICK_MS,
  WALLET_REASON,
  WORLD_CENTER,
  encodeSystemNotice,
  formatSystemNotice,
  resolveMotionInto,
  type CharacterAppearance,
  type MotionTarget,
} from '@niuma/shared-types';
import type { FallsRuntime } from '../sim/falls';
import type { Transport } from '../sim/view';
import type { WantedRuntime } from '../sim/wanted';
import type { Player, World } from '../sim/world';
import type { SpatialGrid } from '../spatial/grid';
import { directionOf } from './brain';

interface PatrolNpc {
  readonly id: number;
  readonly role: number;
  readonly waypoints: ReadonlyArray<readonly [number, number]>;
  readonly speed: number;
  waypointIdx: number;
  pauseUntil: number;
  followTargetId: number;
  followUntil: number;
}

const MOTION: MotionTarget = { x: 0, y: 0 };
const STEP_WAIT_MS = 1_400;

const CLEANER_POINTS: ReadonlyArray<readonly [number, number]> = [
  [4160, 4120],
  [4560, 4096],
  [5040, 3860],
  [4560, 4096],
];

const PROGRAMMER_POINTS: ReadonlyArray<readonly [number, number]> = [
  [3580, 3560],
  [3720, 3560],
  [3720, 3820],
  [3580, 3720],
];

const DELIVERY_POINTS: ReadonlyArray<readonly [number, number]> = [
  [3680, 3680],
  [4096, 3680],
  [4096, 3080],
  [2920, 2980],
  [4096, 3080],
  [4096, 5290],
  [4740, 5290],
  [4096, 4096],
];

const MANAGER_POINTS: ReadonlyArray<readonly [number, number]> = [
  [3720, 3780],
  [3980, 3960],
  [4240, 3960],
  [4240, 4240],
  [3980, 4240],
];

const PET_POINTS: ReadonlyArray<readonly [number, number]> = [
  [4020, 4180],
  [4200, 4180],
  [4280, 3980],
  [3940, 3980],
];

function npcAppearance(
  species: 'cow' | 'horse',
  body: number,
  extra: number,
  headwear: string,
  eyewear: string,
  neckwear: string,
): CharacterAppearance {
  const base = DEFAULT_APPEARANCE[species];
  return {
    species,
    colors: {
      ...base.colors,
      body,
      extra,
      headwear: body,
      neckwear: extra,
    },
    parts: { ...base.parts },
    cosmetics: {
      headwear: headwear as CharacterAppearance['cosmetics']['headwear'],
      eyewear: eyewear as CharacterAppearance['cosmetics']['eyewear'],
      neckwear: neckwear as CharacterAppearance['cosmetics']['neckwear'],
      hairstyle: 'none',
    },
  };
}

export interface SpecialNpcPorts {
  world: World;
  grid: SpatialGrid;
  transport: Transport;
  falls: FallsRuntime;
  wanted: WantedRuntime;
  grantCoins: (player: Player, amount: number, reason: number) => void;
  spendCoins: (player: Player, amount: number, reason: number) => boolean;
}

/**
 * Phase 2-4 趣味交互与通缉特勤 NPC 子系统（Zero-GC）：
 * - 常驻 5 名性格 NPC：清洁阿姨、秃顶熬夜程序员、闪送外卖员、摸鱼查岗经理、赛博流浪柴；
 * - 动态通缉围剿：4★ 召唤 HR 机械杜宾犬、5★ 召唤老板黄金压路机。
 */
export class SpecialNpcRuntime {
  private readonly patrolNpcs: PatrolNpc[] = [];
  private roboDogId = 0;
  private steamrollerId = 0;
  private petBiteCdUntil = 0;
  private roboBiteCdUntil = 0;
  private steamHitCdUntil = 0;
  private readonly tipCdByPlayer = new Map<number, number>();
  private readonly deliveryCdByPlayer = new Map<number, number>();
  private readonly fineCdByPlayer = new Map<number, number>();

  constructor(private readonly ports: SpecialNpcPorts) {}

  spawn(now: number): void {
    if (this.patrolNpcs.length > 0) return;

    this.addPatrol(
      '清洁阿姨',
      npcAppearance('cow', 0xd8ebe4, 0x3b6e8c, 'beret', 'none', 'scarf'),
      ENTITY_ROLE_CLEANER,
      CLEANER_POINTS,
      MOVE_SPEED * 0.65,
      now,
    );
    this.addPatrol(
      '熬夜架构师',
      npcAppearance('cow', 0xbfc7d6, 0x2c4a7c, 'balding_wig', 'round', 'none'),
      ENTITY_ROLE_PROGRAMMER,
      PROGRAMMER_POINTS,
      MOVE_SPEED * 0.55,
      now,
    );
    this.addPatrol(
      '闪送骑士',
      npcAppearance('horse', 0xf6c343, 0x2a3142, 'delivery_helmet', 'cyber_shades', 'scarf'),
      ENTITY_ROLE_DELIVERY,
      DELIVERY_POINTS,
      MOVE_SPEED * 1.15,
      now,
    );
    this.addPatrol(
      '查岗严经理',
      npcAppearance('horse', 0x5c4738, 0x2c4a7c, 'top', 'monocle', 'collar'),
      ENTITY_ROLE_MANAGER,
      MANAGER_POINTS,
      MOVE_SPEED * 0.72,
      now,
    );
    this.addPatrol(
      '赛博小柴',
      npcAppearance('cow', 0xe59c42, 0xc94f3a, 'none', 'none', 'red_scarf'),
      ENTITY_ROLE_PET,
      PET_POINTS,
      MOVE_SPEED * 0.88,
      now,
    );
  }

  private addPatrol(
    name: string,
    appearance: CharacterAppearance,
    role: number,
    waypoints: ReadonlyArray<readonly [number, number]>,
    speed: number,
    now: number,
  ): void {
    const start = waypoints[0]!;
    const npc = this.ports.world.createNpc(name, appearance, start[0], start[1], name, now, undefined, role);
    if (!npc) return;
    npc.applyState(DIRECTION.Down, POSE.Idle, false);
    this.ports.grid.insert(npc.id, npc.x, npc.y);
    this.patrolNpcs.push({
      id: npc.id,
      role,
      waypoints,
      speed,
      waypointIdx: 1 % waypoints.length,
      pauseUntil: now + 800,
      followTargetId: 0,
      followUntil: 0,
    });
  }

  /** 玩家按 Q 打招呼触发趣味 NPC 互动（程序员发小费 / 宠物粘人护主） */
  onWave(actor: Player, now: number): void {
    for (let i = 0; i < this.patrolNpcs.length; i += 1) {
      const entry = this.patrolNpcs[i]!;
      const npc = this.ports.world.get(entry.id);
      if (!npc || npc.incapacitated) continue;
      const dx = npc.x - actor.x;
      const dy = npc.y - actor.y;
      if (dx * dx + dy * dy > 140 * 140) continue;

      npc.applyState(directionOf(actor.x - npc.x, actor.y - npc.y, npc.direction), POSE.Idle, false, false, false, true);
      npc.markDirtyIfChanged();

      if (entry.role === ENTITY_ROLE_PROGRAMMER) {
        const cd = this.tipCdByPlayer.get(actor.id) ?? 0;
        if (now >= cd) {
          this.tipCdByPlayer.set(actor.id, now + 45_000);
          this.ports.grantCoins(actor, 15, WALLET_REASON.NpcReward);
        }
      } else if (entry.role === ENTITY_ROLE_PET) {
        entry.followTargetId = actor.id;
        entry.followUntil = now + 20_000;
      }
    }
  }

  /** 撞倒外卖员掉落拾取补贴 */
  onBumpNpc(attacker: Player, npc: Player, now: number): void {
    if (npc.role !== ENTITY_ROLE_DELIVERY || attacker.isNpc) return;
    const cd = this.deliveryCdByPlayer.get(attacker.id) ?? 0;
    if (now < cd) return;
    this.deliveryCdByPlayer.set(attacker.id, now + 45_000);
    this.ports.grantCoins(attacker, 25, WALLET_REASON.DeliveryDrop);
  }

  private stepToward(npc: Player, tx: number, ty: number, speed: number): boolean {
    const dx = tx - npc.x;
    const dy = ty - npc.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 6) {
      npc.applyState(npc.direction, POSE.Idle, false);
      npc.markDirtyIfChanged();
      return true;
    }
    const step = Math.min(dist, (speed * TICK_MS) / 1000);
    resolveMotionInto(MOTION, npc.x, npc.y, npc.x + (dx / dist) * step, npc.y + (dy / dist) * step);
    npc.x = MOTION.x;
    npc.y = MOTION.y;
    npc.applyState(directionOf(dx, dy, npc.direction), POSE.Walk, true);
    npc.markDirtyIfChanged();
    if (this.ports.grid.update(npc.id, npc.x, npc.y)) npc.needsViewRefresh = true;
    return false;
  }

  private despawnDynamic(id: number): number {
    if (id === 0) return 0;
    const entity = this.ports.world.get(id);
    if (entity) {
      this.ports.grid.remove(id);
      this.ports.world.destroy(id);
    }
    return 0;
  }

  /** 20Hz 更新全部常驻与高星通缉围剿 NPC：Zero-GC */
  tick(now: number): void {
    // 1) 更新常驻 5 名特殊 NPC
    for (let i = 0; i < this.patrolNpcs.length; i += 1) {
      const entry = this.patrolNpcs[i]!;
      const npc = this.ports.world.get(entry.id);
      if (!npc || npc.incapacitated || now < npc.stunUntil) continue;

      if (entry.followTargetId > 0 && now < entry.followUntil) {
        const owner = this.ports.world.get(entry.followTargetId);
        if (owner && owner.wsId !== 0) {
          const dist = Math.hypot(owner.x - npc.x, owner.y - npc.y);
          if (dist > 46) this.stepToward(npc, owner.x, owner.y, entry.speed * 1.15);
        } else {
          entry.followTargetId = 0;
        }
      } else {
        entry.followTargetId = 0;
        if (now >= entry.pauseUntil) {
          const wp = entry.waypoints[entry.waypointIdx]!;
          if (this.stepToward(npc, wp[0], wp[1], entry.speed)) {
            entry.waypointIdx = (entry.waypointIdx + 1) % entry.waypoints.length;
            entry.pauseUntil = now + STEP_WAIT_MS;
          }
        }
      }

      // 赛博流浪狗/猫护主：发现 88px 内有追击警员立刻一口咬住保安小腿震晕 3 秒！
      if (entry.role === ENTITY_ROLE_PET && now >= this.petBiteCdUntil) {
        for (const other of this.ports.world.players.values()) {
          if (!other.isNpc || other.role !== ENTITY_ROLE_GUARD || other.incapacitated || now < other.panStunUntil) continue;
          const dx = other.x - npc.x;
          const dy = other.y - npc.y;
          if (dx * dx + dy * dy <= 88 * 88) {
            this.petBiteCdUntil = now + 12_000;
            other.panStunUntil = now + 3_000;
            other.stunUntil = now + 3_000;
            other.applyState(other.direction, POSE.Lie, false);
            other.markDirtyIfChanged();
            break;
          }
        }
      }

      // 查岗经理抓包发呆摸鱼玩家（藏纸箱/隐身/入座工位可免疫！）
      if (entry.role === ENTITY_ROLE_MANAGER) {
        for (const target of this.ports.world.players.values()) {
          if (target.isNpc || target.wsId === 0 || target.seat !== 0 || target.vehicleId > 0 || target.incapacitated) continue;
          if ((target.activeBuffs.get(BUFF.Box) ?? 0) > now || (target.activeBuffs.get(BUFF.Stealth) ?? 0) > now) continue;
          if (now - target.lastMoveAt < 18_000) continue;
          const fineCd = this.fineCdByPlayer.get(target.id) ?? 0;
          if (now < fineCd) continue;
          const dx = target.x - npc.x;
          const dy = target.y - npc.y;
          if (dx * dx + dy * dy > 84 * 84) continue;
          this.fineCdByPlayer.set(target.id, now + 90_000);
          if (this.ports.spendCoins(target, 15, WALLET_REASON.ManagerFine)) {
            const msg = formatSystemNotice(SYSTEM_NOTICE_KIND.ManagerFine, { name: target.name });
            if (msg) {
              this.ports.transport.send(
                target.wsId,
                encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.ManagerFine, entityId: target.id, text: msg }),
              );
            }
          }
          break;
        }
      }
    }

    // 2) 高通缉专属特勤：4★ HR 机械杜宾犬 & 5★ 老板黄金压路机
    const topWanted = this.ports.wanted.highestWanted(this.ports.world);
    const maxStars = topWanted?.wantedStars ?? 0;

    if (maxStars >= 4 && topWanted && topWanted.ghostMode === GHOST_MODE.Alive) {
      if (this.roboDogId === 0) {
        const dog = this.ports.world.createNpc(
          'HR机械杜宾',
          npcAppearance('horse', 0x2a3142, 0xe84855, 'helmet', 'cyber_shades', 'collar'),
          SECURITY_GARAGE.hotspot.x,
          SECURITY_GARAGE.hotspot.y,
          '4★追缉中',
          now,
          undefined,
          ENTITY_ROLE_ROBO_DOG,
        );
        if (dog) {
          this.roboDogId = dog.id;
          this.ports.grid.insert(dog.id, dog.x, dog.y);
        }
      }
      const dog = this.roboDogId > 0 ? this.ports.world.get(this.roboDogId) : undefined;
      if (dog && !dog.incapacitated) {
        this.stepToward(dog, topWanted.x, topWanted.y, MOVE_SPEED * 1.32);
        const dx = topWanted.x - dog.x;
        const dy = topWanted.y - dog.y;
        if (dx * dx + dy * dy <= 30 * 30 && now >= this.roboBiteCdUntil) {
          this.roboBiteCdUntil = now + 8_000;
          this.ports.falls.triggerFall(topWanted, FALL_KIND.Tumble, 1_800, now, this.ports.world, this.ports.transport);
        }
      }
    } else if (this.roboDogId !== 0) {
      this.roboDogId = this.despawnDynamic(this.roboDogId);
    }

    if (maxStars >= 5 && topWanted && topWanted.ghostMode === GHOST_MODE.Alive) {
      if (this.steamrollerId === 0) {
        const boss = this.ports.world.createNpc(
          '老板压路机',
          npcAppearance('cow', 0xf3c64f, 0xff5a36, 'crown', 'gold_rim_glasses', 'gold_chain'),
          BOSS_VAULT.hotspot.x || WORLD_CENTER.x,
          BOSS_VAULT.hotspot.y || WORLD_CENTER.y,
          '5★最高通缉',
          now,
          undefined,
          ENTITY_ROLE_BOSS_STEAMROLLER,
        );
        if (boss) {
          this.steamrollerId = boss.id;
          this.ports.grid.insert(boss.id, boss.x, boss.y);
        }
      }
      const roller = this.steamrollerId > 0 ? this.ports.world.get(this.steamrollerId) : undefined;
      if (roller && !roller.incapacitated) {
        this.stepToward(roller, topWanted.x, topWanted.y, MOVE_SPEED * 1.4);
        const dx = topWanted.x - roller.x;
        const dy = topWanted.y - roller.y;
        if (dx * dx + dy * dy <= 36 * 36 && now >= this.steamHitCdUntil) {
          this.steamHitCdUntil = now + 10_000;
          this.ports.falls.triggerFall(topWanted, FALL_KIND.Tornado, 2_200, now, this.ports.world, this.ports.transport);
        }
      }
    } else if (this.steamrollerId !== 0) {
      this.steamrollerId = this.despawnDynamic(this.steamrollerId);
    }
  }
}
