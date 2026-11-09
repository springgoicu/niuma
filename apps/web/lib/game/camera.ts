/**
 * 相机焦点：把「跟随谁、夹在哪、落在哪一格」收敛成纯函数，供渲染层与单测共用。
 *
 * 取整纪律（ADR-0021）：相机与角色必须使用同一个吸附函数（`snapTexel` / `Math.round`）。
 * 相机用 `Math.floor`、角色用 `Math.round` 时，两者会在每移动 1 世界像素时错开 1 纹素：
 * 角色相对背景以约 15Hz（60fps 下每 4 帧一次）横跳一个纹素，看起来就是「走路时画面在抖」。
 */
import { snapTexel } from './pixel-scale';

/** 视口比岛屿还宽时居中，否则把相机夹进包围盒；NaN 回落到中心 */
export function cameraAxis(value: number, start: number, length: number, half: number): number {
  if (!Number.isFinite(value)) return start + length / 2;
  if (half * 2 >= length) return start + length / 2;
  return value < start + half ? start + half : value > start + length - half ? start + length - half : value;
}

/**
 * 先夹紧再吸附：贴边时相机停在包围盒内侧，世界层始终落在整数纹素上，
 * 未夹紧时返回值与角色渲染坐标（`snapTexel`）完全一致，角色相对屏幕不位移。
 */
export function cameraFocus(value: number, start: number, length: number, half: number): number {
  return snapTexel(cameraAxis(value, start, length, half));
}
