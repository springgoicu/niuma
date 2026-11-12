/**
 * 带按键的提示文案（唯一事实源）。
 *
 * 桌面端显示原文「按 Z 坐下」；触屏端用 `touchHint()` 投影成按钮说法「点「坐下」」。
 * 引擎（session / actions）只引用 `HINT`，不感知设备；设备判定留在 React 视图层，
 * 因此不需要把触屏标记穿过 Worker 协议。
 *
 * 纯常量模块：不写 `'use client'`、不碰 DOM，Worker 与 React 两侧都能导入。
 */
export const HINT = {
  seat: '按 Z 坐下',
  toilet: '按 Z 使用马桶',
  bed: '按 X 上床躺平',
  board: '按 F 查看牛马榜',
  interact: '按 F 互动',
  lieOnSeat: '座位上不能躺，先按 Z 起身',
  sitOnBed: '床上只能躺，按 X 起身',
  bedOnly: '床上只能躺，按 X 上床',
} as const;

export type HintCopy = (typeof HINT)[keyof typeof HINT];

/**
 * 触屏说法。按钮名必须与动作盘的真实标签一致：
 * 「坐下」「躺平」「互动」来自 TouchControls，`起身` 来自 actionPresentation 的激活态。
 * 只说按钮名，不写「右下」之类的方位——横竖屏的动作盘布局不同，方位会误导人。
 */
const TOUCH_HINTS: Record<HintCopy, string> = {
  [HINT.seat]: '点「坐下」',
  [HINT.toilet]: '点「坐下」使用马桶',
  [HINT.bed]: '点「躺平」',
  [HINT.board]: '点「互动」查看牛马榜',
  [HINT.interact]: '点「互动」',
  [HINT.lieOnSeat]: '座位上不能躺，先点「起身」',
  [HINT.sitOnBed]: '床上只能躺，点「起身」',
  [HINT.bedOnly]: '床上只能躺，点「躺平」',
};

/** 无按键的提示（已到达某地、附近没有设施等）原样透传，不做通用替换 */
export function touchHint(hint: string): string {
  return (TOUCH_HINTS as Record<string, string>)[hint] ?? hint;
}
