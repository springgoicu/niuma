import {
  P2P_DUEL_KNOCKBACK_PX,
  PLAYER_EFFECT,
  POSE,
  RING_VENT_FLAG_ELIMINATED,
  RING_VENT_FLAG_HIT,
  VENT_FACING,
  VENT_KNOCKBACK_PX,
  VENT_STUN_MS,
  bossHitPoint,
  clampToRing,
  effectiveVentCooldownMs,
  encodeVent,
  quantizeCoord,
  resolveMotionInto,
  withinVentCone,
  type MotionTarget,
} from '@niuma/shared-types';
import { consumeShield } from './buffs';
import { broadcastBoss } from './boss';
import { broadcastPlayerEffect } from './effects';
import { broadcastRing } from './ring';
import type { SpatialGrid } from '../spatial/grid';
import type { DuelCombatPort } from '../challenge/types';
import type { Player, World } from './world';
import type { Transport } from './view';

/**
 * 发泄的权威结算（ADR-0051 / ADR-0065）。
 *
 * 三件事，顺序不能反：
 * 1) **只消费边沿**：客户端把 vent 位保持一整个播放窗口（440ms），逐 Tick 结算会连打九次；
 *    `ventPending` 由 `Player.applyState` 在 0→1 时置位，这里消费一次就清掉。
 * 2) **在 Tick 的 dirty 广播之前跑**：受害者的新坐标与躺姿必须在同一个 Tick 里发出去，
 *    晚一个 Tick（50ms）就会让旁观者看到「人先站着、下一帧才倒」。
 * 3) **命中只认服务端几何**：客户端只上报「我在出招」，打没打到、打到谁全由这里决定。
 *
 * 入座的人不会被创飞（ADR-0065）：办公、睡觉、蹲马桶等任何坐着的人都不击退、
 * 不倒地；他若是扇形内最近的人，整次出招按空放结算。
 *
 * 稳态成本：每个玩家一次布尔判断；只有真正出招的人才会扫一遍自己的 AOI 集合。
 */
const MOTION: MotionTarget = { x: 0, y: 0 };

/**
 * 命中观察者：只上报「擂台外的玩家命中」，要不要警告 / 派单由实现方决定。
 *
 * 端口定义在命中结算这一侧，而不是反过来导入 `sim/detention`：
 * 这一层只回答「打没打到、打到谁」，执法策略留在执法模块里。
 */
export interface VentHitObserver {
  /** 场外玩家命中：执法警告 / 派单的入口 */
  onVentHit?(attacker: Player, target: Player, now: number): void;
  /** 场外击倒结算之后：经济发币挂在这里，一倒一次 */
  onKnockdown?(attacker: Player, target: Player, now: number): void;
  /** 老板被最后一击打倒：一局一次，由 `justDied` 保证幂等 */
  onBossKill?(attacker: Player, now: number): void;
}

/**
 * 结算本 Tick 的所有发泄。
 *
 * 空放（前方扇形内没人，或最近的人正坐在座位上）同样会广播一条 `targetId = 0`
 * 的事件包：破空音与「退！退！退！」的台词需要附近每个人都能独立播放。
 */
export function resolveVents(
  world: World,
  grid: SpatialGrid,
  transport: Transport,
  now: number,
  observer?: VentHitObserver,
  duel?: DuelCombatPort,
): void {
  for (const attacker of world.players.values()) {
    if (!attacker.ventPending) continue;
    // 边沿标记只活一次，无论这一下打没打到、有没有被限频吃掉
    attacker.ventPending = false;
    if (!attacker.vent) continue;
    // 自己躺在地上 / 昏迷被拖走时出不了招
    if (now < attacker.stunUntil || attacker.incapacitated) continue;
    // 限频：冷却 = 攻速等级 × Buff 乘子（冰美式打七折，ADR-0085）
    if (now - attacker.lastVentAt < effectiveVentCooldownMs(attacker.stats.atkSpeedLv, attacker.ventCdMul)) {
      continue;
    }
    attacker.lastVentAt = now;

    const attackerInRing = world.ring.has(attacker.id);
    // 颁奖阶段参赛者被冻结；擂台内的出招只在 running 阶段生效
    if (attackerInRing && !world.ring.isRunning()) continue;

    const target = nearestInCone(world, attacker, now, attackerInRing, duel);
    if (!target) {
      broadcastVent(world, attacker, 0, 0, 0, transport);
      // 擂台内没有对手就空放，绝不把拳风穿到老板或场外；
      // 场外只有「扇形内没有可命中玩家」才轮到老板。
      if (!attackerInRing && !duel?.isDueling(attacker)) {
        resolveBossHit(world, attacker, now, transport, observer);
      }
      continue;
    }

    // 入座即免伤：办公 / 睡觉 / 蹲马桶等任何坐着的人都不击退、不倒地，
    // 也不穿透去打击他身后的人——这一下按空放处理。
    if (target.seat !== 0) {
      broadcastVent(world, attacker, 0, 0, 0, transport);
      continue;
    }

    // 工伤保护 / 昏迷中的伤员同样是「免伤挡板」：不击退、不硬直、不计数。
    // 这一下按空放处理，既不穿透打身后的人，也不会把治疗中的玩家再次创飞。
    if (target.incapacitated || now < target.immunityUntilMs) {
      broadcastVent(world, attacker, 0, 0, 0, transport);
      continue;
    }

    const facing = VENT_FACING[attacker.direction] ?? VENT_FACING[0]!;

    // 野外切磋是独立战斗域：只打对手、不倒地、不进执法统计，击退距离也更大
    if (duel?.isDueling(attacker)) {
      const resolution = duel.hit(attacker, target, now);
      if (resolution) {
        if (!resolution.hit) {
          // 对方处于 Space 跳跃无敌帧：这一下按空放处理
          broadcastVent(world, attacker, 0, 0, 0, transport);
          continue;
        }
        resolveMotionInto(
          MOTION,
          target.x,
          target.y,
          target.x + facing.x * P2P_DUEL_KNOCKBACK_PX,
          target.y + facing.y * P2P_DUEL_KNOCKBACK_PX,
        );
        target.x = MOTION.x;
        target.y = MOTION.y;
        target.dirty = true;
        if (grid.update(target.id, target.x, target.y)) target.needsViewRefresh = true;
        broadcastVent(world, attacker, target.id, target.x, target.y, transport);
        continue;
      }
    }

    const ringHit = attackerInRing && world.ring.has(target.id);
    let flags = 0;
    let eliminated = false;
    if (ringHit) {
      const hit = world.ring.applyHit(attacker, target, now);
      if (!hit) continue;
      flags |= RING_VENT_FLAG_HIT;
      eliminated = hit.eliminated;
      if (eliminated) flags |= RING_VENT_FLAG_ELIMINATED;
    }

    // 摸鱼护盾只在擂台外生效：场内是独立战斗域，不能被道具打乱血量裁决。
    // 判定必须排在击退之前——「抵消撞飞」意味着连那 32px 位移也不该发生。
    const shielded = !ringHit && consumeShield(target, now);
    if (shielded) {
      // 挡下的这一下仍然要广播：目标与旁观者都要看到护盾碎裂，而不是「打了没反应」
      broadcastPlayerEffect(world, transport, {
        effect: PLAYER_EFFECT.Shield,
        sourceId: attacker.id,
        targetId: target.id,
        durationMs: 0,
        blocked: true,
      });
    } else {
      // 击退走与移动完全相同的碰撞求解器：撞墙时自然衰减，绝不会把人推进墙里
      resolveMotionInto(
        MOTION,
        target.x,
        target.y,
        target.x + facing.x * VENT_KNOCKBACK_PX,
        target.y + facing.y * VENT_KNOCKBACK_PX,
      );
      target.x = MOTION.x;
      target.y = MOTION.y;
      if (ringHit) {
        const clamped = clampToRing(target.x, target.y);
        target.x = clamped.x;
        target.y = clamped.y;
      }
      // 强制倒地：姿态由服务端写死，客户端的上报在硬直期内一律不被采信（见 applyMove）
      target.applyState(target.direction, POSE.Lie, false);
      // 淘汰者躺到本局结算，避免倒地后站起来又参与移动 / 出招；
      // 结算可能因冠军已定而提前（ADR-0076），所以取 endsAt 而不是写死 120 秒
      target.stunUntil = eliminated
        ? Math.max(now + VENT_STUN_MS, world.ring.endsAt)
        : now + VENT_STUN_MS;
    }
    target.dirty = true;
    if (grid.update(target.id, target.x, target.y)) target.needsViewRefresh = true;

    broadcastVent(world, attacker, target.id, target.x, target.y, transport, flags);
    if (ringHit) broadcastRing(world, transport, now);
    // 擂台是独立战斗域（ADR-0073）：场内命中只结算血量，不进执法统计
    else {
      observer?.onVentHit?.(attacker, target, now);
      if (!shielded) observer?.onKnockdown?.(attacker, target, now);
    }
  }
}

/**
 * 老板受击：把「踢向肚子」折算成受击矩形上最近的一点，再复用同一把扇形尺子。
 *
 * 这样正面、侧面都能踢到，距离太远或背对则打不到；老板归零后继续出招只保留
 * 发泄动作，不再产生血包（客户端也不再看到「-1」）。
 */
function resolveBossHit(
  world: World,
  attacker: Player,
  now: number,
  transport: Transport,
  observer?: VentHitObserver,
): void {
  const hit = bossHitPoint(attacker.x, attacker.y);
  if (!withinVentCone(attacker.x, attacker.y, attacker.direction, hit.x, hit.y)) return;
  const result = world.boss.hit(attacker.id, now);
  if (!result) return;
  broadcastBoss(world, transport, {
    hp: result.hp,
    attackerId: result.attackerId,
    died: result.justDied,
    reset: false,
  });
  // 只有最后一击带 justDied：一局最多发一次老板倒下奖励
  if (result.justDied) observer?.onBossKill?.(attacker, now);
}

/**
 * 前方扇形内距离最近的玩家；已经倒地的人跳过，免得一脚把人永久锁在地上。
 *
 * 入座的人**不跳过**：他被选中后由调用方判空放，所以坐着的人能挡住身后的人。
 */
function nearestInCone(
  world: World,
  attacker: Player,
  now: number,
  attackerInRing: boolean,
  duel?: DuelCombatPort,
): Player | null {
  let best: Player | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  // 切磋中只允许命中约定对手：路人站在扇形里也不会被误伤
  const opponent = duel?.isDueling(attacker) ? duel.opponentOf(attacker) : null;
  // player.known 就是对称 AOI 集合（已排除自己）：与咀嚼广播同一份可见性口径
  for (const id of attacker.known) {
    const candidate = world.get(id);
    if (!candidate) continue;
    if (opponent && candidate.id !== opponent.id) continue;
    // 切磋中的双方不被场外路人打断：只有对手能命中
    if (!opponent && duel?.isDueling(candidate)) continue;
    if (now < candidate.stunUntil) continue;
    // 擂台是独立战斗域：场内只打场内，场外只打场外，围绳两边互不穿透
    if (world.ring.has(candidate.id) !== attackerInRing) continue;
    if (!withinVentCone(attacker.x, attacker.y, attacker.direction, candidate.x, candidate.y)) continue;
    const dx = candidate.x - attacker.x;
    const dy = candidate.y - attacker.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = candidate;
    }
  }
  return best;
}

/**
 * 事件包发给「出招者 + 所有看得见他的人」。
 *
 * `player.known` 不含自己，但发起者必须收到：本地要据它区分「打到了」与「空放」，
 * 命中音效与受害者头顶的台词都挂在这条包上。
 */
function broadcastVent(
  world: World,
  attacker: Player,
  targetId: number,
  x: number,
  y: number,
  transport: Transport,
  flags = 0,
): void {
  const packet = encodeVent(
    attacker.id,
    targetId,
    quantizeCoord(x),
    quantizeCoord(y),
    flags,
  );
  transport.send(attacker.wsId, packet);
  for (const id of attacker.known) {
    const viewer = world.get(id);
    if (viewer) transport.send(viewer.wsId, packet);
  }
}
