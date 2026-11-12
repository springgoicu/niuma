export type TabNavKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/**
 * 页签的键盘落点。
 *
 * 方向键在首尾循环；Home / End 跳到两端；count 为 0 或 1 时永远回到 0。
 * 纯函数，方便在 capture 键盘处理器与单测里共用同一套边界。
 */
export function nextTabIndex(current: number, key: TabNavKey, count: number): number {
  if (count <= 0) return 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const safe = Math.min(Math.max(current, 0), count - 1);
  if (key === 'ArrowLeft') return (safe - 1 + count) % count;
  return (safe + 1) % count;
}
