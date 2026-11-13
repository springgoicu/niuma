/**
 * 保安头顶警灯：红蓝交替的纯时间函数。
 *
 * 灯态直接由 `now` 算，不存额外状态：暂停、切后台、掉帧都不会让两盏灯错位。
 */
export const BEACON_PHASE_MS = 400;
export const BEACON_WIDTH = 14;
export const BEACON_HEIGHT = 5;
export const BEACON_RED = 0xff3b30;
export const BEACON_BLUE = 0x2e7bff;
/** 熄灭那一盏仍留一点余光，避免灯座看起来缺了一角 */
export const BEACON_OFF_ALPHA = 0.22;

/** 0 = 红亮蓝暗，1 = 蓝亮红暗；非有限时间按红灯处理 */
export function beaconPhase(now: number): 0 | 1 {
  if (!Number.isFinite(now)) return 0;
  return Math.floor(Math.max(0, now) / BEACON_PHASE_MS) % 2 === 0 ? 0 : 1;
}
