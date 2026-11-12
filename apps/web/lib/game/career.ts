'use client';

import type { CareerSummary } from '@niuma/shared-types';
import { create } from 'zustand';
import {
  dayKey,
  getActiveDays,
  getStreakDays,
  getWeekMinutes,
  type AttendanceStorage,
} from './attendance';
import { browserStorage, readJson, writeJson, type StorageLike } from '../storage';

/**
 * 行为统计：搬砖步数、里程、摸鱼、被喷、加班。
 *
 * 与考勤一样是本地优先：只写内存，30 秒批处理落盘，切后台 / 关页补写。
 * 与服务端的唯一交集是随考勤摘要一起上报——服务端只转发，不落盘。
 */
export const CAREER_STORAGE_KEY = 'niuma:career:v1';
/** 落盘间隔：与考勤同一个量级，避免高频 I/O */
export const CAREER_FLUSH_MS = 30_000;
/** 1 步折算的世界像素：纯展示口径，脚底不会真的迈这么大 */
export const PX_PER_STEP = 16;
/** 1 米折算的世界像素：165px/s ≈ 6.6m/s，跑图时看着像在赶末班车 */
export const PX_PER_METER = 25;
/** 单次采样允许的最大位移：超过它按切后台 / 传送处理，不计入里程 */
const MAX_SAMPLE_JUMP_PX = 256;

export interface CareerStats {
  distancePx: number;
  steps: number;
  slackCount: number;
  /** 被他人击倒的次数 */
  ventedCount: number;
  /** 成功击倒他人的次数 */
  knockdownCount: number;
  overtimeCount: number;
  /** 上一次记加班的本地日期；空串表示还没记过 */
  lastOvertimeDay: string;
}

export const EMPTY_CAREER_STATS: CareerStats = {
  distancePx: 0,
  steps: 0,
  slackCount: 0,
  ventedCount: 0,
  knockdownCount: 0,
  overtimeCount: 0,
  lastOvertimeDay: '',
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** 读存档只信自己写过的形状：坏字段逐项退化，不让整份统计消失。 */
function sanitizeCareerStats(raw: unknown): CareerStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  return {
    distancePx: finiteOr(value.distancePx, 0),
    steps: finiteOr(value.steps, 0),
    slackCount: finiteOr(value.slackCount, 0),
    ventedCount: finiteOr(value.ventedCount, 0),
    knockdownCount: finiteOr(value.knockdownCount, 0),
    overtimeCount: finiteOr(value.overtimeCount, 0),
    lastOvertimeDay: typeof value.lastOvertimeDay === 'string' ? value.lastOvertimeDay : '',
  };
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
  writeJson(storage, CAREER_STORAGE_KEY, {
    distancePx: Math.max(0, Math.round(state.distancePx)),
    steps: Math.max(0, Math.round(state.steps)),
    slackCount: Math.max(0, Math.round(state.slackCount)),
    ventedCount: Math.max(0, Math.round(state.ventedCount)),
    knockdownCount: Math.max(0, Math.round(state.knockdownCount)),
    overtimeCount: Math.max(0, Math.round(state.overtimeCount)),
    lastOvertimeDay: state.lastOvertimeDay,
  });
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
    this.state = loadCareerStats(storage) ?? { ...EMPTY_CAREER_STATS };
    this.publish();
  }

  start(): void {
    if (this.disposed || this.flushTimer !== null) return;
    this.flushTimer = window.setInterval(() => this.flush(), CAREER_FLUSH_MS);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('beforeunload', this.onPageHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** 2Hz 坐标采样喂进来：超远跳变按传送处理，不计入里程。 */
  recordDistance(deltaPx: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(deltaPx) || deltaPx <= 0 || deltaPx > MAX_SAMPLE_JUMP_PX) return;
    this.state.distancePx += deltaPx;
    this.state.steps = Math.floor(this.state.distancePx / PX_PER_STEP);
    this.touch();
  }

  /** 坐下且不是床：算一次摸鱼。起身不计，边沿判定由调用方保证。 */
  recordSlack(): void {
    if (this.disposed) return;
    this.state.slackCount += 1;
    this.touch();
  }

  /** 被创飞：只记本地玩家，旁观别人挨打不算自己的抗压记录。 */
  recordVented(): void {
    if (this.disposed) return;
    this.state.ventedCount += 1;
    this.touch();
  }

  /** 成功击倒他人：只在服务端 S2C_VENT 归因到本人时调用，空放不计。 */
  recordKnockdown(): void {
    if (this.disposed) return;
    this.state.knockdownCount += 1;
    this.touch();
  }

  /** 21:00 之后仍在岗，每天最多记一次。 */
  recordOvertime(now = Date.now()): void {
    if (this.disposed) return;
    const date = new Date(now);
    if (date.getHours() < 21) return;
    const key = dayKey(now);
    if (this.state.lastOvertimeDay === key) return;
    this.state.lastOvertimeDay = key;
    this.state.overtimeCount += 1;
    this.touch();
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

  private touch(): void {
    this.dirty = true;
    this.publish();
  }

  private publish(): void {
    useCareer.setState({ ...this.state });
  }
}

/**
 * 给宿主用的行为统计门面：组件只拿它，不直接摸 Tracker。
 * StrictMode 双挂载靠引用计数抵消，不会出现两个 30 秒定时器并行。
 */
export interface CareerClock {
  recordDistance(deltaPx: number): void;
  recordSlack(): void;
  recordVented(): void;
  recordKnockdown(): void;
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
    recordDistance: (deltaPx) => activeTracker?.recordDistance(deltaPx),
    recordSlack: () => activeTracker?.recordSlack(),
    recordVented: () => activeTracker?.recordVented(),
    recordKnockdown: () => activeTracker?.recordKnockdown(),
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
 * 把头部的本地数据拼成一条可上报的考勤摘要。
 *
 * `reportedOnlineSec` 由调用方传入当前会话秒数：查看侧只加上报之后的增量，
 * 重连与两端时钟差都不会造成重复计时。
 */
export function buildCareerSummary(
  attendance: AttendanceStorage | null,
  stats: CareerStats,
  province: string,
  reportedOnlineSec: number,
  now: number = Date.now(),
): CareerSummary {
  const storage: AttendanceStorage = attendance ?? {
    firstJoinDate: '',
    totalOnlineMs: 0,
    dailyRecords: {},
    sessionStartTime: 0,
  };
  const safeStats = stats ?? { ...EMPTY_CAREER_STATS };
  return {
    firstJoinDate: storage.firstJoinDate,
    totalOnlineMinutes: Math.floor(Math.max(0, storage.totalOnlineMs) / 60_000),
    activeDays: getActiveDays(storage.dailyRecords),
    todayMinutes: Math.floor(Math.max(0, storage.dailyRecords[dayKey(now)] ?? 0) / 60_000),
    weekMinutes: getWeekMinutes(storage, now),
    streakDays: getStreakDays(storage.dailyRecords, now),
    steps: Math.floor(safeStats.steps),
    distanceM: Math.floor(Math.max(0, safeStats.distancePx) / PX_PER_METER),
    slackCount: Math.floor(safeStats.slackCount),
    ventedCount: Math.floor(safeStats.ventedCount),
    knockdownCount: Math.floor(safeStats.knockdownCount),
    overtimeCount: Math.floor(safeStats.overtimeCount),
    province: province.trim(),
    reportedOnlineSec: Math.max(0, Math.floor(reportedOnlineSec)),
  };
}
