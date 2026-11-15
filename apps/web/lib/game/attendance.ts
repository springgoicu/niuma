'use client';

import { create } from 'zustand';
import { browserStorage, readJson, writeJson, type StorageLike } from '../storage';
import { nextServerMidnight, serverDateKey, serverTzOffsetMin } from './server-date';
import { serverNow, subscribeClockJump } from './server-clock';

/**
 * 本地考勤引擎：在岗数据只活在这个浏览器里（不在 ADR-0081 的落盘范围），
 * 但「今天」的口径由服务器时钟与园区时区判定。
 *
 * 三条硬约束（改之前先读一遍）：
 * 1) tick 只写内存，绝不每秒碰 localStorage；落盘是 30s 的批处理。
 * 2) 跨零点必须把区间切开记账，不能把昨天的 23:59 算进今天。
 * 3) 任何存储 / 时钟异常都退化成「照常走秒」，不能让游戏跟着挂。
 *
 * 只统计今天：不再保存历史总工时、本次会话起点、本周/日均/连续/工龄；
 * 今日如厕是今日工时的子集，两者走同一套区间切分与多标签 merge-max。
 */
export const ATTENDANCE_KEY = 'niuma:attendance:v1';
/** UI 走秒心跳：每秒一次，只推 zustand，不落盘 */
export const ATTENDANCE_TICK_MS = 1_000;
/** 落盘间隔：批量写，避免每秒钟一次 I/O 与 GC 抖动 */
export const ATTENDANCE_FLUSH_MS = 30_000;

/** 日期键正则只建一次：这些函数每秒都会被调用 */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface AttendanceStorage {
  /** "YYYY-MM-DD"，园区日历口径（服务器时区） */
  firstJoinDate: string;
  /** 每日累计在岗毫秒，键为园区日期 "YYYY-MM-DD" */
  dailyRecords: Record<string, number>;
  /** 每日累计如厕毫秒，键为园区日期；任何时刻都满足 ≤ 同日的 dailyRecords */
  dailyToiletRecords: Record<string, number>;
}

/** 工牌与档案弹窗订阅的视图：在持久化结构上叠一个每秒推进的本地时钟 */
export interface AttendanceView extends AttendanceStorage {
  now: number;
}

const EMPTY_VIEW: AttendanceView = {
  firstJoinDate: '',
  dailyRecords: {},
  dailyToiletRecords: {},
  now: 0,
};

/**
 * 园区日期键（ADR-0081）：按**服务器时区**切日，不是本机日历。
 *
 * 一个在 UTC-5 的玩家看到的「今日工时」必须和东八区邻座一致，所以这里不读
 * `new Date()` 的本地时区，而是用服务端下发的偏移平移后再取日期。
 * 实现放在 `server-date.ts`：Worker 里的跑马灯也要同一口径。
 */
export function dayKey(timestamp: number = serverNow()): string {
  return serverDateKey(timestamp, serverTzOffsetMin());
}

/** 毫秒 → HH:MM:SS。小时不封顶，挂在园区一整天也不会砍掉位数。 */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : 0;
  const seconds = Math.max(0, Math.floor(safe / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 毫秒 → HH:MM。工牌左上角与档案的今日时长用这个口径，分钟粒度减少重渲染。 */
export function formatHoursMinutes(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : 0;
  const minutes = Math.max(0, Math.floor(safe / 60_000));
  return formatMinutesClock(minutes);
}

/** 分钟 → HH:MM。远程档案只有分钟，不需要先乘回毫秒。 */
export function formatMinutesClock(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 今日在岗毫秒；日期键按园区日历，跨零点后自动换到新桶。 */
export function getTodayMs(
  storage: Pick<AttendanceStorage, 'dailyRecords'>,
  now: number = serverNow(),
): number {
  const ms = storage.dailyRecords[dayKey(now)];
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** 今日如厕毫秒：任何时刻都钳到今日工时以内，防止坏存档出现「如厕 > 工时」。 */
export function getTodayToiletMs(
  storage: Pick<AttendanceStorage, 'dailyRecords' | 'dailyToiletRecords'>,
  now: number = serverNow(),
): number {
  const toilet = storage.dailyToiletRecords[dayKey(now)];
  if (typeof toilet !== 'number' || !Number.isFinite(toilet) || toilet <= 0) return 0;
  return Math.min(toilet, getTodayMs(storage, now));
}

/** 今日在岗分钟，向下取整；榜单与摘要都用这一口径。 */
export function getTodayMinutes(
  storage: Pick<AttendanceStorage, 'dailyRecords'>,
  now: number = serverNow(),
): number {
  return Math.floor(getTodayMs(storage, now) / 60_000);
}

/** 今日如厕分钟，向下取整；保证 ≤ 今日工时分钟。 */
export function getTodayToiletMinutes(
  storage: Pick<AttendanceStorage, 'dailyRecords' | 'dailyToiletRecords'>,
  now: number = serverNow(),
): number {
  return Math.floor(getTodayToiletMs(storage, now) / 60_000);
}

export interface JobTitle {
  title: string;
  /** 过载时的警示文案；正常职级没有这一项 */
  warning?: string;
  /** Tailwind 文本色，直接挂在标签上 */
  color: string;
}

/** 职级：只按今日工时算；2.0h 与 8.0h 都是闭区间边界。 */
export function getJobTitle(todayHours: number): JobTitle {
  const hours = Number.isFinite(todayHours) ? todayHours : 0;
  if (hours < 2) return { title: '实习摸鱼生', color: 'text-emerald-400' };
  if (hours <= 8) return { title: '标准牛马', color: 'text-sky-400' };
  return {
    title: '骨灰级卷王',
    warning: '⚠ 严重过载：建议立刻前往中庭吃草',
    color: 'text-rose-400',
  };
}

/**
 * 印章的附加维度。全部可选：只描述今天，不再带工龄与连续天数。
 *
 * 优先级从「稀缺称号」到「常规工时」：榜首 > 万步 > 摸鱼宗师 > 过载 > 模范。
 * 一张卡只盖一个章，不能让「摸鱼宗师」和「卷王之王」互相打架。
 */
export interface StampContext {
  steps?: number;
  slackCount?: number;
  rank?: number | null;
}

/** 档案上的实体印章文案：只按今日工时与今日计数。 */
export function getStampTitle(todayHours: number, context?: StampContext): string {
  const hours = Number.isFinite(todayHours) ? todayHours : 0;
  if (context?.rank === 1) return '卷王之王';
  if ((context?.steps ?? 0) >= 10_000) return '万步劳模';
  if ((context?.slackCount ?? 0) >= 50) return '摸鱼宗师';
  if (hours > 8) return '全勤特等牲';
  if (hours >= 6) return '模范标兵';
  return '摸鱼练习生';
}

/**
 * 把一个时间区间按**园区零点**切成若干天，返回新的每日记录。
 *
 * 纯函数、只依赖园区日历：跨零点、后台标签页补算都走同一条路径，
 * 不需要在 tick 里写一堆「if 过零点了」的分支。
 */
function splitIntervalInto(
  records: Readonly<Record<string, number>>,
  fromMs: number,
  toMs: number,
): Record<string, number> {
  const next: Record<string, number> = { ...records };
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return next;
  let cursor = Math.max(0, Math.floor(fromMs));
  const end = Math.floor(toMs);
  if (end <= cursor) return next;

  while (cursor < end) {
    const nextMidnight = nextServerMidnight(cursor, serverTzOffsetMin());
    // 理论上 nextMidnight 一定大于 cursor；保险起见给一个最小步长，避免死循环
    const sliceEnd = Math.min(end, nextMidnight > cursor ? nextMidnight : cursor + 1);
    const key = dayKey(cursor);
    next[key] = (next[key] ?? 0) + (sliceEnd - cursor);
    cursor = sliceEnd;
  }
  return next;
}

/** 在岗区间切分：对外保留旧名字，测试与调用方不用关心内部实现。 */
export function splitAttendanceInterval(
  dailyRecords: Readonly<Record<string, number>>,
  fromMs: number,
  toMs: number,
): Record<string, number> {
  return splitIntervalInto(dailyRecords, fromMs, toMs);
}

/** 如厕区间切分：与在岗同构，保证跨零点的两段都落在正确的日期。 */
export function splitToiletInterval(
  dailyToiletRecords: Readonly<Record<string, number>>,
  fromMs: number,
  toMs: number,
): Record<string, number> {
  return splitIntervalInto(dailyToiletRecords, fromMs, toMs);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sanitizeDailyMap(raw: unknown): Record<string, number> {
  const records: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return records;
  for (const [key, ms] of Object.entries(raw)) {
    if (!DAY_KEY_PATTERN.test(key)) continue;
    const amount = finiteOr(ms, 0);
    if (amount > 0) records[key] = amount;
  }
  return records;
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

  return {
    firstJoinDate,
    dailyRecords: sanitizeDailyMap(value.dailyRecords),
    dailyToiletRecords: sanitizeDailyMap(value.dailyToiletRecords),
  };
}

export function loadAttendance(
  storage: StorageLike | null = browserStorage('local'),
): AttendanceStorage | null {
  return readJson(storage, ATTENDANCE_KEY, sanitizeAttendance);
}

/** 只写持久化需要的三个字段：视图层的 now 不落盘。 */
export function saveAttendance(
  state: AttendanceStorage,
  storage: StorageLike | null = browserStorage('local'),
): void {
  writeJson(storage, ATTENDANCE_KEY, {
    firstJoinDate: state.firstJoinDate,
    dailyRecords: state.dailyRecords,
    dailyToiletRecords: state.dailyToiletRecords,
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
 * 生命周期与「进入园区」对齐：不再记录本次会话起点，刷新/重连后今日工时
 * 从本地日桶继续累加；dispose 时补一次 tick + flush，不丢最后一段。
 */
export class AttendanceTracker {
  private state: AttendanceStorage;
  private lastTickAt: number;
  private toiletActive = false;
  private tickTimer: number | null = null;
  private flushTimer: number | null = null;
  private disposed = false;
  private readonly storage: StorageLike | null;
  /** 时钟跳变退订句柄：第一次对时可能把游标推进几小时，必须重设而不是补算 */
  private readonly unsubscribeClockJump: () => void;

  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.flush();
  };

  private readonly onPageHide = (): void => {
    this.flush();
  };

  /**
   * 另一个标签页刚写了存档：把它的记录并进内存（只增不减）。
   * 两边各自计时时取 max：极端并发下宁可少记一小段，也不让数字倒退。
   */
  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== ATTENDANCE_KEY || !event.newValue) return;
    const stored = loadAttendance(this.storage);
    if (!stored) return;
    this.mergeFrom(stored);
    this.publish(serverNow());
  };

  constructor(now: number = serverNow(), storage: StorageLike | null = browserStorage('local')) {
    this.storage = storage;
    const stored = loadAttendance(storage);
    const today = dayKey(now);
    this.state = stored ?? {
      firstJoinDate: today,
      dailyRecords: {},
      dailyToiletRecords: {},
    };
    this.state.dailyRecords[today] ??= 0;
    this.state.dailyToiletRecords[today] ??= 0;
    this.lastTickAt = now;
    // 玩家本机时钟错了 2 小时，第一次对时会把服务器时刻一次推进 2 小时：
    // 这时要重设游标，否则这 2 小时会被当成「刚在岗」
    this.unsubscribeClockJump = subscribeClockJump(() => {
      this.lastTickAt = serverNow();
    });
    // 只写这一次：把首日与今日空桶落下去；之后交给 30s 批处理
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

  /**
   * 坐/离马桶。切换前先把上一段结算到 now，再改标记；
   * 切换后立即落盘一次，页面被关掉也不会丢刚结束的那段如厕。
   */
  setToilet(active: boolean, now: number = serverNow()): void {
    if (this.disposed || this.toiletActive === active) return;
    this.advanceTo(now);
    this.toiletActive = active;
    this.publish(now);
    this.flush();
  }

  /** 把时间游标推进到 now：在岗必记，如厕只在标记为真时记。 */
  private advanceTo(now: number): void {
    if (!Number.isFinite(now) || now <= this.lastTickAt) {
      // 系统时间被往回拨：不记负数，只把游标对齐，避免下一次心跳补出一段假工时
      this.lastTickAt = Number.isFinite(now) ? now : this.lastTickAt;
      return;
    }
    this.state.dailyRecords = splitAttendanceInterval(
      this.state.dailyRecords,
      this.lastTickAt,
      now,
    );
    if (this.toiletActive) {
      this.state.dailyToiletRecords = splitToiletInterval(
        this.state.dailyToiletRecords,
        this.lastTickAt,
        now,
      );
    }
    this.lastTickAt = now;
  }

  /** 每秒一次：只动内存与 zustand，不碰 localStorage */
  private tick = (): void => {
    if (this.disposed) return;
    const now = serverNow();
    this.advanceTo(now);
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
    // 收尾：先补最后一拍，再把内存里的今日记录写下去
    this.flush();
    this.disposed = true;
    this.unsubscribeClockJump();
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
   * 直接覆盖会让工时忽多忽少。这里按天、按两个桶分别取 max 再写，
   * 保证「不会倒退、不会少记」；代价是极端并发下可能少记一小段。
   */
  private persist(): void {
    const stored = loadAttendance(this.storage);
    if (stored) this.mergeFrom(stored);
    saveAttendance(this.state, this.storage);
  }

  /** 把外部记录并进内存：只增不减，首日取更早的那一天 */
  private mergeFrom(other: AttendanceStorage): void {
    if (
      other.firstJoinDate &&
      (!this.state.firstJoinDate || other.firstJoinDate < this.state.firstJoinDate)
    ) {
      this.state.firstJoinDate = other.firstJoinDate;
    }
    for (const source of [other.dailyRecords, other.dailyToiletRecords] as const) {
      const target =
        source === other.dailyRecords ? this.state.dailyRecords : this.state.dailyToiletRecords;
      for (const [key, ms] of Object.entries(source)) {
        const mine = target[key] ?? 0;
        if (ms > mine) target[key] = ms;
      }
    }
  }

  private publish(now: number): void {
    useAttendance.setState({
      firstJoinDate: this.state.firstJoinDate,
      dailyRecords: this.state.dailyRecords,
      dailyToiletRecords: this.state.dailyToiletRecords,
      now,
    });
  }
}

let activeTracks = 0;
let activeTracker: AttendanceTracker | null = null;

export interface AttendanceClock {
  /** 坐/离马桶座：只在状态变化时调用 */
  setToilet(active: boolean, now?: number): void;
  flush(): void;
  dispose(): void;
}

/**
 * 进入园区时启动；返回的门面在离开时停表并落盘。
 * StrictMode 双挂载靠引用计数抵消，不会出现两个 interval 并行的双倍计时。
 */
export function startAttendanceClock(): AttendanceClock {
  if (typeof window === 'undefined') {
    return { setToilet: () => {}, flush: () => {}, dispose: () => {} };
  }
  activeTracks += 1;
  if (!activeTracker) {
    activeTracker = new AttendanceTracker();
    activeTracker.start();
  }
  let stopped = false;
  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    activeTracks = Math.max(0, activeTracks - 1);
    if (activeTracks > 0 || !activeTracker) return;
    const tracker = activeTracker;
    activeTracker = null;
    tracker.dispose();
  };
  return {
    setToilet(active: boolean, now?: number): void {
      if (stopped || !activeTracker) return;
      activeTracker.setToilet(active, now);
    },
    flush(): void {
      if (stopped || !activeTracker) return;
      activeTracker.flush();
    },
    dispose,
  };
}
