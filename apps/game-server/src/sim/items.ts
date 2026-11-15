import {
  BUFF,
  ITEM_EFFECT,
  ITEM_REJECT,
  ITEM_TARGET,
  PLAYER_EFFECT,
  POSE,
  WALLET_REASON,
  encodeItemReject,
  findItemSkuById,
  type ItemSku,
} from '@niuma/shared-types';
import type { EconomyService } from '../economy/service';
import type { NpcDirector } from '../npc/director';
import { consumeShield, grantShield, markTrickHit, setBuff, trickGuarded } from './buffs';
import { broadcastPlayerEffect } from './effects';
import type { Player, World } from './world';
import type { Transport } from './view';

/**
 * 道具结算的唯一入口（ADR-0085）。
 *
 * 网络层只负责「解码 → 调用这里 → 回拒绝包」，所有规则收在本文件：
 * 目标合法性、距离、座位免伤、整蛊保护、护盾吸收、库存扣减与退币。
 * 新增第 8、9 件道具时只改 SKU 表与下面这个 switch，不碰 `server.ts`。
 */
export interface ItemRuntime {
  world: World;
  transport: Transport;
  economy: EconomyService;
  /** NPC 门面：只有雇佣保安卡用到，测试可以传 null */
  npcs: NpcDirector | null;
}

/**
 * 整蛊道具的作用距离。
 *
 * 比 AOI（1000px）宽一档：点选一个正在跑动的人时，客户端命中的是上一帧的位置，
 * 包到服务端时对方可能又跑了几十像素；1200px 留出这段误差，又不至于让
 * 「看不见的人」被整到。
 */
const MAX_TRICK_DISTANCE_PX = 1200;

export function useItem(
  runtime: ItemRuntime,
  actor: Player,
  targetId: number,
  itemId: number,
  now: number,
): void {
  const { world, transport, economy } = runtime;
  const sku = findItemSkuById(itemId);
  if (!sku) return;

  const reject = (reason: number): void => {
    transport.send(actor.wsId, encodeItemReject(reason, itemId));
  };

  // 大喇叭是「写一句话」而不是「对谁用」，走独立上行包（C2S_SHOUT）
  if (sku.effect === ITEM_EFFECT.Shout) return reject(ITEM_REJECT.InvalidTarget);

  const target = world.get(targetId) ?? null;

  if (sku.target === ITEM_TARGET.Self) {
    if (targetId !== actor.id || !target) return reject(ITEM_REJECT.SelfOnly);
  } else {
    if (!target || target.id === actor.id || target.isNpc || target.wsId === 0) {
      return reject(ITEM_REJECT.InvalidTarget);
    }
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    if (dx * dx + dy * dy > MAX_TRICK_DISTANCE_PX * MAX_TRICK_DISTANCE_PX) {
      return reject(ITEM_REJECT.InvalidTarget);
    }
    // 入座 / 治疗 / 擂台内：与发泄同一条免伤口径，整蛊道具也不该穿透
    if (target.seat !== 0 || target.incapacitated || world.ring.has(target.id)) {
      return reject(ITEM_REJECT.InvalidTarget);
    }
  }

  const control = sku.effect === ITEM_EFFECT.Slip || sku.effect === ITEM_EFFECT.Poster;
  // 保护期拦在扣库存之前：被保护的目标不该让操作者白花一件道具
  if (control && trickGuarded(target, now)) return reject(ITEM_REJECT.Guarded);

  // 先扣库存：扣不动就一个副作用都不能发生
  if (!economy.consumeItem(actor, itemId, WALLET_REASON.ItemUse)) {
    return reject(ITEM_REJECT.NoItem);
  }

  applyItem(runtime, actor, target, sku, now, reject);
}

function applyItem(
  runtime: ItemRuntime,
  actor: Player,
  target: Player,
  sku: ItemSku,
  now: number,
  reject: (reason: number) => void,
): void {
  const { world, transport, economy } = runtime;
  const durationMs = sku.effectMs;
  const effect = effectOf(sku.effect);
  const broadcast = (blocked = false, extraId = 0): void => {
    if (effect === null) return;
    broadcastPlayerEffect(world, transport, {
      effect,
      sourceId: actor.id,
      targetId: target.id,
      extraId,
      durationMs: blocked ? 0 : durationMs,
      blocked,
    });
  };

  switch (sku.effect) {
    case ITEM_EFFECT.Haste:
      setBuff(target, BUFF.Haste, now + durationMs, now);
      broadcast();
      return;

    case ITEM_EFFECT.Shield:
      grantShield(target, now + durationMs, now);
      broadcast();
      return;

    case ITEM_EFFECT.Sparkle:
      // 纯演出：不进 activeBuffs，也不影响任何判定
      broadcast();
      return;

    case ITEM_EFFECT.Slip: {
      // 护盾优先：挡住了就不挂滑倒，也不占整蛊保护
      if (bufferedBlocked(target, now)) return broadcast(true);
      target.applyState(target.direction, POSE.Lie, false);
      target.stunUntil = Math.max(target.stunUntil, now + durationMs);
      target.markDirtyIfChanged();
      setBuff(target, BUFF.Slip, now + durationMs, now);
      markTrickHit(target, now);
      broadcast();
      return;
    }

    case ITEM_EFFECT.Poster: {
      if (bufferedBlocked(target, now)) return broadcast(true);
      setBuff(target, BUFF.Poster, now + durationMs, now);
      markTrickHit(target, now);
      broadcast();
      return;
    }

    case ITEM_EFFECT.Guard: {
      if (bufferedBlocked(target, now)) return broadcast(true);
      const guardId = runtime.npcs?.dispatchFollow(target.id, now + durationMs, now) ?? 0;
      if (guardId === 0) {
        // 没有可用保安：原路退币，不让玩家为「保安都在忙」付费
        economy.grantCoins(actor, sku.price, WALLET_REASON.ItemRefund);
        reject(ITEM_REJECT.NoGuard);
        return;
      }
      setBuff(target, BUFF.Guard, now + durationMs, now);
      // extraId 带上保安实体 id：客户端据此在保安头顶播「盯紧你了！」
      broadcast(false, guardId);
      return;
    }

    default:
      return;
  }
}

/**
 * 护盾吸收：挡下就消耗一层。
 *
 * 返回 true 表示「这一下被挡了，调用方不要再写状态，只播被挡表现」。
 * 广播交给调用方统一做，避免同一次命中既发 Haste 又发 Shield 两条包。
 */
function bufferedBlocked(target: Player, now: number): boolean {
  return consumeShield(target, now);
}

/** 道具效果 → 特效码；没有对应演出的返回 null */
function effectOf(effect: string): number | null {
  switch (effect) {
    case ITEM_EFFECT.Haste:
      return PLAYER_EFFECT.Haste;
    case ITEM_EFFECT.Shield:
      return PLAYER_EFFECT.Shield;
    case ITEM_EFFECT.Sparkle:
      return PLAYER_EFFECT.Sparkle;
    case ITEM_EFFECT.Slip:
      return PLAYER_EFFECT.Slip;
    case ITEM_EFFECT.Poster:
      return PLAYER_EFFECT.Poster;
    case ITEM_EFFECT.Guard:
      return PLAYER_EFFECT.Guard;
    default:
      return null;
  }
}
