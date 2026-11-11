import { SYSTEM_NOTICE_KIND, encodeSystemNotice, formatSystemNotice } from '@niuma/shared-types';
import type { Transport } from './view';
import type { Player, World } from './world';

/**
 * 系统播报：只发给「看得见这个人」的玩家（`player.known`），与聊天的 900px AOI 同口径。
 *
 * 调用时机有硬约束：
 * - 进园必须在 `refreshView()` 之后——那一刻双方的 `known` 才建立起来，早发等于发给零个人；
 * - 离园必须在 `broadcastDespawn()` 之前——它内部会 `known.clear()`，晚发同样没人收。
 *
 * 系统播报不进聊天限速窗口，也不参与词表审核：文案来自共享模板，不含玩家输入。
 */
export function broadcastSystemNotice(
  world: World,
  transport: Transport,
  viewers: Iterable<number>,
  kind: number,
  text: string,
  entityId = 0,
): void {
  if (text.length === 0) return;
  const packet = encodeSystemNotice({ kind, entityId, text });
  for (const id of viewers) {
    const other = world.get(id);
    if (other) transport.send(other.wsId, packet);
  }
}

/** 「xxx 进入了园区」：发给此刻已经能看见他的玩家，不发给本人 */
export function announceEnter(player: Player, world: World, transport: Transport): void {
  const text = formatSystemNotice(SYSTEM_NOTICE_KIND.Enter, { name: player.name });
  if (!text) return;
  broadcastSystemNotice(world, transport, player.known, SYSTEM_NOTICE_KIND.Enter, text, player.id);
}

/** 「xxx 离开了园区」：主动退出、关标签页与掉线在服务端不可区分，统一用这句中性说法 */
export function announceLeave(player: Player, world: World, transport: Transport): void {
  const text = formatSystemNotice(SYSTEM_NOTICE_KIND.Leave, { name: player.name });
  if (!text) return;
  broadcastSystemNotice(world, transport, player.known, SYSTEM_NOTICE_KIND.Leave, text, player.id);
}
