/**
 * 道具与 Buff 的共享契约（ADR-0085）。
 *
 * 三件事只在这里定义，服务端判定与客户端表现读同一份：
 * 1. `PLAYER_EFFECT`：`S2C_PLAYER_EFFECT` 的 effect 字段，u8 只追加不复用；
 * 2. `BUFF_DEFS`：进 `activeBuffs` 的状态，含时长、移速与冷却乘子、是否受整蛊保护；
 * 3. `speedMultiplier` / `ventCooldownMultiplier`：乘子纯函数，`sim/movement` 与
 *    `sim/vent` 直接调用，绝不各写一份判定。
 *
 * 里程碑式的取舍：`Sparkle`（彩带礼花）只是演出，不进 `activeBuffs`——
 * 它没有到期后要撤销的语义，写进表里只会让「有 buff」的判定多一个例外。
 */

/** 玩家特效码：`S2C_PLAYER_EFFECT` 的 effect 字段 */
export const PLAYER_EFFECT = {
  Haste: 1,
  Shield: 2,
  Poster: 3,
  Slip: 4,
  Guard: 5,
  Sparkle: 6,
  Stealth: 7,
  Box: 8,
  Pan: 9,
  CoffeeHeal: 10,
  Spray: 11,
} as const;
export type PlayerEffectId = (typeof PLAYER_EFFECT)[keyof typeof PLAYER_EFFECT];

/** 进入 `Player.activeBuffs` 的状态：没有 Sparkle/Spray */
export const BUFF = {
  Haste: PLAYER_EFFECT.Haste,
  Shield: PLAYER_EFFECT.Shield,
  Poster: PLAYER_EFFECT.Poster,
  Slip: PLAYER_EFFECT.Slip,
  Guard: PLAYER_EFFECT.Guard,
  Stealth: PLAYER_EFFECT.Stealth,
  Box: PLAYER_EFFECT.Box,
  Pan: PLAYER_EFFECT.Pan,
  CoffeeHeal: PLAYER_EFFECT.CoffeeHeal,
} as const;
export type BuffType = (typeof BUFF)[keyof typeof BUFF];

export interface BuffDef {
  readonly type: BuffType;
  readonly effect: PlayerEffectId;
  /** 缺省时长；道具可以按 SKU 的 `effectMs` 覆盖 */
  readonly durationMs: number;
  /** 移速乘子：1 表示不变 */
  readonly speedMul: number;
  /** 发泄冷却乘子：0.7 表示冷却打七折 */
  readonly ventCdMul: number;
  /** 是否属于「整蛊控制类」：命中后给目标 60 秒保护冷却 */
  readonly trick: boolean;
  /** 头顶贴纸 / 状态文案，客户端与气泡共用 */
  readonly label: string;
}

export const BUFF_DEFS: Readonly<Record<BuffType, BuffDef>> = {
  [BUFF.Haste]: {
    type: BUFF.Haste,
    effect: PLAYER_EFFECT.Haste,
    durationMs: 60_000,
    speedMul: 1.15,
    ventCdMul: 0.7,
    trick: false,
    label: '冰美式',
  },
  [BUFF.Shield]: {
    type: BUFF.Shield,
    effect: PLAYER_EFFECT.Shield,
    durationMs: 300_000,
    speedMul: 1,
    ventCdMul: 1,
    trick: false,
    label: '摸鱼护盾',
  },
  [BUFF.Poster]: {
    type: BUFF.Poster,
    effect: PLAYER_EFFECT.Poster,
    durationMs: 20_000,
    speedMul: 0.8,
    ventCdMul: 1,
    trick: true,
    label: '带薪摸鱼',
  },
  [BUFF.Slip]: {
    type: BUFF.Slip,
    effect: PLAYER_EFFECT.Slip,
    durationMs: 2_000,
    // 滑倒期间位移由服务端拒绝（`stunUntil` 已覆盖），乘子只是兜底
    speedMul: 0,
    ventCdMul: 1,
    trick: true,
    label: '滑倒了！',
  },
  [BUFF.Guard]: {
    type: BUFF.Guard,
    effect: PLAYER_EFFECT.Guard,
    durationMs: 15_000,
    speedMul: 1,
    ventCdMul: 1,
    trick: false,
    label: '被盯梢',
  },
  [BUFF.Stealth]: {
    type: BUFF.Stealth,
    effect: PLAYER_EFFECT.Stealth,
    durationMs: 12_000,
    speedMul: 1.05,
    ventCdMul: 1,
    trick: false,
    label: '隐身摸鱼',
  },
  [BUFF.Box]: {
    type: BUFF.Box,
    effect: PLAYER_EFFECT.Box,
    durationMs: 25_000,
    speedMul: 0.65,
    ventCdMul: 1,
    trick: false,
    label: '纸箱伪装',
  },
  [BUFF.Pan]: {
    type: BUFF.Pan,
    effect: PLAYER_EFFECT.Pan,
    durationMs: 30_000,
    speedMul: 1,
    ventCdMul: 1,
    trick: false,
    label: '持锅戒备',
  },
  [BUFF.CoffeeHeal]: {
    type: BUFF.CoffeeHeal,
    effect: PLAYER_EFFECT.CoffeeHeal,
    durationMs: 20_000,
    speedMul: 1.12,
    ventCdMul: 0.85,
    trick: false,
    label: '孟婆续命',
  },
};

/** 整蛊保护冷却：同一目标 60 秒内不再吃同类控制，防恶意无限控死 */
export const TRICK_GUARD_MS = 60_000;
/** 护盾未消耗时的最长挂载时间 */
export const SHIELD_HOLD_MS = 300_000;
/** 保安盯梢时的加速倍率 */
export const GUARD_FOLLOW_SPEED_MUL = 1.3;
/** 保安贴到多少像素算「贴身」 */
export const GUARD_FOLLOW_STOP_PX = 18;

/** 移速乘子的上下钳制：道具叠加也不该出现瞬移或原地不动 */
const SPEED_MUL_MIN = 0.4;
const SPEED_MUL_MAX = 1.6;

function clampMul(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(min, Math.min(max, value));
}

/**
 * 当前生效的移速乘子。
 *
 * 只遍历一次 `activeBuffs`（条目上限 5），过期条目按 1 计；
 * 调用方是 20Hz 的 `applyMove`，所以这里不分配临时数组、不拼字符串。
 */
export function speedMultiplier(
  buffs: ReadonlyMap<number, number> | null | undefined,
  now: number,
): number {
  if (!buffs || buffs.size === 0) return 1;
  let mul = 1;
  for (const [type, expiresAt] of buffs) {
    if (expiresAt <= now) continue;
    const def = BUFF_DEFS[type as BuffType];
    if (!def) continue;
    mul *= def.speedMul;
  }
  return clampMul(mul, SPEED_MUL_MIN, SPEED_MUL_MAX);
}

/** 当前生效的发泄冷却乘子；与移速乘子同一套遍历规则 */
export function ventCooldownMultiplier(
  buffs: ReadonlyMap<number, number> | null | undefined,
  now: number,
): number {
  if (!buffs || buffs.size === 0) return 1;
  let mul = 1;
  for (const [type, expiresAt] of buffs) {
    if (expiresAt <= now) continue;
    const def = BUFF_DEFS[type as BuffType];
    if (!def) continue;
    mul *= def.ventCdMul;
  }
  // 0.5~1：再快的道具组合也不该把冷却压成 0
  return clampMul(mul, 0.5, 1);
}

/** `S2C_PLAYER_EFFECT`：`[op][effect u8][sourceId u16][targetId u16][extraId u16][durationMs u16][flags u8]` */
export interface PlayerEffectPacket {
  effect: number;
  sourceId: number;
  targetId: number;
  /** 保安 id 之类的附加载体；没有时写 0 */
  extraId: number;
  durationMs: number;
  /** 接收者就是目标 */
  isTarget: boolean;
  /** 被护盾抵消 / 未生效：只播被挡表现，不挂状态 */
  blocked: boolean;
}

export const PLAYER_EFFECT_FLAG_SELF = 1;
export const PLAYER_EFFECT_FLAG_BLOCKED = 2;

/** 大喇叭文案上限：按码点计，与输入框共用 */
export const MAX_SHOUT_CHARS = 30;
/** 大喇叭 utf8 字节上限（u8 长度字段）：30 个汉字正好 90 字节 */
export const MAX_SHOUT_BYTES = 90;

/** 清掉控制字符并截到 30 字：协议编码与客户端回显共用同一把尺子 */
export function truncateShout(text: string): string {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const chars = Array.from(clean);
  return chars.length > MAX_SHOUT_CHARS ? chars.slice(0, MAX_SHOUT_CHARS).join('') : clean;
}

/** 服务端 → 全服：大喇叭弹幕 */
export interface LoudspeakerPacket {
  fromId: number;
  text: string;
}

/** 服务端 → 本人：大喇叭被拒的原因（不扣道具） */
export const SHOUT_REJECT = {
  Empty: 0,
  TooLong: 1,
  Blocked: 2,
  NoItem: 3,
  Cooldown: 4,
} as const;
export type ShoutRejectReason = (typeof SHOUT_REJECT)[keyof typeof SHOUT_REJECT];

export interface ShoutRejectPacket {
  reason: number;
}

export const SHOUT_REJECT_LABEL: Readonly<Record<number, string>> = {
  [SHOUT_REJECT.Empty]: '先写一句要喊的话',
  [SHOUT_REJECT.TooLong]: '最多 30 个字',
  [SHOUT_REJECT.Blocked]: '这句话被审核拦下了，道具没有扣',
  [SHOUT_REJECT.NoItem]: '背包里没有大喇叭',
  [SHOUT_REJECT.Cooldown]: '刚喊过，歇 3 秒再来',
};

/** 大喇叭两次发送的最小间隔：与互动包限频同阶，挡住连点刷屏 */
export const SHOUT_COOLDOWN_MS = 3_000;

/**
 * 道具没生效的原因。
 *
 * 只发给操作者本人：`S2C_ITEM_REJECT` 是「你的这一下为什么没成」，
 * 旁观者不需要知道，被整蛊的人也不该收到第二条提示。
 */
export const ITEM_REJECT = {
  NoItem: 0,
  /** 目标不可用 / 距离过远 / 想对自己用整蛊 */
  InvalidTarget: 1,
  /** 目标处于整蛊保护冷却 */
  Guarded: 2,
  /** 被摸鱼护盾挡下 */
  Shielded: 3,
  /** 园区里没有可派遣的保安（已退币） */
  NoGuard: 4,
  /** 自用道具必须用在自己身上 */
  SelfOnly: 5,
} as const;
export type ItemRejectReason = (typeof ITEM_REJECT)[keyof typeof ITEM_REJECT];

export const ITEM_REJECT_LABEL: Readonly<Record<number, string>> = {
  [ITEM_REJECT.NoItem]: '背包里没有这件道具',
  [ITEM_REJECT.InvalidTarget]: '这个目标用不了',
  [ITEM_REJECT.Guarded]: '对方还在整蛊保护期',
  [ITEM_REJECT.Shielded]: '被摸鱼护盾挡下了',
  [ITEM_REJECT.NoGuard]: '保安都在忙，牛马币已退回',
  [ITEM_REJECT.SelfOnly]: '这件只能对自己用',
};

/** 服务端 → 本人：道具未生效 */
export interface ItemRejectPacket {
  reason: number;
  itemId: number;
}
