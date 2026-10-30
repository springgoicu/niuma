import {
  MOVE_SPEED,
  POSE,
  clampWorldX,
  clampWorldY,
  dequantizeCoord,
  resolveMotion,
  unpackState,
  type MovePacket,
  type Pose,
} from '@niuma/shared-types';
import type { Player } from './world';

/** 允许的时间窗下限，避免同一毫秒内连发被误判 */
const MIN_WINDOW_MS = 8;
/** 网络抖动与插值误差余量 */
const TOLERANCE = 1.25;
const SLACK_PX = 3;

function sanitizePose(pose: number): Pose {
  if (pose > POSE.Emote) return POSE.Idle;
  return pose as Pose;
}

export interface MoveResult {
  accepted: boolean;
  crossed: boolean;
  clamped: boolean;
}

/**
 * 服务端权威移动：客户端上报目标点，服务端按时间窗限速。
 * 超速不踢人，只把坐标沿原方向截断到允许距离——避免误伤高延迟玩家。
 */
export function applyMove(player: Player, packet: MovePacket, now: number): MoveResult {
  // packet.id 仅用于协议完整性与日志，服务端一律以连接绑定的实体为准
  const targetX = dequantizeCoord(packet.x);
  const targetY = dequantizeCoord(packet.y);
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distance = Math.hypot(dx, dy);

  const elapsed = Math.max(MIN_WINDOW_MS, now - player.lastMoveAt);
  const allowed = (MOVE_SPEED * elapsed) / 1000 * TOLERANCE + SLACK_PX;
  const clamped = distance > allowed && distance > 0;
  const scale = clamped ? allowed / distance : 1;

  // 先按时间窗截断，再交给地形求解：碰撞只负责「能不能走过去」，不负责限速
  const nextX = clampWorldX(player.x + dx * scale);
  const nextY = clampWorldY(player.y + dy * scale);
  const resolved = resolveMotion(player.x, player.y, nextX, nextY);
  player.x = resolved.x;
  player.y = resolved.y;
  player.lastMoveAt = now;

  const state = unpackState(packet.state);
  const pose = sanitizePose(state.pose);
  player.applyState(state.direction, pose, state.moving);
  player.dirty = true;

  return { accepted: true, crossed: false, clamped };
}
