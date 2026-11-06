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
  type SeatStateEntry,
} from '@niuma/shared-types';
import type { Player } from './world';
import type { SeatRegistry } from './seats';

/** 允许的时间窗下限，避免同一毫秒内连发被误判 */
const MIN_WINDOW_MS = 8;
/** 网络抖动与插值误差余量 */
const TOLERANCE = 1.25;
const SLACK_PX = 3;

function sanitizePose(pose: number): Pose {
  // 姿态只有四态；越界值（含已废弃的 Emote=4）一律按待机处理
  if (pose > POSE.Lie) return POSE.Idle;
  return pose as Pose;
}

export interface MoveResult {
  accepted: boolean;
  crossed: boolean;
  clamped: boolean;
  /** 本包导致的座位释放（移动或改姿态起身），调用方需广播 */
  released: SeatStateEntry[];
}

/**
 * 服务端权威移动：客户端上报目标点，服务端按时间窗限速。
 * 超速不踢人，只把坐标沿原方向截断到允许距离——避免误伤高延迟玩家。
 * 
 * 支持新协议中的 clientSequence 防重复和 clientTimestampMs 用于延迟估计。
 *
 * 座位规则：入座后位置由座位锁定；上报的姿态不再是坐姿即视为起身，随后按正常移动处理。
 */
export function applyMove(player: Player, packet: MovePacket, now: number, seats?: SeatRegistry): MoveResult {
  // packet.id 仅用于协议完整性与日志，服务端一律以连接绑定的实体为准
  
  // 防重复：如果有序号且低于已处理的序号，直接丢弃
  if (packet.clientSequence !== undefined) {
    if (packet.clientSequence <= player.lastClientMoveSequence) {
      return { accepted: false, crossed: false, clamped: false, released: [] };
    }
    player.lastClientMoveSequence = packet.clientSequence;
  }

  const state = unpackState(packet.state);
  const pose = sanitizePose(state.pose);
  const released: SeatStateEntry[] = [];

  if (player.seat !== 0) {
    if (pose !== POSE.Sit) {
      released.push(...(seats?.stand(player) ?? []));
    } else {
      // 坐姿中位置不动，只接受原地的叫唤 / 挥手；跳跃需要先起身，这里不接
      const stationary = !state.moving;
      player.applyState(player.direction, POSE.Sit, false, stationary && state.emote, false, stationary && state.wave);
      player.dirty = true;
      return { accepted: false, crossed: false, clamped: false, released };
    }
  }
  
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

  // 行走中不接叫唤与打招呼：图集没有行走张嘴帧，也没有行走挥手帧，套上去就是脚在滑。
  // 跳跃是位移动作，行走中必须放行；到期由客户端按各自窗口清位，服务端不另设计时器（ADR-0018 / 0019）。
  const stationary = pose !== POSE.Walk && !state.moving;
  player.applyState(
    state.direction,
    pose,
    state.moving,
    stationary && state.emote,
    state.jump,
    stationary && state.wave,
  );
  player.dirty = true;

  return { accepted: true, crossed: false, clamped, released };
}
