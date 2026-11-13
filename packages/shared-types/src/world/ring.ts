/**
 * 发泄区擂台：服务端裁决、客户端烘焙与 HUD 共用的唯一坐标/规则真相。
 *
 * 擂台是发泄区西侧一块独立的 300×260 矩形，和老板垫隔开 160px：
 * - 非参赛者不能靠移动踏入，只能在场边按 F 传送到起点；
 * - 参赛者被夹在矩形内，比赛中不能离开；等待期可取消报名，颁奖期可领奖离场；
 * - 容量 3、初始 10 血，2 分钟是上限：站着的只剩 1 人就立刻结算（ADR-0076），
 *   按剩余血量排出前三名。
 */

import { rectContains, rectExpanded, type WorldRect } from './geometry';

/** 擂台地面：发泄区西侧，北沿与老板垫对齐，南沿留出围观通道。 */
export const RING_ARENA: WorldRect = { x: 3440, y: 5300, w: 300, h: 260 };

/** 场边报名点：擂台东侧、靠近老板垫的铺装空位。 */
export const RING_EXIT = { x: 3780, y: 5430 } as const;

/** 靠近判定：从围绳外 96px 内就能按 F 报名，不必贴到绳子。 */
export const RING_NEAR_PX = 96;

/** 角色脚底离围绳至少留 18px，避免半个身子穿出绳子。 */
export const RING_BOUND_PADDING = 18;

export const RING_CAPACITY = 3;
export const RING_MAX_HP = 10;
/** 本局上限：站着的只剩 1 人时提前结算，不必走满。 */
export const RING_ROUND_MS = 120_000;
/** 颁奖窗口：领奖台与彩带的表现时长，参赛者可随时提前离场。 */
export const RING_AWARD_MS = 4_000;
export const RING_DAMAGE = 1;

/** 三个起跑位：左前、中后、右前，第三人从空位补入。 */
export const RING_START_SLOTS = [
  { x: 3505, y: 5395 },
  { x: 3590, y: 5515 },
  { x: 3675, y: 5395 },
] as const;

/** 领奖台：金位在中央最高阶，银/铜在左右两侧。 */
export const RING_PODIUM_SLOTS = [
  { x: 3590, y: 5360 },
  { x: 3500, y: 5375 },
  { x: 3680, y: 5375 },
] as const;

/** 擂台阶段：0 空闲 / 1 等第 2 人 / 2 进行中 / 3 颁奖。 */
export const RING_PHASE = {
  Idle: 0,
  Waiting: 1,
  Running: 2,
  Award: 3,
} as const;

export type RingPhase = (typeof RING_PHASE)[keyof typeof RING_PHASE];

/** 服务端内部使用的排名输入；`eliminatedAt` 为 null 表示仍站立。 */
export interface RingRankCandidate {
  id: number;
  hp: number;
  eliminatedAt: number | null;
  enteredAt: number;
}

export interface RingRankEntry {
  id: number;
  rank: number;
}

export function isInRing(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return rectContains(RING_ARENA, x, y);
}

/** 是否在报名感应范围内（围绳外扩 96px，场内也算近）。 */
export function isNearRing(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return rectContains(rectExpanded(RING_ARENA, RING_NEAR_PX), x, y);
}

/** 把脚底夹回擂台内；击退、移动预测与服务端裁决共用同一份边界。 */
export function clampToRing(x: number, y: number): { x: number; y: number } {
  const minX = RING_ARENA.x + RING_BOUND_PADDING;
  const maxX = RING_ARENA.x + RING_ARENA.w - RING_BOUND_PADDING;
  const minY = RING_ARENA.y + RING_BOUND_PADDING;
  const maxY = RING_ARENA.y + RING_ARENA.h - RING_BOUND_PADDING;
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/**
 * 按剩余血量排名。
 *
 * 同分时先看是否站立；都已淘汰则后倒下的人名次更高；仍相同则先入场者优先，
 * 最后用 id 兜底，保证服务端在同一 Tick 多次结算时也能得到稳定结果。
 */
export function rankByHp(candidates: readonly RingRankCandidate[]): RingRankEntry[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.hp !== b.hp) return b.hp - a.hp;
    const aDown = a.hp <= 0;
    const bDown = b.hp <= 0;
    if (aDown !== bDown) return aDown ? 1 : -1;
    if (aDown && bDown) {
      const ao = a.eliminatedAt ?? 0;
      const bo = b.eliminatedAt ?? 0;
      if (ao !== bo) return bo - ao;
    }
    if (a.enteredAt !== b.enteredAt) return a.enteredAt - b.enteredAt;
    return a.id - b.id;
  });
  return sorted.map((entry, index) => ({ id: entry.id, rank: index + 1 }));
}
