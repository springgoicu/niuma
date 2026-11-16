import type { BossPacket } from '@niuma/shared-types';

/**
 * 一条 `S2C_BOSS` 对本地玩家意味着什么（ADR-0070 / ADR-0105）。
 *
 * - `hit`：真实命中。出招者存在且不是跨日重置；
 * - `byLocal`：出招者就是本机，只用来决定音效走哪一档节流；
 * - `damage`：本次应显示的伤害点数，按前后血量差计算；`previousHp < 0`
 *   表示还没收到过快照，此时按 1 点兜底，绝不把整条血算成一次伤害。
 *
 * 纯函数：归因只在这里做一次，会话层与单测共用，不在回调里各写一套判断。
 */
export interface BossHitFeedback {
  hit: boolean;
  byLocal: boolean;
  damage: number;
}

export function bossHitFeedback(
  packet: BossPacket,
  localId: number,
  previousHp: number,
): BossHitFeedback {
  // 入场补发与跨日回满都带 attackerId = 0，一律不算命中
  if (packet.reset || packet.attackerId === 0) return { hit: false, byLocal: false, damage: 0 };
  const delta = previousHp >= 0 ? previousHp - packet.hp : 0;
  return {
    hit: true,
    byLocal: packet.attackerId === localId,
    // 一次命中至少 1 点：前值未知（刚入场）或血量没降都不该显示 0 或负数
    damage: delta > 0 ? delta : 1,
  };
}
