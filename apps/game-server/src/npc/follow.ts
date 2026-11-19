import { GUARD_FOLLOW_STOP_PX, POSE } from '@niuma/shared-types';
import type { World } from '../sim/world';
import { directionOf, type FollowTask, type NpcAgent } from './brain';
import { findEscortPath } from './escort-path';
import { chaseSpeed } from './escort';
import { stepAlongPath, type WalkStepResult } from './path-walk';

/**
 * 保安盯梢（ADR-0085，雇佣保安卡）。
 *
 * 与押送的三个差别：
 * 1. **不碰目标**：不写目标的坐标、姿态与硬直，目标该跑跑、该坐坐；
 * 2. **不锁时间**：任务到期只看 `until`，追不到也到点收工，不会把人困住；
 * 3. **允许被打断**：巡逻中的保安可以被派走，押送中的不行（在 director 里判定）。
 *
 * 速度复用押送追击的 `chaseSpeed`：1.3 倍基础速度，并保底比玩家常速快 10%，
 * 否则慢保安永远追不上正在跑的人，看起来像在原地发呆。
 */
const REPLAN_MS = 400;
const REPLAN_PX = 48;
const WALK_STEP: WalkStepResult = { index: 0, movedX: 0, movedY: 0, blocked: false };

/** 推进一帧盯梢；返回 'done' 表示任务结束（到期或目标消失） */
export function stepFollow(
  agent: NpcAgent,
  task: FollowTask,
  world: World,
  now: number,
): 'done' | null {
  const guard = agent.player;
  if (now >= task.until) return 'done';

  // 昏迷送医期间挂着任务不动（ADR-0106）：到期仍按上面的 until 收工
  if (guard.incapacitated) return null;

  // 被创飞：任务保留，躺到硬直结束再继续跟；与巡逻同一个优先级
  if (now < guard.stunUntil) return null;
  if (guard.pose === POSE.Lie) {
    guard.applyState(guard.direction, POSE.Idle, false);
    guard.markDirtyIfChanged();
  }

  const target = world.get(task.targetId);
  if (!target || target.isNpc || target.wsId === 0) return 'done';

  const distance = Math.hypot(guard.x - target.x, guard.y - target.y);
  if (distance <= GUARD_FOLLOW_STOP_PX) {
    face(agent, target.x, target.y);
    return null;
  }

  if (needReplan(task, target.x, target.y, now)) {
    const path = findEscortPath({ x: guard.x, y: guard.y }, { x: target.x, y: target.y });
    // 算不出路不算失败：目标可能刚跑进死角，下一次重算再试；任务到点自然结束
    if (path) {
      task.path = path;
      task.index = 0;
      task.lastTargetX = target.x;
      task.lastTargetY = target.y;
    }
    task.replanAt = now + REPLAN_MS;
  }

  if (walk(agent, task, chaseSpeed(agent.speed))) {
    task.replanAt = 0;
  }

  // 走完这一段后已经贴身：站定面向目标，等下一帧的距离判定维持住
  if (Math.hypot(guard.x - target.x, guard.y - target.y) <= GUARD_FOLLOW_STOP_PX) {
    face(agent, target.x, target.y);
  }
  return null;
}

/** 任务收尾：站定、转头，把视线留给刚被盯过的人 */
export function finishFollow(agent: NpcAgent, now: number): void {
  agent.follow = null;
  agent.phase = 'pause';
  agent.pauseMs = 500;
  agent.pauseUntil = now + agent.pauseMs;
  agent.lookAt = now + 600;
  agent.player.applyState(agent.player.direction, POSE.Idle, false);
  agent.player.markDirtyIfChanged();
}

function face(agent: NpcAgent, x: number, y: number): void {
  const guard = agent.player;
  const direction = directionOf(x - guard.x, y - guard.y, guard.direction);
  if (direction === guard.direction && !guard.moving) return;
  guard.applyState(direction, POSE.Idle, false);
  guard.markDirtyIfChanged();
}

/** 路线走完、还没有路线、或目标移开 48px 才值得重算一次 */
function needReplan(task: FollowTask, x: number, y: number, now: number): boolean {
  if (now < task.replanAt) return false;
  if (task.path.length === 0) return true;
  if (task.index >= task.path.length) return true;
  return Math.hypot(x - task.lastTargetX, y - task.lastTargetY) > REPLAN_PX;
}

/**
 * 沿路线推进一帧。
 *
 * 与押送共用同一套 `resolveMotionInto` 子步 + 单轴滑动：撞墙不穿模，
 * 被挤住就等下一次重算，绝不传送。
 */
function walk(agent: NpcAgent, task: FollowTask, speed: number): boolean {
  const guard = agent.player;
  const result = stepAlongPath(guard, task.path, task.index, speed, false, WALK_STEP);
  task.index = result.index;

  if (result.movedX !== 0 || result.movedY !== 0) {
    guard.applyState(directionOf(result.movedX, result.movedY, guard.direction), POSE.Walk, true);
  } else {
    guard.applyState(guard.direction, POSE.Idle, false);
  }
  guard.markDirtyIfChanged();
  return result.blocked;
}
