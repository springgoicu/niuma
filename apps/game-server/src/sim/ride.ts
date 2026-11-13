import {
  POSE,
  SLIDE_COOLDOWN_MS,
  SLIDE_INTERACT_RANGE,
  SLIDE_PHASE,
  encodeSlideEvent,
  slideById,
  slidePointInto,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import type { Transport } from './view';
import type { Player, World } from './world';

/**
 * 游乐园滑梯的权威乘坐状态机（本轮新增）。
 *
 * 三条纪律与座位 / 发泄一致：
 * 1) **服务端决定轨迹**：客户端只发「我想滑哪座」，塔顶坐标、每 Tick 的位置与落点
 *    全部由共享折线的 `slidePointInto` 决定，伪造包改不了落点；
 * 2) **开始瞬间的传送是脚本化的**：把玩家从缓冲区放到塔顶，不走 `resolveMotion`，
 *    只更新空间索引与视野；滑行期间 `applyMove` 直接忽略客户端上报；
 * 3) **落点必须回到自由地面**：结束时写 landing、清空 ride 状态、把 `lastMoveAt`
 *    重置到当前时刻，避免下一次移动被 250ms 的速度窗口误判成瞬移。
 *
 * 状态只活在 `Player` 内存里：断线、进程重启即清空，不落库。
 */
const POINT = { x: 0, y: 0 };

export function isRiding(player: Player, now: number): boolean {
  return player.rideSlide !== 0 && now < player.rideEndsAt;
}

/**
 * 开始一次滑行。返回 true 表示已经进入滑行状态。
 *
 * 拒绝条件与客户端提示共用同一套口径：坐着、倒地硬直、正在滑、冷却中、
 * 离落地点超过 `SLIDE_INTERACT_RANGE`、滑梯 id 不存在，全部不采信。
 */
export function startRide(player: Player, slideId: number, now: number): boolean {
  if (player.seat !== 0) return false;
  if (now < player.stunUntil) return false;
  if (player.rideSlide !== 0 || now < player.rideEndsAt) return false;
  // lastSlideAt = 0 表示本局还没滑过：不能拿 0 当基准把第一次请求也挡掉
  if (player.lastSlideAt > 0 && now - player.lastSlideAt < SLIDE_COOLDOWN_MS) return false;

  const slide = slideById(slideId);
  if (!slide) return false;
  const dx = player.x - slide.landing.x;
  const dy = player.y - slide.landing.y;
  if (dx * dx + dy * dy > SLIDE_INTERACT_RANGE * SLIDE_INTERACT_RANGE) return false;

  player.rideSlide = slideId;
  player.rideEndsAt = now + slide.rideMs;
  player.lastSlideAt = now;
  player.x = slide.top.x;
  player.y = slide.top.y;
  const direction = slidePointInto(POINT, slideId, 0);
  player.applyState(direction, POSE.Sit, false);
  player.markDirtyIfChanged();
  return true;
}

/** 滑行开始 / 结束的广播：本人 + 看得见他的人（与发泄同一份可见性口径） */
export function broadcastSlide(
  world: World,
  player: Player,
  slideId: number,
  phase: number,
  transport: Transport,
): void {
  const packet = encodeSlideEvent(player.id, slideId, phase);
  if (player.wsId !== 0) transport.send(player.wsId, packet);
  for (const id of player.known) {
    const viewer = world.get(id);
    if (viewer && viewer.wsId !== 0) transport.send(viewer.wsId, packet);
  }
}

/**
 * 每 Tick 推进所有正在滑行的玩家。
 *
 * 必须在 `runTick` 之前调用：新坐标与席地坐姿要赶在同一 Tick 的 dirty 广播里发出去，
 * 晚一帧就会让旁观者看到「先站着、再瞬移」的撕裂。
 */
export function advanceRides(
  world: World,
  grid: SpatialGrid,
  transport: Transport,
  now: number,
): void {
  for (const player of world.players.values()) {
    if (player.rideSlide === 0) continue;
    const slide = slideById(player.rideSlide);
    if (!slide) {
      player.rideSlide = 0;
      player.rideEndsAt = 0;
      continue;
    }

    const remaining = player.rideEndsAt - now;
    if (remaining <= 0) {
      player.x = slide.landing.x;
      player.y = slide.landing.y;
      player.rideSlide = 0;
      player.rideEndsAt = 0;
      player.lastMoveAt = now;
      player.applyState(player.direction, POSE.Idle, false);
      player.markDirtyIfChanged();
      if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
      broadcastSlide(world, player, slide.id, SLIDE_PHASE.Finish, transport);
      continue;
    }

    const t = 1 - remaining / slide.rideMs;
    const direction = slidePointInto(POINT, slide.id, t);
    player.x = POINT.x;
    player.y = POINT.y;
    player.applyState(direction, POSE.Sit, false);
    player.markDirtyIfChanged();
    if (grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
  }
}
