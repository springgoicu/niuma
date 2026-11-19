import { TICK_MS, resolveWalkInto, type MotionTarget } from '@niuma/shared-types';
import type { Player } from '../sim/world';

const DT_SEC = TICK_MS / 1000;
const MOTION: MotionTarget = { x: 0, y: 0 };

export interface WalkPoint {
  readonly x: number;
  readonly y: number;
}

export interface WalkStepResult {
  index: number;
  movedX: number;
  movedY: number;
  blocked: boolean;
}

/**
 * 共享 NPC / 保安沿航点步进求解器（零 GC 复用输出对象）：
 * 统一复用 `resolveWalkInto` 的 4px 子步 + 单轴滑动 + 护士站门禁。
 */
export function stepAlongPath(
  entity: Player,
  path: readonly WalkPoint[],
  startIndex: number,
  speed: number,
  requireFullSegment: boolean,
  out: WalkStepResult,
): WalkStepResult {
  let index = startIndex;
  let remaining = speed * DT_SEC;
  let movedX = 0;
  let movedY = 0;
  let blocked = false;

  while (remaining > 0 && index < path.length) {
    const waypoint = path[index]!;
    const dx = waypoint.x - entity.x;
    const dy = waypoint.y - entity.y;
    const segment = Math.hypot(dx, dy);
    if (segment <= 1e-3) {
      index += 1;
      continue;
    }

    const step = Math.min(remaining, segment);
    const targetX = entity.x + (dx / segment) * step;
    const targetY = entity.y + (dy / segment) * step;
    resolveWalkInto(MOTION, entity.x, entity.y, targetX, targetY);
    const realX = MOTION.x - entity.x;
    const realY = MOTION.y - entity.y;
    const realLength = Math.hypot(realX, realY);

    entity.x = MOTION.x;
    entity.y = MOTION.y;
    movedX += realX;
    movedY += realY;
    remaining -= step;

    const completed = step >= segment - 0.01 && (!requireFullSegment || realLength >= segment - 0.5);
    if (completed) {
      index += 1;
    } else if (realLength < 0.5) {
      blocked = true;
      break;
    }
  }

  out.index = index;
  out.movedX = movedX;
  out.movedY = movedY;
  out.blocked = blocked;
  return out;
}
