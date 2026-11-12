import { DANMAKU_MODE, normalizeDanmakuColor, type DanmakuMode } from '@niuma/shared-types';

/**
 * 弹幕调色板与输入侧文案（ADR-0056）。
 *
 * 颜色值只在表现层出现：共享层只认 0~7 的索引，服务端不认识 RGB。
 * 这样换一套配色不需要动协议，也不会出现「服务端广播了一个客户端没有的颜色」。
 */

export interface DanmakuColorPreset {
  /** 协议索引，与数组下标一致 */
  index: number;
  /** Pixi 用的 24 位色值 */
  hex: number;
  /** 色块的可读名称：不依赖颜色也能选 */
  label: string;
  /** 职场寓意：色块 hover / aria-label 的第二行 */
  tagline: string;
}

/**
 * 8 种高对比预设。
 *
 * 顺序即协议索引：0 必须是默认白——`normalizeDanmakuColor` 把越界值回落到 0，
 * 调换顺序会让所有旧消息换色。
 */
export const DANMAKU_PALETTE: readonly DanmakuColorPreset[] = [
  { index: 0, hex: 0xffffff, label: '纯白', tagline: '纯真牛马' },
  { index: 1, hex: 0x00ff99, label: '薄荷绿', tagline: '带薪摸鱼' },
  { index: 2, hex: 0xff3366, label: '警示红', tagline: '需求加急' },
  { index: 3, hex: 0xffd700, label: '高光金', tagline: '老板画饼' },
  { index: 4, hex: 0x00e5ff, label: '赛博蓝', tagline: '理性拒绝' },
  { index: 5, hex: 0xb388ff, label: '赋能紫', tagline: '闭环抓手' },
  { index: 6, hex: 0xffa500, label: '落日橙', tagline: '准点下班' },
  { index: 7, hex: 0xff77ff, label: '发疯粉', tagline: '拒绝内卷' },
] as const;

export function danmakuColorAt(index: number): DanmakuColorPreset {
  // 归一化后再取：调用方传伪造包里的 200 也不会拿到 undefined
  return DANMAKU_PALETTE[normalizeDanmakuColor(index)] ?? DANMAKU_PALETTE[0]!;
}

/** Pixi 的 24 位色值 → CSS 十六进制；色块与预览共用一份换算 */
export function cssHex(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export interface DanmakuModeOption {
  value: DanmakuMode;
  /** 工具栏上的箭头符号：只用符号会看不懂，必须配文字标签 */
  icon: string;
  label: string;
}

/** 模式轮转顺序：滚动 → 顶端 → 底端 → 滚动 */
export const DANMAKU_MODE_OPTIONS: readonly DanmakuModeOption[] = [
  { value: DANMAKU_MODE.Scroll, icon: '➡', label: '滚动' },
  { value: DANMAKU_MODE.Top, icon: '⬆', label: '顶端' },
  { value: DANMAKU_MODE.Bottom, icon: '⬇', label: '底端' },
] as const;

export function danmakuModeOption(mode: DanmakuMode): DanmakuModeOption {
  return DANMAKU_MODE_OPTIONS.find((option) => option.value === mode) ?? DANMAKU_MODE_OPTIONS[0]!;
}

/** 点击模式按钮：按固定顺序循环，不记忆「上一次从哪来」 */
export function nextDanmakuMode(mode: DanmakuMode): DanmakuMode {
  const index = DANMAKU_MODE_OPTIONS.findIndex((option) => option.value === mode);
  const next = DANMAKU_MODE_OPTIONS[(index + 1) % DANMAKU_MODE_OPTIONS.length];
  return next ? next.value : DANMAKU_MODE.Scroll;
}

/**
 * 一键职场黑话。
 *
 * 点击只填入输入框并聚焦，不直接发射：发出去的话归用户所有，
 * 误触一条「这个需求做不了」比少点一次发送更贵。
 */
export const DANMAKU_QUICK_PILLS: readonly string[] = [
  '⚠️ 老板正在靠近！',
  '收到，这就去办',
  '这个需求做不了',
  '带薪拉屎中...',
  '今日摸鱼纯度 +1',
  '建议立刻去中庭吃草',
] as const;
