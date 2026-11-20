import {
  GHOST_MODE,
  GHOST_SPEED_MUL,
  ISLAND_SAND,
  MOVE_SPEED,
  P2P_DUEL_IFRAME_MS,
  POSE,
  clampWorldX,
  clampWorldY,
  dequantizeCoord,
  isOnLand,
  resolveWalkInto,
  seatById,
  seatPose,
  unpackState,
  type MovePacket,
  type MotionTarget,
  type Pose,
  type SeatStateEntry,
} from '@niuma/shared-types';
import type { Player } from './world';
import type { SeatRegistry } from './seats';

/** 允许的时间窗下限，避免同一毫秒内连发被误判 */
const MIN_WINDOW_MS = 8;
/**
 * 允许的时间窗上限（5 个 Tick）。
 *
 * 上行改成「有变化才发」之后，站着不动很久再走会留下几百毫秒甚至更长的间隔；
 * 窗口不封顶的话，`allowed` 会跟着间隔线性放大，等于给了一次免费瞬移。
 * 封顶后单包最多放行 165×0.25×1.25+3 ≈ 55px，既能吸收抖动丢包，又把瞬移压住。
 */
const MAX_WINDOW_MS = 250;
/** 网络抖动与插值误差余量 */
const TOLERANCE = 1.25;
const SLACK_PX = 3;

/**
 * 移动包是 200 人 × 20Hz = 4000 条/秒的热路径，返回值与座位变更都复用同一块 scratch。
 * 调用方必须**立刻消费**结果，不能跨包持有：`server.ts` 拿到就广播，符合这个约定。
 */
const RESULT: MoveResult = { accepted: false, crossed: false, clamped: false, released: [] };
const RELEASED: SeatStateEntry[] = [];
const MOTION: MotionTarget = { x: 0, y: 0 };

function sanitizePose(pose: number): Pose {
  // 姿态只有四态；越界值（含 bit4 被旧客户端读进 pose 得到的 4）一律按待机处理
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
export function applyMove(
  player: Player,
  packet: MovePacket,
  now: number,
  seats?: SeatRegistry,
): MoveResult {
  // packet.id 仅用于协议完整性与日志，服务端一律以连接绑定的实体为准

  RELEASED.length = 0;
  RESULT.accepted = false;
  RESULT.crossed = false;
  RESULT.clamped = false;
  RESULT.released = RELEASED;

  // 防重复：如果有序号且低于已处理的序号，直接丢弃
  if (packet.clientSequence !== undefined) {
    if (packet.clientSequence <= player.lastClientMoveSequence) return RESULT;
    player.lastClientMoveSequence = packet.clientSequence;
  }

  // 公寓窗口探头（ADR-0098）：人在窗里，位移与姿态一概不采信，只保留门口台阶上的站姿
  if (player.roomId !== 0) {
    player.applyState(player.direction, POSE.Idle, false);
    player.markDirtyIfChanged();
    return RESULT;
  }

  /**
   * 倒地硬直（ADR-0051）：被创飞的 1.5 秒内不采信客户端的姿态与位移。
   *
   * 只拦上报、不改 `lastMoveAt`：硬直结束时时间窗会被 MAX_WINDOW_MS 封顶，
   * 一次最多放行 55px，正好容得下那 32px 的击退落点，不会把人拽回去。
   * 姿态每个包都重打包成同一个 state，`markIfChanged` 在第一次之后就不再置 dirty。
   */
  if (now < player.stunUntil) {
    player.applyState(player.direction, POSE.Lie, false);
    player.markDirtyIfChanged();
    return RESULT;
  }

  // 昏迷 / 拖拽 / 病床治疗 / 街头倒地期间：位置与姿态不采信客户端上报
  if (player.incapacitated || player.ghostMode === GHOST_MODE.Flatline || now < player.fallUntil) {
    player.applyState(player.direction, POSE.Lie, false);
    player.markDirtyIfChanged();
    return RESULT;
  }

  const state = unpackState(packet.state);
  const pose = sanitizePose(state.pose);

  // 驾车状态：保存操控方向与意图终点，位置与物理碰撞全权由 VehicleRuntime 在 20Hz Tick 里积分
  if (player.vehicleId > 0) {
    player.driveTargetX = dequantizeCoord(packet.x);
    player.driveTargetY = dequantizeCoord(packet.y);
    player.driveTargetAt = now;
    player.lastMoveAt = now;
    player.applyState(state.direction, POSE.Sit, false);
    player.markDirtyIfChanged();
    RESULT.accepted = true;
    return RESULT;
  }

  if (player.seat !== 0) {
    // 座位上该是坐还是躺由座位种类决定：床位收 Lie，其余收 Sit；上报其它姿态即起身
    const seat = seatById(player.seat);
    const expected = seat ? seatPose(seat.kind) : POSE.Sit;
    if (pose !== expected) {
      if (seats) seats.stand(player, RELEASED);
    } else {
      // 座位上位置不动，只接受原地的发泄 / 挥手；跳跃需要先起身，这里不接
      const stationary = !state.moving;
      player.applyState(player.direction, expected, false, stationary && state.vent, false, stationary && state.wave);
      player.markDirtyIfChanged();
      return RESULT;
    }
  }

  const targetX = dequantizeCoord(packet.x);
  const targetY = dequantizeCoord(packet.y);
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const elapsed = Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, now - player.lastMoveAt));
  // 幽灵出窍态享受 1.25× 漂移穿墙（仍受陆地岛界兜底约束，不可漂进深海）
  const ghostMul = player.ghostMode === GHOST_MODE.Ghost ? GHOST_SPEED_MUL : 1;
  // 移速乘子由 Buff 缓存提供（冰美式 1.15 / 降薪贴 0.8）；
  // 这里只读标量，避免在 20Hz 路径上遍历 activeBuffs
  const allowed = ((MOVE_SPEED * player.speedMul * ghostMul * elapsed) / 1000) * TOLERANCE + SLACK_PX;
  const clamped = distance > allowed && distance > 0;
  const scale = clamped ? allowed / distance : 1;

  // 先按时间窗截断，再交给地形求解：碰撞只负责「能不能走过去」，不负责限速
  const nextX = clampWorldX(player.x + dx * scale);
  const nextY = clampWorldY(player.y + dy * scale);
  if (player.ghostMode === GHOST_MODE.Ghost) {
    if (isOnLand(nextX, nextY, ISLAND_SAND)) {
      player.x = nextX;
      player.y = nextY;
    } else if (isOnLand(nextX, player.y, ISLAND_SAND)) {
      player.x = nextX;
    } else if (isOnLand(player.x, nextY, ISLAND_SAND)) {
      player.y = nextY;
    }
  } else {
    resolveWalkInto(MOTION, player.x, player.y, nextX, nextY);
    player.x = MOTION.x;
    player.y = MOTION.y;
  }
  player.lastMoveAt = now;

  // 行走中不接打招呼：图集没有行走挥手帧，套上去就是脚在滑。
  // 发泄与跳跃都放行——发泄是「打断移动直接出招」，客户端会在出招窗口内停止位移并落回站姿，
  // 这里再按 stationary 拦一道，反而会把「边走边按 E」的第一包吃掉（ADR-0051）。
  // 到期由客户端按各自窗口清位，服务端不另设计时器（ADR-0019 / 0051）。
  const stationary = pose !== POSE.Walk && !state.moving;
  // 跳跃上升沿记 0.4s 无敌帧：头槌结算读 jumpUntilMs，持续按住的后续帧不会续期
  const jumpStarted = state.jump && !player.jump;
  player.applyState(
    state.direction,
    pose,
    state.moving,
    state.vent,
    state.jump,
    stationary && state.wave,
  );
  if (jumpStarted) player.jumpUntilMs = now + P2P_DUEL_IFRAME_MS;
  player.markDirtyIfChanged();

  RESULT.accepted = true;
  RESULT.clamped = clamped;
  return RESULT;
}
