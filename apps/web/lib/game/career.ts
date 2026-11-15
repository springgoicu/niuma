'use client';

import { MAX_COUNT, MAX_STEPS, type CareerSummary } from '@niuma/shared-types';
import { create } from 'zustand';
import { serverHour, serverTzOffsetMin } from './server-date';
import { serverNow } from './server-clock';
import {
  dayKey,
  getTodayMinutes,
  getTodayToiletMinutes,
  type AttendanceStorage,
} from './attendance';
import { browserStorage, readJson, writeJson, type StorageLike } from '../storage';

/**
 * 行为统计：搬砖步数、摸鱼、被创、击倒、加班。
 *
 * 与考勤一样是本地优先：只写内存，30 秒批处理落盘，切后台 / 关页补写。
 * 与服务端的交集是随考勤摘要一起上报——服务端只转发；只有赞与擂台名次
 * 会进匿名设备档案落盘（ADR-0081），本文件的计数不进服务端存储。
 *
 * 只统计今天：存档按园区日期（服务器时区）分桶，午夜自然换日；历史累计不再保留，
 * 也不会在部署 / 刷新后把旧总量灌进今日桶。
 */
export const CAREER_STORAGE_KEY = 'niuma:career:v1';
/** 落盘间隔：与考勤同一个量级，避免高频 I/O */
export const CAREER_FLUSH_MS = 30_000;
/** 1 步折算的世界像素：纯展示口径，脚底不会真的迈这么大 */
export const PX_PER_STEP = 16;
/** 单次采样允许的最大位移：超过它按切后台 / 传送处理，不计入里程 */
const MAX_SAMPLE_JUMP_PX = 256;
/** 单日里程上限：约 1000 万步，足够覆盖任何正常游玩，也不让 u32 溢出 */
const MAX_DAILY_DISTANCE_PX = MAX_STEPS * PX_PER_STEP;

/** 一天的行为计数；只保留今日，跨零点由日期键换桶。 */
export interface CareerDayStats {
  distancePx: number;
  slackCount: number;
  /** 被他人击倒的次数 */
  ventedCount: number;
  /** 成功击倒他人的次数 */
  knockdownCount: number;
  /** 今日加班次数（0 或 1） */
  overtimeCount: number;
  /** 今日擂台冠 / 亚 / 季军次数（ADR-0073） */
  ringGold: number;
  ringSilver: number;
  ringBronze: number;
}

export interface CareerStats {
  daily: Record<string, CareerDayStats>;
}

export const EMPTY_CAREER_DAY: CareerDayStats = {
  distancePx: 0,
  slackCount: 0,
  ventedCount: 0,
  knockdownCount: 0,
  overtimeCount: 0,
  ringGold: 0,
  ringSilver: 0,
  ringBronze: 0,
};

export const EMPTY_CAREER_STATS: CareerStats = { daily: {} };

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clampCount(value: number, max = MAX_COUNT): number {
  return Math.min(max, Math.max(0, Math.floor(value)));
}

function sanitizeDay(raw: unknown): CareerDayStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  return {
    distancePx: Math.min(MAX_DAILY_DISTANCE_PX, finiteOr(value.distancePx, 0)),
    slackCount: clampCount(finiteOr(value.slackCount, 0)),
    ventedCount: clampCount(finiteOr(value.ventedCount, 0)),
    knockdownCount: clampCount(finiteOr(value.knockdownCount, 0)),
    overtimeCount: clampCount(finiteOr(value.overtimeCount, 0), 1),
    ringGold: clampCount(finiteOr(value.ringGold, 0)),
    ringSilver: clampCount(finiteOr(value.ringSilver, 0)),
    ringBronze: clampCount(finiteOr(value.ringBronze, 0)),
  };
}

/** 读存档只信自己写过的形状：坏字段逐项退化，旧版累计字段直接丢弃。 */
function sanitizeCareerStats(raw: unknown): CareerStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.daily !== 'object' || value.daily === null) {
    // 旧存档没有 daily：今日桶从 0 开始，不把历史累计灌进来
    return { daily: {} };
  }
  const daily: Record<string, CareerDayStats> = {};
  for (const [key, entry] of Object.entries(value.daily)) {
    if (!DAY_KEY_PATTERN.test(key)) continue;
    const day = sanitizeDay(entry);
    if (day) daily[key] = day;
  }
  return { daily };
}

export function loadCareerStats(
  storage: StorageLike | null = browserStorage('local'),
): CareerStats | null {
  return readJson(storage, CAREER_STORAGE_KEY, sanitizeCareerStats);
}

export function saveCareerStats(
  state: CareerStats,
  storage: StorageLike | null = browserStorage('local'),
): void {
  const daily: Record<string, CareerDayStats> = {};
  for (const [key, day] of Object.entries(state.daily)) {
    if (!DAY_KEY_PATTERN.test(key)) continue;
    daily[key] = {
      distancePx: Math.max(0, Math.round(day.distancePx)),
      slackCount: clampCount(day.slackCount),
      ventedCount: clampCount(day.ventedCount),
      knockdownCount: clampCount(day.knockdownCount),
      overtimeCount: clampCount(day.overtimeCount, 1),
      ringGold: clampCount(day.ringGold),
      ringSilver: clampCount(day.ringSilver),
      ringBronze: clampCount(day.ringBronze),
    };
  }
  writeJson(storage, CAREER_STORAGE_KEY, { daily });
}

/** 工牌档案订阅的视图：与持久化结构同形，写入只由 Tracker 负责。 */
export const useCareer = create<CareerStats>(() => ({ ...EMPTY_CAREER_STATS }));

/**
 * 行为统计会话。一个页面只允许一个，由 `startCareerClock` 用引用计数管住。
 */
export class CareerTracker {
  private state: CareerStats;
  private dirty = false;
  private flushTimer: number | null = null;
  private disposed = false;
  private readonly storage: StorageLike | null;

  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.flush();
  };

  private readonly onPageHide = (): void => {
    this.flush();
  };

  constructor(storage: StorageLike | null = browserStorage('local')) {
    this.storage = storage;
    this.state = loadCareerStats(storage) ?? { daily: {} };
    this.publish();
  }

  start(): void {
    if (this.disposed || this.flushTimer !== null) return;
    this.flushTimer = window.setInterval(() => this.flush(), CAREER_FLUSH_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('beforeunload', this.onPageHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** 2Hz 坐标采样喂进来：超远跳变按传送处理，不计入今日里程。 */
  recordDistance(deltaPx: number, now: number = serverNow()): void {
    if (this.disposed) return;
    if (!Number.isFinite(deltaPx) || deltaPx <= 0 || deltaPx > MAX_SAMPLE_JUMP_PX) return;
    this.mutateDay(now, (day) => ({
      ...day,
      distancePx: Math.min(MAX_DAILY_DISTANCE_PX, day.distancePx + deltaPx),
    }));
  }

  /** 坐下且不是床：算一次摸鱼。起身不计，边沿判定由调用方保证。 */
  recordSlack(now: number = serverNow()): void {
    if (this.disposed) return;
    this.mutateDay(now, (day) => ({ ...day, slackCount: clampCount(day.slackCount + 1) }));
  }

  /** 被创飞：只记本地玩家，旁观别人挨打不算自己的抗压记录。 */
  recordVented(now: number = serverNow()): void {
    if (this.disposed) return;
    this.mutateDay(now, (day) => ({ ...day, ventedCount: clampCount(day.ventedCount + 1) }));
  }

  /** 成功击倒他人：只在服务端 S2C_VENT 归因到本人时调用，空放不计。 */
  recordKnockdown(now: number = serverNow()): void {
    if (this.disposed) return;
    this.mutateDay(now, (day) => ({ ...day, knockdownCount: clampCount(day.knockdownCount + 1) }));
  }

  /**
   * 擂台名次入账：一局只记一次，按 matchId 去重由调用方保证。
   * 只有冠亚季军会走到这里，第四名及以后不存在（容量就是 3）。
   */
  recordRingMedal(rank: 1 | 2 | 3, now: number = serverNow()): void {
    if (this.disposed) return;
    this.mutateDay(now, (day) => {
      if (rank === 1) return { ...day, ringGold: clampCount(day.ringGold + 1) };
      if (rank === 2) return { ...day, ringSilver: clampCount(day.ringSilver + 1) };
      return { ...day, ringBronze: clampCount(day.ringBronze + 1) };
    });
  }

  /** 园区 21:00 之后仍在岗，每天最多记一次。 */
  recordOvertime(now = serverNow()): void {
    if (this.disposed) return;
    // 加班判定按园区时钟：玩家在别的时区不该把「晚上九点」算错
    if (serverHour(now, serverTzOffsetMin()) < 21) return;
    this.mutateDay(now, (day) =>
      day.overtimeCount > 0 ? day : { ...day, overtimeCount: 1 },
    );
  }

  snapshot(): CareerStats {
    return this.state;
  }

  flush(): void {
    if (this.disposed || !this.dirty) return;
    this.dirty = false;
    saveCareerStats(this.state, this.storage);
  }

  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    this.flushTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('beforeunload', this.onPageHide);
    window.removeEventListener('pagehide', this.onPageHide);
  }

  /** 按本地日期更新一个桶：先复制再写，订阅者不会看到被就地改写的对象。 */
  private mutateDay(now: number, updater: (day: CareerDayStats) => CareerDayStats): void {
    const key = dayKey(now);
    const current = this.state.daily[key] ?? EMPTY_CAREER_DAY;
    const next = updater(current);
    this.state = {
      daily: {
        ...this.state.daily,
        [key]: next,
      },
    };
    this.touch();
  }

  private touch(): void {
    this.dirty = true;
    this.publish();
  }

  private publish(): void {
    useCareer.setState({ daily: this.state.daily });
  }
}

/**
 * 给宿主用的行为统计门面：组件只拿它，不直接摸 Tracker。
 * StrictMode 双挂载靠引用计数抵消，不会出现两个 30 秒定时器并行。
 */
export interface CareerClock {
  recordDistance(deltaPx: number, now?: number): void;
  recordSlack(now?: number): void;
  recordVented(now?: number): void;
  recordKnockdown(now?: number): void;
  recordRingMedal(rank: 1 | 2 | 3, now?: number): void;
  recordOvertime(now?: number): void;
  snapshot(): CareerStats;
  dispose(): void;
}

let activeTracks = 0;
let activeTracker: CareerTracker | null = null;

const NOOP_CLOCK: CareerClock = {
  recordDistance: () => {},
  recordSlack: () => {},
  recordVented: () => {},
  recordKnockdown: () => {},
  recordRingMedal: () => {},
  recordOvertime: () => {},
  snapshot: () => ({ ...EMPTY_CAREER_STATS }),
  dispose: () => {},
};

export function startCareerClock(): CareerClock {
  if (typeof window === 'undefined') return NOOP_CLOCK;
  activeTracks += 1;
  if (!activeTracker) {
    activeTracker = new CareerTracker();
    activeTracker.start();
  }
  let stopped = false;
  return {
    recordDistance: (deltaPx, now) => activeTracker?.recordDistance(deltaPx, now),
    recordSlack: (now) => activeTracker?.recordSlack(now),
    recordVented: (now) => activeTracker?.recordVented(now),
    recordKnockdown: (now) => activeTracker?.recordKnockdown(now),
    recordRingMedal: (rank, now) => activeTracker?.recordRingMedal(rank, now),
    recordOvertime: (now) => activeTracker?.recordOvertime(now),
    snapshot: () => activeTracker?.snapshot() ?? { ...EMPTY_CAREER_STATS },
    dispose: () => {
      if (stopped) return;
      stopped = true;
      activeTracks = Math.max(0, activeTracks - 1);
      if (activeTracks > 0 || !activeTracker) return;
      const tracker = activeTracker;
      activeTracker = null;
      tracker.dispose();
    },
  };
}

/**
 * 把本地考勤 + 本地计数拼成一条只含今日字段的可上报摘要。
 *
 * 工时与如厕直接读今日考勤桶，计数读今日行为桶；`todayToiletMinutes`
 * 再钳一次 ≤ `todayMinutes`，保证协议层与 UI 都不会出现「如厕 > 工时」。
 */
export function buildCareerSummary(
  attendance: AttendanceStorage | null,
  stats: CareerStats,
  province: string,
  now: number = serverNow(),
): CareerSummary {
  const storage: Pick<AttendanceStorage, 'firstJoinDate' | 'dailyRecords' | 'dailyToiletRecords'> =
    attendance ?? { firstJoinDate: '', dailyRecords: {}, dailyToiletRecords: {} };
  const safeStats = stats ?? { daily: {} };
  const day = safeStats.daily[dayKey(now)] ?? EMPTY_CAREER_DAY;
  const todayMinutes = getTodayMinutes(storage, now);
  const todayToiletMinutes = Math.min(getTodayToiletMinutes(storage, now), todayMinutes);
  return {
    firstJoinDate: storage.firstJoinDate,
    todayMinutes,
    todayToiletMinutes,
    todaySteps: Math.floor(Math.max(0, day.distancePx) / PX_PER_STEP),
    todayKnockdown: clampCount(day.knockdownCount),
    todayVented: clampCount(day.ventedCount),
    todayOvertime: clampCount(day.overtimeCount, 1),
    ringGold: clampCount(day.ringGold),
    ringSilver: clampCount(day.ringSilver),
    ringBronze: clampCount(day.ringBronze),
    province: province.trim(),
  };
}
