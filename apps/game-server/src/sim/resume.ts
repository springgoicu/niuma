import {
  DIRECTION,
  POSE,
  SPAWN_CENTER,
  findFreePoint,
  isBlocked,
  isOnLand,
  isWaterAt,
  seatById,
  seatPose,
  type Direction,
  type Pose,
  type ResumeState,
  type SeatInstance,
} from '@niuma/shared-types';

/** 出生裁决结果：坐标、朝向、姿态，以及命中的座位（null 表示不占座） */
export interface ResolvedSpawn {
  x: number;
  y: number;
  direction: Direction;
  pose: Pose;
  seat: SeatInstance | null;
}

/**
 * 出生点在中央迎宾广场散布（ADR-0047）；落进花坛/水面/障碍时由 `findFreePoint` 就近挪到空地。
 * 压测会把半径放大到 3000，采样点可能落海：先拒绝采样重抽，避免整批人被兜底塞回广场。
 */
export function spawnPoint(radius: number): { x: number; y: number } {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * radius;
    const x = SPAWN_CENTER.x + Math.cos(angle) * distance;
    const y = SPAWN_CENTER.y + Math.sin(angle) * distance;
    // 连障碍与水面一起拒：出生点落在湖心观感糟糕，也确实离广场中心太远
    if (!isOnLand(x, y) || isBlocked(x, y) || isWaterAt(x, y)) continue;
    return findFreePoint(x, y);
  }
  // 兜底回中央广场；`findFreePoint` 自己的世界中心兜底是给移动卡死恢复用的，不能改
  return findFreePoint(SPAWN_CENTER.x, SPAWN_CENTER.y);
}

/**
 * 一次落点是否可以站人：与出生点同一套判据，水面即使可涉水也不作为恢复点。
 */
function isStandable(x: number, y: number): boolean {
  return isOnLand(x, y) && !isBlocked(x, y) && !isWaterAt(x, y);
}

/**
 * 座位错位的容忍半径。
 *
 * 正常存档里 `resume.x / y` 就是座位锚点（入座后角色坐标即座位坐标）。
 * 但座位 id 是「座位表下标 + 1」，布局增删座位会让其后所有 id 前移
 * （ADR-0105 拆掉摸鱼亭四张石鼓凳后，后面的影厅座椅、长椅、病床、赌桌圆凳全部前移 4）。
 * 老存档里的 seatId 因此可能指向另一张远处的椅子；距离对不上就不认座。
 */
const RESUME_SEAT_SLACK = 64;

function seatMatchesPoint(seat: SeatInstance, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.hypot(seat.x - x, seat.y - y) <= RESUME_SEAT_SLACK;
}

/**
 * 把客户端上报的 resume 裁决成真正可用的出生点。
 *
 * 客户端缓存一律视为不可信输入：坐标要重新过地形判据，座位要重新查权威占用表。
 * 座位仍空闲就吸附回去；被占了则站到座位旁，姿态回站立。
 * 地面坐 / 躺没有座位可争，只保留姿态。行走姿态不跨会话，一律降回 Idle。
 */
export function resolveSpawn(
  resume: ResumeState | undefined,
  isSeatFree: (seatId: number) => boolean,
  spawnRadius: number,
): ResolvedSpawn {
  if (!resume) {
    const point = spawnPoint(spawnRadius);
    return { x: point.x, y: point.y, direction: DIRECTION.Down, pose: POSE.Idle, seat: null };
  }

  const reported = resume.seatId > 0 ? seatById(resume.seatId) : undefined;
  // id 还在、但坐标对不上：说明座位表改过，这张椅子不是玩家当初坐的那张
  const seat = reported && seatMatchesPoint(reported, resume.x, resume.y) ? reported : undefined;
  if (seat && isSeatFree(seat.id)) {
    return { x: seat.x, y: seat.y, direction: seat.facing, pose: seatPose(seat.kind), seat };
  }

  // 座位已被占（或这个 id 已经不存在）：以座位为锚点站旁边，而不是退回随机出生点
  const anchor = seat ?? resume;
  let x = anchor.x;
  let y = anchor.y;
  if (!isStandable(x, y)) {
    const nearby = findFreePoint(x, y);
    if (isStandable(nearby.x, nearby.y)) {
      x = nearby.x;
      y = nearby.y;
    } else {
      const point = spawnPoint(spawnRadius);
      x = point.x;
      y = point.y;
    }
  }

  return {
    x,
    y,
    direction: resume.direction,
    pose: seat ? POSE.Idle : resume.pose === POSE.Walk ? POSE.Idle : resume.pose,
    seat: null,
  };
}
