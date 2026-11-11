'use client';

/**
 * 虚拟摇杆的数学（ADR-0032）：屏幕偏移 → 移动向量。
 *
 * 全模块只有一条不变量：**输出的模长只取决于手指离摇杆中心多远，与方向无关**。
 * 斜着推和左右推在同一个半径上必须给出同样长的向量，否则角色斜向会比直行快
 * （历史上这里用 DOM 的 `max(width, height) / 2` 当半径，摇杆一旦被布局拉伸，
 * 方形对角与边中点的归一化就不一致）。
 *
 * 逻辑半径写死为 `STICK_RADIUS`，视觉环与计算共用同一个数；不 import pixi、不读 DOM，
 * 可以单独验算。旋转舞台的坐标换算也在这里做，组件只负责指针事件与绘制。
 */

/** 摇杆基座直径与摇杆头直径（CSS px）：视觉尺寸只在这里定义一次 */
export const STICK_BASE = 112;
export const STICK_KNOB = 44;
/**
 * 摇杆逻辑半径 = 摇杆头能走的行程：(基座 - 头) / 2。
 * 摇杆头推到内环边缘时正好是满力，视觉与计算不再各说一套。
 */
export const STICK_RADIUS = (STICK_BASE - STICK_KNOB) / 2;
/** 摇杆死区：小于该力度视为静止，避免拇指轻碰就滑步 */
export const STICK_DEAD_ZONE = 0.18;

export interface StickInput {
  x: number;
  y: number;
}

/**
 * 屏幕偏移 `(sx, sy)`（相对摇杆中心，y 向下为正）→ 舞台坐标下的移动向量。
 *
 * - `rotated`：竖屏时舞台被 CSS 顺时针旋转 90°，屏幕向量要先换算回舞台本地坐标；
 * - 输出模长 = `(力度 - 死区) / (1 - 死区)`，力度 = 行程 / 半径；
 * - 半径外的偏移钳到半径，不会因为推到圆外突然加速。
 */
export function stickVector(
  sx: number,
  sy: number,
  rotated = false,
  radius: number = STICK_RADIUS,
  deadZone: number = STICK_DEAD_ZONE,
): StickInput {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const dx = rotated ? sy : sx;
  const dy = rotated ? -sx : sy;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };

  // 力度只看离原点多远：方向单位 × 统一力度，斜向与直行同速
  const force = Math.min(length, radius) / radius;
  if (force <= deadZone) return { x: 0, y: 0 };
  const strength = (force - deadZone) / (1 - deadZone);
  return { x: (dx / length) * strength, y: (dy / length) * strength };
}

/** 摇杆头的屏幕偏移：只钳半径，不做死区重标定（视觉上摇杆头跟着手指走） */
export function stickKnob(sx: number, sy: number, radius: number = STICK_RADIUS): StickInput {
  const length = Math.hypot(sx, sy);
  if (length <= radius || length === 0) return { x: sx, y: sy };
  return { x: (sx / length) * radius, y: (sy / length) * radius };
}
