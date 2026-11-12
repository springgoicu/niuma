/**
 * 选园页展示用的在线人数。
 *
 * 真实在线由 `/health` 提供，这里只在**展示层**放大，让一座刚开服的园区
 * 不至于因为「3 / 90」显得荒凉。监控、状态脚本、准入闸门读的仍是真实值，
 * 所以这个系数改大改小都不影响任何调度决策。
 *
 * 上限夹在容量上：放大后超过容量会显示「135 / 90」，一眼就假，反而坏事。
 */
export const ONLINE_DISPLAY_FACTOR = 1.5;

export function displayOnline(online: number, capacity: number): number {
  if (!Number.isFinite(online) || online <= 0) return 0;
  const scaled = Math.round(online * ONLINE_DISPLAY_FACTOR);
  return Number.isFinite(capacity) && capacity > 0 ? Math.min(scaled, capacity) : scaled;
}
