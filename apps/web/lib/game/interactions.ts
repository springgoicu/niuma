'use client';

import { POSE, WORLD_LAYOUT, type Pose, type PropKind, type SeatKind } from '@niuma/shared-types';

/**
 * 轻互动：售货机、饮水机、咖啡机的一次性反馈，与躺床打呼。
 *
 * 全部留在客户端：不新增协议、不进服务端状态机（零持久化的取舍见 ADR-0024）。
 * 这里是纯函数，`GameSession` 只负责「按键 → 查最近设施 → 冒气泡」。
 */

/** 互动判定半径：比入座半径小一档，站在机器旁边才触发 */
export const INTERACT_RANGE = 56;

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
