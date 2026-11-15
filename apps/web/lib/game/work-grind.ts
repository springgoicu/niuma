/**
 * 「加班搬砖」终端小游戏的纯逻辑（ADR-0088）。
 *
 * 不碰 DOM、不读时间：`now` 一律由调用方传进来，因此单测可以直接把一轮
 * 跑完，而不是等 8 秒。界面只负责把这份状态画出来。
 *
 * 玩法：屏幕上依次高亮 A–Z 字母，敲对进入下一个，敲错扣连击。
 * 一轮 = 固定时长或敲完全部字母，先到者为准；完成后才允许发送领取请求。
 */

import { WORK_REWARD } from '@niuma/shared-types';

/** 一轮要敲的字母数：约 400ms 一个，手速正常的人刚好在 8 秒内敲完 */
export const WORK_GRIND_KEYS = 20;
/** 键盘上一眼能认出的字母集合：去掉容易与 IME 组合键混淆的长按行为，只做单键判定 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface WorkGrindRound {
  /** 起始时刻（调用方时钟，毫秒） */
  startedAt: number;
  /** 目标字母序列 */
  sequence: string[];
  /** 当前该敲第几个 */
  index: number;
  /** 连击：敲对 +1，敲错归零 */
  combo: number;
  maxCombo: number;
  misses: number;
  /** 结算时刻：0 表示还没结束 */
  finishedAt: number;
}

/** 开一轮：`random` 可注入，单测里字母序列必须可复现 */
export function createWorkRound(now: number, random: () => number = Math.random): WorkGrindRound {
  const sequence: string[] = [];
  for (let i = 0; i < WORK_GRIND_KEYS; i += 1) {
    sequence.push(ALPHABET[Math.floor(random() * ALPHABET.length)] ?? 'A');
  }
  return { startedAt: now, sequence, index: 0, combo: 0, maxCombo: 0, misses: 0, finishedAt: 0 };
}

/** 这一轮是否已经结束（敲完或超时） */
export function isWorkRoundDone(round: WorkGrindRound, now: number): boolean {
  if (round.finishedAt !== 0) return true;
  if (round.index >= round.sequence.length) return true;
  return now - round.startedAt >= WORK_REWARD.RoundMs;
}

/** 剩余毫秒：界面画进度条用，已结束返回 0 */
export function workRoundRemainingMs(round: WorkGrindRound, now: number): number {
  if (round.finishedAt !== 0) return 0;
  return Math.max(0, WORK_REWARD.RoundMs - (now - round.startedAt));
}

export type WorkKeyVerdict = 'hit' | 'miss' | 'ignored' | 'finished';

/**
 * 敲一个键。
 *
 * - `finished`：这一轮已经结算过，调用方应停止收键；
 * - `ignored`：敲完字母表后还没到时（不影响连击）；
 * - `miss`：敲错，连击归零（不扣钱，只影响「本轮」的观感与连击数）。
 */
export function typeWorkKey(round: WorkGrindRound, key: string, now: number): WorkKeyVerdict {
  if (round.finishedAt !== 0) return 'finished';
  if (isWorkRoundDone(round, now)) {
    round.finishedAt = now;
    return 'finished';
  }
  const expected = round.sequence[round.index];
  if (!expected) return 'ignored';
  if (key.toUpperCase() !== expected) {
    round.misses += 1;
    round.combo = 0;
    return 'miss';
  }
  round.index += 1;
  round.combo += 1;
  if (round.combo > round.maxCombo) round.maxCombo = round.combo;
  if (round.index >= round.sequence.length) {
    round.finishedAt = now;
    return 'hit';
  }
  return 'hit';
}

/** 结束这一轮（超时或被 Esc 中断）：`now` 写入结算时刻，保证只结算一次 */
export function finishWorkRound(round: WorkGrindRound, now: number): void {
  if (round.finishedAt !== 0) return;
  round.finishedAt = now;
}

/**
 * 完成度：敲对的比例。服务端不认这个数（金额只看坐姿与间隔），
 * 它只用于界面上的「本轮完成 18/20」与结算卡文案。
 */
export function workRoundAccuracy(round: WorkGrindRound): number {
  const total = round.sequence.length;
  if (total === 0) return 0;
  return Math.min(1, round.index / total);
}

/** 是否算「完成了一轮」：敲完才发领取请求，半途中断不算 */
export function isWorkRoundComplete(round: WorkGrindRound): boolean {
  return round.finishedAt !== 0 && round.index >= round.sequence.length;
}

/** 清理：新一轮开始时用，避免把上一轮的对象留在 React 状态里 */
export function nextWorkRound(round: WorkGrindRound, now: number, random?: () => number): WorkGrindRound {
  return createWorkRound(now, random ?? Math.random);
}

/** 连击档位：只影响顶栏的金色描边强度，不发钱 */
export function comboMilestone(combo: number): 0 | 1 | 2 | 3 {
  if (combo >= 30) return 3;
  if (combo >= 20) return 2;
  if (combo >= 10) return 1;
  return 0;
}
