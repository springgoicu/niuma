/**
 * 打工产出、老板 2.0 与全局随机事件（ADR-0088）。
 *
 * 全部参数集中在这里，服务端发钱与客户端预估必须读同一把尺子：
 * 任何一处再接一份字面量，都会出现「终端显示 22 币、钱包只多 15 币」的错位。
 *
 * 本文件不 import protocol.ts / types.ts：opcode 与编解码留在 protocol.ts，
 * 这里只放纯数值、纯函数与包的形状，避免循环依赖。
 */

import { PLAZA_CENTER, PLAZA_RADIUS } from './world/layout';

// ---------------------------------------------------------------------------
// 工位搬砖
// ---------------------------------------------------------------------------

/**
 * 搬砖结算参数。
 *
 * `RoundMs` 是终端小游戏一轮的时长，`MinGapMs` 比它短 2 秒：
 * 给 RTT 抖动与「最后一击的按键包晚到」留余量，同时仍然挡住连点脚本。
 */
export const WORK_REWARD = {
  Min: 15,
  Max: 30,
  RoundMs: 8000,
  MinGapMs: 6000,
  NightMul: 1.5,
  /** 每级工效 +8%，10 级 = ×1.8 */
  PerEffLv: 0.08,
  /** 单轮封顶：工效满级 + 夜班也不会超过这个数，避免通胀 */
  Cap: 120,
} as const;

/** 夜班判定：园区本地 21:00–06:00。`hour` 是 0–23 的服务端本地小时 */
export function isNightShift(hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  return hour >= 21 || hour < 6;
}

/**
 * 一轮搬砖的产出（属性成长已废除，只保留夜班时段加成）。
 *
 * `roll` 是服务端随机数（0 ≤ roll < 1），客户端只用固定 0.5 做「预估」展示，
 * 真正的金额永远以服务端下发的 `S2C_WORK_RESULT` 为准。
 */
export function workPayout(roll: number, _workEffLv: number, night: boolean): number {
  const r = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999, roll)) : 0.5;
  const base = WORK_REWARD.Min + Math.floor(r * (WORK_REWARD.Max - WORK_REWARD.Min + 1));
  const nightMul = night ? WORK_REWARD.NightMul : 1;
  return Math.min(WORK_REWARD.Cap, Math.round(base * nightMul));
}

/** 工位热区 id：与 `WORKSTATIONS` 下标一一对应 */
export function workDeskHotspotId(index: number): string {
  return `work-desk-${index}`;
}

/** 工位热区半径：足够覆盖「站在椅子边」也算在工位，不必精确到座椅吸附 */
export const WORK_DESK_RANGE = 84;

// ---------------------------------------------------------------------------
// 老板 2.0
// ---------------------------------------------------------------------------

/**
 * 老板奖励与「画饼冲击波」。
 *
 * `ShockEvery` 用血量差值而不是百分比：老板满血 10000、每次命中扣 1，
 * 用整数阈值才能在 `BossRuntime` 里用一次比较判断「这一脚是否跨过 25%」。
 */
export const BOSS_REWARD = {
  HitMin: 4,
  HitMax: 8,
  CritMul: 2,
  /** 尾刀大奖：只在 justDied 那一次发放 */
  Blade: 500,
  /** 固定街头幸运暴击率 15%（不依赖属性升级） */
  CritCap: 0.15,
} as const;

export const BOSS_SHOCK = {
  /** 每掉 2500 血（满血 10000 的 25%）触发一次 */
  Every: 2500,
  WarnMs: 2000,
  /** 预警圈半径：以老板受击中心为圆心 */
  Radius: 320,
  KnockbackPx: 48,
  StunMs: 1500,
} as const;

/** 固定街机暴击率：所有玩家一致为 15% */
export function bossCritChance(_critLv = 0): number {
  return BOSS_REWARD.CritCap;
}

/** 单次命中的掉落：2~5 币，暴击翻倍 */
export function bossHitCoins(roll: number, crit: boolean): number {
  const r = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999, roll)) : 0.5;
  const base = BOSS_REWARD.HitMin + Math.floor(r * (BOSS_REWARD.HitMax - BOSS_REWARD.HitMin + 1));
  return crit ? base * BOSS_REWARD.CritMul : base;
}

/** 冲击波阶段：预警 → 结算。客户端按阶段切换红色圆环的进度与配色 */
export const BOSS_SHOCK_PHASE = {
  Warn: 1,
  Hit: 2,
} as const;
export type BossShockPhase = (typeof BOSS_SHOCK_PHASE)[keyof typeof BOSS_SHOCK_PHASE];

/** 冲击波包：`[op][phase u8][x u16][y u16][radius u16][remainingMs u16][hits u8]` */
export interface BossShockPacket {
  phase: number;
  x: number;
  y: number;
  radius: number;
  remainingMs: number;
  /** 结算帧里被震趴的人数，预警帧为 0 */
  hits: number;
}

// ---------------------------------------------------------------------------
// 全局随机事件
// ---------------------------------------------------------------------------

export const WORLD_EVENT_KIND = {
  RedPacketRain: 1,
  Inspection: 2,
} as const;
export type WorldEventKind = (typeof WORLD_EVENT_KIND)[keyof typeof WORLD_EVENT_KIND];

export const WORLD_EVENT_PHASE = {
  /** 横幅播报，倒计时结束才真正开场 */
  Announce: 1,
  /** 进行中：红包可拾取 / 查岗倒计时 */
  Active: 2,
  /** 已结算：横幅播报结果，2 秒后消失 */
  Resolve: 3,
} as const;
export type WorldEventPhase = (typeof WORLD_EVENT_PHASE)[keyof typeof WORLD_EVENT_PHASE];

export const WORLD_EVENT = {
  /** 每 10 分钟一次 */
  PeriodMs: 10 * 60 * 1000,
  /** 开场前的横幅预热 */
  AnnounceMs: 3000,
  RedPacketCount: 25,
  RedPacketMin: 10,
  RedPacketMax: 40,
  /** 拾取半径：走到红包边上就能捡 */
  RedPacketPickRange: 72,
  /** 红包雨持续时间 */
  RedPacketDurationMs: 45_000,
  /** 查岗倒计时 */
  InspectionWarnMs: 10_000,
  InspectionReward: 60,
} as const;

/** 红包位图：25 个红包塞进一个 u32 */
export const RED_PACKET_MASK = (1 << WORLD_EVENT.RedPacketCount) - 1;

/** 确定性撒点：同一场事件在所有客户端与服务端得到同样的 25 个坐标 */
export interface RedPacketSpot {
  x: number;
  y: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 红包撒点：广场内两圈环形分布 + 抖动。
 *
 * 半径收在 130–300：既能被广场石砖托住视觉，也不会压到四向主路与圆庭边缘的花箱。
 * 服务端只用它做「距离校验」，渲染端只用它做「摆在哪儿」，两边不算第二份坐标表。
 */
export function redPacketSpots(seed: number): RedPacketSpot[] {
  const rand = mulberry32(seed * 2654435761 + 0x9e3779b9);
  const count = WORLD_EVENT.RedPacketCount;
  const spots: RedPacketSpot[] = [];
  const outer = PLAZA_RADIUS - 60;
  const inner = 130;
  for (let i = 0; i < count; i += 1) {
    // 两圈交错：偶数圈外环、奇数圈内环，避免 25 个点挤成一条圆周
    const ring = i % 2 === 0 ? outer : inner + (outer - inner) * 0.35;
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const radius = ring + (rand() - 0.5) * 34;
    spots.push({
      x: Math.round(PLAZA_CENTER.x + Math.cos(angle) * radius),
      y: Math.round(PLAZA_CENTER.y + Math.sin(angle) * radius * 0.92),
    });
  }
  return spots;
}

/** 世界事件包：`[op][kind u8][phase u8][remainingSec u16][seed u16][amount u16]` */
export interface WorldEventPacket {
  kind: number;
  phase: number;
  remainingSec: number;
  /** 红包雨的撒点种子；查岗事件填 0 */
  seed: number;
  /** 事件额外数值：红包雨是 0，查岗是全勤人数 */
  amount: number;
}

/** 红包拾取请求：`[op][index u8]` */
export interface EventClaimRequest {
  index: number;
}

/** 红包拾取结果：`[op][index u8][amount u16][flags u8]`，bit0 = 本次由自己领到 */
export interface EventClaimResult {
  index: number;
  amount: number;
  mine: boolean;
}

/** 事件文案：两个阶段各一句，服务端广播与客户端横幅共用 */
export function worldEventTitle(kind: number): string {
  if (kind === WORLD_EVENT_KIND.RedPacketRain) return '天降财神红包雨';
  if (kind === WORLD_EVENT_KIND.Inspection) return '老板突击查岗';
  return '园区事件';
}

export function worldEventSubtitle(kind: number, phase: number): string {
  if (kind === WORLD_EVENT_KIND.RedPacketRain) {
    if (phase === WORLD_EVENT_PHASE.Announce) return '财神爷撒钱了，广场马上落红包';
    if (phase === WORLD_EVENT_PHASE.Active) return '走近红包或按 F 抢';
    return '红包抢完了，下次赶早';
  }
  if (kind === WORLD_EVENT_KIND.Inspection) {
    if (phase === WORLD_EVENT_PHASE.Announce) return '老板正在路上，工位上别乱走';
    if (phase === WORLD_EVENT_PHASE.Active) return '坐稳工位，全勤奖马上发';
    return '查岗结束，全勤奖已到账';
  }
  return '';
}

// ---------------------------------------------------------------------------
// 每日悬赏
// ---------------------------------------------------------------------------

export const QUEST_ID = {
  BossHits: 1,
  MatchWin: 2,
  WorkRounds: 3,
} as const;
export type QuestId = (typeof QUEST_ID)[keyof typeof QUEST_ID];

export interface QuestDef {
  id: number;
  /** 客户端存档 / 文案使用的稳定键 */
  key: string;
  title: string;
  blurb: string;
  target: number;
  reward: number;
}

/**
 * 三个每日悬赏。
 *
 * 进度全部由服务端计数（打老板次数、P2P 胜局、搬砖轮数），
 * 客户端只做展示与「一键领取」请求；日期键固定 `YYYY-MM-DD`，跨天由服务端重置。
 */
export const QUEST_DEFS: readonly QuestDef[] = [
  {
    id: QUEST_ID.BossHits,
    key: 'boss_hits',
    title: '踢老板 10 脚',
    blurb: '在发泄区真实命中研发园老板 10 次。',
    target: 10,
    reward: 60,
  },
  {
    id: QUEST_ID.MatchWin,
    key: 'match_win',
    title: '赢一局对局',
    blurb: '随便挑一种 P2P 玩法（猜拳 / 骰子 / 切磋）赢一局。',
    target: 1,
    reward: 80,
  },
  {
    id: QUEST_ID.WorkRounds,
    key: 'work_rounds',
    title: '搬砖 2 轮',
    blurb: '坐到自己工位上完成两轮加班搬砖。',
    target: 2,
    reward: 40,
  },
];

export function findQuestDef(id: number): QuestDef | undefined {
  return QUEST_DEFS.find((def) => def.id === id);
}

/** 单条悬赏的进度快照 */
export interface QuestEntry {
  id: number;
  progress: number;
  target: number;
  claimed: boolean;
}

/** 悬赏状态包：`[op][dayLen u8][day][count u8]` + count × `[id u8][progress u16][claimed u8]` */
export interface QuestStatePacket {
  day: string;
  entries: QuestEntry[];
}

/** 进度字段是 u16：服务端写入前统一钳制，伪造进度也撑不大包体 */
export const QUEST_PROGRESS_MAX = 0xffff;
