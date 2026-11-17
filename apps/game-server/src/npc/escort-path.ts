import { findPath, warmNavGrid, type NavPoint } from '../nav/path';

/**
 * 押送寻路：只在「保安去抓人 / 拖人去小黑屋」时使用（ADR-0061 / 0072）。
 *
 * 算法已下沉到 `nav/path.ts` 供押送与救护车共用（ADR-0115）；这里保留既有导出，
 * 让调用方 `npc/escort.ts` 零改动。行为与签名不变：24px 网格 BFS + 视线简化，
 * 无路返回 null，不做直线穿墙兜底。
 */

/** 预热网格，避免第一次执法在一个 Tick 里现算 */
export function warmEscortGrid(): void {
  warmNavGrid();
}

/** 求一条从 `from` 到 `to` 的可走路线（含起点与终点）；无路返回 null */
export function findEscortPath(from: NavPoint, to: NavPoint): NavPoint[] | null {
  return findPath(from, to);
}
