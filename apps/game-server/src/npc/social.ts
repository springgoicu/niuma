import { POSE } from '@niuma/shared-types';
import type { Player, World } from '../sim/world';
import { faceToward, startWave, type NpcAgent } from './brain';
import type { NpcConfig } from './config';
import type { Rng } from './rng';

/**
 * NPC 的社交层：只保留对视、让路与招手，不发言。
 *
 * 全部按 `socialIntervalMs`（默认 500ms）摊还，不进 20Hz 热路径；
 * 邻居检索直接复用对称 AOI 的 `player.known`，不再做一次空间查询、也不分配对象。
 */
export interface NpcSocialContext {
  readonly world: World;
  readonly config: NpcConfig;
  readonly rng: Rng;
}

const NEIGHBOR_RADIUS = 160;
const YIELD_RADIUS = 80;
/** 停顿中有人靠近时，有一半概率转头看过去 */
const LOOK_CHANCE = 0.55;
/** 迎面撞上时让路的概率 */
const YIELD_CHANCE = 0.5;
/** 停顿中近距离招手的概率 */
const WAVE_CHANCE = 0.05;

function nearestKnown(context: NpcSocialContext, self: Player): Player | null {
  let best: Player | null = null;
  let bestDistanceSq = NEIGHBOR_RADIUS * NEIGHBOR_RADIUS;
  // known 不含自己，且与观察者对称：天然就是「附近有谁」的超集
  for (const id of self.known) {
    const other = context.world.get(id);
    if (!other || other.roomId !== 0) continue;
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
  // 昏迷（等救护车）与被创飞躺在地上时都不做社交：先保住姿态
  if (player.incapacitated || now < player.stunUntil) return;
  if (!context.config.interact) return;

  const neighbor = nearestKnown(context, player);
  if (!neighbor) return;

  const dx = neighbor.x - player.x;
  const dy = neighbor.y - player.y;
  const distanceSq = dx * dx + dy * dy;
  if (agent.phase === 'pause') {
    if (context.rng.chance(LOOK_CHANCE)) faceToward(agent, neighbor, now);
    if (distanceSq <= YIELD_RADIUS * YIELD_RADIUS && context.rng.chance(WAVE_CHANCE)) {
      startWave(agent, now);
    }
  } else if (
    neighbor.moving &&
    distanceSq <= YIELD_RADIUS * YIELD_RADIUS &&
    (!agent.yieldCooldownUntil || now >= agent.yieldCooldownUntil) &&
    context.rng.chance(YIELD_CHANCE)
  ) {
    // 迎面走来：先停下让路，再看向对方；设冷却避免双方交替卡在原地让路
    agent.yieldCooldownUntil = now + 3500;
    yieldTo(agent, neighbor, now);
  }
}
