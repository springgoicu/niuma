/** 服务端权威 Tick 频率（Hz） */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/** 定点精度：1 单位 = 1/8 像素，u16 覆盖 0..8191.875px */
export const FIXED_SCALE = 8;

export const WORLD_WIDTH = 8192;
export const WORLD_HEIGHT = 8192;
export const TILE_SIZE = 32;

/** AOI 视野半径（像素） */
export const VIEW_RADIUS = 900;
/** 空间哈希单元边长（像素），与视野半径同阶以减少跨格抖动 */
export const CELL_SIZE = 512;

/** 玩家移动速度（像素/秒） */
export const MOVE_SPEED = 132;
/** 单 Tick 允许的最大位移（像素），含 15% 抖动容差 */
export const MAX_STEP = (MOVE_SPEED * TICK_MS) / 1000;
export const MAX_STEP_TOLERANCE = MAX_STEP * 1.15;

export const MAX_CHAT_CHARS = 160;
export const MAX_NAME_CHARS = 16;
export const MAX_NAME_BYTES = 48;
export const MAX_PACKET_BYTES = 2048;
export const MAX_ENTITIES = 1024;
export const MAX_SYNC_ENTRIES = 255;

/** 移动包固定 8 字节：op + id + x + y + state */
export const MOVE_PACKET_BYTES = 8;
/** 同步包内每条实体增量 */
export const SYNC_ENTRY_BYTES = 7;
/** 同步包头部：op(1) + tick(4) + count(2) */
export const SYNC_HEADER_BYTES = 7;
/** 外观压缩后固定长度 */
export const APPEARANCE_BYTES = 20;

export const DIRECTION = {
  Down: 0,
  Left: 1,
  Right: 2,
  Up: 3,
} as const;

export const POSE = {
  Idle: 0,
  Walk: 1,
  Sit: 2,
  Lie: 3,
  Emote: 4,
} as const;

export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];
export type Pose = (typeof POSE)[keyof typeof POSE];

export const ACTION = {
  Sit: 0,
  Lie: 1,
  Emote: 2,
} as const;

export type ActionId = (typeof ACTION)[keyof typeof ACTION];
