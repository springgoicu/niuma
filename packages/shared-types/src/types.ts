/**
 * 领域契约：客户端、服务端、捏人端共同消费的唯一真相。
 * 该文件不依赖任何运行时，可被 Bun / Node / 浏览器直接引用。
 */

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
} as const;

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
}

export interface WelcomePacket {
  entityId: number;
  tick: number;
  x: number;
  y: number;
}

export interface ChatPacket {
  entityId: number;
  msgId: number;
  text: string;
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
