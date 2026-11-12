/**
 * 发泄（Vent）命中几何：出招者正前方的一个扇形。
 *
 * 服务端用它裁决「这一记有没有打到人」，客户端用同一个函数判断
 * 「点击的这个相邻玩家是否在出招范围内」。两端共用一份实现，
 * 玩家看到的可打范围与服务端的判定区不会差半个身位。
 *
 * 纯函数、零分配、无开方：20Hz Tick 里每个出招者都要扫一遍视野内的人。
 */

import { DIRECTION, VENT_HALF_ANGLE_DEG, VENT_RANGE_PX, type Direction } from '../constants';

/**
 * 四向轴对齐朝向向量，下标与 `DIRECTION` 一致（Down=0 / Left=1 / Right=2 / Up=3）。
 *
 * 角色只有四个朝向，所以判定区永远是朝上、下、左、右的楔形，
 * 不存在八向斜角分支——这也是 `directionFromVector` 横向优先的延伸。
 */
export const VENT_FACING: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
];

/** 半角余弦的平方：与「点积平方 vs 距离平方 × cos²」比较，省掉一次开方与一次除法 */
function cosHalfSqOf(halfAngleDeg: number): number {
  const cos = Math.cos((halfAngleDeg * Math.PI) / 180);
  return cos * cos;
}

const DEFAULT_COS_HALF_SQ = cosHalfSqOf(VENT_HALF_ANGLE_DEG);

/**
 * 目标是否落在出招者前方的扇形内。
 *
 * `ax/ay` 出招者、`direction` 出招朝向、`bx/by` 候选目标，坐标同为世界像素。
 * 判定两件事：距离不超过 `range`，且与朝向的夹角不超过 `halfAngleDeg`。
 * 目标与出招者完全重合时按命中处理——贴脸不该因为「算不出方向」而漏判。
 */
export function withinVentCone(
  ax: number,
  ay: number,
  direction: Direction,
  bx: number,
  by: number,
  range: number = VENT_RANGE_PX,
  halfAngleDeg: number = VENT_HALF_ANGLE_DEG,
): boolean {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  const distanceSq = dx * dx + dy * dy;
  // 先比距离：绝大多数候选目标在这里就被排除，后面的点积只对近处的人算
  if (distanceSq > range * range) return false;
  if (distanceSq <= 0) return true;

  const facing = VENT_FACING[direction] ?? VENT_FACING[DIRECTION.Down]!;
  const dot = dx * facing.x + dy * facing.y;
  // 背对目标时点积为负：直接出局，也避免下一步拿负数平方去比较
  if (dot <= 0) return false;

  const cosHalfSq =
    halfAngleDeg === VENT_HALF_ANGLE_DEG ? DEFAULT_COS_HALF_SQ : cosHalfSqOf(halfAngleDeg);
  // dot/|d| ≥ cosθ  ⇔  dot² ≥ |d|²·cos²θ（两侧都非负，平方不改变符号）
  return dot * dot >= distanceSq * cosHalfSq;
}
