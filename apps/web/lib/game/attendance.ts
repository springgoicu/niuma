'use client';

import { create } from 'zustand';
import { browserStorage, readJson, writeJson, type StorageLike } from '../storage';
import { localDateKey } from './local-date';

/**
 * 本地考勤引擎：服务端零持久化，所有在岗数据只活在这个浏览器里。
 *
 * 三条硬约束（改之前先读一遍）：
 * 1) tick 只写内存，绝不每秒碰 localStorage；落盘是 30s 的批处理。
 * 2) 跨零点必须把区间切开记账，不能把昨天的 23:59 算进今天。
 * 3) 任何存储 / 时钟异常都退化成「照常走秒」，不能让游戏跟着挂。
 */
export const ATTENDANCE_KEY = 'niuma:attendance:v1';
/** UI 走秒心跳：每秒一次，只推 zustand，不落盘 */
export const ATTENDANCE_TICK_MS = 1_000;
/** 落盘间隔：批量写，避免每秒钟一次 I/O 与 GC 抖动 */
export const ATTENDANCE_FLUSH_MS = 30_000;

/** 日期键与拆解用的正则只建一次：这些函数每秒都会被调用 */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_PARTS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface AttendanceStorage {
  /** "YYYY-MM-DD"，本地日历口径 */
  firstJoinDate: string;
  /** 历史累计总在岗毫秒（不含当前会话尚未落盘的部分） */
  totalOnlineMs: number;
  /** 每日累计毫秒，键为本地日期 "YYYY-MM-DD" */
  dailyRecords: Record<string, number>;
  /** 本次进入园区的打卡时间戳 */
  sessionStartTime: number;
}

/** 工牌与档案弹窗订阅的视图：在持久化结构上叠一个每秒推进的本地时钟 */
export interface AttendanceView extends AttendanceStorage {
  now: number;
}

const EMPTY_VIEW: AttendanceView = {
  firstJoinDate: '',
  totalOnlineMs: 0,
  dailyRecords: {},
  sessionStartTime: 0,
  now: 0,
};

/**
 * 本地日期键。刻意不用 `toISOString()`：那是 UTC 口径，
 * 在东八区会把 00:00–08:00 的打卡记到前一天。
 *
 * 实现搬到了 `local-date.ts`：Worker 里的节假日引擎也要切日，
 * 但不能顺着 `attendance.ts` 把 zustand store 拖进渲染线程。这里保留同名导出。
 */
export const dayKey = localDateKey;

/** 毫秒 → HH:MM:SS。小时不封顶，挂在园区一整天也不会砍掉位数。 */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : 0;
  const seconds = Math.max(0, Math.floor(safe / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 本次在岗走秒。非正数 / 断线恢复前的空值显示 00:00:00。 */
export function getCurrentSessionDuration(startTime: number, now: number = Date.now()): string {
  if (!Number.isFinite(startTime) || startTime <= 0 || !Number.isFinite(now)) return '00:00:00';
  return formatDuration(now - startTime);
}

/** 日均：只统计真正有过工时的日期，四舍五入到一位小数。 */
export function getDailyAverageHours(storage: AttendanceStorage): number {
  const values = Object.values(storage.dailyRecords).filter(
    (ms) => Number.isFinite(ms) && ms > 0,
  );
  if (values.length === 0) return 0;
  const total = values.reduce((sum, ms) => sum + ms, 0);
  return Math.round((total / values.length / 3_600_000) * 10) / 10;
}

/** 有工时的日期数：日均的分母，也用于判断「有没有可展示的考勤」。 */
export function getActiveDays(dailyRecords: Readonly<Record<string, number>>): number {
  let days = 0;
  for (const ms of Object.values(dailyRecords)) {
    if (Number.isFinite(ms) && ms > 0) days += 1;
  }
  return days;
}

/** 本地周一零点。周日按「上一周的周一」算，避免周榜在周日跳到下一周。 */
function startOfWeek(now: number): number {
  const date = new Date(now);
  const offset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset).getTime();
}

/**
 * 本周累计在岗毫秒（本地周一零点起算）。
 *
 * 按日期键逐天累加而不是做时间差：跨零点的记录已经被 `splitAttendanceInterval`
 * 切好，按天取整不会把昨天 23:59 算进今天。
 */
export function getWeekMs(
  dailyRecords: Readonly<Record<string, number>>,
  now: number = Date.now(),
): number {
  const start = startOfWeek(now);
  let total = 0;
  for (let cursor = start; cursor <= now; cursor += 86_400_000) {
    const ms = dailyRecords[dayKey(cursor)];
    if (Number.isFinite(ms) && ms > 0) total += ms;
  }
  return total;
}

/** 本周累计在岗分钟，供工牌显示与榜单排序。 */
export function getWeekMinutes(
  storage: AttendanceStorage,
  now: number = Date.now(),
): number {
  return Math.floor(getWeekMs(storage.dailyRecords, now) / 60_000);
}

/**
 * 连续在岗天数：从今天往前数，今天还没工时就从昨天起算。
 * 这样早上刚打开页面不会把昨天之前攒的连续记录判成 0。
 */
export function getStreakDays(
  dailyRecords: Readonly<Record<string, number>>,
  now: number = Date.now(),
): number {
  const today = new Date(now);
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (!((dailyRecords[dayKey(cursor)] ?? 0) > 0)) cursor -= 86_400_000;
  let days = 0;
  // 上限只防坏存档把循环拖长；正常连续记录远小于 10 年
  for (let guard = 0; guard < 3_650; guard += 1) {
    const ms = dailyRecords[dayKey(cursor)];
    if (!(typeof ms === 'number' && Number.isFinite(ms) && ms > 0)) break;
    days += 1;
    cursor -= 86_400_000;
  }
  return days;
}

/** 工龄：本地零点日期差，至少 1 天（入职当天就算第 1 天）。 */
export function getSeniorityDays(firstJoinDate: string, now: number = Date.now()): number {
  const match = DAY_PARTS_PATTERN.exec(firstJoinDate);
  if (!match) return 1;
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  const current = new Date(now);
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(today)) return 1;
  return Math.max(1, Math.round((today - start) / 86_400_000));
}

export interface JobTitle {
  title: string;
  /** 过载时的警示文案；正常职级没有这一项 */
  warning?: string;
  /** Tailwind 文本色，直接挂在标签上 */
  color: string;
}

/** 职级：2.0h 与 8.0h 都是闭区间边界，恰好卡在边界上不算过载。 */
export function getJobTitle(avgDailyHours: number): JobTitle {
  const avg = Number.isFinite(avgDailyHours) ? avgDailyHours : 0;
  if (avg < 2) return { title: '实习摸鱼生', color: 'text-emerald-400' };
  if (avg <= 8) return { title: '标准牛马', color: 'text-sky-400' };
  return {
    title: '骨灰级卷王',
    warning: '⚠ 严重过载：建议立刻前往中庭吃草',
    color: 'text-rose-400',
  };
}

/**
 * 印章的附加维度。全部可选：旧调用不传时输出与改造前逐字一致。
 *
 * 优先级从「稀缺称号」到「常规工时」：榜首 > 万步 > 摸鱼宗师 > 过载 > 连续全勤 > 模范。
 * 一张卡只盖一个章，不能让「摸鱼宗师」和「终身免下班」互相打架。
 */
export interface StampContext {
  streakDays?: number;
  steps?: number;
  slackCount?: number;
  rank?: number | null;
}

/** 档案上的实体印章文案：工时越狠，章越离谱。 */
export function getStampTitle(
  avgDailyHours: number,
  seniorityDays: number,
  context?: StampContext,
): string {
  const avg = Number.isFinite(avgDailyHours) ? avgDailyHours : 0;
  if (context?.rank === 1) return '卷王之王';
  if ((context?.steps ?? 0) >= 10_000) return '万步劳模';
  if ((context?.slackCount ?? 0) >= 50) return '摸鱼宗师';
  if (avg > 8) return seniorityDays >= 30 ? '终身免下班' : '全勤特等牲';
  if ((context?.streakDays ?? 0) >= 7) return '全勤铁牛';
  if (avg >= 6) return '模范标兵';
  return '摸鱼练习生';
}

/**
 * 把一个时间区间按本地零点切成若干天，返回新的每日记录。
 *
 * 纯函数、只依赖本地日历：跨零点、跨 DST、后台标签页补算都走同一条路径，
 * 不需要在 tick 里写一堆「if 过零点了」的分支。
 */
export function splitAttendanceInterval(
  dailyRecords: Readonly<Record<string, number>>,
  fromMs: number,
  toMs: number,
): Record<string, number> {
  const next: Record<string, number> = { ...dailyRecords };
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return next;
  let cursor = Math.max(0, Math.floor(fromMs));
  const end = Math.floor(toMs);
  if (end <= cursor) return next;

  while (cursor < end) {
    const date = new Date(cursor);
    const nextMidnight = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    ).getTime();
    // 理论上 nextMidnight 一定大于 cursor；保险起见给一个最小步长，避免死循环
    const sliceEnd = Math.min(end, nextMidnight > cursor ? nextMidnight : cursor + 1);
    const key = dayKey(cursor);
    next[key] = (next[key] ?? 0) + (sliceEnd - cursor);
    cursor = sliceEnd;
  }
  return next;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** 读存档只信得过自己写过的形状：坏数据一律当没有，下一次心跳会重建。 */
function sanitizeAttendance(raw: unknown): AttendanceStorage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  // firstJoinDate 是整份存档的锚点：连它都没有，就不是我们写的东西
  if (typeof value.firstJoinDate !== 'string') return null;

  const firstJoinDate = DAY_KEY_PATTERN.test(value.firstJoinDate)
    ? value.firstJoinDate
    : dayKey();

  const dailyRecords: Record<string, number> = {};
  if (typeof value.dailyRecords === 'object' && value.dailyRecords !== null) {
    for (const [key, ms] of Object.entries(value.dailyRecords)) {
      if (!DAY_KEY_PATTERN.test(key)) continue;
      const amount = finiteOr(ms, 0);
      if (amount > 0) dailyRecords[key] = amount;
    }
  }

  return {
    firstJoinDate,
    totalOnlineMs: finiteOr(value.totalOnlineMs, 0),
    dailyRecords,
    sessionStartTime: finiteOr(value.sessionStartTime, 0),
  };
}

export function loadAttendance(
  storage: StorageLike | null = browserStorage('local'),
): AttendanceStorage | null {
  return readJson(storage, ATTENDANCE_KEY, sanitizeAttendance);
}

/** 只写协议里的四个字段：视图层的 now 不落盘。 */
export function saveAttendance(
  state: AttendanceStorage,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, ATTENDANCE_KEY, {
    firstJoinDate: state.firstJoinDate,
    totalOnlineMs: Math.max(0, Math.round(state.totalOnlineMs)),
    dailyRecords: state.dailyRecords,
    sessionStartTime: state.sessionStartTime,
  });
}

/**
 * 每秒推进的视图 store。外部只读，写入只由 Tracker 负责，
 * 这样「内存优先」不会被某个组件顺手 setState 打穿。
 */
export const useAttendance = create<AttendanceView>(() => ({ ...EMPTY_VIEW }));

/**
 * 考勤会话。一个页面只允许存在一个，由 `startAttendanceClock` 用引用计数管住。
 *
 * 生命周期与「进入园区」对齐：构造函数把 sessionStartTime 重置为现在，
 * 历史总额与每日记录原样续上；dispose 时补一次 tick + flush，不丢最后一段。
 */
export class AttendanceTracker {
  private state: AttendanceStorage;
  private lastTickAt: number;
  private tickTimer: number | null = null;
  private flushTimer: number | null = null;
  private disposed = false;
  private readonly storage: StorageLike | null;

  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.flush();
  };

  private readonly onPageHide = (): void => {
    this.flush();
  };

  /**
   * 另一个标签页刚写了存档：把它的记录并进内存（只增不减）。
   * 不动 `sessionStartTime` —— 本页的在岗仍从自己进园那一刻算起。
   */
  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== ATTENDANCE_KEY || !event.newValue) return;
    const stored = loadAttendance(this.storage);
    if (!stored) return;
    this.mergeFrom(stored);
    this.publish(Date.now());
  };

  constructor(now: number = Date.now(), storage: StorageLike | null = browserStorage('local')) {
    this.storage = storage;
    const stored = loadAttendance(storage);
    const today = dayKey(now);
    this.state = stored ?? {
      firstJoinDate: today,
      totalOnlineMs: 0,
      dailyRecords: {},
      sessionStartTime: now,
    };
    // 新的一次进入园区：持久化里可能还留着上次的打卡时间，一律以本次为准
    this.state.sessionStartTime = now;
    this.state.dailyRecords[today] ??= 0;
    this.lastTickAt = now;
    // 只写这一次：把首日与新的 sessionStartTime 落下去；之后交给 30s 批处理
    this.persist();
    this.publish(now);
  }

  start(): void {
    if (this.disposed || this.tickTimer !== null) return;
    this.tickTimer = window.setInterval(this.tick, ATTENDANCE_TICK_MS);
    this.flushTimer = window.setInterval(() => this.flush(), ATTENDANCE_FLUSH_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('beforeunload', this.onPageHide);
    // iOS Safari 上 beforeunload 不一定触发，pagehide 是切后台/关页的兜底
    window.addEventListener('pagehide', this.onPageHide);
    // 多标签页：别的页写了存档就跟上，别让两边各记各的
    window.addEventListener('storage', this.onStorage);
  }

  /** 每秒一次：只动内存与 zustand，不碰 localStorage */
  private tick = (): void => {
    if (this.disposed) return;
    const now = Date.now();
    if (now <= this.lastTickAt) {
      // 系统时间被往回拨：不记负数，只把游标对齐，避免下一次心跳补出一段假工时
      this.lastTickAt = now;
      this.publish(now);
      return;
    }
    this.state.dailyRecords = splitAttendanceInterval(
      this.state.dailyRecords,
      this.lastTickAt,
      now,
    );
    this.state.totalOnlineMs += now - this.lastTickAt;
    this.lastTickAt = now;
    this.publish(now);
  };

  flush(): void {
    if (this.disposed) return;
    // 切后台 / 关窗的「瞬间同步」必须先把最后一拍补进内存，再落盘；
    // 否则最多会丢掉 1 秒——虽然不多，但这正是 flush 与 30s 定时写盘的区别
    this.tick();
    this.persist();
  }

  dispose(): void {
    if (this.disposed) return;
    // 收尾：先补最后一拍，再把内存里的总额写下去
    this.flush();
    this.disposed = true;
    if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    this.tickTimer = null;
    this.flushTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('beforeunload', this.onPageHide);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('storage', this.onStorage);
  }

  /**
   * 落盘前先跟存储对一次账。
   *
   * 同一浏览器开两个标签页时，两边各有一份内存与各自的 30 秒批处理，
   * 直接覆盖会让工时忽多忽少。这里按天取 max、总额取 max 再写，
   * 保证「不会倒退、不会少记」；代价是极端并发下可能少记一小段。
   */
  private persist(): void {
    const stored = loadAttendance(this.storage);
    if (stored) this.mergeFrom(stored);
    saveAttendance(this.state, this.storage);
  }

  /** 把外部记录并进内存：只增不减，首日取更早的那一天 */
  private mergeFrom(other: AttendanceStorage): void {
    this.state.totalOnlineMs = Math.max(this.state.totalOnlineMs, other.totalOnlineMs);
    if (
      other.firstJoinDate &&
      (!this.state.firstJoinDate || other.firstJoinDate < this.state.firstJoinDate)
    ) {
      this.state.firstJoinDate = other.firstJoinDate;
    }
    for (const [key, ms] of Object.entries(other.dailyRecords)) {
      const mine = this.state.dailyRecords[key] ?? 0;
      if (ms > mine) this.state.dailyRecords[key] = ms;
    }
  }

  private publish(now: number): void {
    useAttendance.setState({
      firstJoinDate: this.state.firstJoinDate,
      totalOnlineMs: this.state.totalOnlineMs,
      dailyRecords: this.state.dailyRecords,
      sessionStartTime: this.state.sessionStartTime,
      now,
    });
  }
}

let activeTracks = 0;
let activeTracker: AttendanceTracker | null = null;

/**
 * 进入园区时启动；返回的清理函数会在离开时停表并落盘。
 * StrictMode 双挂载靠引用计数抵消，不会出现两个 interval 并行的双倍计时。
 */
export function startAttendanceClock(): () => void {
  if (typeof window === 'undefined') return () => {};
  activeTracks += 1;
  if (!activeTracker) {
    activeTracker = new AttendanceTracker();
    activeTracker.start();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    activeTracks = Math.max(0, activeTracks - 1);
    if (activeTracks > 0 || !activeTracker) return;
    const tracker = activeTracker;
    activeTracker = null;
    tracker.dispose();
  };
}
