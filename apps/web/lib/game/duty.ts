/**
 * 在岗提醒的档位（分钟）：本地定时，不占网络。
 *
 * 会话断线重连会重建世界，计时随 WELCOME 归零——这里只描述「跨过哪一档」，
 * 计时与归零由 session 负责。
 */
export const ON_DUTY_MINUTES = [30, 60, 120] as const;

export interface DutyTick {
  /** 本次该播报的分钟数；0 表示还没跨过下一档 */
  minutes: number;
  /** 推进后的游标，下一次从这一档继续看 */
  cursor: number;
}

/**
 * 后台标签页会停掉渲染循环，恢复时一次可能跨过好几档。
 * 只返回最高的那一档——补发一串过时提醒比不提醒更吵。
 */
export function advanceOnDuty(onlineSec: number, cursor: number): DutyTick {
  let minutes = 0;
  let next = cursor;
  while (next < ON_DUTY_MINUTES.length) {
    const target = ON_DUTY_MINUTES[next]!;
    if (onlineSec < target * 60) break;
    minutes = target;
    next += 1;
  }
  return { minutes, cursor: next };
}
