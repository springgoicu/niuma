/**
 * 领域契约：客户端、服务端、捏人端共同消费的唯一真相。
 * 该文件不依赖任何运行时，可被 Bun / Node / 浏览器直接引用。
 */

import type { CareerSummary } from './career';
import type { Direction, Pose, SyncFormat } from './constants';
import type { DanmakuMode } from './danmaku';

export type Species = 'cow' | 'horse';

/**
 * 颜色槽的线协议顺序，编码时按此序逐槽写 u16。
 * 追加只允许放在末尾：偏移由数组下标推导，插队会让旧字节解成别的部位。
 */
export const APPEARANCE_COLOR_KEYS = [
  'body',
  'pattern',
  'hoof',
  'eyes',
  'extra',
  'snout',
  'tail',
  'headwear',
  'eyewear',
  'neckwear',
  'hairstyle',
] as const;

export type AppearanceColorKey = (typeof APPEARANCE_COLOR_KEYS)[number];

export interface CharacterAppearance {
  species: Species;
  /** 11 个独立色槽：前 5 个是整体，后 6 个跟随各自的属性 */
  colors: {
    /** 主体色，32-bit HEX */
    body: number;
    /** 斑纹色 */
    pattern: number;
    /** 蹄铁色 */
    hoof: number;
    /** 眼睛色 */
    eyes: number;
    /** 牛角 / 马鬃色 */
    extra: number;
    /** 口鼻色 */
    snout: number;
    /** 尾巴色 */
    tail: number;
    /** 头饰色 */
    headwear: number;
    /** 眼镜色 */
    eyewear: number;
    /** 颈饰色 */
    neckwear: number;
    /** 发型色 */
    hairstyle: number;
  };
  parts: {
    /** 奶牛斑纹 / 马蹄踏雪 */
    patternId: number;
    /** 宽牛吻 / 狭长马吻 */
    snoutId: number;
    /** 牛独有配件 (0: 无, 1: 尖角, 2: 弯角, 3: 断角) */
    hornId?: number;
    /** 马独有配件 (0: 短鬃, 1: 披肩长发, 2: 朋克莫西干) */
    maneId?: number;
    tailId: number;
  };
  cosmetics: {
    /** 头饰：学士帽 / 鸭舌帽 / 贝雷帽 / 安全帽 / 礼帽 */
    headwear?: string;
    /** 眼镜：圆框 / 墨镜 / 单眼镜 */
    eyewear?: string;
    /** 颈饰：围巾 / 项圈 / 挂脖耳机 */
    neckwear?: string;
    /** 发型：寸头 / 齐刘海 / 马尾 / 爆炸头 / 大背头 */
    hairstyle?: string;
  };
}

/**
 * 线协议操作码。使用 frozen 对象而非 const enum：
 * 1) isolatedModules 下 const enum 无法跨包内联；
 * 2) 需要运行时反查做日志与断言。
 */
export const OpCode = {
  C2S_MOVE: 0x01,
  S2C_SYNC_ENTITIES: 0x02,
  C2S_ACTION: 0x03,
  S2C_CHAT_BROADCAST: 0x04,
  S2C_ENTITY_SPAWN: 0x05,
  S2C_ENTITY_DESPAWN: 0x06,
  C2S_HELLO: 0x10,
  S2C_WELCOME: 0x11,
  C2S_SET_APPEARANCE: 0x12,
  S2C_APPEARANCE: 0x13,
  C2S_PING: 0x14,
  S2C_PONG: 0x15,
  C2S_CHAT: 0x16,
  S2C_QUEUE_STATUS: 0x17,
  S2C_QUEUE_REJECTED: 0x18,
  S2C_SEAT_STATE: 0x19,
  S2C_CHAT_REJECTED: 0x1a,
  /** 设置常驻状态：`[op][len u16][utf8]`，空字符串表示清除 */
  C2S_SET_STATUS: 0x1b,
  /** 状态变更广播：`[op][entityId u16][len u16][utf8]` */
  S2C_STATUS: 0x1c,
  /** 系统提示（进园 / 离园等）：`[op][kind u8][entityId u16][len u16][utf8]` */
  S2C_SYSTEM_NOTICE: 0x1d,
  /** 拉取更早的聊天：`[op][beforeMsgId u16][limit u8]`，`beforeMsgId = 0` 表示要最新一页 */
  C2S_CHAT_HISTORY: 0x1e,
  /** 历史聊天页：`[op][flags u8][count u8]` + count × entry */
  S2C_CHAT_HISTORY: 0x1f,
  /*
   * 0x20 已随「吃草」动作下线（原 S2C_GRAZE），空号保留不复用：
   * 旧客户端仍按旧表解析该字节，复用会让它们把新包当成咀嚼事件。
   */
  /**
   * 发泄结算：`[op][attackerId u16][targetId u16][x u16][y u16]`。
   *
   * 姿态与位移本身走 Tick，这条包只补 Tick 表达不了的两件事：
   * 1) 归因——谁打了谁。二十多人同屏时，光看某个人倒下去无法判断是谁动的手；
   * 2) 受害者本人的硬直——本地玩家姿态由客户端预测，Tick 里的 state 对它不生效。
   * 因此必须显式下发一次，并带上服务端结算后的权威坐标。
   * 空放（没打到人）也发一条，`targetId = 0`，让附近所有人播放破空音与台词。
   */
  S2C_VENT: 0x21,
  /** 考勤摘要补报：`[op][len u8][payload]`，服务端只做内存转发 */
  C2S_CAREER: 0x22,
  /** 考勤摘要广播：`[op][entityId u16][len u8][payload]` */
  S2C_CAREER: 0x23,
  /**
   * 牛马榜查询：`[op][metric u8]`。0 表示一次拉全部五个指标，
   * 服务端按指标各回一条 `S2C_BOARD`（ADR-0054）。
   */
  C2S_BOARD: 0x24,
  /** 牛马榜快照：`[op][metric u8][online u16][slacking u16][count u8][selfRank u16][selfValue u32]` + 条目 */
  S2C_BOARD: 0x25,
  /** 工牌点赞：`[op][targetId u16]`，服务端内存计数（ADR-0057） */
  C2S_LIKE: 0x26,
  /** 点赞广播：`[op][targetId u16][likes u16][flags u8]`，flags bit0 = 接收者就是点赞者 */
  S2C_LIKE: 0x27,
  /** 改工牌名：`[op][len u16][utf8]`，与状态包同构；空名与政治敏感由服务端保留原名 */
  C2S_SET_NAME: 0x28,
  /** 改名广播：`[op][entityId u16][len u16][utf8]` */
  S2C_NAME: 0x29,
  // 0x2a / 0x2b 曾是滑梯请求与滑行事件，ADR-0067 起永久留空，不复用编号
  /**
   * 发泄区老板血量：`[op][hp u16][attackerId u16][flags u8]`，6 字节定长。
   *
   * 纯下行快照：入场补发一次，之后每次命中广播一次。`flags bit0` 表示本次
   * 归零（客户端只弹一次横幅），`bit1` 表示跨日重置（客户端恢复彩色）。
   * 空挥不发包；同 Tick 多人命中按服务端裁决顺序各发一条。
   */
  S2C_BOSS: 0x2c,
  /*
   * 0x2d / 0x2e / 0x2f 曾是绩效八角笼报名、取消与快照（C2S_RING_* / S2C_RING），
   * 现随擂台玩法下线永久留空不复用，避免旧客户端把新包误判成擂台事件。
   */
  /**
   * 小黑屋处置：`[op][entityId u16][phase u8][flags u8][seconds u16][guardId u16]`，
   * 9 字节定长。押送坐标本身走 Tick，这条包只表达「谁被警告 / 被带走 / 被松手」。
   * 旧客户端走 default 静默忽略（ADR-0072）。
   */
  S2C_JAIL: 0x30,
  /**
   * 救护车同步：`[op][id u8][state u8][x u16][y u16][flags u8]`，8 字节定长。
   * 停靠静止时不重复下发（ADR-0043 去脏）。
   */
  S2C_AMBULANCE: 0x31,
  /** 伤员状态：`[op][entityId u16][state u8][seconds u16]`，6 字节定长。 */
  S2C_PATIENT: 0x32,
  // ---- 牛马币经济与 P2P 互动（ADR-0082 / ADR-0083），从 0x33 继续追加 ----
  /** 发起挑战：`[op][targetId u16][gameType u8][wager u32][extra u16]`，10 字节定长。 */
  C2S_P2P_INVITE: 0x33,
  /** 回应邀请：`[op][inviteId u32][accept u8]`，6 字节定长。 */
  C2S_P2P_RESPOND: 0x34,
  /** 打赏：`[op][targetId u16][amount u32]`，7 字节定长。 */
  C2S_TIP: 0x35,
  /** 使用消耗品：`[op][targetId u16][itemId u8]`，4 字节定长。 */
  C2S_USE_ITEM: 0x36,
  /** 商店购买：`[op][kind u8][id u8][count u8]`，4 字节定长。 */
  C2S_SHOP_BUY: 0x37,
  /** 钱包快照：余额 + 四维 + 房屋等级 + 原因 + 完整背包，见 `encodeWalletSync`。 */
  S2C_WALLET_SYNC: 0x38,
  /** 邀请浮窗：含发起者名字与 TTL，见 `encodeP2PInviteNotify`。 */
  S2C_P2P_INVITE_NOTIFY: 0x39,
  /** 邀请结果：接受 / 拒绝 / 过期 / 校验失败，7 字节定长。 */
  S2C_P2P_INVITE_RESULT: 0x3a,
  /** 对局开始 / 结束快照，见 `encodeP2PMatch`。 */
  S2C_P2P_MATCH: 0x3b,
  /** 打赏广播：`[op][fromId u16][toId u16][amount u32][flags u8]`，12 字节定长。 */
  S2C_TIP: 0x3c,
  /**
   * 旧道具效果广播：`[op][sourceId u16][targetId u16][itemId u8][flags u8]`。
   *
   * ADR-0085 起由 `S2C_PLAYER_EFFECT`(0x44) 取代，服务端不再发送；
   * 编号永久留空不复用，旧客户端仍能解析历史回放。
   */
  S2C_ITEM_EFFECT: 0x3d,
  /** P2P 行动：`[op][matchId u32][action u8]`，猜拳盲选出拳。 */
  C2S_P2P_ACTION: 0x3e,
  /** P2P 亮牌：双方与附近 AOI 都能看到的头顶像素演出。 */
  S2C_P2P_SHOWDOWN: 0x3f,
  /** 切磋实时状态：双方血量 + 剩余时间，扣血 / 1Hz 心跳时广播。 */
  S2C_P2P_DUEL_STATE: 0x40,
  // ---- 道具与 Buff 引擎（ADR-0085），从 0x41 继续追加 ----
  /** 大喇叭文案：`[op][len u8][utf8]`，≤ 30 字（90 字节）。 */
  C2S_SHOUT: 0x41,
  /** 大喇叭被拒：`[op][reason u8]`，2 字节定长；不扣道具。 */
  S2C_SHOUT_REJECT: 0x42,
  /** 全服弹幕：`[op][fromId u16][len u8][utf8]`，不含审核信息。 */
  S2C_LOUDSPEAKER: 0x43,
  /**
   * 玩家特效广播：`[op][effect u8][sourceId u16][targetId u16][extraId u16]
   * [durationMs u16][flags u8]`，11 字节定长，见 `PlayerEffectPacket`。
   *
   * 取代 0x3d（S2C_ITEM_EFFECT，已停止发送、编号永久留空）：旧包只能表达
   * 「谁对谁用了哪件道具」，表达不了「持续多久、是否被护盾挡下、保安是谁」。
   */
  S2C_PLAYER_EFFECT: 0x44,
  /** 道具未生效：`[op][reason u8][itemId u8]`，只回给操作者，见 `ITEM_REJECT`。 */
  S2C_ITEM_REJECT: 0x45,
  // ---- 热点建筑与房产冠名（ADR-0087）----
  /*
   * 0x46 / 0x47 / 0x4a / 0x4b 曾用于骰桌与八角笼押注（C2S_DICE_BET / S2C_DICE_STATE /
   * C2S_ARENA_BET / S2C_ARENA_POOL），下线后永久留空不复用。
   */
  /** 房产操作：`[op][villa u8][action u8]`，3 字节定长 */
  C2S_VILLA: 0x48,
  /** 房产状态：`[op][count u8]` + 每栋一条，见 `encodeVillaState` */
  S2C_VILLA_STATE: 0x49,
  /** 公寓操作：`[op][action u8][arg u8]`，3 字节定长 */
  C2S_APARTMENT: 0x4c,
  // 0x4d–0x50 永久留空不复用：邀请串门、家具布局、房间状态、串门通知随
  // ADR-0098「公寓改为窗口探头」下线，编号不能回收给新包（旧客户端会解错）。
  // ---- 打工产出 / Boss 2.0 / 全局随机事件 / 每日悬赏（ADR-0088），从 0x51 继续追加 ----
  /**
   * 搬砖结算：`[op][combo u8]`，2 字节定长。
   *
   * `combo` 只做展示与日志，不参与发钱：金额一律由服务端按工效 / 夜班 / 随机数算。
   */
  C2S_WORK_CLAIM: 0x51,
  /** 搬砖结果：`[op][amount u16][mult u8][flags u8]`，5 字节定长 */
  S2C_WORK_RESULT: 0x52,
  /** 领取每日悬赏：`[op][questId u8]`，2 字节定长 */
  C2S_QUEST_CLAIM: 0x53,
  /** 悬赏状态：`[op][len u8][day][count u8]` + count × `[id u8][progress u16][claimed u8]` */
  S2C_QUEST_STATE: 0x54,
  /** 世界事件横幅：`[op][kind u8][phase u8][remainingSec u16][seed u16][amount u16]` */
  S2C_WORLD_EVENT: 0x55,
  /** 抢红包：`[op][index u8]`，2 字节定长 */
  C2S_EVENT_CLAIM: 0x56,
  /** 画饼冲击波：`[op][phase u8][x u16][y u16][radius u16][remainingMs u16][hits u8]` */
  S2C_BOSS_SHOCK: 0x57,
  /**
   * 抢红包结果：`[op][index u8][amount u16][flags u8]`，5 字节定长。
   * 广播给视野内的人（让旁观者看到红包被抢走），`flags bit0` 表示领取者就是收包人本人。
   */
  S2C_EVENT_CLAIM: 0x58,
  /**
   * 公寓窗口探头全量快照（ADR-0098）：`[op][count u8]` + count ×
   * `[playerId u16][slot u8][window u8]`。
   *
   * 全量而不是增量：最多 6 栋 × 20 窗 = 120 条，只在进楼 / 出楼 / 断线 / 入场时各发一次，
   * 稳态零流量。收到就整份替换，不需要合并或对账。
   */
  S2C_APARTMENT_PEEK: 0x59,
  // ---- 互动拒绝回执（ADR-0104），从 0x5a 继续追加 ----
  /**
   * 互动被服务端拒绝：`[op][action u8][reason u8]`，3 字节定长。
   *
   * 只回给操作者本人，不带玩家可见文案：客户端按 `INTERACT_ACTION` /
   * `INTERACT_REASON` 映射中文，服务端只负责裁决与编号。
   */
  S2C_INTERACT_REJECT: 0x5a,
  /*
   * 0x5b / 0x5c / 0x5d 曾是骰桌结算单与战绩榜（ADR-0110），随骰桌下线永久留空不复用。
   */
  /**
   * 全园区交互播报（ADR-0112）：`[op][kind u8][actorId u16][x u16][y u16][len u8][utf8]`。
   *
   * 只发给「看不见主角」的在线玩家：身边人已经看到完整动画，不需要第二条
   * 文字播报。坐标用于小地图事件标记，量化口径与实体同步一致。
   */
  S2C_ACTIVITY: 0x5e,
  /**
   * 客户端上报本机私有互动：`[op][kind u8][sub u8]`，3 字节定长。
   *
   * 上香、设施气泡、场所台词这类演出只活在本地，服务端无从派生；坐标一律
   * 取服务端权威位置，`sub` 只作展示细分，不影响判定。
   */
  C2S_ACTIVITY: 0x5f,
} as const;

/**
 * 互动拒绝包里的动作编号（ADR-0104）。
 *
 * 编号只追加不复用：旧客户端不认识新编号时按「未知」静默处理即可。
 */
export const INTERACT_ACTION = {
  // 0 / 1 / 2 / 3 / 11 曾用于擂台与骰桌，编号永久保留不复用
  VillaBuy: 4,
  VillaLock: 5,
  VillaCollect: 6,
  WorkClaim: 7,
  QuestClaim: 8,
  EventClaim: 9,
  Apartment: 10,
  /** 未知 / 未识别的互动动作，客户端给通用兜底文案 */
  Unknown: 255,
} as const;
export type InteractAction = (typeof INTERACT_ACTION)[keyof typeof INTERACT_ACTION];

/**
 * 互动拒绝原因。文案由客户端映射，服务端永远只发编号。
 *
 * `Unknown` 兜住未来值：旧客户端收到不认识的原因时给一句通用提示，不静默。
 */
export const INTERACT_REASON = {
  Unknown: 0,
  NotSeated: 1,
  TooFar: 2,
  Phase: 3,
  Full: 4,
  Already: 5,
  NotEnoughCoins: 6,
  BadAmount: 7,
  Busy: 8,
  Cooldown: 9,
  NoTarget: 10,
  NoStock: 11,
  OwnerOnly: 12,
  Sold: 13,
  NoIncome: 14,
} as const;
export type InteractReason = (typeof INTERACT_REASON)[keyof typeof INTERACT_REASON];

/** 互动拒绝回执：客户端据此显示「差什么」，不再点了没反应 */
export interface InteractRejectPacket {
  action: number;
  reason: number;
}

/** 老板血量包：flags bit0 = 本次归零，bit1 = 跨日重置 */
export const BOSS_FLAG_DIED = 1;
export const BOSS_FLAG_RESET = 1 << 1;

/**
 * 小黑屋阶段（ADR-0072）：
 * 1 警告（只发本人）、2 保安出动、3 押送中、4 预留（不发送）、5 松手放人。
 *
 * 没有禁足时长：押到反省点即发 5，移动 / 动作立刻恢复。
 */
export const JAIL_PHASE = {
  Warn: 1,
  Dispatch: 2,
  Escort: 3,
  Jailed: 4,
  Released: 5,
} as const;
export type JailPhase = (typeof JAIL_PHASE)[keyof typeof JAIL_PHASE];

/** 小黑屋包 flags：bit0 表示接收者就是被处置者本人 */
export const JAIL_FLAG_SELF = 1;

/**
 * 小黑屋处置包（`S2C_JAIL`）。
 *
 * `seconds` 保留字段：当前所有阶段都填 0（没有禁足倒计时）。`guardId = 0`
 * 表示这次事件没有保安参与（例如只警告）。
 */
export interface JailPacket {
  entityId: number;
  phase: number;
  self: boolean;
  seconds: number;
  guardId: number;
}

/** 救护车四态：停泊 / 出警 / 拖拽 / 空车返航 */
export const AMBULANCE_STATE = {
  Idle: 0,
  Dispatched: 1,
  Transporting: 2,
  Returning: 3,
} as const;
export type AmbulanceState = (typeof AMBULANCE_STATE)[keyof typeof AMBULANCE_STATE];

/** 救护车 flags：bit0 警灯鸣闪，bit1 车厢内有伤员 */
export const AMBULANCE_FLAG_SIREN = 1;
export const AMBULANCE_FLAG_CARRYING = 1 << 1;

export interface AmbulancePacket {
  id: number;
  state: AmbulanceState;
  /** 量化坐标（1/8 像素） */
  x: number;
  y: number;
  flags: number;
}

/** 伤员状态：昏迷 / 病床治疗 / 工伤保护 */
export const PATIENT_STATE = {
  None: 0,
  Incapacitated: 1,
  Treating: 2,
  Shielded: 3,
} as const;
export type PatientState = (typeof PATIENT_STATE)[keyof typeof PATIENT_STATE];

export interface PatientStatusPacket {
  entityId: number;
  state: PatientState;
  /** 剩余秒数：治疗倒计时 / 免疫护盾剩余时间；昏迷为 0 */
  seconds: number;
}

export type OpCodeValue = (typeof OpCode)[keyof typeof OpCode];

export interface EntitySnapshot {
  id: number;
  /** 量化坐标（1/8 像素） */
  x: number;
  y: number;
  /** 位打包后的朝向 + 姿态 + 移动标志 */
  state: number;
}

export interface MovePacket extends EntitySnapshot {
  /** 客户端单调递增序号，用于防重复 */
  clientSequence?: number;
  /** 客户端时间戳（毫秒），用于延迟估计 */
  clientTimestampMs?: number;
}

export interface SpawnPacket {
  id: number;
  x: number;
  y: number;
  state: number;
  name: string;
  appearance: CharacterAppearance;
  /** 常驻状态：空串（或旧包缺省）表示没设置 */
  status?: string;
  /**
   * 服务端口径的已在线秒数：发送入场包那一刻的会话时长。
   * 旧服务端不带这一段时为 undefined，客户端退化为「首次看到起算」。
   */
  onlineSec?: number;
  /**
   * 本人自报的考勤摘要（服务端内存转发）。
   * 旧服务端不带这一段时为 undefined，工牌显示「未上报」而不是 0。
   */
  career?: CareerSummary;
  /**
   * 服务端内存里的工牌点赞数（ADR-0057）。
   * 旧服务端不带这一段时为 undefined，按 0 展示；只有大于 0 才写进包，省 3 字节。
   */
  likes?: number;
  /**
   * 实体角色（0 普通 / 1 保安）。只有保安才写这一段；
   * 旧服务端不带时为 undefined，客户端按普通实体渲染，不画警灯。
   */
  role?: number;
}

/** 考勤摘要广播：`entityId` 是被围观者，payload 与 HELLO / SPAWN 的尾部段一致。 */
export interface CareerBroadcastPacket {
  entityId: number;
  career: CareerSummary;
}

export interface WelcomePacket {
  entityId: number;
  tick: number;
  x: number;
  y: number;
  /** 服务端裁决后的权威 state：客户端据此初始化朝向与姿态，不再自行假设 */
  state: number;
  /**
   * 服务端实际采用的同步条目格式。条目格式必须由服务端说清而不是按包长猜：
   * 截断的 7 字节条目恰好等于一条 6 字节条目，猜错只会把垃圾字节读成坐标。
   * 旧服务端不带这一段时为 undefined，客户端按 7 字节处理。
   */
  syncFormat?: SyncFormat;
  /**
   * 服务端采信并结算后的本次会话已在线秒数（ADR-0060）。
   *
   * 客户端拿它当 `welcomeAt` 的基准，断线重连后接着算而不是从 0 开始；
   * 旧服务端不带这一段时缺席，按 0 处理，行为退化成「重连归零」。
   */
  sessionSec?: number;
}

/**
 * 上一次会话的落点，随 `C2S_HELLO` 上报。
 *
 * 一律当作不可信输入：坐标必须落在可行走的陆地上，座位必须仍然空闲，
 * 裁决权完全在服务端（`resolveSpawn`）。姿态不允许 `Walk`——移动状态不跨会话。
 */
export interface ResumeState {
  /** 世界像素坐标 */
  x: number;
  y: number;
  direction: Direction;
  pose: Pose;
  /** 上次所坐的座位 id；0 表示当时没坐 */
  seatId: number;
}

/**
 * 园区频道发言（`S2C_CHAT_BROADCAST`）。
 *
 * `colorIndex` / `danmakuMode` 是发送时选定的弹幕外观，服务端钳制后原样广播：
 * 所有接收端看到的颜色与模式必须一致，不能各自按本地偏好重算。
 */
export interface ChatPacket {
  entityId: number;
  msgId: number;
  /** 调色板预设索引，已归一化到 0~7 */
  colorIndex: number;
  danmakuMode: DanmakuMode;
  text: string;
}

/** 客户端发言（`C2S_CHAT`）：服务端复核前先由客户端带上弹幕外观 */
export interface ChatSendPacket {
  /** 调色板预设索引；越界由服务端回落到默认白 */
  colorIndex: number;
  danmakuMode: DanmakuMode;
  text: string;
}

/**
 * 发泄结算事件（`S2C_VENT`）。
 *
 * `x` / `y` 是服务端结算后的受击者权威位置（1/8px 定点，与移动包同口径）。
 * 受害者客户端必须直接采用它：击退只有 32px，低于本地和解的 128px 漂移阈值，
 * 光等 Tick 回正会留下一次「先被拉开、再被拽回」的抖动。
 * 空放时 `targetId = 0`，`x` / `y` 无意义。
 */
export interface VentEventPacket {
  attackerId: number;
  targetId: number;
  x: number;
  y: number;
}

/**
 * 老板血量快照（`S2C_BOSS`）。
 *
 * `hp` 是全园区共享的当日剩余血量；`attackerId` 只用于让出招者本人播「-1」
 * 飘字，0 表示入场补发或跨日重置。`died` / `reset` 由 flags 解出，避免
 * 调用方自己记位。
 */
export interface BossPacket {
  hp: number;
  attackerId: number;
  died: boolean;
  reset: boolean;
}

/* ------------------------------------------------------------------ *
 * 园区房产地标（ADR-0087）
 * ------------------------------------------------------------------ */

/** 房产操作 */
export interface VillaRequest {
  villa: number;
  action: number;
}

export const VILLA_ACTION = {
  Buy: 0,
  ToggleLock: 1,
  Collect: 2,
} as const;

/** 一栋房产的公开状态 */
export interface VillaPacket {
  id: number;
  /** 房主当前在线的实体 id；离线为 0，只用于广播定位，不表示「无主」 */
  ownerId: number;
  ownerName: string;
  locked: boolean;
  /** 是否已有房主（离线也算）：被他人冠名后可按 1.5× 溢价收购 */
  owned: boolean;
  /** 收包人是不是本房产的房主（按设备号判定，离线/重连都稳定） */
  mine: boolean;
  /** 摇钱树当前可收币数（只有房主看得出准确值，其他人读到 0） */
  pending: number;
}

export interface VillaStatePacket {
  villas: VillaPacket[];
}

/** 公寓操作：0 进屋探头 / 1 出门；2 曾用于户型升级，随 ADR-0098 下线且不复用 */
export const APARTMENT_ACTION = {
  Enter: 0,
  Exit: 1,
} as const;

export interface ApartmentRequest {
  action: number;
  arg: number;
}

/** 一个正在窗口探头的人：楼栋 + 窗口编号 */
export interface ApartmentPeekEntry {
  id: number;
  /** 楼栋下标 0..5 */
  slot: number;
  /** 窗口编号 0..19 */
  window: number;
}

/** 窗口探头全量快照：收到就整份替换 */
export interface ApartmentPeekPacket {
  entries: ReadonlyArray<ApartmentPeekEntry>;
}

/**
 * 系统提示包：文案已由发送方套好模板，客户端只负责按 `kind` 选样式。
 * `entityId = 0` 表示没有具体对象（例如本地的在岗提醒）。
 */
export interface SystemNoticePacket {
  kind: number;
  entityId: number;
  text: string;
}

/**
 * 全园区交互播报包（ADR-0112）：文案已由服务端套好模板。
 *
 * `kind` 见 `ACTIVITY_KIND`；`x / y` 是已经反量化回来的世界坐标，
 * 客户端用小地图标记定位，不再从实体表反查（远处主角根本没有实体）。
 */
export interface ActivityPacket {
  kind: number;
  /** 事件主角的实体 id；已离场的播报仍然带原 id，仅作展示 */
  actorId: number;
  x: number;
  y: number;
  text: string;
}

/** 客户端上报本机私有互动：`sub` 只作展示细分，服务端不采信坐标 */
export interface ActivityReportPacket {
  kind: number;
  sub: number;
}

/**
 * 一条历史聊天。
 *
 * `name` 是发送时的昵称快照：发送者可能早就离场，客户端名字表里查不到，
 * 只有 `entityId` 的话会退化成「匿名牛马」。
 * 时间用「距今秒数」而不是服务端时间戳——客户端按自己的时钟还原，
 * 两端时钟不一致也不会出现「历史比现在还新」的倒流。
 */
export interface ChatHistoryEntry {
  msgId: number;
  entityId: number;
  /** 距今秒数：客户端用 `Date.now() - ageSec * 1000` 还原 */
  ageSec: number;
  name: string;
  text: string;
}

/** 历史页；`flags` 见 `CHAT_HISTORY_FLAG`（首屏快照 / 还有更早的） */
export interface ChatHistoryPacket {
  flags: number;
  entries: ChatHistoryEntry[];
}

/** 上翻请求：`beforeMsgId = 0` 表示「要最新一页」 */
export interface ChatHistoryRequest {
  beforeMsgId: number;
  limit: number;
}

/**
 * 当前主导压力的维度。0 表示三项都健康，其余用于客户端解释「为什么在排队」：
 * 带宽看的是实测出口字节，人数看的是准入容量，Tick 看的是 p95 是否逼近预算。
 */
export const LIMIT_KIND = {
  None: 0,
  Bandwidth: 1,
  Players: 2,
  Tick: 3,
} as const;

export type LimitKind = (typeof LIMIT_KIND)[keyof typeof LIMIT_KIND];

export const QUEUE_REJECT_REASON = {
  /** 队列已达动态上限，直接拒绝，避免请求无限堆积 */
  QueueFull: 1,
  /** 排队超过最长等待时间，主动劝退 */
  WaitTimeout: 2,
} as const;

export type QueueRejectReason = (typeof QUEUE_REJECT_REASON)[keyof typeof QUEUE_REJECT_REASON];

/** 聊天被拦下的原因：客户端只负责换一句人话，不暴露具体词条（ADR-0028） */
export const CHAT_REJECT_REASON = {
  /** 命中政治类词条：整条消息不广播 */
  Political: 1,
  /** 触发限速窗口：5s 内第 4 条起 */
  RateLimited: 2,
} as const;

export type ChatRejectReason = (typeof CHAT_REJECT_REASON)[keyof typeof CHAT_REJECT_REASON];

/** 排队位次快照：排队者每秒收到一条，零广播、零同步 */
export interface QueueStatusPacket {
  /** 服务端分配的排队号，仅用于日志串联与重连排查 */
  ticket: number;
  /** 从 1 开始的前方人数 */
  position: number;
  /** 队列总长度（含自己） */
  length: number;
  /** 预计等待秒数 */
  etaSec: number;
  /** 当前准入容量（AIMD 自适应后的人数上限） */
  capacity: number;
  dominant: LimitKind;
  /** 综合水位千分比，0..1000 */
  utilizationPermille: number;
}

export interface QueueRejectedPacket {
  reason: QueueRejectReason;
}

/** 服务端广播给客户端的行动结果，用于动作栏与气泡 */
export interface ActionResult {
  entityId: number;
  action: number;
}

export const DEFAULT_APPEARANCE: Record<Species, CharacterAppearance> = {
  cow: {
    species: 'cow',
    colors: {
      body: 0xf3efe4,
      pattern: 0x2a2622,
      hoof: 0x3a3532,
      eyes: 0x1d1a17,
      extra: 0xe6d6b4,
      // 口鼻与尾巴默认跟随主体色，跟改造前「口鼻借 body 染色」的观感一致
      snout: 0xf3efe4,
      tail: 0xf3efe4,
      headwear: 0x2c4a7c,
      eyewear: 0x66756a,
      neckwear: 0xc94f3a,
      hairstyle: 0x2a2622,
    },
    parts: {
      patternId: 1,
      snoutId: 0,
      hornId: 1,
      tailId: 0,
    },
    cosmetics: {
      headwear: 'cap',
      eyewear: 'round',
      neckwear: 'scarf',
      hairstyle: 'buzz',
    },
  },
  horse: {
    species: 'horse',
    colors: {
      body: 0xa96c3c,
      pattern: 0xf0ebdf,
      hoof: 0x4a3b2e,
      eyes: 0x1d1a17,
      extra: 0x3b2a1d,
      snout: 0xa96c3c,
      tail: 0xa96c3c,
      headwear: 0x2c4a7c,
      eyewear: 0x66756a,
      neckwear: 0x2c4a7c,
      hairstyle: 0x3b2a1d,
    },
    parts: {
      patternId: 1,
      snoutId: 1,
      maneId: 1,
      tailId: 1,
    },
    cosmetics: {
      headwear: 'none',
      eyewear: 'monocle',
      neckwear: 'collar',
      hairstyle: 'none',
    },
  },
};
