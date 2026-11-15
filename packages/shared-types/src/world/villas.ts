/**
 * 豪宅小院（VILLA_1 / VILLA_2）：小黑屋以东、摸鱼湖以西的两块 220px 见方院地。
 *
 * - 无主时门口牌匾标价 1000 币，按 F 买下「本运行周期」的冠名权；
 * - 牌匾实时显示房主名，房主可切换锁门（锁上后门洞变成一道动态门栅）；
 * - 院内金色摇钱树每分钟结 25 币，房主走进去按 F 收走（最多囤 10 分钟）。
 *
 * 院墙是静态碰撞（进 WORLD_LAYOUT.solids），门栅是动态碰撞：
 * 服务端裁决与客户端预测都调 `villaDoorSolid`，锁上时才把这道矩形塞进碰撞表。
 */

import type { SolidRect } from './campus';
import { rectContains, type WorldRect } from './geometry';

/** 冠名权价格：买下后本运行周期内归你，重启园区重新挂牌 */
export const VILLA_PRICE = 1000;
/** 摇钱树每分钟产出 */
export const VILLA_INCOME = 25;
export const VILLA_INCOME_INTERVAL_MS = 60_000;
/** 离线囤积上限：10 分钟，回来一次最多收 250 */
export const VILLA_INCOME_CAP_MS = 10 * 60_000;
/** 门口牌匾与热区的感应半径 */
export const VILLA_GATE_RANGE = 64;
export const VILLA_TREE_RANGE = 48;

export interface VillaSpec {
  /** 线协议 id：u8，只追加不复用 */
  readonly id: number;
  readonly key: string;
  readonly name: string;
  /** 院地整体（含院墙） */
  readonly rect: WorldRect;
  /** 小楼本体：院地北半部，牌匾挂在它南墙上 */
  readonly house: WorldRect;
  /** 院门中心（南墙缺口） */
  readonly gate: { readonly x: number; readonly y: number };
  /** 牌匾挂点：院门正上方 */
  readonly plaque: { readonly x: number; readonly y: number };
  /** 摇钱树锚点：院内空地 */
  readonly tree: { readonly x: number; readonly y: number };
}

const WALL = 8;
const GATE_HALF = 26;

function villa(
  id: number,
  key: string,
  name: string,
  rect: WorldRect,
): VillaSpec {
  const gate = { x: rect.x + rect.w / 2, y: rect.y + rect.h };
  return {
    id,
    key,
    name,
    rect,
    house: { x: rect.x + 24, y: rect.y + 16, w: rect.w - 48, h: 78 },
    gate,
    plaque: { x: gate.x, y: gate.y - 12 },
    tree: { x: gate.x, y: rect.y + rect.h - 44 },
  };
}

export const VILLA_SPECS: ReadonlyArray<VillaSpec> = [
  villa(0, 'villa-1', '摸鱼一号院', { x: 4670, y: 4700, w: 220, h: 170 }),
  villa(1, 'villa-2', '摸鱼二号院', { x: 4670, y: 4890, w: 220, h: 160 }),
];

export function villaById(id: number): VillaSpec | undefined {
  return VILLA_SPECS.find((spec) => spec.id === id);
}

/** 静态院墙：南北东三面整段，南墙在院门处留门洞（门栅由 `villaDoorSolid` 生成） */
export const VILLA_WALL_SOLIDS: ReadonlyArray<SolidRect> = VILLA_SPECS.flatMap((spec) => {
  const { x, y, w, h } = spec.rect;
  const left = spec.gate.x - GATE_HALF;
  const right = spec.gate.x + GATE_HALF;
  return [
    // 北墙
    { kind: 'wall' as const, x, y, w, h: WALL },
    // 东墙
    { kind: 'wall' as const, x: x + w - WALL, y, w: WALL, h },
    // 西墙
    { kind: 'wall' as const, x, y, w: WALL, h },
    // 南墙：门洞左右各一段
    { kind: 'wall' as const, x, y: y + h - WALL, w: Math.max(0, left - x), h: WALL },
    {
      kind: 'wall' as const,
      x: right,
      y: y + h - WALL,
      w: Math.max(0, x + w - right),
      h: WALL,
    },
  ];
});

/** 锁门时的门栅：与南墙同厚，填住门洞 */
export function villaDoorSolid(spec: VillaSpec, locked: boolean): SolidRect | null {
  if (!locked) return null;
  return {
    kind: 'prop',
    x: spec.gate.x - GATE_HALF,
    y: spec.rect.y + spec.rect.h - WALL,
    w: GATE_HALF * 2,
    h: WALL,
  };
}

/** 是否站在院门口（牌匾与买卖都在这一处） */
export function isNearVillaGate(spec: VillaSpec, x: number, y: number, range = VILLA_GATE_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = x - spec.gate.x;
  const dy = y - spec.gate.y;
  return dx * dx + dy * dy <= range * range;
}

/** 是否站在院内摇钱树旁；锁门后屋主自己仍能进（门栅只挡客人） */
export function isNearVillaTree(spec: VillaSpec, x: number, y: number, range = VILLA_TREE_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = x - spec.tree.x;
  const dy = y - spec.tree.y;
  return dx * dx + dy * dy <= range * range;
}

/** 是否站在院内（收租只认院内，站在墙外不算） */
export function isInVillaYard(spec: VillaSpec, x: number, y: number): boolean {
  return rectContains(spec.rect, x, y);
}

/** 已累积的产出：按完整分钟结算，超过上限后不再增长 */
export function villaPendingIncome(lastCollectAt: number, now: number): number {
  if (!Number.isFinite(lastCollectAt) || !Number.isFinite(now)) return 0;
  const span = Math.min(VILLA_INCOME_CAP_MS, Math.max(0, now - lastCollectAt));
  return Math.floor(span / VILLA_INCOME_INTERVAL_MS) * VILLA_INCOME;
}
