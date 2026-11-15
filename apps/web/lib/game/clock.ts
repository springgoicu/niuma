/**
 * 聊天行左侧的时间戳：园区时钟的 HH:MM（24 小时制）。
 *
 * 手写补零而不是 `Intl.DateTimeFormat`：每渲染一屏消息就建一个格式化器太贵，
 * 而且服务端与浏览器的 locale 不一致时，SSR 与水合会给出两种结果。
 * 时区偏移由服务端下发（ADR-0081）：一个在 UTC-5 的玩家看到的聊天时间
 * 与东八区邻座一致，不会出现「同一句消息差 13 小时」。
 */
import { serverClockParts, serverDateKey } from './server-date';
import { serverTzOffsetMin } from './server-clock';

export function formatClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '--:--';
  const { hour, minute } = serverClockParts(at, serverTzOffsetMin());
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 带秒的园区时刻 `HH:MM:SS`：榜单页脚的「快照时刻」用 */
export function formatClockSeconds(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '--:--:--';
  const { hour, minute, second } = serverClockParts(at, serverTzOffsetMin());
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** 悬停时看的完整时刻：园区时区，不依赖 locale，避免 SSR 与水合的差异 */
export function formatFullClock(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  const tz = serverTzOffsetMin();
  const { hour, minute, second } = serverClockParts(at, tz);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${serverDateKey(at, tz)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
