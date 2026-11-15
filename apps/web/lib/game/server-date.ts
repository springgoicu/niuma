/**
 * 园区日历（ADR-0081）。
 *
 * 与 `local-date.ts` 的区别只有一处，但很关键：这里的一切按**服务器时区**切日。
 * 东八区的园区里，一个在 UTC-5 的玩家看到的「今天工时」「明天上香」「周末倒计时」
 * 必须和邻座完全一样，不能各算各的日历。
 *
 * 实现方式：把时刻平移到「园区本地」后走 UTC getter。固定偏移没有夏令时，
 * 所以不需要时区库，也不会出现 23 / 25 小时的一天。
 */

/**
 * 园区时区偏移（分钟）的出口：偏移由对时链路（`server-clock`）维护，
 * 这里只转发一次，日历侧不另存第二份真相。
 */
export { serverTzOffsetMin } from './server-clock';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function shift(nowMs: number, tzOffsetMin: number): number {
  return nowMs + tzOffsetMin * MINUTE_MS;
}

/** `YYYY-MM-DD`：园区日历口径；非法时间戳返回空串 */
export function serverDateKey(nowMs: number, tzOffsetMin: number): string {
  if (!Number.isFinite(nowMs)) return '';
  const date = new Date(shift(nowMs, tzOffsetMin));
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** 园区当天 00:00 的时间戳（毫秒） */
export function startOfServerDay(nowMs: number, tzOffsetMin: number): number {
  if (!Number.isFinite(nowMs)) return Number.NaN;
  const shifted = shift(nowMs, tzOffsetMin);
  return Math.floor(shifted / DAY_MS) * DAY_MS - tzOffsetMin * MINUTE_MS;
}

/** 两个时刻相隔几个园区自然日（先归零点再相除） */
export function serverDayDiff(from: number, to: number, tzOffsetMin: number): number {
  const start = startOfServerDay(from, tzOffsetMin);
  const end = startOfServerDay(to, tzOffsetMin);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / DAY_MS);
}

/** 园区本周周一 00:00：中文语境里「这周」从周一开始 */
export function startOfServerWeek(nowMs: number, tzOffsetMin: number): number {
  const dayStart = startOfServerDay(nowMs, tzOffsetMin);
  if (!Number.isFinite(dayStart)) return Number.NaN;
  const weekday = serverWeekday(nowMs, tzOffsetMin);
  return dayStart - (weekday - 1) * DAY_MS;
}

/** 园区星期：1 = 周一 … 7 = 周日 */
export function serverWeekday(nowMs: number, tzOffsetMin: number): number {
  const date = new Date(shift(nowMs, tzOffsetMin));
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/**
 * 某个园区日期的某个整点。
 *
 * 固定偏移下一天恒等于 24 小时，所以直接按小时数加毫秒即可，
 * 不会像 `setHours` 那样在夏令时切换日漂一小时。
 */
export function serverDayAtHour(dayStartMs: number, hour: number): number {
  if (!Number.isFinite(dayStartMs)) return Number.NaN;
  return dayStartMs + hour * 3_600_000;
}

/** 下一次园区零点（毫秒）：考勤跨零点切分区间时用 */
export function nextServerMidnight(nowMs: number, tzOffsetMin: number): number {
  if (!Number.isFinite(nowMs)) return Number.NaN;
  const shifted = shift(nowMs, tzOffsetMin);
  const nextDay = (Math.floor(shifted / DAY_MS) + 1) * DAY_MS;
  return nextDay - tzOffsetMin * MINUTE_MS;
}

/** 园区本地小时（0–23），聊天气泡与限时玩法共用 */
export function serverHour(nowMs: number, tzOffsetMin: number): number {
  return new Date(shift(nowMs, tzOffsetMin)).getUTCHours();
}

/** 园区本地小时的小数形式（0–24）：灯光色调按它插值，全场玩家看到的昼夜一致 */
export function serverHourFraction(nowMs: number, tzOffsetMin: number): number {
  const date = new Date(shift(nowMs, tzOffsetMin));
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

/** 园区本地月份（0 基，与 `Date.getMonth()` 同口径）：季节判定用 */
export function serverMonth(nowMs: number, tzOffsetMin: number): number {
  return new Date(shift(nowMs, tzOffsetMin)).getUTCMonth();
}

/** 园区本地时分秒：聊天气泡时间戳用 */
export function serverClockParts(
  nowMs: number,
  tzOffsetMin: number,
): { hour: number; minute: number; second: number } {
  const date = new Date(shift(nowMs, tzOffsetMin));
  return {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}
