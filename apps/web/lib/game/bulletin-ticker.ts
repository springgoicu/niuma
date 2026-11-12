/**
 * 世界跑马灯的纯几何（ADR-0059）。
 *
 * 与 `bulletin.ts` 分开的理由：滚动算法要单测，而 `bulletin.ts` 会 import Pixi。
 * 这里只有数字与一条缓动曲线，Worker、React、bun test 都能直接跑。
 */

/** 每句停留 6 秒；三句一轮共 18 秒 */
export const TICKER_SLOT_MS = 6_000;
export const TICKER_SLOTS = 3;
/** 可视窗口宽度（世界纹素）：略窄于牌面，读起来像一块小霓虹条 */
export const TICKER_WIDTH = 92;
export const TICKER_HEIGHT = 12;

/** 当前轮播到第几句：0 = 周五倒计时 / 1 = 春节 / 2 = 元旦 */
export function tickerSlot(elapsedMs: number): number {
  const safe = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return Math.floor(safe / TICKER_SLOT_MS) % TICKER_SLOTS;
}

/**
 * 跑马灯横向偏移：从句首在右边缘外，滑到整句完全离开左边缘。
 * 两端缓入缓出（easeInOutCubic）：切换瞬间文字正好都在遮罩外，看不到跳变。
 */
export function tickerOffset(elapsedMs: number, textWidth: number, maskWidth: number = TICKER_WIDTH): number {
  const safe = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const width = Number.isFinite(textWidth) ? Math.max(0, textWidth) : 0;
  const mask = Number.isFinite(maskWidth) ? Math.max(0, maskWidth) : 0;
  const progress = (safe % TICKER_SLOT_MS) / TICKER_SLOT_MS;
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  const start = mask / 2 + 4;
  const end = -mask / 2 - width - 4;
  return start + (end - start) * eased;
}
