'use client';

import { POSE, WELCOME_LANDMARKS, WORLD_LAYOUT, type Pose, type PropKind, type SeatKind } from '@niuma/shared-types';

/**
 * 轻互动：售货机、饮水机、咖啡机的一次性反馈，与躺床打呼。
 *
 * 全部留在客户端：不新增协议、不进服务端状态机（零持久化的取舍见 ADR-0024）。
 * 这里是纯函数，`GameSession` 只负责「按键 → 查最近设施 → 冒气泡」。
 */

/** 互动判定半径：比入座半径小一档，站在机器旁边才触发 */
export const INTERACT_RANGE = 56;

/**
 * 牛马榜公告栏的互动半径（ADR-0054）。
 *
 * 牌面 128px 宽，站在正中或两侧都能按 F；与设施 56px 分开，
 * 是因为公告栏是「走过去看」的地标，不该要求玩家贴着底座站。
 * 服务端另有 240px 距离门，只负责挡住离开后仍刷请求的伪造包。
 */
export const BOARD_INTERACT_RANGE = 96;

/** 是否站在公告栏旁边：坐标取地标底座中心，与碰撞盒同一份真相 */
export function isNearRankBoard(x: number, y: number, range: number = BOARD_INTERACT_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(range)) return false;
  const board = WELCOME_LANDMARKS.rankBoard;
  const dx = x - board.x;
  const dy = y - board.y;
  return dx * dx + dy * dy <= range * range;
}

const INTERACTIVE_KINDS = ['vending', 'cooler', 'coffee'] as const;
export type InteractiveKind = (typeof INTERACTIVE_KINDS)[number];

const INTERACTIVE_SET: ReadonlySet<PropKind> = new Set(INTERACTIVE_KINDS);

export function isInteractiveKind(kind: PropKind): kind is InteractiveKind {
  return INTERACTIVE_SET.has(kind);
}

/**
 * 台词：每类设施三句，按互动次数轮转，连按同一台机器会换话，不会卡在同一句。
 * 语气保持「加班园区」的生活化吐槽，不引入数值或任务。
 */
const LINES: Record<InteractiveKind, readonly string[]> = {
  vending: ['咔哒——冰可乐到手', '再来一罐，明天再说', '零钱没找开，快乐到位'],
  cooler: ['咕嘟咕嘟，续一口', '接满一杯，继续牛马', '水温刚好，气也顺了'],
  coffee: ['美式，苦得像周一', '加两包糖，甜一点', '第三杯了，心还在跳'],
};

/** 最近设施的输出槽：按键栈里复用同一个对象，避免每次互动造一份短命字面量 */
export interface InteractiveTarget {
  kind: InteractiveKind;
  x: number;
  y: number;
}

/** 写入调用方槽位的版本：返回 false 时槽位内容无意义 */
export function nearestInteractivePropInto(
  out: InteractiveTarget,
  x: number,
  y: number,
  range: number = INTERACT_RANGE,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(range)) return false;
  let found = false;
  let bestDistance = range * range;
  for (const prop of WORLD_LAYOUT.props) {
    if (!isInteractiveKind(prop.kind)) continue;
    const dx = prop.x - x;
    const dy = prop.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > bestDistance) continue;
    out.kind = prop.kind;
    out.x = prop.x;
    out.y = prop.y;
    bestDistance = distance;
    found = true;
  }
  return found;
}

/** 最近的可互动设施：范围外或附近没有时返回 null（保留给调用方不需要零分配的场合） */
export function nearestInteractiveProp(
  x: number,
  y: number,
  range: number = INTERACT_RANGE,
): { kind: InteractiveKind; x: number; y: number } | null {
  const out: InteractiveTarget = { kind: 'vending', x: 0, y: 0 };
  return nearestInteractivePropInto(out, x, y, range) ? out : null;
}

/** 按互动次数取台词：同一个 counter 永远同一句，便于单测与复现 */
export function pickLine(kind: InteractiveKind, counter: number): string {
  const lines = LINES[kind];
  const index = Number.isFinite(counter) ? Math.abs(Math.trunc(counter)) % lines.length : 0;
  return lines[index]!;
}

/**
 * 咀嚼台词：没有对应动画帧，气泡是唯一的本地视觉反馈。
 * 与设施台词分表，避免连按 F / G 时互相串词。
 */
const GRAZE_LINES = ['嚼嚼…', '这草有点柴', '低头，是为了不被点名'] as const;

export function pickGrazeLine(counter: number): string {
  const index = Number.isFinite(counter) ? Math.abs(Math.trunc(counter)) % GRAZE_LINES.length : 0;
  return GRAZE_LINES[index]!;
}

/**
 * 发泄的台词：出招者三句、被创飞者三句。
 *
 * 与设施台词的关键区别是**按 netId 取值而不是按次数轮转**：
 * 这些气泡由每个客户端各自根据广播出来的 state 位渲染，用本地计数器轮转的话，
 * 双开窗口看到的会是两句不同的话。用实体 id 取模，全场的第 N 号玩家永远是同一句。
 */
const VENT_LINES = ['💢 发泄！', '退！退！退！', '吃我一记牛马冲撞！'] as const;
const VENT_VICTIM_LINES = ['💫 哎哟被创飞了！', '💥 判定为工伤！', '😵 倒地装死中...'] as const;

function lineBySeed(lines: readonly string[], seed: number): string {
  const index = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % lines.length : 0;
  return lines[index]!;
}

/** 出招者头顶的台词 */
export function pickVentLine(seed: number): string {
  return lineBySeed(VENT_LINES, seed);
}

/** 被创飞者头顶的台词 */
export function pickVentVictimLine(seed: number): string {
  return lineBySeed(VENT_VICTIM_LINES, seed);
}

/** 躺床打呼：躺下静置 5s 后第一次，之后每 9s 一次 */
export const SNORE_FIRST_MS = 5000;
export const SNORE_INTERVAL_MS = 9000;

/**
 * 这一刻该不该冒「Zzz…」。
 * `idleMs` 是躺下后经过的时间（行走 / 起身会把它清零），`sinceSnoreMs` 是距上次打呼的时间。
 */
export function snoreDue(
  pose: Pose,
  seatKind: SeatKind | null,
  idleMs: number,
  sinceSnoreMs: number,
): boolean {
  if (pose !== POSE.Lie || seatKind !== 'bed') return false;
  if (!Number.isFinite(idleMs) || !Number.isFinite(sinceSnoreMs)) return false;
  if (idleMs < SNORE_FIRST_MS) return false;
  return sinceSnoreMs >= SNORE_INTERVAL_MS;
}
