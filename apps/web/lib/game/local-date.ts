/**
 * 本地日历工具（纯函数，不依赖 DOM / zustand / Pixi）。
 *
 * 存在的理由：Worker 里的世界跑马灯要算「今天几号」，而 `attendance.ts` 带着 zustand store。
 * 把日期口径抽到这里，渲染线程只依赖纯计算，不会把 UI 状态拖进后台线程。
 *
 * 所有函数一律按**本地时区**理解「一天」：`toISOString()` 是 UTC 口径，
 * 在东八区会把 00:00–08:00 的打卡记到前一天（ADR-0052 的老坑）。
 */

/** `YYYY-MM-DD`：本地日历口径；非法时间戳返回空串，调用方按「无日期」处理 */
export function localDateKey(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 当天 00:00:00.000 的时间戳；非法值原样返回 NaN */
export function startOfLocalDay(timestamp: number = Date.now()): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 按本地日历加减天数。
 * 用 `setDate` 而不是 `+ n * 86400000`：跨夏令时的那一天不是 24 小时，
 * 加毫秒会让「明天 09:00」漂成 08:00 或 10:00。
 */
export function addLocalDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** 两个时刻相隔几个本地自然日：先归零点再相除，23 / 25 小时的 DST 日不算差一天 */
export function localDayDiff(from: number, to: number): number {
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/**
 * 本周周一 00:00。
 * 中文语境里「这周」从周一开始，周日的 `getDay() === 0` 要归到上一周的末尾。
 */
export function startOfLocalWeek(timestamp: number = Date.now()): number {
  const dayStart = startOfLocalDay(timestamp);
  if (!Number.isFinite(dayStart)) return Number.NaN;
  const date = new Date(dayStart);
  const weekday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekday);
  return date.getTime();
}
