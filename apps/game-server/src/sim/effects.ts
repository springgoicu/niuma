import { encodePlayerEffect, type PlayerEffectPacket } from '@niuma/shared-types';
import type { Player, World } from './world';
import type { Transport } from './view';

/**
 * `S2C_PLAYER_EFFECT` 的唯一出口（ADR-0085）。
 *
 * 为什么按接收者逐个编码：`isTarget` 是「我是不是被打的那个人」的视角位，
 * 同一条事件在不同客户端上取值不同。接收者集合是「来源 + 目标 + 双方 AOI」，
 * 上界是两圈视野（几十人），逐个编码的代价远小于让客户端自己推断遗漏。
 *
 * 复用缓冲：`RECIPIENTS` 与循环内不分配临时数组，事件包是低频路径，
 * 但道具连发时也别给 GC 添活。
 */
const RECIPIENTS = new Map<number, Player>();

export interface PlayerEffectInput {
  effect: number;
  sourceId: number;
  targetId: number;
  /** 保安 id 之类的附加载体；没有时写 0 */
  extraId?: number;
  durationMs?: number;
  /** 被护盾抵消 / 未生效 */
  blocked?: boolean;
  /** 额外的接收者（例如被雇佣的保安不需要，但派单方可能需要） */
  include?: Iterable<number>;
}

export function broadcastPlayerEffect(
  world: World,
  transport: Transport,
  input: PlayerEffectInput,
): void {
  RECIPIENTS.clear();
  const collect = (id: number): void => {
    const player = world.get(id);
    if (player) RECIPIENTS.set(player.id, player);
  };
  collect(input.sourceId);
  collect(input.targetId);
  const source = world.get(input.sourceId);
  if (source) for (const id of source.known) collect(id);
  const target = world.get(input.targetId);
  if (target && target.id !== input.sourceId) for (const id of target.known) collect(id);
  if (input.include) for (const id of input.include) collect(id);

  const durationMs = Math.max(0, Math.round(input.durationMs ?? 0));
  for (const player of RECIPIENTS.values()) {
    if (player.wsId === 0) continue;
    transport.send(
      player.wsId,
      encodePlayerEffect({
        effect: input.effect,
        sourceId: input.sourceId,
        targetId: input.targetId,
        extraId: input.extraId ?? 0,
        durationMs,
        isTarget: player.id === input.targetId,
        blocked: input.blocked === true,
      }),
    );
  }
  RECIPIENTS.clear();
}

/** 单给一个人的特效包：保安喊话这类只对目标有意义的补发用 */
export function sendPlayerEffect(
  transport: Transport,
  wsId: number,
  packet: PlayerEffectPacket,
): void {
  if (wsId === 0) return;
  transport.send(wsId, encodePlayerEffect(packet));
}
