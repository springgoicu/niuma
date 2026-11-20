/**
 * 护士急救站步行通行求解：全面放开健康玩家步行进站参观与续杯咖啡。
 *
 * 优化说明：
 * 旧版曾通过空气墙阻拦健康玩家进入西侧大门；新版急诊大厅全面开放：
 * 只要没有撞到北/东/西围栏、导医台或病床实心体，玩家可自由推门走进
 * 急诊大厅慰问病床上的同事、围观救护车进出并在吧台领取免费孟婆咖啡。
 */

import { CLINIC_RECT } from './clinic';
import { PLAYER_RADIUS, resolveMotionInto, type MotionTarget } from './collision';

/** 是否站在急诊站台内部地面 */
export function isInClinicInterior(x: number, y: number): boolean {
  return (
    x > CLINIC_RECT.x &&
    x < CLINIC_RECT.x + CLINIC_RECT.w &&
    y > CLINIC_RECT.y &&
    y < CLINIC_RECT.y + CLINIC_RECT.h
  );
}

/**
 * 步行位移求解：统一走地形与实心体碰撞求解，健康玩家与伤员均自由进出急诊大门。
 * 返回值保持签名兼容，固定返回 `false`（不再人为拦截进门）。
 */
export function resolveWalkInto(
  out: MotionTarget,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number = PLAYER_RADIUS,
): boolean {
  resolveMotionInto(out, fromX, fromY, toX, toY, radius);
  return false;
}
