/**
 * 护士急救站门禁（ADR-0107）：只挡「从站外跨进站内」的步行位移。
 *
 * 为什么不做实体墙：墙会同时挡住救护车（`moveCar` 与步行共用 `resolveMotionInto`），
 * 还会让 `findFreePoint` 把站内治好的伤员「脱困」传送出站，违反「自己走出去」。
 * 所以规则放在求解这一层：站外 → 站内 的位移夹回门线，站内 → 任意方向原样放行。
 *
 * 边界取严格内点：夹取会把脚底落在门线上，若门线也算站内，
 * 下一帧就重新获得向内走的许可（夹一次、进一寸地漏进去）。
 */

import { CLINIC_RECT } from './clinic';
import { PLAYER_RADIUS, resolveMotionInto, type MotionTarget } from './collision';

/** 夹到门线外多少像素：0.5px 足够让严格内点判定认为「还在门外」，肉眼又看不出来 */
const DOOR_EPS = 0.5;

/** 是否严格站在站内地面（不含围挡带与门线本身） */
export function isInClinicInterior(x: number, y: number): boolean {
  return (
    x > CLINIC_RECT.x &&
    x < CLINIC_RECT.x + CLINIC_RECT.w &&
    y > CLINIC_RECT.y &&
    y < CLINIC_RECT.y + CLINIC_RECT.h
  );
}

/**
 * 把「站外 → 站内」的目标点夹到门线上，写进 `out`；不在进门位移时返回 false。
 *
 * slabs 法求线段与矩形边界的入点参数：取两轴近平面参数里更大的那个，
 * 那正是真正被跨过的那条边。切向分量按入点保留——斜着走会贴着门框滑行；
 * 整步回退会把门角走成死胡同，所以不用「回退到起点」这种解法。
 */
function clampEntryPoint(
  out: MotionTarget,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const x0 = CLINIC_RECT.x;
  const x1 = CLINIC_RECT.x + CLINIC_RECT.w;
  const y0 = CLINIC_RECT.y;
  const y1 = CLINIC_RECT.y + CLINIC_RECT.h;

  /** 入点参数；-1 表示这一轴没有从外侧跨进来 */
  let t = -1;
  /** 1 = 跨 x 边（西门 / 东侧），2 = 跨 y 边（南通道 / 北侧） */
  let axis = 0;
  /** 是否沿 +x / +y 方向进入：true 对应西边（x0）与北边（y0） */
  let forward = false;

  if (toX > fromX && fromX <= x0) {
    t = (x0 - fromX) / (toX - fromX);
    axis = 1;
    forward = true;
  } else if (toX < fromX && fromX >= x1) {
    t = (x1 - fromX) / (toX - fromX);
    axis = 1;
    forward = false;
  }

  if (toY > fromY && fromY <= y0) {
    const ty = (y0 - fromY) / (toY - fromY);
    if (ty > t) {
      t = ty;
      axis = 2;
      forward = true;
    }
  } else if (toY < fromY && fromY >= y1) {
    const ty = (y1 - fromY) / (toY - fromY);
    if (ty > t) {
      t = ty;
      axis = 2;
      forward = false;
    }
  }

  if (axis === 0 || t <= 0 || t > 1) return false;

  const entryX = fromX + (toX - fromX) * t;
  const entryY = fromY + (toY - fromY) * t;
  if (axis === 2) {
    out.x = entryX;
    out.y = forward ? y0 - DOOR_EPS : y1 + DOOR_EPS;
  } else {
    out.x = forward ? x0 - DOOR_EPS : x1 + DOOR_EPS;
    out.y = entryY;
  }
  return true;
}

/**
 * 步行位移求解 = 地形求解 + 护士站门禁。
 *
 * 除了救护车与传送，园区里所有「用脚走」的位移都走这里：真人、巡逻 NPC、
 * 押送保安、击退与冲击波。返回值表示这一帧是否被门禁挡下，仅供客户端做节流提示，
 * 服务端不消费它——速度截断口径仍然只看 `applyMove` 自己的 `clamped`。
 */
export function resolveWalkInto(
  out: MotionTarget,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number = PLAYER_RADIUS,
): boolean {
  const fromInside = isInClinicInterior(fromX, fromY);
  if (!fromInside && isInClinicInterior(toX, toY)) {
    if (!clampEntryPoint(out, fromX, fromY, toX, toY)) {
      // 数值上找不到入点（理论上不发生）：这一帧原地不动，绝不冒险放进去
      out.x = fromX;
      out.y = fromY;
      return true;
    }
    const targetX = out.x;
    const targetY = out.y;
    resolveMotionInto(out, fromX, fromY, targetX, targetY, radius);
    // 兜底：门线上的切向分量撞上围挡后仍可能被挤进站内，宁可这一帧不动
    if (isInClinicInterior(out.x, out.y)) {
      out.x = fromX;
      out.y = fromY;
    }
    return true;
  }

  resolveMotionInto(out, fromX, fromY, toX, toY, radius);
  if (!fromInside && isInClinicInterior(out.x, out.y)) {
    out.x = fromX;
    out.y = fromY;
    return true;
  }
  return false;
}
