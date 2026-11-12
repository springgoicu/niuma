'use client';

import { localDateKey } from './local-date';

/**
 * 「当天首次上香」的本地凭据（ADR-0061）。
 *
 * 只存**最近一次上香的自然日**，不存次数、不上报服务端：
 * 零持久化约束下，「功德 +1」只能是一次性提示，不能变成账号数值。
 * 存日期而不是布尔量，是为了隔天自动失效——不需要任何清理逻辑。
 *
 * `localDateKey` 是本地时区口径（不是 UTC），东八区的 00:00–08:00 不会被算成前一天。
 */

const STORAGE_KEY = 'niuma.incense.day';

/** 读最近一次上香的日期键；隐私模式 / 禁用存储时退回空串（视为从没上过香） */
export function readIncenseDay(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 写回日期键。写失败不抛——上香本身不该因为存储不可用而中断 */
export function writeIncenseDay(day: string): void {
  if (typeof window === 'undefined' || day.length === 0) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, day);
  } catch {
    // 忽略：下一位玩家仍然能正常上香，只是明天会再送一次光晕
  }
}

/** 今天是否还没上过香 */
export function isFirstIncenseToday(lastDay: string, now: number = Date.now()): boolean {
  return lastDay !== localDateKey(now);
}
