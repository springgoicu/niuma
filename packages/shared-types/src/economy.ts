/**
 * 牛马币经济档案（ADR-0082）。
 *
 * 永久层只有浏览器 localStorage：服务端内存是本次进园的权威，
 * 但所有字段都必须在协议层过同一把尺子——HELLO 上报的是不可信输入。
 *
 * 该文件不碰 ByteWriter：编码函数集中在 protocol.ts，避免与 HELLO 循环依赖。
 */

import { SHIELD_HOLD_MS } from './buffs';

/** localStorage 键：版本号写进键名，升级时旧档自然失效而不是读出半截结构 */
export const ECONOMY_STORAGE_KEY = 'niuma:economy:v1';

/** HELLO 尾部经济段魔数。0xfa 已被会话续算段占用，0xf8–0xff 全部名花有主 */
export const ECONOMY_EXTENSION_MAGIC = 0xf7;
/** 经济段最短载荷：coins u32 + 四维各 u8 + houseTier u8 + 道具数量 u8 */
export const ECONOMY_MIN_BYTES = 10;
/** 经济段最长载荷：10 + 16 种道具 × (id u8 + count u16) */
export const ECONOMY_MAX_BYTES = 10 + 16 * 3;
export const ECONOMY_MAX_ITEM_KINDS = 16;

/** 余额上限：u32 留出余量，避免前端 number 与 0xffffffff 相加时越界 */
export const MAX_COINS = 999_999_999;
export const MAX_STAT_LEVEL = 10;
export const MAX_ITEM_COUNT = 99;
export const MAX_HOUSE_TIER = 5;
export const MAX_ECONOMY_COSMETICS = 24;

export const STAT_KEYS = ['atkSpeedLv', 'workEffLv', 'critLv', 'armorLv'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export interface EconomyStats {
  /** 攻速：唯一已经接入玩法的属性，决定发泄冷却 */
  atkSpeedLv: number;
  /** 工作效率：预留给打工产出，当前只影响商店展示 */
  workEffLv: number;
  /** 暴击：预留给伤害浮动 */
  critLv: number;
  /** 护甲：预留给受击减伤 */
  armorLv: number;
}

/** 每日任务进度：日期键固定用 `YYYY-MM-DD`，跨天由前端重置 */
export interface DailyQuestState {
  day: string;
  progress: Record<string, number>;
  claimed: string[];
}

export interface EconomyProfile {
  coins: number;
  stats: EconomyStats;
  unlockedCosmetics: string[];
  inventory: Record<string, number>;
  houseTier: number;
  dailyQuests: DailyQuestState;
}

/** 钱包变动原因：协议里是 u8，只追加不复用（旧客户端只做展示兜底） */
export const WALLET_REASON = {
  Init: 0,
  RingReward: 1,
  KnockdownReward: 2,
  BossReward: 3,
  QuestReward: 4,
  ShopUpgrade: 5,
  ShopItem: 6,
  TipOut: 7,
  TipIn: 8,
  EscrowFreeze: 9,
  EscrowRefund: 10,
  MatchReward: 11,
  MatchLoss: 12,
  ItemUse: 13,
  /** 道具没生效（保安缺席等）原路退回：只追加不复用 */
  ItemRefund: 14,
  // ---- 四类新建筑（热区注册表同一轮）----
  /** 赌桌下注冻结 */
  DiceBet: 15,
  /** 赌桌彩池派彩 */
  DiceWin: 16,
  /** 保安查岗抽水（彩蛋） */
  GuardRake: 17,
  /** 八角笼报名费 */
  ArenaFee: 18,
  /** 八角笼胜者拿走 100 币彩池 */
  ArenaWin: 19,
  /** 观战押注冻结 */
  ArenaBet: 20,
  /** 观战押注派彩 */
  ArenaBetWin: 21,
  /** 押注退款（无人对押 / 比赛取消） */
  ArenaBetRefund: 22,
  /** 豪宅冠名权 */
  VillaBuy: 23,
  /** 摇钱树收币 */
  VillaIncome: 24,
  /** 装扮购买 */
  Cosmetic: 25,
  /** 户型升级 */
  HouseUpgrade: 26,
  /** 购买家具 */
  Furniture: 27,
  // ---- 打工产出 / 世界事件（ADR-0088），只追加不复用 ----
  /** 工位搬砖工资 */
  WorkPay: 28,
  /** 红包雨抢到的红包 */
  RedPacket: 29,
  /** 命中老板的掉落 */
  BossHit: 30,
  /** 突击查岗全勤奖 */
  InspectionBonus: 31,
} as const;
export type WalletReason = (typeof WALLET_REASON)[keyof typeof WALLET_REASON];

export const WALLET_REASON_LABEL: Record<number, string> = {
  [WALLET_REASON.Init]: '进园结算',
  [WALLET_REASON.RingReward]: '擂台奖金',
  [WALLET_REASON.KnockdownReward]: '击倒奖励',
  [WALLET_REASON.BossReward]: '老板倒下',
  [WALLET_REASON.QuestReward]: '每日任务',
  [WALLET_REASON.ShopUpgrade]: '属性升级',
  [WALLET_REASON.ShopItem]: '购买道具',
  [WALLET_REASON.TipOut]: '打赏支出',
  [WALLET_REASON.TipIn]: '收到打赏',
  [WALLET_REASON.EscrowFreeze]: '赌注冻结',
  [WALLET_REASON.EscrowRefund]: '赌注退还',
  [WALLET_REASON.MatchReward]: '对局获胜',
  [WALLET_REASON.MatchLoss]: '对局落败',
  [WALLET_REASON.ItemUse]: '使用道具',
  [WALLET_REASON.ItemRefund]: '道具退还',
  [WALLET_REASON.DiceBet]: '赌桌下注',
  [WALLET_REASON.DiceWin]: '赌桌派彩',
  [WALLET_REASON.GuardRake]: '保安抽水',
  [WALLET_REASON.ArenaFee]: '八角笼报名',
  [WALLET_REASON.ArenaWin]: '八角笼奖金',
  [WALLET_REASON.ArenaBet]: '观战押注',
  [WALLET_REASON.ArenaBetWin]: '押注派彩',
  [WALLET_REASON.ArenaBetRefund]: '押注退还',
  [WALLET_REASON.VillaBuy]: '买下小院',
  [WALLET_REASON.VillaIncome]: '摇钱树收币',
  [WALLET_REASON.Cosmetic]: '购买装扮',
  [WALLET_REASON.HouseUpgrade]: '户型升级',
  [WALLET_REASON.Furniture]: '购买家具',
  [WALLET_REASON.WorkPay]: '搬砖工资',
  [WALLET_REASON.RedPacket]: '抢到红包',
  [WALLET_REASON.BossHit]: '踢老板掉落',
  [WALLET_REASON.InspectionBonus]: '查岗全勤',
};

/** 固定收益：一处定义，服务端发币与商店文案共用 */
export const ECONOMY_REWARD = {
  RingGold: 300,
  RingSilver: 150,
  RingBronze: 80,
  Knockdown: 12,
  BossKill: 150,
  Quest: 30,
} as const;

export interface StatSku {
  key: StatKey;
  name: string;
  blurb: string;
  basePrice: number;
  stepPrice: number;
}

export const STAT_SKUS: readonly StatSku[] = [
  {
    key: 'atkSpeedLv',
    name: '攻速',
    blurb: '每级发泄冷却 −70ms，10 级锁在 500ms。',
    basePrice: 120,
    stepPrice: 80,
  },
  {
    key: 'workEffLv',
    name: '工效',
    blurb: '每级让工位搬砖多产 8%，夜班再 ×1.5。',
    basePrice: 100,
    stepPrice: 60,
  },
  {
    key: 'critLv',
    name: '暴击',
    blurb: '每级 +5% 踢老板暴击（掉落翻倍），封顶 35%。',
    basePrice: 140,
    stepPrice: 90,
  },
  {
    key: 'armorLv',
    name: '护甲',
    blurb: '后续受击减伤的预备属性。',
    basePrice: 110,
    stepPrice: 70,
  },
];

export function statUpgradePrice(key: StatKey, level: number): number {
  const sku = STAT_SKUS.find((entry) => entry.key === key);
  if (!sku) return 0;
  return sku.basePrice + sku.stepPrice * clampStatLevel(level);
}

/** 消耗品效果：服务端只认这几种；未知 id 一律拒绝 */
export const ITEM_EFFECT = {
  Haste: 'haste',
  Shield: 'shield',
  Sparkle: 'sparkle',
  Slip: 'slip',
  Poster: 'poster',
  Guard: 'guard',
  Shout: 'shout',
} as const;
export type ItemEffect = (typeof ITEM_EFFECT)[keyof typeof ITEM_EFFECT];

/** 释放目标：0 只能对自己用，1 必须点另一个真人 */
export const ITEM_TARGET = {
  Self: 0,
  Other: 1,
} as const;
export type ItemTarget = (typeof ITEM_TARGET)[keyof typeof ITEM_TARGET];

export interface ItemSku {
  /** 线协议 id：u8，只追加不复用 */
  id: number;
  /** localStorage 与商店 UI 使用的稳定键 */
  key: string;
  name: string;
  blurb: string;
  price: number;
  effect: ItemEffect;
  /** 效果持续毫秒，0 表示纯表现 */
  effectMs: number;
  target: ItemTarget;
}

/**
 * 道具目录（ADR-0085）。
 *
 * id 1（能量饮料）与 id 3（续命奶茶）下线：分别被冰美式、摸鱼护盾取代。
 * 线协议 id 只追加不复用，两个号永久留空——旧客户端读到未知 id 会按
 * 「背包里没有这件」处理，不会被解析成另一种效果。
 */
export const ITEM_SKUS: readonly ItemSku[] = [
  {
    id: 2,
    key: 'confetti',
    name: '彩带礼花',
    blurb: '在目标头顶炸一把彩带，全场可见。',
    price: 40,
    effect: ITEM_EFFECT.Sparkle,
    effectMs: 0,
    target: ITEM_TARGET.Other,
  },
  {
    id: 4,
    key: 'ice_americano',
    name: '冰美式',
    blurb: '60 秒内移速 +15%，发泄冷却再缩短 30%。',
    price: 30,
    effect: ITEM_EFFECT.Haste,
    effectMs: 60_000,
    target: ITEM_TARGET.Self,
  },
  {
    id: 5,
    key: 'slack_shield',
    name: '摸鱼护盾',
    blurb: '获得 1 层护盾，自动挡下一次被撞飞或整蛊。',
    price: 80,
    effect: ITEM_EFFECT.Shield,
    effectMs: SHIELD_HOLD_MS,
    target: ITEM_TARGET.Self,
  },
  {
    id: 6,
    key: 'loudspeaker',
    name: '全服大喇叭',
    blurb: '向全服发一条金色置顶弹幕，限 30 字。',
    price: 100,
    effect: ITEM_EFFECT.Shout,
    effectMs: 0,
    target: ITEM_TARGET.Self,
  },
  {
    id: 7,
    key: 'banana_peel',
    name: '香蕉皮',
    blurb: '让目标当场滑倒躺地 2 秒。',
    price: 40,
    effect: ITEM_EFFECT.Slip,
    effectMs: 2_000,
    target: ITEM_TARGET.Other,
  },
  {
    id: 8,
    key: 'pay_cut_sticker',
    name: '摸鱼降薪贴',
    blurb: '目标头顶挂 20 秒「带薪摸鱼」贴纸，移速 −20%。',
    price: 60,
    effect: ITEM_EFFECT.Poster,
    effectMs: 20_000,
    target: ITEM_TARGET.Other,
  },
  {
    id: 9,
    key: 'hire_guard',
    name: '雇佣保安卡',
    blurb: '派最近的保安以 1.3 倍速赶来，贴身尾随 15 秒。',
    price: 150,
    effect: ITEM_EFFECT.Guard,
    effectMs: 15_000,
    target: ITEM_TARGET.Other,
  },
];

export function findItemSku(key: string): ItemSku | undefined {
  return ITEM_SKUS.find((entry) => entry.key === key);
}

export function findItemSkuById(id: number): ItemSku | undefined {
  return ITEM_SKUS.find((entry) => entry.id === id);
}

/** 装扮售卖槽位：与 `catalog.ts` 的四张目录一一对应 */
export type CosmeticSlot = 'head' | 'eyes' | 'neck' | 'hair';

/**
 * 赛博茶水强化站的装扮货架。
 *
 * `key` 直接落到 `EconomyProfile.unlockedCosmetics`（字符串），
 * 与捏人界面的配件目录同名；服务端只认这张表里的 key，
 * 客户端自造的字符串会被 `buyCosmetic` 拒掉。
 */
export interface CosmeticSku {
  /** 线协议 id：u8，只追加不复用 */
  id: number;
  slot: CosmeticSlot;
  key: string;
  name: string;
  price: number;
}

export const COSMETIC_SKUS: readonly CosmeticSku[] = [
  { id: 1, slot: 'head', key: 'top', name: '总裁礼帽', price: 320 },
  { id: 2, slot: 'head', key: 'god_of_wealth', name: '财神冠', price: 480 },
  { id: 3, slot: 'head', key: 'bamboo_hat', name: '斗笠', price: 260 },
  { id: 4, slot: 'head', key: 'curse_hoop', name: '紧箍咒', price: 400 },
  { id: 5, slot: 'eyes', key: 'sun', name: '墨镜', price: 300 },
  { id: 6, slot: 'eyes', key: 'monocle', name: '单片眼镜', price: 360 },
  { id: 7, slot: 'neck', key: 'phones', name: '挂脖耳机', price: 280 },
  { id: 8, slot: 'neck', key: 'chinese_knot', name: '中国结', price: 220 },
  { id: 9, slot: 'neck', key: 'jade_pendant', name: '玉佩', price: 340 },
  { id: 10, slot: 'hair', key: 'afro', name: '爆炸头', price: 240 },
  { id: 11, slot: 'hair', key: 'slick', name: '大背头', price: 200 },
  { id: 12, slot: 'hair', key: 'topknot', name: '高马尾髻', price: 260 },
  // ---- ADR-0088：打工经济上线后的一批「暴富」件，全部追加在末尾 ----
  { id: 13, slot: 'head', key: 'golden_helmet', name: '黄金安全帽', price: 520 },
  { id: 14, slot: 'head', key: 'crown', name: '皇冠', price: 680 },
  { id: 15, slot: 'eyes', key: 'cyber_shades', name: '赛博墨镜', price: 380 },
  { id: 16, slot: 'eyes', key: 'gold_rim_glasses', name: '金丝眼镜', price: 320 },
  { id: 17, slot: 'neck', key: 'gold_chain', name: '大金链', price: 560 },
  { id: 18, slot: 'neck', key: 'red_scarf', name: '红围巾', price: 240 },
];

export function findCosmeticSkuById(id: number): CosmeticSku | undefined {
  return COSMETIC_SKUS.find((entry) => entry.id === id);
}

export function findCosmeticSkuByKey(key: string): CosmeticSku | undefined {
  return COSMETIC_SKUS.find((entry) => entry.key === key);
}

export function clampStatLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_STAT_LEVEL, Math.floor(value)));
}

export function clampCoins(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COINS, Math.floor(value)));
}

export function clampItemCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_ITEM_COUNT, Math.floor(value)));
}

/** 发泄冷却的唯一尺子：服务端校验与客户端预估必须读同一个函数 */
export const VENT_COOLDOWN_BASE_MS = 1200;
export const VENT_COOLDOWN_MIN_MS = 500;
export const VENT_COOLDOWN_PER_LEVEL_MS = 70;

export function ventCooldownMs(atkSpeedLv: number): number {
  return Math.max(
    VENT_COOLDOWN_MIN_MS,
    VENT_COOLDOWN_BASE_MS - VENT_COOLDOWN_PER_LEVEL_MS * clampStatLevel(atkSpeedLv),
  );
}

/**
 * 带 Buff 乘子的实际冷却。
 *
 * `cdMul` 来自 `ventCooldownMultiplier`（冰美式乘 0.7），钳在 0.5~1；
 * 下限仍是 500ms，不允许任何道具把尺子打穿。
 */
export function effectiveVentCooldownMs(atkSpeedLv: number, cdMul = 1): number {
  const base = ventCooldownMs(atkSpeedLv);
  const mul = Number.isFinite(cdMul) ? Math.max(0.5, Math.min(1, cdMul)) : 1;
  return Math.max(VENT_COOLDOWN_MIN_MS, Math.round(base * mul));
}

export function emptyStats(): EconomyStats {
  return { atkSpeedLv: 0, workEffLv: 0, critLv: 0, armorLv: 0 };
}

export function emptyEconomyProfile(): EconomyProfile {
  return {
    coins: 0,
    stats: emptyStats(),
    unlockedCosmetics: [],
    inventory: {},
    houseTier: 0,
    dailyQuests: { day: '', progress: {}, claimed: [] },
  };
}

function sanitizeInventory(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  let kinds = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kinds >= ECONOMY_MAX_ITEM_KINDS) break;
    if (!findItemSku(key)) continue;
    const count = clampItemCount(typeof value === 'number' ? value : Number(value));
    if (count <= 0) continue;
    out[key] = count;
    kinds += 1;
  }
  return out;
}

function sanitizeCosmetics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_ECONOMY_COSMETICS) break;
    if (typeof entry !== 'string') continue;
    const key = entry.trim().slice(0, 32);
    if (key.length === 0 || out.includes(key)) continue;
    out.push(key);
  }
  return out;
}

function sanitizeDailyQuests(raw: unknown): DailyQuestState {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const day = typeof source.day === 'string' ? source.day.slice(0, 10) : '';
  const progress: Record<string, number> = {};
  if (source.progress && typeof source.progress === 'object') {
    for (const [key, value] of Object.entries(source.progress as Record<string, unknown>)) {
      const count = Math.max(0, Math.min(9999, Math.floor(Number(value) || 0)));
      if (count > 0) progress[key.slice(0, 24)] = count;
    }
  }
  const claimed: string[] = [];
  if (Array.isArray(source.claimed)) {
    for (const entry of source.claimed) {
      if (claimed.length >= 12) break;
      if (typeof entry === 'string' && entry.length > 0 && !claimed.includes(entry)) {
        claimed.push(entry.slice(0, 24));
      }
    }
  }
  return { day, progress, claimed };
}

/** 本地档案 → 可信档案：所有入口（读盘、HELLO、商店）都先过这一层 */
export function sanitizeEconomyProfile(raw: unknown): EconomyProfile {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const statsRaw = (source.stats && typeof source.stats === 'object' ? source.stats : {}) as Record<
    string,
    unknown
  >;
  return {
    coins: clampCoins(Number(source.coins) || 0),
    stats: {
      atkSpeedLv: clampStatLevel(Number(statsRaw.atkSpeedLv) || 0),
      workEffLv: clampStatLevel(Number(statsRaw.workEffLv) || 0),
      critLv: clampStatLevel(Number(statsRaw.critLv) || 0),
      armorLv: clampStatLevel(Number(statsRaw.armorLv) || 0),
    },
    unlockedCosmetics: sanitizeCosmetics(source.unlockedCosmetics),
    inventory: sanitizeInventory(source.inventory),
    houseTier: Number.isFinite(Number(source.houseTier))
      ? Math.max(0, Math.min(MAX_HOUSE_TIER, Math.floor(Number(source.houseTier))))
      : 0,
    dailyQuests: sanitizeDailyQuests(source.dailyQuests),
  };
}
