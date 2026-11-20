/**
 * 园区房产地标（8 栋分阶产业，ADR-0087 扩展版）：
 *
 * - 无主时门口牌匾标出起拍价，按 F 买下「本运行周期」的冠名权；
 * - 已有房主时支持 **1.5× 溢价收购**（原房主自动获得 1.2× 补偿，在线离线均到账）；
 * - 牌匾实时显示房主名 + 在线状态灯 + 门锁状态；
 * - 院内摇钱树按地段分阶每分钟结 15~80 币（最多囤 10 分钟），房主走进去按 F 收走；
 * - 院墙是静态碰撞（进 WORLD_LAYOUT.solids），门栅是动态碰撞：
 *   服务端裁决与客户端预测都调 `villaDoorSolid`，锁上时才把这道矩形塞进碰撞表。
 */

import type { SolidRect } from './campus';
import { rectContains, type WorldRect } from './geometry';

/** 默认兜底冠名价（供旧测试引用）；实际各房产按 `spec.price` 计算 */
export const VILLA_PRICE = 1000;
/** 默认兜底每分钟产出（供旧测试引用）；实际各房产按 `spec.income` 计算 */
export const VILLA_INCOME = 25;
export const VILLA_INCOME_INTERVAL_MS = 60_000;
/** 离线囤积上限：10 分钟，回来一次最多收 10 分钟产出 */
export const VILLA_INCOME_CAP_MS = 10 * 60_000;
/** 门口牌匾与热区的感应半径 */
export const VILLA_GATE_RANGE = 64;
export const VILLA_TREE_RANGE = 48;

/** 已被他人冠名的房产支持溢价收购：买家支付 1.5× 原价，原房主获 1.2× 补偿 */
export const VILLA_BUYOUT_MULTIPLIER = 1.5;
export const VILLA_BUYOUT_REFUND_RATIO = 1.2;

export type PropertyTier = 1 | 2 | 3 | 4;
export type PropertyKind = 'courtyard' | 'club' | 'garage' | 'stall' | 'lodge';
export type PropertyDistrict = 'amusement' | 'living' | 'scenery';
export type PropertyNavId =
  | 'villa1'
  | 'villa2'
  | 'clubNeon'
  | 'streetGarage'
  | 'ramenStall'
  | 'lakeLodge'
  | 'bambooYard'
  | 'pondPavilion';

export const PROPERTY_TIER_LABEL: Record<PropertyTier, string> = {
  1: 'T1 街头摊位',
  2: 'T2 雅致小院',
  3: 'T3 黄金商铺',
  4: 'T4 霓虹地标',
};

export interface VillaSpec {
  /** 线协议 id：u8，只追加不复用 */
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly navId: PropertyNavId;
  readonly district: PropertyDistrict;
  readonly kind: PropertyKind;
  readonly tier: PropertyTier;
  readonly price: number;
  readonly income: number;
  readonly tagline: string;
  /** 院地整体（含院墙） */
  readonly rect: WorldRect;
  /** 小楼本体：院地北半部，牌匾挂在它南墙上 */
  readonly house: WorldRect;
  /** 院门中心（南墙缺口） */
  readonly gate: { readonly x: number; readonly y: number };
  /** 牌匾挂点：院门正上方 */
  readonly plaque: { readonly x: number; readonly y: number };
  /** 摇钱树/收银柜锚点：院内空地 */
  readonly tree: { readonly x: number; readonly y: number };
}

const WALL = 8;
const GATE_HALF = 26;

interface PropertyInput {
  id: number;
  key: string;
  name: string;
  navId: PropertyNavId;
  district: PropertyDistrict;
  kind: PropertyKind;
  tier: PropertyTier;
  price: number;
  income: number;
  tagline: string;
  rect: WorldRect;
}

function property(input: PropertyInput): VillaSpec {
  const { rect } = input;
  const gate = { x: Math.round(rect.x + rect.w / 2), y: rect.y + rect.h };
  const houseH = Math.min(82, Math.max(54, Math.round(rect.h * 0.44)));
  return {
    id: input.id,
    key: input.key,
    name: input.name,
    navId: input.navId,
    district: input.district,
    kind: input.kind,
    tier: input.tier,
    price: input.price,
    income: input.income,
    tagline: input.tagline,
    rect,
    house: { x: rect.x + 20, y: rect.y + 14, w: rect.w - 40, h: houseH },
    gate,
    plaque: { x: gate.x, y: gate.y - 12 },
    tree: { x: gate.x, y: rect.y + rect.h - 42 },
  };
}

/**
 * 园区 8 栋分阶房产（原摸鱼一号/二号院 id 0/1 与坐标完全保留，新地标按 2..7 顺序追加）：
 * - 生活区：T2 摸鱼一号院 / T2 摸鱼二号院
 * - 游乐区（霓虹娱乐街）：T4 不夜城夜店 / T3 霓虹改车铺 / T1 夜市拉面摊
 * - 景观区：T1 摸鱼湖钓屋 / T2 翠竹隐士居 / T3 沉思畔茶院
 */
export const VILLA_SPECS: ReadonlyArray<VillaSpec> = [
  property({
    id: 0,
    key: 'villa-1',
    name: '摸鱼一号院',
    navId: 'villa1',
    district: 'living',
    kind: 'courtyard',
    tier: 2,
    price: 1000,
    income: 25,
    tagline: '生活大街南侧独立砖砌小院，自带摇钱树。',
    rect: { x: 4320, y: 5390, w: 220, h: 170 },
  }),
  property({
    id: 1,
    key: 'villa-2',
    name: '摸鱼二号院',
    navId: 'villa2',
    district: 'living',
    kind: 'courtyard',
    tier: 2,
    price: 1000,
    income: 25,
    tagline: '一号院东邻，同规格双拼砖院与门前花园。',
    rect: { x: 4600, y: 5390, w: 220, h: 170 },
  }),
  property({
    id: 2,
    key: 'club-neon',
    name: '不夜城夜店',
    navId: 'clubNeon',
    district: 'amusement',
    kind: 'club',
    tier: 4,
    price: 5000,
    income: 80,
    tagline: '霓虹娱乐街西首地标：蓝砖舞池、顶配灯球与高额分红。',
    rect: { x: 2700, y: 2640, w: 320, h: 320 },
  }),
  property({
    id: 3,
    key: 'street-garage',
    name: '霓虹改车铺',
    navId: 'streetGarage',
    district: 'amusement',
    kind: 'garage',
    tier: 3,
    price: 2500,
    income: 45,
    tagline: '娱乐街中段潮酷工坊：赛博霓虹棚顶与街头胎印。',
    rect: { x: 3060, y: 2700, w: 240, h: 260 },
  }),
  property({
    id: 4,
    key: 'ramen-stall',
    name: '夜市拉面摊',
    navId: 'ramenStall',
    district: 'amusement',
    kind: 'stall',
    tier: 1,
    price: 600,
    income: 18,
    tagline: '三盏灯笼一锅热汤：低门槛入局的街头网红宵夜摊。',
    rect: { x: 3330, y: 2780, w: 200, h: 180 },
  }),
  property({
    id: 5,
    key: 'lake-lodge',
    name: '摸鱼湖钓屋',
    navId: 'lakeLodge',
    district: 'scenery',
    kind: 'lodge',
    tier: 1,
    price: 500,
    income: 15,
    tagline: '摸鱼湖东北岸观景木屋，新手最易入手的第一套产权。',
    rect: { x: 5240, y: 4700, w: 200, h: 150 },
  }),
  property({
    id: 6,
    key: 'bamboo-yard',
    name: '翠竹隐士居',
    navId: 'bambooYard',
    district: 'scenery',
    kind: 'courtyard',
    tier: 2,
    price: 1200,
    income: 30,
    tagline: '翠竹林南侧青瓦竹院，远离喧嚣又紧邻西主路。',
    rect: { x: 3060, y: 4300, w: 210, h: 150 },
  }),
  property({
    id: 7,
    key: 'pond-pavilion',
    name: '沉思畔茶院',
    navId: 'pondPavilion',
    district: 'scenery',
    kind: 'lodge',
    tier: 3,
    price: 2800,
    income: 50,
    tagline: '沉思浅塘北岸私密茶院，俯瞰东北湖景的黄金别业。',
    rect: { x: 4940, y: 2500, w: 260, h: 170 },
  }),
];

export function villaById(id: number): VillaSpec | undefined {
  return VILLA_SPECS.find((spec) => spec.id === id);
}

/** 买下或溢价收购所需价格：无主按原价，已被他人冠名按 1.5× 计算 */
export function villaBuyPrice(spec: VillaSpec, owned: boolean): number {
  return owned ? Math.round(spec.price * VILLA_BUYOUT_MULTIPLIER) : spec.price;
}

/** 被他人溢价收购时，原房主自动获赔金额（1.2× 原价） */
export function villaBuyoutRefund(spec: VillaSpec): number {
  return Math.round(spec.price * VILLA_BUYOUT_REFUND_RATIO);
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
export function villaPendingIncome(lastCollectAt: number, now: number, incomePerMin = VILLA_INCOME): number {
  if (!Number.isFinite(lastCollectAt) || !Number.isFinite(now)) return 0;
  const span = Math.min(VILLA_INCOME_CAP_MS, Math.max(0, now - lastCollectAt));
  return Math.floor(span / VILLA_INCOME_INTERVAL_MS) * incomePerMin;
}
