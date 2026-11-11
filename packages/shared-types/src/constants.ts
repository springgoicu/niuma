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
/**
 * 状态标签的长度预算：与昵称共用一把显示宽尺子，但是**独立的一份额度**。
 * 16 显示宽 = 8 个汉字或 8 个 emoji；状态独占头顶一行，不与昵称宽度叠加。
 */
export const MAX_STATUS_CHARS = 16;
/** 状态字节上限：与 HELLO / SPAWN 尾部扩展段的 u8 长度字段对齐 */
export const MAX_STATUS_BYTES = 48;
export const MAX_STATUS_DISPLAY_UNITS = 16;
/**
 * 状态扩展段的魔数。HELLO 与 SPAWN 都在尾部追加 `[0xff][statusLen u8][status]`，
 * 旧解码器读到 0xff 会按「未知版本」整段忽略（RESUME_VERSION 恒为 1，永不撞车）。
 */
export const STATUS_EXTENSION_MAGIC = 0xff;
/**
 * SPAWN 尾部的「已在线秒数」扩展段：`[0xfe][onlineSec u32 小端]`。
 *
 * 0xfe 大于 MAX_STATUS_BYTES（48），不可能是合法状态长度，所以可以紧跟在可选状态段
 * 之后按首字节窥视。没有这一段的旧服务端包与上一版逐字节相同；旧解码器读完状态后
 * 不校验尾部，且状态长度超出剩余字节时会回退空串，天然忽略这 5 字节。
 */
export const ONLINE_EXTENSION_MAGIC = 0xfe;
export const ONLINE_EXTENSION_BYTES = 5;
export const MAX_PACKET_BYTES = 2048;
/**
 * 与 `MAX_ENTITY_ID` 对齐：紧凑同步条目只给 id 留 10 bit。
 * 收到 1023 个实体后 `World.create` 就会拒绝，正好在回绕之前停下，不会出现重复 id。
 */
export const MAX_ENTITIES = 1023;
export const MAX_SYNC_ENTRIES = 255;

/** 移动包固定长度：op(1) + id(2) + x(2) + y(2) + state(1) = 8 字节基础版本
 *  新版本添加：sequence(2) + timestamp(4) = 14 字节总长
 *  兼容性：server 需处理两种长度
 */
export const MOVE_PACKET_BYTES = 8;
export const MOVE_PACKET_WITH_TIMING_BYTES = 14;
/** 同步包内每条实体增量 */
export const SYNC_ENTRY_BYTES = 7;
/**
 * 紧凑条目：id 10 bit + x/y 各 15 bit + state 8 bit = 48 bit = 6 字节。
 *
 * 48 bit 扣掉 state 的 8 位只剩 40 位，1/8px 下 x/y 各要 16 位（8192px × 8 = 65536），
 * 留给 id 的只剩 8 位——装不下 1023 个实体。用偏移基址也不行：岛屿南北跨度
 * 33696 个单位已经超过 15 bit 的 32767。所以条目内部改用 1/4px：
 * 15 位正好覆盖 8192px，位置误差 ≤0.25px，肉眼不可见。
 */
export const SYNC_ENTRY_BYTES_COMPACT = 6;
/** 紧凑条目内部的坐标精度（1/4 px）；解码后左移还原成 1/8px 单位，消费方无需改动 */
export const SYNC_COORD_SCALE = 4;
/** 紧凑条目 id 的位宽上限：10 bit */
export const MAX_ENTITY_ID = 0x3ff;
/** 同步包头部：op(1) + tick(4) + count(2) */
export const SYNC_HEADER_BYTES = 7;
/**
 * HELLO 尾部的能力段魔数：`[0xfd][format]`。
 *
 * 0xfd 大于 MAX_STATUS_BYTES(48)，不可能是合法的状态长度，也不与 0xff 状态段冲突；
 * 不声明这一段的老客户端继续收 7 字节条目，服务端按每人各自的格式编码。
 */
export const SYNC_CAPABILITY_MAGIC = 0xfd;
/** 同步条目格式：7 字节（旧） */
export const SYNC_FORMAT_LEGACY = 0;
/** 同步条目格式：6 字节紧凑 */
export const SYNC_FORMAT_COMPACT = 1;
/** 解码端按包长自适应的格式判定结果 */
export type SyncFormat = typeof SYNC_FORMAT_LEGACY | typeof SYNC_FORMAT_COMPACT;
/**
 * 外观压缩后固定长度（ADR-0011）：
 * [0] species | [1..22] 11×u16 RGB565 | [23..26] parts | [27..30] 配件索引 | [31] reserved
 */
export const APPEARANCE_BYTES = 32;

/**
 * HELLO 尾部可选的恢复段：`[version u8][x u16][y u16][state u8][seatId u16]`。
 *
 * 不带这一段的帧长与旧版完全一致（压测机器人、旧客户端走原路径），
 * 解码端按「剩余字节数」判断，不需要任何版本协商包。
 */
export const RESUME_VERSION = 1;
export const RESUME_BYTES = 8;

/**
 * 排队快照：op(1) + ticket(4) + position(2) + length(2) + etaSec(2) + capacity(2)
 *          + dominant(1) + utilizationPermille(2)
 */
export const QUEUE_STATUS_BYTES = 16;
/** 排队拒绝：op(1) + reason(1) */
export const QUEUE_REJECT_BYTES = 2;
/** 聊天拒绝：op(1) + reason(1)，与排队拒绝同构 */
export const CHAT_REJECT_BYTES = 2;

/**
 * 聊天历史（ADR-0039）：服务端进程内环形缓冲，不落盘、不接库。
 *
 * 条数与时长双上限——条数管内存（200 × 约 540B ≈ 108KB 恒定），
 * 时长管「重开标签页看到一小时前的话」这种失真。
 */
export const CHAT_HISTORY_CAPACITY = 200;
export const CHAT_HISTORY_TTL_MS = 60 * 60 * 1000;
/** 首屏补发与每次上翻的条数：一页一包，与加长后的面板可视高度对齐 */
export const CHAT_HISTORY_PAGE_SIZE = 10;
/** 单次请求允许的最大页长：客户端传什么都不能改大服务端的下行预算 */
export const CHAT_HISTORY_MAX_PAGE = 30;
/**
 * 单个历史包的下行预算。历史会走 `transport.send` 的出口计量并影响准入带宽水位，
 * 所以一页装不下就截断并置 `HasMore`，不引入分包协议。
 */
export const CHAT_HISTORY_PACKET_BUDGET = 2048;
/** 上翻请求的最小间隔：滚动抖动不应该把服务端刷穿 */
export const CHAT_HISTORY_REQUEST_INTERVAL_MS = 500;

/** 历史包 flags：位标记而不是枚举，将来加「按类型过滤」不用再开新包 */
export const CHAT_HISTORY_FLAG = {
  /** 首屏快照：客户端整表替换，而不是往现有列表前插 */
  Replace: 1,
  /** 本页之外还有更早的消息 */
  HasMore: 2,
} as const;
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
