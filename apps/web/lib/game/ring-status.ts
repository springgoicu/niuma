'use client';

import { RING_CAPACITY, RING_PHASE, type RingPacket, type RingSlot } from '@niuma/shared-types';
import { serverNow } from './server-clock';

/**
 * 擂台 HUD 的纯函数部分（ADR-0073）。
 *
 * 服务端只给「收到那一刻还剩多少毫秒」，倒计时由客户端按服务器时钟递减；
 * 把这段推导放在纯函数里，测试就能覆盖 10 秒警示、归零与阶段文案，
 * 不用起 React 渲染。
 */

export interface RingSeat {
  slot: number;
  member: RingSlot | null;
}

/** 红蓝两个固定席位：按 slot 排列，空位也占一行，HUD 不会因为少人跳排版 */
export function ringSeats(packet: RingPacket): RingSeat[] {
  const seats: RingSeat[] = [];
  for (let slot = 0; slot < RING_CAPACITY; slot += 1) {
    const member = packet.members.find((entry) => (entry.slot ?? 0) === slot) ?? null;
    seats.push({ slot, member });
  }
  return seats;
}

/**
 * 剩余时间：`receivedAt` 与 `now` 都是**服务器时刻**（ADR-0081）。
 * 非 running 阶段恒为 0——等待 / 颁奖的进度不由这个字段表达。
 */
export function ringRemainingMs(
  packet: RingPacket,
  receivedAt: number,
  now: number = serverNow(),
): number {
  if (packet.phase !== RING_PHASE.Running) return 0;
  const drift = Math.max(0, now - receivedAt);
  return Math.max(0, packet.remainingMs - drift);
}

/** 倒计时口径：`1:59`，最后 10 秒仍然只显示秒，不闪小数 */
export function ringClock(remainingMs: number): string {
  const total = Math.ceil(Math.max(0, remainingMs) / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 最后 10 秒（含 10.0s）要换成警示色并让 HUD 轻微脉动 */
export function ringIsUrgent(packet: RingPacket, remainingMs: number): boolean {
  return packet.phase === RING_PHASE.Running && remainingMs > 0 && remainingMs <= 10_000;
}

/** 阶段文案随「你是不是参赛者」变化：参赛者看的是自己这一局，围观者看的是能不能进 */
export function ringPhaseLabel(packet: RingPacket, isMember: boolean): string {
  switch (packet.phase) {
    case RING_PHASE.Waiting:
      return isMember ? '等待挑战者' : '等待第 2 人';
    case RING_PHASE.Running:
      return '计分中';
    case RING_PHASE.Award:
      return '颁奖中';
    default:
      return '空闲';
  }
}

/** 名次文案：0 表示还没结算 */
export function ringRankLabel(rank: number): string {
  if (rank === 1) return '冠军';
  if (rank === 2) return '亚军';
  if (rank === 3) return '季军';
  return '';
}

/** 血量分档：给 HUD 上色，低血一眼就能看到 */
export function ringHpTone(hp: number): 'safe' | 'warn' | 'danger' {
  if (hp >= 7) return 'safe';
  if (hp >= 4) return 'warn';
  return 'danger';
}
