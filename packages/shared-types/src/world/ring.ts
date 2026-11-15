/**
 * 绩效八角笼：服务端裁决、客户端烘焙与 HUD 共用的唯一坐标/规则真相。
 *
 * 擂台是发泄区西侧一块独立的 300×260 矩形，和老板垫隔开 160px：
 * - 四周围栏是静态碰撞，南北正中各留 56px 门洞；
 * - 踏进南门内的报名区按 F 交 50 币当擂主，第二人上台即开赛（红 / 蓝两角）；
 * - 参赛者被夹在围栏内，比赛中不能离开；等待期可取消报名，颁奖期可领奖离场；
 * - 容量 2、初始 10 血，2 分钟是上限：站着的只剩 1 人就立刻结算（ADR-0076）；
 * - 场外 4 张观战长椅，坐上去可以对红 / 蓝双方押注，赢家按彩池比例分账；
 * - 擂主连胜 ≥3 场触发全服广播。
 */

import { DIRECTION } from '../constants';
import type { SeatInstance, SolidRect } from './campus';
import { rectContains, rectExpanded, type WorldRect } from './geometry';

/**
 * 擂台地面（ADR-0097）：游乐大街中段的路南，夹在赌场亭与游乐园南门之间。
 * 北沿与赌场亭同一条街，南沿留出围观通道。
 */
export const RING_ARENA: WorldRect = { x: 3140, y: 2760, w: 300, h: 260 };

/** 场边出场点：南门外侧，颁奖结束后统一落在这里。 */
export const RING_EXIT = { x: RING_ARENA.x + 150, y: RING_ARENA.y + RING_ARENA.h + 32 } as const;

/** 报名区：南门内侧的台面，踏进来按 F 就算上台。 */
export const RING_SIGNUP = { x: RING_ARENA.x + 150, y: RING_ARENA.y + 216 } as const;
export const RING_SIGNUP_RANGE = 72;

/** 靠近判定：从围栏外 96px 内就能按 F 报名，不必贴到栏杆。 */
export const RING_NEAR_PX = 96;

/** 角色脚底离围栏至少留 22px，避免半个身子穿出栏杆。 */
export const RING_BOUND_PADDING = 22;

/** 对局容量：红蓝 1v1。 */
export const RING_CAPACITY = 2;
export const RING_MAX_HP = 10;
/** 本局上限：站着的只剩 1 人时提前结算，不必走满。 */
export const RING_ROUND_MS = 120_000;
/** 颁奖窗口：领奖台与彩带的表现时长，参赛者可随时提前离场。 */
export const RING_AWARD_MS = 4_000;
export const RING_DAMAGE = 1;

/** 报名费：擂主与挑战者各交 50，两人 100 全给胜者（平台不抽水）。 */
export const RING_FEE = 50;
/** 连胜里程碑：达到即全服广播一次。 */
export const RING_STREAK_TARGET = 3;
/** 观战押注的上下限 */
export const RING_BET_MIN = 10;
export const RING_BET_MAX = 500;

/** 红 / 蓝两角：线协议 u8 */
export const RING_SIDE = {
  Red: 0,
  Blue: 1,
} as const;
export type RingSide = (typeof RING_SIDE)[keyof typeof RING_SIDE];

export const RING_SIDE_NAME: Record<number, string> = {
  [RING_SIDE.Red]: '红方',
  [RING_SIDE.Blue]: '蓝方',
};

/** 两个起跑位：红角在左、蓝角在右，先报名的是红方（擂主）。 */
export const RING_START_SLOTS = [
  { x: RING_ARENA.x + 65, y: RING_ARENA.y + 128 },
  { x: RING_ARENA.x + 235, y: RING_ARENA.y + 128 },
] as const;

/**
 * 围栏：四条 10px 厚的栏杆，南北正中各留 56px 门洞。
 *
 * 静态碰撞进 `WORLD_LAYOUT.solids`；参赛者的 `clampToRing` 内缩 22px，
 * 因此比赛中不会被自己的围栏挡住。
 */
export const RING_FENCE_SOLIDS: ReadonlyArray<SolidRect> = (() => {
  const W = 10;
  const { x, y, w, h } = RING_ARENA;
  const gateLeft = RING_SIGNUP.x - 28;
  const gateRight = RING_SIGNUP.x + 28;
  return [
    // 北墙：门洞左右两段
    { kind: 'wall' as const, x, y, w: gateLeft - x, h: W },
    { kind: 'wall' as const, x: gateRight, y, w: x + w - gateRight, h: W },
    // 南墙：门洞左右两段
    { kind: 'wall' as const, x, y: y + h - W, w: gateLeft - x, h: W },
    { kind: 'wall' as const, x: gateRight, y: y + h - W, w: x + w - gateRight, h: W },
    // 东西两侧整段
    { kind: 'wall' as const, x, y, w: W, h },
    { kind: 'wall' as const, x: x + w - W, y, w: W, h },
  ];
})();

/** 4 张观战长椅：西侧两张、东侧两张，全部面朝擂台 */
export const RING_BENCHES: ReadonlyArray<{ x: number; y: number }> = [
  { x: RING_ARENA.x - 60, y: RING_ARENA.y + 52 },
  { x: RING_ARENA.x - 60, y: RING_ARENA.y + 144 },
  { x: RING_ARENA.x + 360, y: RING_ARENA.y + 52 },
  { x: RING_ARENA.x + 360, y: RING_ARENA.y + 144 },
];

/** 观战长椅的座位组名：热区 `seatGroupId` 与「坐上才能押注」的资格判定共用这一处（ADR-0093） */
export const RING_BENCH_SEAT_GROUP = 'arena-bench';

/** 观战长椅的坐点（在椅面正前方 12px，与其它长椅同一口径） */
export const RING_BENCH_SEAT_DRAFTS: ReadonlyArray<Omit<SeatInstance, 'id' | 'desk'>> = RING_BENCHES.map(
  (bench) => ({
    x: bench.x,
    y: bench.y + 12,
    facing: DIRECTION.Down,
    kind: 'bench' as const,
    group: RING_BENCH_SEAT_GROUP,
  }),
);

/**
 * 观战长椅底座碰撞：40×16，与园区里其它长椅同尺寸。
 *
 * 底边贴在长椅脚底（`bench.y`），和 `propSolid` 对 bench 的口径一致：
 * 精灵锚点是 (0.5, 1)，坐点在椅前 12px，碰撞盒若按中心摆会在坐点下方留出隐形墙。
 */
export const RING_BENCH_SOLIDS: ReadonlyArray<SolidRect> = RING_BENCHES.map((bench) => ({
  kind: 'prop' as const,
  x: bench.x - 20,
  y: bench.y - 16,
  w: 40,
  h: 16,
}));

/** 是否在报名区（南门内的台面上） */
export function isInRingSignup(x: number, y: number, range = RING_SIGNUP_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = x - RING_SIGNUP.x;
  const dy = y - RING_SIGNUP.y;
  return dx * dx + dy * dy <= range * range;
}

/** 领奖台：金位在中央最高阶，银/铜在左右两侧。 */
export const RING_PODIUM_SLOTS = [
  { x: RING_ARENA.x + 150, y: RING_ARENA.y + 60 },
  { x: RING_ARENA.x + 60, y: RING_ARENA.y + 75 },
  { x: RING_ARENA.x + 240, y: RING_ARENA.y + 75 },
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
