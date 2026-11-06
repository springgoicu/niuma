import { DIRECTION, Direction, FIXED_SCALE, POSE, Pose, WORLD_HEIGHT, WORLD_WIDTH } from './constants';

/**
 * 坐标量化：像素浮点 -> u16 定点。
 * 唯一实现，客户端与服务端必须共用，禁止就地复制。
 */
const MAX_QUANT = Math.round(WORLD_WIDTH * FIXED_SCALE) - 1;

export function quantizeCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Math.round(value * FIXED_SCALE);
  if (scaled <= 0) return 0;
  if (scaled >= MAX_QUANT) return MAX_QUANT;
  return scaled;
}

export function dequantizeCoord(value: number): number {
  return value / FIXED_SCALE;
}

export function clampWorldX(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > WORLD_WIDTH - 1 ? WORLD_WIDTH - 1 : x;
}

export function clampWorldY(y: number): number {
  if (!Number.isFinite(y)) return 0;
  return y < 0 ? 0 : y > WORLD_HEIGHT - 1 ? WORLD_HEIGHT - 1 : y;
}

/**
 * 位打包：bit0-1 朝向，bit2-3 姿态，bit4 打招呼，bit5 移动标志，bit6 叫唤，bit7 跳。
 *
 * 叫唤 / 跳 / 打招呼是一次性叠加动作，与姿态正交：位只在播放窗口内为真，
 * 客户端到期自己清位，服务端只负责回传（ADR-0018 / ADR-0019）。
 *
 * 姿态只有 0-3 四个值，原来的 3 bit 字段高位（bit4）恒为 0，
 * 因此第三个叠加位直接复用这一位，包长与 opcode 都不变。
 * 混布降级：旧客户端会把 bit4 读进 pose 得到 4，回落 idle；旧服务端 sanitizePose 归 Idle 并丢位。
 */
export function packState(
  direction: Direction,
  pose: Pose,
  moving: boolean,
  emote = false,
  jump = false,
  wave = false,
): number {
  return (
    ((direction & 0b11) |
      ((pose & 0b11) << 2) |
      (wave ? 0b10000 : 0) |
      (moving ? 0b100000 : 0) |
      (emote ? 0b1000000 : 0) |
      (jump ? 0b10000000 : 0)) &
    0xff
  );
}

export function unpackState(state: number): {
  direction: Direction;
  pose: Pose;
  moving: boolean;
  emote: boolean;
  jump: boolean;
  wave: boolean;
} {
  const direction = (state & 0b11) as Direction;
  const pose = ((state >> 2) & 0b11) as Pose;
  return {
    direction,
    pose,
    moving: (state & 0b100000) !== 0,
    emote: (state & 0b1000000) !== 0,
    jump: (state & 0b10000000) !== 0,
    wave: (state & 0b10000) !== 0,
  };
}

/** 由速度向量推导朝向：横向优先于纵向，保持八向输入下的稳定表现 */
export function directionFromVector(dx: number, dy: number, fallback: Direction): Direction {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? DIRECTION.Right : DIRECTION.Left;
  }
  return dy > 0 ? DIRECTION.Down : DIRECTION.Up;
}

export function poseForMovement(pose: Pose, moving: boolean): Pose {
  if (pose === POSE.Sit || pose === POSE.Lie) return pose;
  return moving ? POSE.Walk : POSE.Idle;
}
