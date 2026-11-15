/**
 * P2P 互动总线（ChallengeBus）的协议契约（ADR-0083）。
 *
 * 总线的职责只有一条：把「邀请 → 接受 → 冻结赌注 → 玩法裁决 → 结算/退款」
 * 这条链路跑通；具体玩法由注册在 gameType 上的处理器负责。
 */

/** 邀请有效期：浮窗倒计时与服务端 TTL 共用同一个常量 */
export const P2P_INVITE_TTL_MS = 15_000;
/** 发起距离：沿用 AOI 视野口径（900px）的保守内圈，避免跨屏骚扰 */
export const P2P_INVITE_RANGE_PX = 400;
/** 单局赌注上限：超出直接拒绝，避免一次失误清空余额 */
export const P2P_MAX_WAGER = 5_000;
/** 邀请表与对局表的上限：拒绝新请求，绝不让状态无限增长 */
export const P2P_MAX_PENDING_INVITES = 32;
export const P2P_MAX_ACTIVE_MATCHES = 32;
/** 街头摇骰子：服务端掷骰后等前端把 1.5s 滚动动画播完再结算 */
export const P2P_DICE_SETTLE_MS = 1_800;
/** 亮牌演出时长：翻滚 1.5s + 定格 2.5s，4s 后整体淡出 */
export const P2P_SHOWDOWN_MS = 4_000;
/** 骰子先翻滚再定格的时长 */
export const P2P_DICE_ROLL_MS = 1_500;
/** 猜拳每轮盲选窗口 */
export const P2P_RPS_ROUND_MS = 5_000;
/** 猜拳最多加赛到第 3 轮，仍平局退款 */
export const P2P_RPS_MAX_ROUNDS = 3;
/** 野外切磋：30 秒、100 HP、出圈半径 220px、跳跃无敌 0.4s */
export const P2P_DUEL_DURATION_MS = 30_000;
export const P2P_DUEL_HP = 100;
export const P2P_DUEL_ESCAPE_PX = 220;
export const P2P_DUEL_IFRAME_MS = 400;
/** 切磋头槌：基础伤害、暴击每级加成、护甲每级减伤、击退距离 */
export const P2P_DUEL_BASE_DAMAGE = 12;
export const P2P_DUEL_CRIT_PER_LEVEL = 0.06;
export const P2P_DUEL_ARMOR_PER_LEVEL = 0.05;
export const P2P_DUEL_KNOCKBACK_PX = 140;
/** 赢家拿奖池的 95%，5% 为园区税 */
export const P2P_TAX_BPS = 500;

export const P2P_GAME_TYPE = {
  /** 街头摇骰子 */
  Dice: 1,
  /** 灵魂猜拳 */
  Rps: 2,
  /** 野外单挑切磋 */
  Duel: 3,
} as const;
export type P2PGameType = (typeof P2P_GAME_TYPE)[keyof typeof P2P_GAME_TYPE];

export const P2P_GAME_NAME: Record<number, string> = {
  [P2P_GAME_TYPE.Dice]: '街头摇骰子',
  [P2P_GAME_TYPE.Rps]: '灵魂猜拳',
  [P2P_GAME_TYPE.Duel]: '野外切磋',
};

/** 骰子押注预设；自定义输入由总线按 P2P_MAX_WAGER 与余额复核 */
export const P2P_BET_PRESETS = [0, 10, 50, 200] as const;

/** 猜拳出拳：只追加不复用 */
export const P2P_ACTION = {
  Rock: 1,
  Scissors: 2,
  Paper: 3,
} as const;
export type P2PAction = (typeof P2P_ACTION)[keyof typeof P2P_ACTION];

export const P2P_ACTION_LABEL: Record<number, string> = {
  [P2P_ACTION.Rock]: '石头',
  [P2P_ACTION.Scissors]: '剪刀',
  [P2P_ACTION.Paper]: '布',
};

export const P2P_INVITE_REASON = {
  None: 0,
  Declined: 1,
  Expired: 2,
  Offline: 3,
  Busy: 4,
  TargetBusy: 5,
  OutOfRange: 6,
  NotEnoughCoins: 7,
  InvalidWager: 8,
  Self: 9,
  Limit: 10,
  UnknownGame: 11,
} as const;
export type P2PInviteReason = (typeof P2P_INVITE_REASON)[keyof typeof P2P_INVITE_REASON];

export const P2P_INVITE_REASON_LABEL: Record<number, string> = {
  [P2P_INVITE_REASON.Declined]: '对方拒绝了挑战',
  [P2P_INVITE_REASON.Expired]: '邀请已超时',
  [P2P_INVITE_REASON.Offline]: '对方已经离开园区',
  [P2P_INVITE_REASON.Busy]: '你正在另一场互动中',
  [P2P_INVITE_REASON.TargetBusy]: '对方正在另一场互动中',
  [P2P_INVITE_REASON.OutOfRange]: '距离太远，走近一点再发起',
  [P2P_INVITE_REASON.NotEnoughCoins]: '牛马币不够付这笔赌注',
  [P2P_INVITE_REASON.InvalidWager]: '赌注不在允许范围内',
  [P2P_INVITE_REASON.Self]: '不能挑战自己',
  [P2P_INVITE_REASON.Limit]: '互动请求太多了，稍后再试',
  [P2P_INVITE_REASON.UnknownGame]: '这个玩法还没开放',
};

/** 对局阶段：1 开始、2 结束（结算包只发一次） */
export const P2P_MATCH_PHASE = {
  Started: 1,
  Finished: 2,
} as const;
export type P2PMatchPhase = (typeof P2P_MATCH_PHASE)[keyof typeof P2P_MATCH_PHASE];

export const P2P_MATCH_END = {
  Normal: 0,
  OpponentLeft: 1,
  Timeout: 2,
  Cancelled: 3,
  /** 主动跑出约定中心点 220px 外 */
  Fled: 4,
} as const;
export type P2PMatchEnd = (typeof P2P_MATCH_END)[keyof typeof P2P_MATCH_END];

/** 客户端 → 服务端：`[0x33][targetId u16][gameType u8][wager u32][extra u16]` */
export interface P2PInviteRequest {
  targetId: number;
  gameType: number;
  wager: number;
  extra: number;
}

/** 服务端 → 被邀请方：附带邀请人名字与剩余时间，主线程无需再查档案 */
export interface P2PInviteNotifyPacket {
  inviteId: number;
  fromId: number;
  fromName: string;
  gameType: number;
  wager: number;
  extra: number;
  ttlMs: number;
}

/** 客户端 → 服务端：`[0x34][inviteId u32][accept u8]` */
export interface P2PRespondRequest {
  inviteId: number;
  accept: boolean;
}

/** 服务端 → 发起方：邀请被接受 / 拒绝 / 过期，统一一条结果包 */
export interface P2PInviteResultPacket {
  inviteId: number;
  accepted: boolean;
  reason: number;
}

/** 服务端 → 双方：对局开始 / 结束快照 */
export interface P2PMatchPacket {
  matchId: number;
  gameType: number;
  phase: number;
  remainingMs: number;
  selfId: number;
  opponentId: number;
  opponentName: string;
  wager: number;
  /** 0 表示尚未产生胜者（开始时与平局） */
  winnerId: number;
  /** 结束原因，开始时为 0 */
  endReason: number;
}

/** 客户端 → 服务端：`[0x3e][matchId u32][action u8]`，猜拳盲选出拳 */
export interface P2PActionRequest {
  matchId: number;
  action: number;
}

/** 亮牌状态位：平局 / 本局最终结果（猜拳多回合时用来区分是否继续） */
export const P2P_SHOWDOWN_FLAG_TIE = 1;
export const P2P_SHOWDOWN_FLAG_FINAL = 1 << 1;

/**
 * 服务端 → 参与者 + 附近 AOI：头顶亮牌演出。
 *
 * 固定 24 字节：`[0x3f][matchId u32][gameType u8][round u8][aId u16][bId u16]
 * [winnerId u16][flags u8][d1..d6 u8][aAction u8][bAction u8][durationMs u16]`
 * - 骰子用 d1..d6（A 三颗在前、B 三颗在后）
 * - 猜拳用 aAction / bAction
 * - 切磋用 d1 / d2 携带双方结算时 HP
 */
export interface P2PShowdownPacket {
  matchId: number;
  gameType: number;
  round: number;
  aId: number;
  bId: number;
  winnerId: number;
  flags: number;
  dice: number[];
  aAction: number;
  bAction: number;
  durationMs: number;
}

/** 切磋状态位：bit0 = 本局已经分出胜负 */
export const P2P_DUEL_FLAG_FINISHED = 1;

/** 服务端 → 参与者 + 附近 AOI：切磋实时血量与剩余时间 */
export interface P2PDuelStatePacket {
  matchId: number;
  aId: number;
  bId: number;
  hpA: number;
  hpB: number;
  remainingMs: number;
  flags: number;
}

/** 打赏：`[0x35][targetId u16][amount u32]` */
export interface TipRequest {
  targetId: number;
  amount: number;
}

/** 道具：`[0x36][targetId u16][itemId u8]` */
export interface UseItemRequest {
  targetId: number;
  itemId: number;
}

/** 商店：`[0x37][kind u8][id u8][count u8]` */
export const SHOP_KIND = {
  Stat: 0,
  Item: 1,
  /** 赛博茶水强化站的装扮货架（ADR-0087） */
  Cosmetic: 2,
  /** 曾用于牛马公寓的家具：随 ADR-0098 下线，编号永久留空不复用 */
  Furniture: 3,
} as const;
export type ShopKind = (typeof SHOP_KIND)[keyof typeof SHOP_KIND];

export interface ShopBuyRequest {
  kind: number;
  id: number;
  count: number;
}

/** 服务端 → 双方：打赏结果，flags bit0 = 接收者就是被赏的一方 */
export interface TipPacket {
  fromId: number;
  toId: number;
  amount: number;
  /** 接收者是否是收钱的那方 */
  received: boolean;
}

/** 服务端 → 相关玩家：道具效果，flags bit0 = 接收者就是目标 */
export interface ItemEffectPacket {
  sourceId: number;
  targetId: number;
  itemId: number;
  /** 接收者是否是目标 */
  isTarget: boolean;
}

export const P2P_FLAG_SELF_TARGET = 1;
