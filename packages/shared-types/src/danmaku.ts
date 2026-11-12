/**
 * 弹幕元数据契约：颜色预设索引与飞行模式。
 *
 * 为什么放在共享层而不是客户端调色板文件：这两个字节会原样进出聊天包，
 * 服务端必须能在「不认识具体颜色」的前提下做钳制（ADR-0056）。颜色值本身
 * 属于表现层，留在 `apps/web/lib/game/danmaku-palette.ts`。
 */

/** 飞行模式：与 `C2S_CHAT` / `S2C_CHAT_BROADCAST` 的 `danmakuMode` 位一一对应 */
export const DANMAKU_MODE = {
  /** 从右缘向左匀速飞过整屏 */
  Scroll: 0,
  /** 顶部居中停留后淡出 */
  Top: 1,
  /** 底部居中停留后淡出 */
  Bottom: 2,
} as const;

export type DanmakuMode = (typeof DANMAKU_MODE)[keyof typeof DANMAKU_MODE];

/**
 * 当前调色板可用的颜色数量。
 *
 * 协议字段是 u8、文档口径 0~15，留了扩容余量；但今天的调色板只有 8 色，
 * 越界的索引必须回落到默认白，否则客户端会拿到一个不存在的颜色。
 */
export const DANMAKU_COLOR_COUNT = 8;

/** 协议允许的颜色索引上限（含）：字段按 0~15 设计，超出即视为脏数据 */
export const DANMAKU_PROTOCOL_COLOR_MAX = 15;

/** 协议允许的最大飞行模式（Bottom） */
export const DANMAKU_MODE_MAX = DANMAKU_MODE.Bottom;

/** 聊天包中文本之前的元数据字节数：`colorIndex u8 + danmakuMode u8` */
export const DANMAKU_META_BYTES = 2;

/**
 * 颜色索引归一化。
 *
 * 服务端与客户端都调用同一把尺子：伪造包、旧版残留、浮点越界都只能得到
 * 一个确定的值，广播出去的颜色不会因接收端不同而不同（与打码同一纪律）。
 */
export function normalizeDanmakuColor(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const index = Math.trunc(value);
  // 低于 0 或超过协议字段上限：脏数据，回落默认白
  if (index < 0 || index > DANMAKU_PROTOCOL_COLOR_MAX) return 0;
  // 落在协议范围内但调色板还没有这一格：同样回落默认白
  return index < DANMAKU_COLOR_COUNT ? index : 0;
}

/** 飞行模式归一化：未知值一律按滚动处理，绝不把脏字节传进渲染层 */
export function normalizeDanmakuMode(value: number): DanmakuMode {
  if (value === DANMAKU_MODE.Top) return DANMAKU_MODE.Top;
  if (value === DANMAKU_MODE.Bottom) return DANMAKU_MODE.Bottom;
  return DANMAKU_MODE.Scroll;
}
