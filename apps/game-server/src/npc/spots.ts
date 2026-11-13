import { PLAYER_RADIUS, WORLD_BOUNDS, findFreePoint, isBlocked } from '@niuma/shared-types';
import type { Rng } from './rng';

/**
 * NPC 的落点采样：整座岛随机漫游。
 *
 * 旧版按「广场 / 工作区 / 宿舍…」分区域，NPC 一辈子只在几个圆里转；
 * 现在直接在 `WORLD_BOUNDS`（岛包围盒）里均匀取点，用 `isBlocked` 过掉海与障碍。
 * 真正的绕障仍交给 `resolveMotionInto` 与 brain 的卡住恢复，不在这里造导航网格。
 */
export interface NpcSpot {
  x: number;
  y: number;
}

/** 同一次采样最多试几次：岛面积约占包围盒六成，24 次全失败的概率可以忽略 */
const RETRY_COUNT = 24;
/** 换路点时与当前位置的最小距离：全岛尺度下 240px 才像「去别处」 */
const MIN_WALK_PX = 240;
/** 出生点之间至少拉开 160px，避免 5 个人叠在一格 */
const MIN_SPAWN_GAP = 160;

function sampleIslandPoint(rng: Rng): NpcSpot {
  const { x, y, w, h } = WORLD_BOUNDS;
  return { x: x + rng.range(0, w), y: y + rng.range(0, h) };
}

/**
 * 全岛采一个可站立点。
 *
 * 岛是带海湾的多边形，矩形采样会落进海里；前 20 次还要求离当前位置至少
 * `minWalkPx`，最后 4 次放宽，避免贴着岛边缘时永远采不到点。
 */
export function pickWaypoint(rng: Rng, from?: NpcSpot, minWalkPx = MIN_WALK_PX): NpcSpot {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
    const point = sampleIslandPoint(rng);
    if (isBlocked(point.x, point.y, PLAYER_RADIUS)) continue;
    if (from && attempt < RETRY_COUNT - 4) {
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      if (dx * dx + dy * dy < minWalkPx * minWalkPx) continue;
    }
    return point;
  }
  // 连续失败：从当前位置就近脱困，绝不把 NPC 留在海里或墙里
  const anchor = from ?? {
    x: WORLD_BOUNDS.x + WORLD_BOUNDS.w / 2,
    y: WORLD_BOUNDS.y + WORLD_BOUNDS.h / 2,
  };
  const fallback = findFreePoint(anchor.x, anchor.y, PLAYER_RADIUS, true);
  return { x: fallback.x, y: fallback.y };
}

/** 出生点：同样全岛采样，并尽量和其他同事拉开距离 */
export function pickSpawnPoint(rng: Rng, occupied: readonly NpcSpot[] = []): NpcSpot {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
    const point = sampleIslandPoint(rng);
    if (isBlocked(point.x, point.y, PLAYER_RADIUS)) continue;
    const tooClose = occupied.some((other) => {
      const dx = other.x - point.x;
      const dy = other.y - point.y;
      return dx * dx + dy * dy < MIN_SPAWN_GAP * MIN_SPAWN_GAP;
    });
    if (tooClose) continue;
    return point;
  }
  return pickWaypoint(rng, occupied[occupied.length - 1]);
}
