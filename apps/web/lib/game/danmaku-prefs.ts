import { DANMAKU_MODE, normalizeDanmakuColor, normalizeDanmakuMode, type DanmakuMode } from '@niuma/shared-types';

/**
 * 弹幕偏好契约（ADR-0056）。
 *
 * 这个文件必须能在 Worker 里安全导入：只放纯函数与常量，不碰 `window` /
 * `localStorage`。读写落盘在 `lib/danmaku-prefs.ts`，只允许主线程调用。
 */

export const DANMAKU_PREF_KEY = 'niuma:danmaku_pref:v1';

/** 不透明度下限：再低看不清正文，等于变相关闭 */
export const DANMAKU_OPACITY_MIN = 0.2;
export const DANMAKU_OPACITY_MAX = 1;
/** 默认 85%：比全不透明柔和，但在雪地与草地上仍然锐利 */
export const DANMAKU_OPACITY_DEFAULT = 0.85;

/**
 * 覆盖区域。
 *
 * - `full`：全部轨道；
 * - `half`：只占上半屏，给地面操作留出完整视野；
 * - `compact`：只占前 3 轨，适合边打边聊。
 */
export type DanmakuCoverage = 'full' | 'half' | 'compact';

export const DANMAKU_COVERAGES: readonly DanmakuCoverage[] = ['full', 'half', 'compact'] as const;

export const DANMAKU_COVERAGE_LABELS: Record<DanmakuCoverage, { label: string; hint: string }> = {
  full: { label: '全屏', hint: '全部轨道' },
  half: { label: '半屏', hint: '仅上半屏' },
  compact: { label: '精简', hint: '仅前 3 轨' },
};

export interface DanmakuPrefs {
  /** 总开关：关掉后立即清屏，聊天仍进频道列表 */
  enabled: boolean;
  /** 整层不透明度：0.2 ~ 1 */
  opacity: number;
  coverage: DanmakuCoverage;
  /** 输入时选中的颜色索引（发送侧的偏好，也存这里，避免第二个 key） */
  colorIndex: number;
  /** 输入时选中的飞行模式 */
  mode: DanmakuMode;
}

export const DEFAULT_DANMAKU_PREFS: DanmakuPrefs = {
  enabled: true,
  opacity: DANMAKU_OPACITY_DEFAULT,
  coverage: 'full',
  colorIndex: 0,
  mode: DANMAKU_MODE.Scroll,
};

/** 不透明度归一化：非数字回默认，超出区间夹到边界，保留两位小数便于百分比显示 */
export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DANMAKU_OPACITY_DEFAULT;
  const clamped = Math.min(DANMAKU_OPACITY_MAX, Math.max(DANMAKU_OPACITY_MIN, value));
  return Math.round(clamped * 100) / 100;
}

function isCoverage(value: unknown): value is DanmakuCoverage {
  return value === 'full' || value === 'half' || value === 'compact';
}

/**
 * 读盘清洗。
 *
 * 逐字段回落而不是整条丢弃：用户换过浏览器版本、或将来新增字段时，
 * 「颜色还记得、透明度丢了」比「全部重置」更接近预期。只有根本不是对象
 * 的脏数据才返回 null（交给 `readJson` 顺手清掉）。
 */
export function sanitizeDanmakuPrefs(raw: unknown): DanmakuPrefs | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const parsed = raw as Partial<DanmakuPrefs>;
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_DANMAKU_PREFS.enabled,
    opacity: typeof parsed.opacity === 'number' ? clampOpacity(parsed.opacity) : DEFAULT_DANMAKU_PREFS.opacity,
    coverage: isCoverage(parsed.coverage) ? parsed.coverage : DEFAULT_DANMAKU_PREFS.coverage,
    colorIndex:
      typeof parsed.colorIndex === 'number'
        ? normalizeDanmakuColor(parsed.colorIndex)
        : DEFAULT_DANMAKU_PREFS.colorIndex,
    mode:
      typeof parsed.mode === 'number' ? normalizeDanmakuMode(parsed.mode) : DEFAULT_DANMAKU_PREFS.mode,
  };
}

/**
 * 覆盖区域对应的轨道数。
 *
 * 取整方式偏「多给一条」：`half` 用 ceil，宁可多一条也不要在窄屏上只剩 3 轨
 * 时把顶/底固定弹幕挤到同一行。
 */
export function coveredTrackCount(coverage: DanmakuCoverage, totalTracks: number): number {
  if (totalTracks <= 0) return 0;
  if (coverage === 'compact') return Math.min(3, totalTracks);
  if (coverage === 'half') return Math.max(1, Math.ceil(totalTracks / 2));
  return totalTracks;
}
