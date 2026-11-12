/**
 * 牛马节假日 / 黄历引擎（ADR-0059）。
 *
 * 三条纪律：
 * 1. **纯前端、零服务端**：只依赖原生 `Date`，不引入农历库、不请求接口；
 *    世界跑马灯（Worker）与弹窗（主线程）共用这一份函数，两处文案不会打架。
 * 2. **按本地时区切日**：日期键与天数差全部走 `local-date.ts`，禁止 `toISOString()`。
 * 3. **不猜日期**：农历节日只认 2026–2028 对照表；表外年份标成「待更新」，
 *    宁可在界面上写一句实话，也不给玩家一个假倒计时。
 *
 * 周末口径：本周周一 09:00 上班 → 周五 18:00 下班；周五 18:00 到下周一 09:00 判为周末。
 */

import { addLocalDays, localDayDiff, startOfLocalDay, startOfLocalWeek } from './local-date';

const HOUR_MS = 3_600_000;
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

/** 某个时刻所在周（或之后最近一周）的周五 18:00 */
function fridayTargetOf(timestamp: number): number {
  const friday = new Date(addLocalDays(startOfLocalWeek(timestamp), 4));
  friday.setHours(18, 0, 0, 0);
  return friday.getTime();
}

/** 周五 18:00 之后的那个周一 09:00 */
function weekendEndOf(fridayTarget: number): number {
  const monday = new Date(addLocalDays(fridayTarget, 3));
  monday.setHours(9, 0, 0, 0);
  return monday.getTime();
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

export function weekendCountdown(now: number = Date.now()): WeekendCountdown {
  const at = Number.isFinite(now) ? now : Date.now();
  const target = fridayTargetOf(at);

  /**
   * 周末窗口有两种落法，必须都判：
   * - 周五 18:00 之后：窗口从本周五开始；
   * - 周一 00:00–09:00：本周五还没到，但上一周的周末窗口还没关。
   */
  const windowStart = at >= target ? target : fridayTargetOf(at - 7 * 86_400_000);
  const windowEnd = weekendEndOf(windowStart);

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
    weekendEndsAt: weekendEndOf(target),
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

export function weekProgress(now: number = Date.now()): WeekProgress {
  const at = Number.isFinite(now) ? now : Date.now();
  const weekStart = startOfLocalWeek(at);
  const clockIn = new Date(weekStart);
  clockIn.setHours(9, 0, 0, 0);
  const clockOut = new Date(addLocalDays(weekStart, 4));
  clockOut.setHours(18, 0, 0, 0);
  const elapsedMs = Math.min(WORK_WEEK_MS, Math.max(0, at - clockIn.getTime()));
  return {
    percent: Math.round((elapsedMs / WORK_WEEK_MS) * 100),
    elapsedMs,
    totalMs: WORK_WEEK_MS,
    done: at >= clockOut.getTime(),
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
  /** 连休天数预期：官方调休每年不同，文案统一标「预期」 */
  restDays: number;
  /** 日期是否已确定（农历节日依赖对照表） */
  scheduled: boolean;
}

export interface Holiday extends HolidaySpec {
  /** 距离今天还有几天：本地零点相减；当天为 0 */
  daysLeft: number;
}

/** 农历对照表覆盖的年份：表外年份不猜日期 */
export const HOLIDAY_TABLE_YEARS: readonly number[] = [2026, 2027, 2028];

const FIXED_HOLIDAYS: ReadonlyArray<{ id: HolidayId; name: string; month: number; day: number; restDays: number }> = [
  { id: 'new-year', name: '元旦', month: 1, day: 1, restDays: 3 },
  { id: 'labour', name: '劳动节', month: 5, day: 1, restDays: 5 },
  { id: 'national-day', name: '国庆节', month: 10, day: 1, restDays: 7 },
];

const LUNAR_META: ReadonlyArray<{ id: HolidayId; name: string; restDays: number }> = [
  { id: 'spring-festival', name: '春节', restDays: 8 },
  { id: 'qingming', name: '清明节', restDays: 3 },
  { id: 'dragon-boat', name: '端午节', restDays: 3 },
  { id: 'mid-autumn', name: '中秋节', restDays: 3 },
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

/** 某一公历年的 7 个法定节日：固定日期 + 农历对照；按时间升序，未知日期排在最后 */
export function holidayCalendar(year: number): HolidaySpec[] {
  const specs: HolidaySpec[] = [];
  for (const item of FIXED_HOLIDAYS) {
    specs.push({
      id: item.id,
      name: item.name,
      at: new Date(year, item.month - 1, item.day, 0, 0, 0, 0).getTime(),
      restDays: item.restDays,
      scheduled: true,
    });
  }
  const table = LUNAR_TABLE[year];
  for (const item of LUNAR_META) {
    const date = table?.[item.id];
    specs.push({
      id: item.id,
      name: item.name,
      at: date ? new Date(year, date[0] - 1, date[1], 0, 0, 0, 0).getTime() : Number.NaN,
      restDays: item.restDays,
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
function scheduledCandidates(now: number): HolidaySpec[] {
  const year = new Date(now).getFullYear();
  const out: HolidaySpec[] = [];
  for (let offset = 0; offset <= 2; offset += 1) {
    for (const spec of holidayCalendar(year + offset)) {
      if (spec.scheduled && Number.isFinite(spec.at)) out.push(spec);
    }
  }
  return out;
}

/** 自动过滤过期节日，按时间自然排序；`limit` 默认 3（弹窗只置顶最近三个） */
export function upcomingHolidays(now: number = Date.now(), limit: number = 3): Holiday[] {
  const at = Number.isFinite(now) ? now : Date.now();
  const today = startOfLocalDay(at);
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return scheduledCandidates(at)
    .filter((spec) => spec.at >= today)
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((spec) => ({ ...spec, daysLeft: localDayDiff(at, spec.at) }));
}

/** 最近的一个指定节日：跑马灯只关心春节 / 元旦，不受「最近三个」限制 */
export function nextHoliday(id: HolidayId, now: number = Date.now()): Holiday | undefined {
  const at = Number.isFinite(now) ? now : Date.now();
  const today = startOfLocalDay(at);
  const candidates = scheduledCandidates(at)
    .filter((spec) => spec.id === id && spec.at >= today)
    .sort((a, b) => a.at - b.at);
  const next = candidates[0];
  return next ? { ...next, daysLeft: localDayDiff(at, next.at) } : undefined;
}

/* ------------------------------------------------------------------ *
 * 每日确定性黄历
 * ------------------------------------------------------------------ */

/** 今日宜：从这些里抽 2 项 */
export const ALMANAC_GOOD: readonly string[] = [
  '带薪如厕',
  '对齐颗粒度',
  '装模作样敲代码',
  '准点踩线打卡',
  '中庭大步吃草',
  '把会议开成茶话会',
  '摸鱼时保持在线',
  '把周报写成散文',
];

/** 今日忌：从这些里抽 2 项 */
export const ALMANAC_BAD: readonly string[] = [
  '答应临时加需求',
  '秒回老板微信',
  '深夜看周报',
  '和高管同乘电梯',
  '主动承担责任',
  '在群里回复「收到」',
  '帮同事改 PPT',
  '周五下午提上线',
];

const ALMANAC_MOTTOS: readonly string[] = [
  '摸鱼不是偷懒，是把命留给自己。',
  '工资是租的，命是自己的。',
  '今天也要做一株安静的韭菜。',
  '别急，放假总会来的。',
  '准点下班，是最高级的自律。',
  '牛马也有抬头看天的时候。',
];

/**
 * djb2：按码点推进，与 `badge.ts` 的昵称哈希同一把尺子。
 * 同一天、任何设备、任何时区偏移都不会改变结果，所以全服看到同一份黄历。
 */
export function djb2(text: string): number {
  let hash = 5381;
  for (const char of text) {
    hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

export interface Almanac {
  /** 计算用的公历日期键 `YYYY-MM-DD` */
  dateKey: string;
  good: readonly [string, string];
  bad: readonly [string, string];
  motto: string;
  /** 原始哈希：测试与调试用，UI 不展示 */
  hash: number;
}

/** 从池里取两个不重复的下标：第二个下标从 `len - 1` 里取，跨过第一个 */
function pickTwo(pool: readonly string[], seed: number): [string, string] {
  const first = seed % pool.length;
  let second = (seed >>> 8) % (pool.length - 1);
  if (second >= first) second += 1;
  return [pool[first]!, pool[second]!];
}

/** 每日黄历：输入 `YYYY-MM-DD`，输出宜 2 项、忌 2 项与一句评语 */
export function dailyAlmanac(dateKey: string): Almanac {
  const hash = djb2(dateKey);
  return {
    dateKey,
    good: pickTwo(ALMANAC_GOOD, hash),
    bad: pickTwo(ALMANAC_BAD, hash >>> 13),
    motto: ALMANAC_MOTTOS[(hash >>> 24) % ALMANAC_MOTTOS.length]!,
    hash,
  };
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
export function tickerMessages(now: number = Date.now()): readonly [string, string, string] {
  const at = Number.isFinite(now) ? now : Date.now();
  const countdown = weekendCountdown(at);
  const first =
    countdown.state === 'IS_WEEKEND'
      ? '🏖️ 合法摸鱼周末进行中！'
      : `🎉 距离周五下班还剩 ${countdown.days}天 ${pad2(countdown.hours)}:${pad2(countdown.minutes)}:${pad2(countdown.seconds)}`;
  const spring = nextHoliday('spring-festival', at);
  const newYear = nextHoliday('new-year', at);
  return [
    first,
    spring ? `🧧 距离春节还有 ${spring.daysLeft} 天` : '🧧 春节日期待更新',
    newYear ? `🧨 距离元旦还有 ${newYear.daysLeft} 天` : '🧨 元旦日期待更新',
  ];
}

/** 假日卡上的第二行：`连休 8 天`；表外年份写「日期待更新」 */
export function holidayRestLabel(holiday: HolidaySpec): string {
  return holiday.scheduled ? `连休 ${holiday.restDays} 天` : '日期待更新';
}

/** 假日卡上的第一行：`还有 42 天` / `就是今天` */
export function holidayDaysLabel(daysLeft: number): string {
  return daysLeft <= 0 ? '就是今天' : `还有 ${daysLeft} 天`;
}
