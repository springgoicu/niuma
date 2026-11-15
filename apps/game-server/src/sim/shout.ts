import {
  ITEM_EFFECT,
  SHOUT_COOLDOWN_MS,
  SHOUT_REJECT,
  WALLET_REASON,
  encodeLoudspeaker,
  encodeShoutReject,
  findItemSku,
  truncateShout,
  type ModerationFilter,
} from '@niuma/shared-types';
import type { EconomyService } from '../economy/service';
import type { Player, World } from './world';
import type { Transport } from './view';

/**
 * 全服大喇叭（ADR-0085）。
 *
 * 与聊天分开的理由有三条：
 * 1. **范围不同**：聊天走 AOI，大喇叭要求全服所有真人——这是它 100 币的价值；
 * 2. **不写历史**：一次性广播，回放里不该出现昨天的大喇叭；
 * 3. **不占聊天窗口**：否则「发一条大喇叭」会顺手把人禁言 5 秒，玩家会觉得被骗。
 *
 * 审核沿用聊天那条链路：政治类整条拒绝，污言秽语按打码后的文本广播。
 * 被拒一律不扣道具——玩家写错字不该损失 100 币。
 */
export interface ShoutRuntime {
  world: World;
  transport: Transport;
  economy: EconomyService;
  moderation: ModerationFilter;
}

export function handleShout(
  runtime: ShoutRuntime,
  player: Player,
  rawText: string,
  now: number,
): void {
  const { world, transport, economy, moderation } = runtime;
  const reject = (reason: number): void => {
    transport.send(player.wsId, encodeShoutReject(reason));
  };

  const sku = findItemSku('loudspeaker');
  if (!sku || sku.effect !== ITEM_EFFECT.Shout) return;

  // 超长在协议层已按 30 字截断，这里不再拒绝：截断比「花了 100 币发不出去」友好
  const text = truncateShout(rawText);
  if (text.length === 0) return reject(SHOUT_REJECT.Empty);
  if (now - player.lastShoutAt < SHOUT_COOLDOWN_MS) return reject(SHOUT_REJECT.Cooldown);
  if ((player.inventory[sku.key] ?? 0) <= 0) return reject(SHOUT_REJECT.NoItem);

  const verdict = moderation.inspect(text);
  if (verdict.verdict === 'reject') return reject(SHOUT_REJECT.Blocked);

  // 先扣道具再发：扣不动库存时不能有任何副作用
  if (!economy.consumeItem(player, sku.id, WALLET_REASON.ItemUse)) {
    return reject(SHOUT_REJECT.NoItem);
  }
  player.lastShoutAt = now;

  const packet = encodeLoudspeaker({ fromId: player.id, text: verdict.text });
  for (const other of world.players.values()) {
    if (other.wsId === 0) continue;
    transport.send(other.wsId, packet);
  }
}
