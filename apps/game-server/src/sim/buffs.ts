import {
  BUFF,
  BUFF_DEFS,
  TRICK_GUARD_MS,
  speedMultiplier,
  ventCooldownMultiplier,
  type BuffType,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * Buff 状态机的唯一入口（ADR-0085）。
 *
 * 三条纪律，缺一条就会退化成「到处写时间戳」：
 * 1. 只有这里能改 `activeBuffs` / `trickGuardUntil` / `shieldCharges`；
 * 2. 每次状态变更后立刻重算 `speedMul` / `ventCdMul` 两个标量缓存——
 *    移动与冷却在 20Hz 路径上，绝不能回头遍历 Map；
 * 3. 到期清理只发生在 Tick 的 `pruneBuffs`，读路径靠 `expiresAt <= now` 自行忽略。
 */

/** 写入或延长一个 Buff；到期时间只增不减，重复使用同一道具不会缩短已有的 */
export function setBuff(player: Player, type: BuffType, expiresAt: number, now: number): void {
  if (!BUFF_DEFS[type]) return;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return;
  const prev = player.activeBuffs.get(type) ?? 0;
  if (expiresAt <= prev) return;
  player.activeBuffs.set(type, expiresAt);
  refreshMultipliers(player, now);
}

/** 立即移除一个 Buff（护盾被消耗、保安任务被取消等） */
export function clearBuff(player: Player, type: BuffType, now: number): void {
  if (!player.activeBuffs.delete(type)) return;
  refreshMultipliers(player, now);
}

/** 重算乘子缓存：只有状态变更时才调用 */
export function refreshMultipliers(player: Player, now: number): void {
  player.speedMul = speedMultiplier(player.activeBuffs, now);
  player.ventCdMul = ventCooldownMultiplier(player.activeBuffs, now);
}

/** 会话开始 / 对象池回收：清空所有临时状态 */
export function clearAllBuffs(player: Player): void {
  player.activeBuffs.clear();
  player.trickGuardUntil = 0;
  player.shieldCharges = 0;
  player.speedMul = 1;
  player.ventCdMul = 1;
}

/** 获得一层护盾：层数与状态表同时写，任何一边缺席都不算有护盾 */
export function grantShield(player: Player, expiresAt: number, now: number): void {
  setBuff(player, BUFF.Shield, expiresAt, now);
  player.shieldCharges = Math.min(1, player.shieldCharges + 1);
}

/**
 * 消耗一层护盾。返回 true 表示这次攻击被挡下。
 *
 * 过期的护盾在这里顺手清掉：调用点是「被撞飞 / 被整蛊」的瞬间，
 * 比 Tick 清理更早一步，不会出现「已经过期但还挡了一下」。
 */
export function consumeShield(player: Player, now: number): boolean {
  if (player.shieldCharges <= 0) return false;
  const until = player.activeBuffs.get(BUFF.Shield) ?? 0;
  if (until <= now) {
    player.shieldCharges = 0;
    clearBuff(player, BUFF.Shield, now);
    return false;
  }
  player.shieldCharges -= 1;
  if (player.shieldCharges <= 0) clearBuff(player, BUFF.Shield, now);
  return true;
}

/** 目标是否还在整蛊保护冷却里 */
export function trickGuarded(player: Player, now: number): boolean {
  return player.trickGuardUntil > now;
}

/** 命中一次控制类整蛊：给目标续上 60 秒保护 */
export function markTrickHit(player: Player, now: number): void {
  player.trickGuardUntil = now + TRICK_GUARD_MS;
}

/**
 * 单遍清理：过期 Buff 与过期保护。
 *
 * 返回 true 表示乘子缓存可能变了（调用方不需要额外做什么，
 * 保留返回值只为让「这一帧有没有状态失效」可被观测）。
 */
export function pruneBuffs(player: Player, now: number): boolean {
  let changed = false;
  if (player.activeBuffs.size > 0) {
    for (const [type, until] of player.activeBuffs) {
      if (until <= now) {
        player.activeBuffs.delete(type);
        changed = true;
      }
    }
    if (changed) refreshMultipliers(player, now);
  }
  // 护盾状态被清掉但层数还在（异常路径）：以状态表为准
  if (player.shieldCharges > 0 && !player.activeBuffs.has(BUFF.Shield)) {
    player.shieldCharges = 0;
    changed = true;
  }
  if (player.trickGuardUntil !== 0 && player.trickGuardUntil <= now) {
    player.trickGuardUntil = 0;
  }
  return changed;
}
