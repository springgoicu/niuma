import {
  DIRECTION,
  MOVE_SPEED,
  POSE,
  TICK_MS,
  resolveMotionInto,
  type Direction,
  type MotionTarget,
} from '@niuma/shared-types';
import type { Player } from '../sim/world';
import type { NpcConfig } from './config';
import type { Rng } from './rng';
import { pickWaypoint, type NpcSpot } from './spots';

/**
 * 单个 NPC 的行为状态机：走走停停、停下看四周、被撞倒后自己爬起来。
 *
 * 实体位置与姿态仍然写在 `Player` 上（复用 AOI、同步与地形碰撞），
 * 路点、计时器与卡住计数放在这里，不污染 `Player.reset()`。
 * 所有随机都走外部传入的 `Rng`，同一颗种子可复现同一段行为。
 */
export type NpcPhase = 'walk' | 'pause';

/**
 * 一次押送任务：追击 → 按肩 → 拖行。
 *
 * 任务只活在 `NpcAgent` 上，不写进 `Player`；目标断线、无路可走或超时都会
 * 由 `npc/escort` 回报中止，保安停在原地继续巡逻，绝不传送（ADR-0061）。
 */
export type EscortStage = 'chase' | 'hold' | 'drag';

export interface EscortTask {
  targetId: number;
  stage: EscortStage;
  /** 本阶段结束时刻（目前只有按肩停顿用到） */
  stageUntil: number;
  /** 当前这一段的路线点，首点通常是保安当前位置 */
  path: NpcSpot[];
  index: number;
  /** 下一次允许重算路线的时刻（追击时限流 400ms） */
  replanAt: number;
  lastTargetX: number;
  lastTargetY: number;
  /** 本阶段开始时刻：追击 / 拖行各自计时，超时即中止 */
  startedAt: number;
  /**
   * 拖行截止时刻：`beginDrag` 按实际路线长度与拖行速度派生（ADR-0080）。
   * 0 表示还没进入拖行，不能当成「立即超时」。
   */
  dragDeadlineAt: number;
  /** 拖行时目标在保安身后的方向（单位向量） */
  towX: number;
  towY: number;
}

export interface NpcAgent {
  readonly player: Player;
  /** 像素/秒：MOVE_SPEED × speedFactor */
  readonly speed: number;
  phase: NpcPhase;
  /** 正在执行的押送任务；null 表示正常巡逻 */
  escort: EscortTask | null;
  target: NpcSpot;
  /** 本次停顿的结束时刻 */
  pauseUntil: number;
  /** 当前停顿档位的总时长，测试与调试用 */
  pauseMs: number;
  /** 下一次换视线方向的时刻 */
  lookAt: number;
  /** 挥手结束时刻；0 表示没在挥手 */
  waveUntil: number;
  /** 卡住检测的采样基准 */
  lastProgressAt: number;
  lastProgressX: number;
  lastProgressY: number;
  stuckCount: number;
  /** 下一次邻居感知的时刻（social 消费） */
  nextSocialAt: number;
}

/** 每次推进的时长：与服务器 Tick 同一口径，NPC 不另跑一套时间 */
const DT_SEC = TICK_MS / 1000;
const STUCK_CHECK_MS = 600;
const STUCK_MIN_PX = 6;
const STUCK_TURN_AT = 2;
const STUCK_REST_AT = 5;
const REST_MIN_MS = 20_000;
const REST_MAX_MS = 40_000;
const LOOK_MIN_MS = 800;
const LOOK_MAX_MS = 2_500;
const WAVE_MS = 900;

const MOTION: MotionTarget = { x: 0, y: 0 };

/** 由位移向量取四向朝向；零点沿用上一个朝向 */
export function directionOf(dx: number, dy: number, fallback: Direction = DIRECTION.Down): Direction {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? DIRECTION.Right : DIRECTION.Left;
  return dy >= 0 ? DIRECTION.Down : DIRECTION.Up;
}

export function randomDirection(rng: Rng): Direction {
  const roll = rng.int(0, 3);
  if (roll === 0) return DIRECTION.Down;
  if (roll === 1) return DIRECTION.Left;
  if (roll === 2) return DIRECTION.Right;
  return DIRECTION.Up;
}

/** 停顿时长：短停 10%、常规 70%、长时间发呆 20% */
export function pickPauseMs(rng: Rng, config: NpcConfig): number {
  const roll = rng.next();
  const range =
    roll < 0.1 ? config.pauseMs.short : roll < 0.8 ? config.pauseMs.normal : config.pauseMs.long;
  return rng.int(range[0], range[1]);
}

export function createAgent(
  rng: Rng,
  player: Player,
  speedFactor: number,
  config: NpcConfig,
  now: number,
): NpcAgent {
  return {
    player,
    speed: MOVE_SPEED * speedFactor,
    phase: 'pause',
    escort: null,
    target: pickWaypoint(rng, { x: player.x, y: player.y }),
    // 出生后先站一会儿：五个人同时起步会像列队
    pauseUntil: now + rng.int(400, 2_400),
    pauseMs: 0,
    lookAt: now + rng.int(LOOK_MIN_MS, LOOK_MAX_MS),
    waveUntil: 0,
    lastProgressAt: now,
    lastProgressX: player.x,
    lastProgressY: player.y,
    stuckCount: 0,
    nextSocialAt: now + rng.int(0, config.socialIntervalMs),
  };
}

/**
 * 挥一次手：`wave` 位由服务端计时清掉。
 *
 * 客户端的远端叠加位是边沿触发，保持为 1 不会重复播放；但不清位的话，
 * 下一次移动会带着「还在挥手」的 state，看起来像卡住了。
 */
export function startWave(agent: NpcAgent, now: number): void {
  agent.waveUntil = now + WAVE_MS;
  agent.player.applyState(agent.player.direction, agent.player.pose, false, false, false, true);
  agent.player.markDirtyIfChanged();
}

export function faceToward(agent: NpcAgent, point: NpcSpot, now: number): void {
  const dx = point.x - agent.player.x;
  const dy = point.y - agent.player.y;
  const direction = directionOf(dx, dy, agent.player.direction);
  if (direction === agent.player.direction) return;
  agent.player.applyState(direction, agent.player.pose, agent.player.moving);
  agent.player.markDirtyIfChanged();
  agent.lookAt = now + LOOK_MIN_MS;
}

function enterPause(agent: NpcAgent, rng: Rng, config: NpcConfig, now: number): void {
  agent.phase = 'pause';
  agent.pauseMs = pickPauseMs(rng, config);
  agent.pauseUntil = now + agent.pauseMs;
  agent.lookAt = now + rng.int(LOOK_MIN_MS, LOOK_MAX_MS);
  agent.player.applyState(agent.player.direction, POSE.Idle, false);
  agent.player.markDirtyIfChanged();
}

function enterWalk(agent: NpcAgent, rng: Rng, now: number): void {
  agent.phase = 'walk';
  agent.target = pickWaypoint(rng, { x: agent.player.x, y: agent.player.y });
  agent.lastProgressAt = now;
  agent.lastProgressX = agent.player.x;
  agent.lastProgressY = agent.player.y;
  agent.stuckCount = 0;
  agent.player.applyState(agent.player.direction, POSE.Walk, true);
  agent.player.markDirtyIfChanged();
}

/**
 * 推进一个 NPC 一帧。
 *
 * 顺序有讲究：
 * 1) 硬直优先：被 `resolveVents` 创飞后保持躺姿，什么都不做；
 * 2) 硬直结束先站起，再重新选路，避免「躺着平移」；
 * 3) 挥手机制到期清位；
 * 4) 行走与停顿各自推进。
 */
export function updateAgent(agent: NpcAgent, rng: Rng, config: NpcConfig, now: number): void {
  const player = agent.player;

  if (now < player.stunUntil) return;

  // 硬直结束：自己爬起来，先站定半秒再继续走
  if (player.pose === POSE.Lie) {
    player.applyState(player.direction, POSE.Idle, false);
    player.markDirtyIfChanged();
    agent.phase = 'pause';
    agent.pauseMs = 600;
    agent.pauseUntil = now + agent.pauseMs;
    agent.lookAt = now + LOOK_MIN_MS;
    agent.stuckCount = 0;
    agent.lastProgressAt = now;
    agent.lastProgressX = player.x;
    agent.lastProgressY = player.y;
    return;
  }

  if (agent.waveUntil > 0 && now >= agent.waveUntil) {
    agent.waveUntil = 0;
    player.applyState(player.direction, player.pose, player.moving);
    player.markDirtyIfChanged();
  }

  if (agent.phase === 'walk') {
    const dx = agent.target.x - player.x;
    const dy = agent.target.y - player.y;
    const distance = Math.hypot(dx, dy);
    const step = agent.speed * DT_SEC;

    if (distance <= step) {
      // 到达：贴到采样点（该点已由 isBlocked 保证可站立）
      player.x = agent.target.x;
      player.y = agent.target.y;
      enterPause(agent, rng, config, now);
      return;
    }

    const unitX = dx / distance;
    const unitY = dy / distance;
    // 与服务端移动包同一个求解器：4px 子步 + 单轴滑动，不穿墙也不卡死
    resolveMotionInto(MOTION, player.x, player.y, player.x + unitX * step, player.y + unitY * step);
    player.x = MOTION.x;
    player.y = MOTION.y;

    const wave = agent.waveUntil > 0;
    player.applyState(directionOf(unitX, unitY, player.direction), POSE.Walk, true, false, false, wave);
    player.markDirtyIfChanged();

    if (now - agent.lastProgressAt >= STUCK_CHECK_MS) {
      const movedX = player.x - agent.lastProgressX;
      const movedY = player.y - agent.lastProgressY;
      if (movedX * movedX + movedY * movedY < STUCK_MIN_PX * STUCK_MIN_PX) {
        agent.stuckCount += 1;
        if (agent.stuckCount >= STUCK_REST_AT) {
          // 连续五次挪不动：原地歇一会儿再重选，绝不传送
          agent.stuckCount = 0;
          player.applyState(directionOf(movedX, movedY, player.direction), POSE.Idle, false);
          player.markDirtyIfChanged();
          agent.phase = 'pause';
          agent.pauseMs = rng.int(REST_MIN_MS, REST_MAX_MS);
          agent.pauseUntil = now + agent.pauseMs;
          agent.lookAt = now + rng.int(LOOK_MIN_MS, LOOK_MAX_MS);
        } else if (agent.stuckCount >= STUCK_TURN_AT) {
          // 换一个落点：撞到树或墙角时不必等满五次
          agent.target = pickWaypoint(rng, { x: player.x, y: player.y });
        }
      } else {
        agent.stuckCount = 0;
      }
      agent.lastProgressAt = now;
      agent.lastProgressX = player.x;
      agent.lastProgressY = player.y;
    }
    return;
  }

  // 停顿：到点就走，没到点偶尔换个视线方向（看起来在观察四周）
  if (now >= agent.pauseUntil) {
    enterWalk(agent, rng, now);
    return;
  }
  if (now >= agent.lookAt) {
    agent.lookAt = now + rng.int(LOOK_MIN_MS, LOOK_MAX_MS);
    const direction = randomDirection(rng);
    if (direction !== player.direction) {
      player.applyState(direction, POSE.Idle, false, false, false, agent.waveUntil > 0);
      player.markDirtyIfChanged();
    }
  }
}
