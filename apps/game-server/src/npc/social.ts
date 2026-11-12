import { POSE } from '@niuma/shared-types';
import { broadcastChatLine } from '../sim/chat';
import type { ChatHistory } from '../sim/history';
import type { Transport } from '../sim/view';
import type { Player, World } from '../sim/world';
import { faceToward, startWave, type NpcAgent } from './brain';
import type { NpcConfig } from './config';
import type { Rng } from './rng';
import { NPC_CHAT_LINES } from './roster';

/**
 * NPC 的社交层：对视、让路、招手与低频发言。
 *
 * 全部按 `socialIntervalMs`（默认 500ms）摊还，不进 20Hz 热路径；
 * 邻居检索直接复用对称 AOI 的 `player.known`，不再做一次空间查询、也不分配对象。
 * 发言走 `broadcastChatLine`，与玩家聊天共用同一份 msgId、历史与可见性口径。
 */
export interface NpcSocialContext {
  readonly world: World;
  readonly transport: Transport;
  /** 频道历史；缺省时只做肢体互动，不发言 */
  readonly history?: ChatHistory;
  readonly config: NpcConfig;
  readonly rng: Rng;
  /** 已过审的外置台词；空数组表示用内置池 */
  readonly chatLines: readonly string[];
}

const NEIGHBOR_RADIUS = 160;
const YIELD_RADIUS = 80;
/** 停顿中有人靠近时，有一半概率转头看过去 */
const LOOK_CHANCE = 0.55;
/** 迎面撞上时让路的概率 */
const YIELD_CHANCE = 0.5;
/** 停顿中近距离招手的概率 */
const WAVE_CHANCE = 0.05;
/** 附近没人时，把发言推迟多久再检查 */
const LONELY_RECHECK_MS: readonly [number, number] = [30_000, 60_000];

function nearestKnown(context: NpcSocialContext, self: Player): Player | null {
  let best: Player | null = null;
  let bestDistanceSq = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;
  // known 不含自己，且与观察者对称：天然就是「附近有谁」的超集
  for (const id of self.known) {
    const other = context.world.get(id);
    if (!other) continue;
    const dx = other.x - self.x;
    const dy = other.y - self.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = other;
    }
  }
  return best;
}

function yieldTo(agent: NpcAgent, other: Player, now: number): void {
  agent.phase = 'pause';
  agent.pauseMs = 900;
  agent.pauseUntil = now + agent.pauseMs;
  agent.lookAt = now + agent.pauseMs;
  agent.player.applyState(agent.player.direction, POSE.Idle, false);
  agent.player.markDirtyIfChanged();
  faceToward(agent, other, now);
}

/**
 * 每 `socialIntervalMs` 调一次。调用方不需要节流，函数内部自己看 `nextSocialAt`。
 */
export function updateSocial(agent: NpcAgent, context: NpcSocialContext, now: number): void {
  if (now < agent.nextSocialAt) return;
  agent.nextSocialAt = now + context.config.socialIntervalMs;

  const player = agent.player;
  // 被创飞躺在地上时不做社交：先爬起来
  if (now < player.stunUntil) return;

  if (context.config.interact) {
    const neighbor = nearestKnown(context, player);
    if (neighbor) {
      const dx = neighbor.x - player.x;
      const dy = neighbor.y - player.y;
      const distanceSq = dx * dx + dy * dy;
      if (agent.phase === 'pause') {
        if (context.rng.chance(LOOK_CHANCE)) faceToward(agent, neighbor, now);
        if (distanceSq <= YIELD_RADIUS * YIELD_RADIUS && context.rng.chance(WAVE_CHANCE)) {
          startWave(agent, now);
        }
      } else if (distanceSq <= YIELD_RADIUS * YIELD_RADIUS && context.rng.chance(YIELD_CHANCE)) {
        // 迎面走来：先停下让路，再看向对方；过一秒继续自己的路
        yieldTo(agent, neighbor, now);
      }
    }
  }

  if (!context.config.chat || !context.history || now < agent.nextChatAt) return;
  if (player.known.size === 0) {
    // 附近没人就别对着空气说话，半分钟后再看
    agent.nextChatAt = now + context.rng.int(LONELY_RECHECK_MS[0], LONELY_RECHECK_MS[1]);
    return;
  }

  const lines = context.chatLines.length > 0 ? context.chatLines : NPC_CHAT_LINES;
  const text = context.rng.pick(lines);
  broadcastChatLine(player, text, now, context.world, context.transport, context.history, agent.chatColor, 0);
  agent.nextChatAt = now + context.rng.int(context.config.chatDelayMs.repeat[0], context.config.chatDelayMs.repeat[1]);
}
