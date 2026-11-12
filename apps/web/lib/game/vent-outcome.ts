import type { VentEventPacket } from '@niuma/shared-types';

/**
 * 一条 `S2C_VENT` 对本地玩家意味着什么。
 *
 * - `hit`：自己被击倒（空放不算）；
 * - `dealt`：自己成功击倒别人（空放 `targetId = 0` 不算）；
 * - `other`：旁观互殴，或自己空放。
 *
 * 纯函数：归因只在这里做一次，会话层与单测共用，不在回调里各写一套判断。
 */
export type VentOutcome = 'hit' | 'dealt' | 'other';

export function ventOutcome(packet: VentEventPacket, localId: number): VentOutcome {
  if (packet.targetId !== 0 && packet.targetId === localId) return 'hit';
  if (packet.targetId !== 0 && packet.attackerId === localId) return 'dealt';
  return 'other';
}
