import {
  DIRECTION,
  JAIL_ANCHOR,
  JAIL_DOOR_PAVING,
  MOVE_SPEED,
  POSE,
  resolveWalkInto,
  type MotionTarget,
} from '@niuma/shared-types';
import type { Player, World } from '../sim/world';
import { DETENTION, type EscortAbortReason, type EscortEvent } from '../sim/detention';
import { directionOf, type NpcAgent, type EscortTask } from './brain';
import { findEscortPath } from './escort-path';
import { stepAlongPath, type WalkStepResult } from './path-walk';

/**
 * 保安押送：`sim/detention` 只管「派给谁 / 抓到没有 / 送到了没有」，
 * 怎么走、什么时候按肩、拖在身后多少像素全部收在这里。
 *
 * 速度按保安基础速度乘系数，不使用传送；任何一步算不出路线就中止并原地松手。
 */

export const ESCORT = {
  /** 追击速度：1.3 倍基础速度，约 214px/s */
  CHASE_SPEED_FACTOR: 1.3,
  /** 拖行速度：0.85 倍基础速度 */
  DRAG_SPEED_FACTOR: 0.85,
  /** 抓取距离：目标进入这个半径就伸脚 */
  GRAB_RANGE_PX: 26,
  /** 按肩停顿：先站住 0.6s，再开始拖 */
  GRAB_HOLD_MS: 600,
  /** 被拖者在保安身后的距离 */
  TOW_OFFSET_PX: 22,
  /** 追击超过这个时间还没摸到人：证据不足，放人 */
  CHASE_TIMEOUT_MS: 12_000,
  /** 拖行超过这个时间：算卡死，原地松手 */
  DRAG_TIMEOUT_MS: 15_000,
  /** 追击重算路线的最短间隔 */
  REPLAN_MS: 400,
  /** 目标位移超过这个距离才值得重算 */
  REPLAN_PX: 48,
  /** 送到反省点后的原地停顿 */
  PAUSE_AFTER_MS: 2_000,
  /** 追击速度相对玩家常速的下限倍率：慢保安也不能追不上走路的人（ADR-0080） */
  CHASE_MIN_FACTOR: 1.1,
  /** 拖行超时上限：按路线长度派生的截止不会超过这里 */
  DRAG_TIMEOUT_MAX_MS: 60_000,
} as const;

const MOTION: MotionTarget = { x: 0, y: 0 };
const WALK_STEP: WalkStepResult = { index: 0, movedX: 0, movedY: 0, blocked: false };

/**
 * 追击速度的唯一出口：便于单测，也避免两处各写一个倍率。
 *
 * 保安基础速度是 `MOVE_SPEED × speedFactor`（0.62–0.95），裸乘 1.3 时最慢只有
 * 133px/s，追不上持续移动的玩家。这里再压一条「至少比玩家常速快 10%」的下限，
 * 快保安仍走原来的 1.3 倍，不被下限抹平。
 */
export function chaseSpeed(guardSpeed: number): number {
  return Math.max(guardSpeed * ESCORT.CHASE_SPEED_FACTOR, MOVE_SPEED * ESCORT.CHASE_MIN_FACTOR);
}

/**
 * 拖行截止的唯一出口：按实际路线长度与拖行速度派生（ADR-0080）。
 *
 * 固定 15 秒只够走 1300–2000px，西北角抓到的人必然半路被放走。这里给
 * 1.6 倍路程余量，短途仍保底 15 秒，上限 60 秒防止异常路径把案子拖死。
 */
export function dragDeadline(now: number, pathLength: number, speed: number): number {
  const estimate = speed > 0 ? (pathLength / speed) * 1_600 : 0;
  return now + Math.min(ESCORT.DRAG_TIMEOUT_MAX_MS, Math.max(ESCORT.DRAG_TIMEOUT_MS, estimate));
}

/** 门外铺装中心：强制保安从门口进屋，不从墙外“判定到达” */
const DOOR_OUTSIDE = {
  x: JAIL_DOOR_PAVING.x + JAIL_DOOR_PAVING.w / 2,
  y: JAIL_DOOR_PAVING.y + JAIL_DOOR_PAVING.h / 2,
};
/** 松手点：反省点东北 36px，保安不占被押者的格子 */
const DROP_POINT = { x: JAIL_ANCHOR.x + 36, y: JAIL_ANCHOR.y - 36 };

const DIRECTION_VECTOR: Record<number, { x: number; y: number }> = {
  [DIRECTION.Down]: { x: 0, y: 1 },
  [DIRECTION.Up]: { x: 0, y: -1 },
  [DIRECTION.Left]: { x: -1, y: 0 },
  [DIRECTION.Right]: { x: 1, y: 0 },
};

/**
 * 推进一帧押送。返回 null 表示还在路上；返回事件表示本帧发生了
 * 抓取 / 到达 / 中止，由 director 转交给 detention 与客户端。
 */
export function stepEscort(
  agent: NpcAgent,
  task: EscortTask,
  world: World,
  now: number,
): EscortEvent | null {
  const guard = agent.player;

  // 押送员昏迷送医：当帧作废这一单（ADR-0113）。旧口径是「挂起等康复再续追」，
  // 被押者会原地躺到保安治好，玩家只能干等——这正是要消掉的体验。
  if (guard.incapacitated) return abort(guard, task, now, 'guard_down');

  // 超时只看时间，不看保安当前能不能动（ADR-0080）：被踹倒期间也必须照常计时，
  // 否则每帧都从这里提前 return，永远走不到下面的超时分支，任务会停摆到案子上限
  if (task.stage === 'chase' && now - task.startedAt >= ESCORT.CHASE_TIMEOUT_MS) {
    return abort(guard, task, now, 'timeout');
  }
  if (task.stage === 'drag') {
    // 旧任务对象可能还没有截止时刻：退回固定上限，绝不出现「永不超时」
    const deadline = task.dragDeadlineAt > 0 ? task.dragDeadlineAt : task.startedAt + ESCORT.DRAG_TIMEOUT_MS;
    if (now >= deadline) return abort(guard, task, now, 'timeout');
  }

  // 被发泄踹倒：任务保留，躺到硬直结束；与 updateAgent 一样先站起来再继续
  if (now < guard.stunUntil) return null;
  if (guard.pose === POSE.Lie) {
    guard.applyState(guard.direction, POSE.Idle, false);
    guard.markDirtyIfChanged();
    return null;
  }

  const target = world.get(task.targetId);
  if (!target || target.isNpc || target.wsId === 0) return abort(guard, task, now, 'missing');
  // 被押者自己被打倒送医：坐标从此归救护链，押送当帧让位（ADR-0113），
  // 否则拖行写「保安身后 22px」与挂车尾写「车尾 26px」会互相拉扯。
  if (target.incapacitated) return abort(guard, task, now, 'target_down');

  if (task.lastProgressAt === undefined) {
    task.lastProgressAt = now;
    task.lastProgressX = guard.x;
    task.lastProgressY = guard.y;
  } else if (Math.hypot(guard.x - (task.lastProgressX ?? guard.x), guard.y - (task.lastProgressY ?? guard.y)) >= 2) {
    task.lastProgressAt = now;
    task.lastProgressX = guard.x;
    task.lastProgressY = guard.y;
  }

  if (task.stage === 'hold') {
    faceToward(agent, target);
    if (now < task.stageUntil) return null;
    beginDrag(agent, task, now);
    if (task.path.length === 0) return abort(guard, task, now, 'stuck');
    return null;
  }

  if (task.stage === 'chase') {
    if (distance(guard, target) <= ESCORT.GRAB_RANGE_PX) {
      grab(agent, task, target, now);
      return { kind: 'grab', guardId: guard.id, targetId: target.id, now };
    }

    if (needReplan(task, target, now)) {
      const path = findEscortPath({ x: guard.x, y: guard.y }, { x: target.x, y: target.y });
      if (!path) return abort(guard, task, now, 'stuck');
      task.path = path;
      task.index = 0;
      task.replanAt = now + ESCORT.REPLAN_MS;
      task.lastTargetX = target.x;
      task.lastTargetY = target.y;
    }

    walkPath(agent, task, chaseSpeed(agent.speed));
    if (Math.hypot(guard.x - (task.lastProgressX ?? guard.x), guard.y - (task.lastProgressY ?? guard.y)) >= 2) {
      task.lastProgressAt = now;
      task.lastProgressX = guard.x;
      task.lastProgressY = guard.y;
    }

    if (distance(guard, target) <= ESCORT.GRAB_RANGE_PX) {
      grab(agent, task, target, now);
      return { kind: 'grab', guardId: guard.id, targetId: target.id, now };
    }
    return null;
  }

  // 拖行：沿着算好的路径走，中途遇动态门栅或墙角停滞则尝试重算一次，再卡死就中止放人
  const moved = walkPath(agent, task, agent.speed * ESCORT.DRAG_SPEED_FACTOR);
  if (moved.x !== 0 || moved.y !== 0) {
    const length = Math.hypot(moved.x, moved.y);
    task.towX = moved.x / length;
    task.towY = moved.y / length;
    if (Math.hypot(guard.x - (task.lastProgressX ?? guard.x), guard.y - (task.lastProgressY ?? guard.y)) >= 2) {
      task.lastProgressAt = now;
      task.lastProgressX = guard.x;
      task.lastProgressY = guard.y;
    }
  } else if (now - task.lastProgressAt >= 800 && !task.dragReplanned) {
    task.dragReplanned = true;
    task.lastProgressAt = now;
    const prevStartedAt = task.startedAt;
    const prevDeadline = task.dragDeadlineAt;
    beginDrag(agent, task, now);
    if (task.path.length === 0) return abort(guard, task, now, 'stuck');
    task.startedAt = prevStartedAt;
    if (prevDeadline > 0) task.dragDeadlineAt = Math.min(prevDeadline, task.dragDeadlineAt);
  } else if (task.dragReplanned && now - task.lastProgressAt >= 1200) {
    return abort(guard, task, now, 'stuck');
  }
  placeTargetBehind(guard, task, target, now);
  // 拖行期间逐帧续期：保安被创飞或路线卡住时，被押者最多 5 秒就能自己站起来，
  // 不会因为任务停摆而躺到案子上限（ADR-0080）
  target.stunUntil = now + DETENTION.DRAG_LOCK_MS;

  if (task.index >= task.path.length) {
    return { kind: 'arrive', guardId: guard.id, targetId: target.id, now };
  }
  return null;
}

function distance(a: Player, b: Player): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function abort(
  guard: Player,
  task: EscortTask,
  now: number,
  reason: EscortAbortReason,
): EscortEvent {
  return { kind: 'abort', guardId: guard.id, targetId: task.targetId, now, reason };
}

/** 抓到：站住、面朝目标，目标交给 detention 锁成躺姿；0.6s 后开始拖 */
function grab(agent: NpcAgent, task: EscortTask, target: Player, now: number): void {
  const guard = agent.player;
  const direction = directionOf(target.x - guard.x, target.y - guard.y, guard.direction);
  guard.applyState(direction, POSE.Idle, false);
  guard.markDirtyIfChanged();

  target.applyState(directionOf(guard.x - target.x, guard.y - target.y, target.direction), POSE.Lie, false);
  // 拖行硬直：拖行中由 stepEscort 逐帧续期，到达 / 中止时由 detention 清零
  target.stunUntil = now + DETENTION.DRAG_LOCK_MS;
  target.markDirtyIfChanged();

  task.stage = 'hold';
  task.stageUntil = now + ESCORT.GRAB_HOLD_MS;
}

/** 停在目标身边时只转头，不移动 */
function faceToward(agent: NpcAgent, target: Player): void {
  const guard = agent.player;
  const direction = directionOf(target.x - guard.x, target.y - guard.y, guard.direction);
  if (direction === guard.direction) return;
  guard.applyState(direction, POSE.Idle, false);
  guard.markDirtyIfChanged();
}

/** 拖行开始：先到门外，再从门口走到松手点，保证镜头里真的“进了屋” */
function beginDrag(agent: NpcAgent, task: EscortTask, now: number): void {
  const guard = agent.player;
  const toDoor = findEscortPath({ x: guard.x, y: guard.y }, DOOR_OUTSIDE);
  const toDrop = findEscortPath(DOOR_OUTSIDE, DROP_POINT);
  if (!toDoor || !toDrop) {
    task.path = [];
    return;
  }
  // 两段路的接缝点只保留一份，避免在门口原地“点一下头”
  task.path = [...toDoor, ...toDrop.slice(1)];
  task.index = 0;
  // 截止按真实路线长度派生：远端抓到的人不会走到一半就被固定 15 秒放掉
  task.dragDeadlineAt = dragDeadline(
    now,
    measurePath(guard, task.path),
    agent.speed * ESCORT.DRAG_SPEED_FACTOR,
  );
  // 阶段切换必须放在算到路线之后：算不出路就保持空路径，由调用方 abort('stuck')。
  // 漏掉这一行时每 Tick 都会重新进入 hold 重算路线，保安与被押者会一直原地不动。
  task.stage = 'drag';
  task.startedAt = now;
  task.lastProgressAt = now;
  task.lastProgressX = guard.x;
  task.lastProgressY = guard.y;
  const vector = DIRECTION_VECTOR[guard.direction] ?? DIRECTION_VECTOR[DIRECTION.Down]!;
  task.towX = vector.x;
  task.towY = vector.y;
}

/** 路线总长：拖行截止按它派生，只在进入拖行时算一次 */
function measurePath(from: { x: number; y: number }, path: ReadonlyArray<{ x: number; y: number }>): number {
  let total = 0;
  let previous = from;
  for (const point of path) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

/** 追击重算：路线走完、停滞或目标位移超过 48px 时按 400ms 节流重算 */
function needReplan(task: EscortTask, target: Player, now: number): boolean {
  if (now < task.replanAt) return false;
  if (task.index >= task.path.length && task.path.length > 0) return true;
  if (task.path.length === 0) return true;
  if (task.lastProgressAt !== undefined && now - task.lastProgressAt >= ESCORT.REPLAN_MS) return true;
  return Math.hypot(target.x - task.lastTargetX, target.y - task.lastTargetY) > ESCORT.REPLAN_PX;
}

/**
 * 沿路线推进一帧，返回本帧实际位移。
 *
 * 用法与真人移动同一个 `resolveWalkInto`（地形求解 + 护士站门禁）：
 * 4px 子步、单轴滑动，不会穿墙；被挤住时最多原地等下一次重算，不会在墙里抖。
 */
function walkPath(agent: NpcAgent, task: EscortTask, speed: number): { x: number; y: number } {
  const guard = agent.player;
  const result = stepAlongPath(guard, task.path, task.index, speed, false, WALK_STEP);
  task.index = result.index;

  if (result.movedX !== 0 || result.movedY !== 0) {
    const direction = directionOf(result.movedX, result.movedY, guard.direction);
    guard.applyState(direction, POSE.Walk, true);
  } else {
    guard.applyState(guard.direction, POSE.Idle, false);
  }
  guard.markDirtyIfChanged();
  return { x: result.movedX, y: result.movedY };
}

/** 被拖者始终在保安身后 22px；落点走与保安移动相同的碰撞与门禁求解，拐角处不会写进墙或站内 */
function placeTargetBehind(guard: Player, task: EscortTask, target: Player, now: number): void {
  // 从保安脚下起步求解：被挡时会被截停在墙边，宁可贴住保安也不产生非法坐标
  resolveWalkInto(
    MOTION,
    guard.x,
    guard.y,
    guard.x - task.towX * ESCORT.TOW_OFFSET_PX,
    guard.y - task.towY * ESCORT.TOW_OFFSET_PX,
  );
  target.x = MOTION.x;
  target.y = MOTION.y;
  target.lastMoveAt = now;
  target.applyState(
    directionOf(guard.x - target.x, guard.y - target.y, target.direction),
    POSE.Lie,
    false,
  );
  target.markDirtyIfChanged();
}
