/**
 * 园区唯一时钟（ADR-0081）。
 *
 * 服务端所有「会写进共享状态」的判定都必须走这里：擂台倒计时、老板跨日重置、
 * 点赞与榜单限频、落盘时间戳。进程里只有一份时区偏移，启动时解析一次，
 * 之后的「今天」不会因为运行中途改系统时区而在两个口径之间来回跳。
 *
 * 为什么不直接 `new Date().setHours(24, ...)`：容器多半跑 UTC，而园区的
 * 「零点回满」是玩家理解的本地零点。偏移固定成整数分钟后，用 UTC 位移计算
 * 就够了，也不需要引时区库。
 */

export interface GameClock {
  /** 园区时区偏移（分钟，东八区 = 480） */
  readonly tzOffsetMin: number;
  /** 当前时刻（毫秒）；默认 `Date.now`，测试与压测可注入 */
  now(): number;
  /** 当前时刻（秒级 epoch）：随 PONG 下发，32 位到 2106 年才回绕 */
  serverSec(): number;
  /** 下一次园区零点（毫秒） */
  nextMidnight(nowMs?: number): number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * 解析园区时区偏移（分钟）。
 *
 * - 显式配置优先：多园区部署时以它为准，彼此不跟着宿主机的时区漂；
 * - 缺省取宿主机时区；
 * - 取值夹到 ±14 小时（现实时区的极限），坏值一律回落到 fallback。
 */
export function resolveTzOffsetMin(raw: string | undefined, fallback?: number): number {
  const base = fallback ?? -new Date().getTimezoneOffset();
  if (raw === undefined || raw.trim() === '') return clampOffset(base);
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampOffset(parsed) : clampOffset(base);
}

function clampOffset(value: number): number {
  const limit = 14 * 60;
  if (!Number.isFinite(value)) return 0;
  return Math.max(-limit, Math.min(limit, Math.round(value)));
}

/**
 * 下一次园区零点。
 *
 * 把时刻先平移到「园区本地」再按 UTC 取整，最后平移回来：
 * 固定偏移下没有任何夏令时，所以不会出现 `setHours` 那种跨夏令时多一小时的问题。
 */
export function nextServerMidnight(nowMs: number, tzOffsetMin: number): number {
  const shifted = nowMs + tzOffsetMin * MINUTE_MS;
  const nextDay = (Math.floor(shifted / DAY_MS) + 1) * DAY_MS;
  return nextDay - tzOffsetMin * MINUTE_MS;
}

/** 园区本地小时（0–23）：聊天时间戳与营业时间判断共用 */
export function serverHourOf(nowMs: number, tzOffsetMin: number): number {
  const shifted = nowMs + tzOffsetMin * MINUTE_MS;
  return new Date(shifted).getUTCHours();
}

export function createGameClock(tzOffsetMin: number, now: () => number = Date.now): GameClock {
  const offset = clampOffset(tzOffsetMin);
  return {
    tzOffsetMin: offset,
    now,
    serverSec() {
      return Math.floor(now() / 1000);
    },
    nextMidnight(nowMs = now()) {
      return nextServerMidnight(nowMs, offset);
    },
  };
}
