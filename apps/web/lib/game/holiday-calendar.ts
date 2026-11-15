/**
 * 牛马节假日引擎（ADR-0059 / ADR-0081 / ADR-0086）。
 *
 * 只留可核对的内容：节日日期（农历对照表内）与按服务器时钟走的倒计时 / 工时窗。
 * 每日「宜 / 忌 / 评语」是日期哈希抽的固定文案池，没有任何数据来源，已整体删除。
 *
 * 三条纪律：
 * 1. **纯前端、零服务端**：只依赖原生 `Date`，不引入农历库、不请求接口；
 *    世界跑马灯（Worker）与弹窗（主线程）共用这一份函数，两处文案不会打架。
 * 2. **按园区时区切日**：日期键与天数差全部走 `server-date.ts`，偏移由服务端下发。
 *    一个在 UTC-5 的玩家和东八区邻座看到的倒计时必须一模一样。
 * 3. **不猜日期**：农历节日只认 2026–2028 对照表；表外年份标成「待更新」，
 *    宁可在界面上写一句实话，也不给玩家一个假倒计时。
 *
 * 周末口径：本周周一 09:00 上班 → 周五 18:00 下班；周五 18:00 到下周一 09:00 判为周末。
 */

import { serverNow, serverTzOffsetMin } from './server-clock';
import { serverDayAtHour, serverDayDiff, startOfServerDay, startOfServerWeek } from './server-date';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** 一周工时：周一 09:00 → 周五 18:00 = 4 天 9 小时 */
const WORK_WEEK_MS = 105 * HOUR_MS;

/* ------------------------------------------------------------------ *
 * 本周解脱倒计时
 * ------------------------------------------------------------------ */

export type WeekendState = 'WEEKDAY' | 'IS_WEEKEND';

export interface WeekendCountdown {
  state: WeekendState;
  /** 本周周五 18:00；周末态是刚刚过去的那个周五 */
  targetMs: number;
  /** 工作日到点剩余毫秒；周末态为 0 */
  remainingMs: number;
  /** 下周一 09:00：工作日是「这周五之后的周一」，周末态是本次周末的终点 */
  weekendEndsAt: number;
  /** 周末还剩多少毫秒；工作日为 0 */
  weekendRemainingMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** 某个时刻所在周（或之后最近一周）的周五 18:00（园区时区） */
function fridayTargetOf(timestamp: number, tz: number): number {
  return serverDayAtHour(startOfServerWeek(timestamp, tz) + 4 * DAY_MS, 18);
}

/** 周五 18:00 之后的那个周一 09:00（园区时区） */
function weekendEndOf(fridayTarget: number, tz: number): number {
  return serverDayAtHour(startOfServerDay(fridayTarget, tz) + 3 * DAY_MS, 9);
}

function splitToParts(ms: number): Pick<WeekendCountdown, 'days' | 'hours' | 'minutes' | 'seconds'> {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

export function weekendCountdown(
  now: number = serverNow(),
  tz: number = serverTzOffsetMin(),
): WeekendCountdown {
  const at = Number.isFinite(now) ? now : serverNow();
  const target = fridayTargetOf(at, tz);

  /**
   * 周末窗口有两种落法，必须都判：
   * - 周五 18:00 之后：窗口从本周五开始；
   * - 周一 00:00–09:00：本周五还没到，但上一周的周末窗口还没关。
   */
  const windowStart = at >= target ? target : fridayTargetOf(at - 7 * DAY_MS, tz);
  const windowEnd = weekendEndOf(windowStart, tz);

  if (at >= windowStart && at < windowEnd) {
    return {
      state: 'IS_WEEKEND',
      targetMs: windowStart,
      remainingMs: 0,
      weekendEndsAt: windowEnd,
      weekendRemainingMs: windowEnd - at,
      ...splitToParts(0),
    };
  }

  const remainingMs = Math.max(0, target - at);
  return {
    state: 'WEEKDAY',
    targetMs: target,
    remainingMs,
    weekendEndsAt: weekendEndOf(target, tz),
    weekendRemainingMs: 0,
    ...splitToParts(remainingMs),
  };
}

export interface WeekProgress {
  /** 0–100：本周工时窗（周一 09:00 → 周五 18:00）已消耗的百分比 */
  percent: number;
  elapsedMs: number;
  totalMs: number;
  /** 已经走完 105 小时（含周末） */
  done: boolean;
}

export function weekProgress(
  now: number = serverNow(),
  tz: number = serverTzOffsetMin(),
): WeekProgress {
  const at = Number.isFinite(now) ? now : serverNow();
  const weekStart = startOfServerWeek(at, tz);
  const clockIn = serverDayAtHour(weekStart, 9);
  const clockOut = serverDayAtHour(weekStart + 4 * DAY_MS, 18);
  const elapsedMs = Math.min(WORK_WEEK_MS, Math.max(0, at - clockIn));
  return {
    percent: Math.round((elapsedMs / WORK_WEEK_MS) * 100),
    elapsedMs,
    totalMs: WORK_WEEK_MS,
    done: at >= clockOut,
  };
}

/* ------------------------------------------------------------------ *
 * 法定节假日池
 * ------------------------------------------------------------------ */

export type HolidayId =
  | 'new-year'
  | 'spring-festival'
  | 'qingming'
  | 'labour'
  | 'dragon-boat'
  | 'mid-autumn'
  | 'national-day';

export interface HolidaySpec {
  id: HolidayId;
  name: string;
  /** 节日当天本地零点；农历表外年份为 NaN */
  at: number;
  /** 日期是否已确定（农历节日依赖对照表） */
  scheduled: boolean;
}

export interface Holiday extends HolidaySpec {
  /** 距离今天还有几天：本地零点相减；当天为 0 */
  daysLeft: number;
}

/** 农历对照表覆盖的年份：表外年份不猜日期 */
export const HOLIDAY_TABLE_YEARS: readonly number[] = [2026, 2027, 2028];

const FIXED_HOLIDAYS: ReadonlyArray<{ id: HolidayId; name: string; month: number; day: number }> = [
  { id: 'new-year', name: '元旦', month: 1, day: 1 },
  { id: 'labour', name: '劳动节', month: 5, day: 1 },
  { id: 'national-day', name: '国庆节', month: 10, day: 1 },
];

const LUNAR_META: ReadonlyArray<{ id: HolidayId; name: string }> = [
  { id: 'spring-festival', name: '春节' },
  { id: 'qingming', name: '清明节' },
  { id: 'dragon-boat', name: '端午节' },
  { id: 'mid-autumn', name: '中秋节' },
];

/**
 * 农历节日的公历对照（近三年）。
 * 表外年份没有可信数据源时保持「待更新」，由界面显示诚实的占位文案。
 */
const LUNAR_TABLE: Readonly<Record<number, Partial<Record<HolidayId, readonly [number, number]>>>> = {
  2026: {
    'spring-festival': [2, 17],
    qingming: [4, 5],
    'dragon-boat': [6, 19],
    'mid-autumn': [9, 25],
  },
  2027: {
    'spring-festival': [2, 6],
    qingming: [4, 5],
    'dragon-boat': [6, 9],
    'mid-autumn': [9, 15],
  },
  2028: {
    'spring-festival': [1, 26],
    qingming: [4, 4],
    'dragon-boat': [5, 28],
    'mid-autumn': [10, 3],
  },
};

/** 园区日历年份：跨年附近不能用本机时区的年份 */
function serverYearOf(nowMs: number, tz: number): number {
  return new Date(nowMs + tz * MINUTE_MS).getUTCFullYear();
}

/** 某个园区日期的零点时间戳；固定偏移下一天恒等 24 小时 */
function serverDateAt(year: number, month: number, day: number, tz: number): number {
  return Date.UTC(year, month - 1, day) - tz * MINUTE_MS;
}

/** 某一公历年的 7 个法定节日：固定日期 + 农历对照；按时间升序，未知日期排在最后 */
export function holidayCalendar(year: number, tz: number = serverTzOffsetMin()): HolidaySpec[] {
  const specs: HolidaySpec[] = [];
  for (const item of FIXED_HOLIDAYS) {
    specs.push({
      id: item.id,
      name: item.name,
      at: serverDateAt(year, item.month, item.day, tz),
      scheduled: true,
    });
  }
  const table = LUNAR_TABLE[year];
  for (const item of LUNAR_META) {
    const date = table?.[item.id];
    specs.push({
      id: item.id,
      name: item.name,
      at: date ? serverDateAt(year, date[0], date[1], tz) : Number.NaN,
      scheduled: date !== undefined,
    });
  }
  return specs.sort((a, b) => {
    if (Number.isNaN(a.at)) return 1;
    if (Number.isNaN(b.at)) return -1;
    return a.at - b.at;
  });
}

/** 从 today 起往后扫三年：跨年的元旦与春节都在候选里 */
function scheduledCandidates(now: number, tz: number): HolidaySpec[] {
  const year = serverYearOf(now, tz);
  const out: HolidaySpec[] = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    for (const spec of holidayCalendar(year + offset, tz)) {
      if (spec.scheduled && Number.isFinite(spec.at)) out.push(spec);
    }
  }
  return out;
}

/** 自动过滤过期节日，按时间自然排序；`limit` 默认 3（弹窗只置顶最近三个） */
export function upcomingHolidays(
  now: number = serverNow(),
  limit: number = 3,
  tz: number = serverTzOffsetMin(),
): Holiday[] {
  const at = Number.isFinite(now) ? now : serverNow();
  const today = startOfServerDay(at, tz);
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return scheduledCandidates(at, tz)
    .filter((spec) => spec.at >= today)
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((spec) => ({ ...spec, daysLeft: serverDayDiff(at, spec.at, tz) }));
}

/** 最近的一个指定节日：跑马灯只关心春节 / 元旦，不受「最近三个」限制 */
export function nextHoliday(
  id: HolidayId,
  now: number = serverNow(),
  tz: number = serverTzOffsetMin(),
): Holiday | undefined {
  const at = Number.isFinite(now) ? now : serverNow();
  const today = startOfServerDay(at, tz);
  const candidates = scheduledCandidates(at, tz)
    .filter((spec) => spec.id === id && spec.at >= today)
    .sort((a, b) => a.at - b.at);
  const next = candidates[0];
  return next ? { ...next, daysLeft: serverDayDiff(at, next.at, tz) } : undefined;
}

/* ------------------------------------------------------------------ *
 * 文案
 * ------------------------------------------------------------------ */

function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

/** 弹窗里的大号时钟：`02天 06小时 41分 28秒` */
export function formatCountdown(ms: number): string {
  const parts = splitToParts(ms);
  return `${pad2(parts.days)}天 ${pad2(parts.hours)}小时 ${pad2(parts.minutes)}分 ${pad2(parts.seconds)}秒`;
}

/** 世界跑马灯的三句：周五倒计时 → 春节 → 元旦，每 6 秒轮换一次 */
export function tickerMessages(
  now: number = serverNow(),
  tz: number = serverTzOffsetMin(),
): readonly [string, string, string] {
  const at = Number.isFinite(now) ? now : serverNow();
  const countdown = weekendCountdown(at, tz);
  const first =
    countdown.state === 'IS_WEEKEND'
      ? '🏖️ 合法摸鱼周末进行中！'
      : `🎉 距离周五下班还剩 ${countdown.days}天 ${pad2(countdown.hours)}:${pad2(countdown.minutes)}:${pad2(countdown.seconds)}`;
  const spring = nextHoliday('spring-festival', at, tz);
  const newYear = nextHoliday('new-year', at, tz);
  return [
    first,
    spring ? `🧧 距离春节还有 ${spring.daysLeft} 天` : '🧧 春节日期待更新',
    newYear ? `🧨 距离元旦还有 ${newYear.daysLeft} 天` : '🧨 元旦日期待更新',
  ];
}

/** 假日卡上的第一行：`还有 42 天` / `就是今天` */
export function holidayDaysLabel(daysLeft: number): string {
  return daysLeft <= 0 ? '就是今天' : `还有 ${daysLeft} 天`;
}
