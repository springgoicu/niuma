/** 服务端权威 Tick 频率（Hz） */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/** 定点精度：1 单位 = 1/8 像素，u16 覆盖 0..8191.875px */
export const FIXED_SCALE = 8;

export const WORLD_WIDTH = 8192;
export const WORLD_HEIGHT = 8192;
export const TILE_SIZE = 32;

/**
 * AOI 视野半径（像素）。
 * 世界倍率降到 1.5 后，2560 宽的屏上一屏就横跨 1707 世界像素，半对角线约 979，
 * 900 会让屏幕四角的角色不出现在视野里（走到边上才突然出现）；提到 1000 盖住它。
 */
export const VIEW_RADIUS = 1000;
/** 空间哈希单元边长（像素），与视野半径同阶以减少跨格抖动 */
export const CELL_SIZE = 512;

/**
 * 玩家移动速度（像素/秒）。
 * 世界按 1.25 放大后同比提到 165：同一段路走的秒数不变，手感不会变「拖」。
 */
export const MOVE_SPEED = 165;
/** 单 Tick 允许的最大位移（像素），含 15% 抖动容差 */
export const MAX_STEP = (MOVE_SPEED * TICK_MS) / 1000;
export const MAX_STEP_TOLERANCE = MAX_STEP * 1.15;

export const MAX_CHAT_CHARS = 160;
/** 昵称为空或被审核拦下时的兜底工牌名：协议钳制与客户端回退必须用同一个字面量 */
export const FALLBACK_NICKNAME = '无名牛马';
/** 昵称字符数上限（按码点计）：输入框与协议共用 */
export const MAX_NAME_CHARS = 16;
/** 昵称字节上限：与 C2S_HELLO / S2C_SPAWN 的 u8 长度字段对齐 */
export const MAX_NAME_BYTES = 48;
/**
 * 昵称在头顶的显示宽度上限：半角 1、全角 2，16 单位 = 8 个汉字。
 * 名字比这个宽就会横跨两个身位，压住邻座的头顶——超出的部分换省略号。
 */
export const MAX_NAME_DISPLAY_UNITS = 16;
export const MAX_PACKET_BYTES = 2048;
export const MAX_ENTITIES = 1024;
export const MAX_SYNC_ENTRIES = 255;

/** 移动包固定长度：op(1) + id(2) + x(2) + y(2) + state(1) = 8 字节基础版本
 *  新版本添加：sequence(2) + timestamp(4) = 14 字节总长
 *  兼容性：server 需处理两种长度
 */
export const MOVE_PACKET_BYTES = 8;
export const MOVE_PACKET_WITH_TIMING_BYTES = 14;
/** 同步包内每条实体增量 */
export const SYNC_ENTRY_BYTES = 7;
/** 同步包头部：op(1) + tick(4) + count(2) */
export const SYNC_HEADER_BYTES = 7;
/**
 * 外观压缩后固定长度（ADR-0011）：
 * [0] species | [1..22] 11×u16 RGB565 | [23..26] parts | [27..30] 配件索引 | [31] reserved
 */
export const APPEARANCE_BYTES = 32;

/**
 * 排队快照：op(1) + ticket(4) + position(2) + length(2) + etaSec(2) + capacity(2)
 *          + dominant(1) + utilizationPermille(2)
 */
export const QUEUE_STATUS_BYTES = 16;
/** 排队拒绝：op(1) + reason(1) */
export const QUEUE_REJECT_BYTES = 2;
/** 聊天拒绝：op(1) + reason(1)，与排队拒绝同构 */
export const CHAT_REJECT_BYTES = 2;
/** 排队位次推送间隔（毫秒）；排队者零广播，只有这一条心跳包 */
export const QUEUE_STATUS_INTERVAL_MS = 1000;

export const DIRECTION = {
  Down: 0,
  Left: 1,
  Right: 2,
  Up: 3,
} as const;

/**
 * 基础姿态只有四种。叫唤与跳跃不是姿态，而是 state 字节里的两个一次性标志位
 * （bit6 / bit7）：它们与姿态正交，播完自然回到原姿势，不需要服务端记忆与回滚（ADR-0018）。
 */
export const POSE = {
  Idle: 0,
  Walk: 1,
  Sit: 2,
  Lie: 3,
} as const;

export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];
export type Pose = (typeof POSE)[keyof typeof POSE];

/**
 * 动作：坐 / 躺 / 起身。叫唤与跳随 move 包上行（ADR-0018）。
 * Sit 在附近有空闲座位时入座，否则落地坐；Stand 释放座位并回到站立。
 */
export const ACTION = {
  Sit: 0,
  Lie: 1,
  Stand: 2,
} as const;

export type ActionId = (typeof ACTION)[keyof typeof ACTION];
