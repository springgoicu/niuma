/**
 * 领域契约：客户端、服务端、捏人端共同消费的唯一真相。
 * 该文件不依赖任何运行时，可被 Bun / Node / 浏览器直接引用。
 */

export type Species = 'cow' | 'horse';

export interface CharacterAppearance {
  species: Species;
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
    /** 电脑包 / 公文包 */
    backItem?: string;
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

export interface MovePacket extends EntitySnapshot {}

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
      backItem: 'laptop',
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
      backItem: 'briefcase',
    },
  },
};
