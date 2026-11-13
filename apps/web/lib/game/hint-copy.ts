/**
 * 带按键的提示文案（唯一事实源）。
 *
 * 桌面端显示原文「按 Z 坐下」；触屏端用 `touchHint()` 投影成按钮说法「点「坐下」」。
 * 引擎（session / actions）只引用 `HINT`，不感知设备；设备判定留在 React 视图层，
 * 因此不需要把触屏标记穿过 Worker 协议。
 *
 * 纯常量模块：不写 `'use client'`、不碰 DOM，Worker 与 React 两侧都能导入。
 */
import type { ActionKey } from './input';

export const HINT = {
  seat: '按 Z 坐下',
  toilet: '按 Z 使用马桶',
  bed: '按 X 上床躺平',
  board: '按 F 查看牛马榜',
  /** 放假告示板（ADR-0059）：感应区 64px，面朝板面时才出现；文案用键帽写法照抄需求 */
  bulletin: '[F] 查看放假倒计时',
  interact: '按 F 互动',
  /** 赛博财神供案（ADR-0061） */
  shrine: '[F] 上香祈福',
  /** 老干部紫砂茶台（ADR-0061） */
  tea: '[F] 续杯养生茶',
  /** 发泄区老板（ADR-0070）：出招键是 E，不是互动键 F */
  boss: '[E] 发泄·踹老板一脚',
  lieOnSeat: '座位上不能躺，先按 Z 起身',
  sitOnBed: '床上只能躺，按 X 起身',
  bedOnly: '床上只能躺，按 X 上床',
} as const;

export type HintCopy = (typeof HINT)[keyof typeof HINT];

/** 可互动提示对应的按钮描述；纯状态 / 劝阻文案在表里显式记为 null */
export interface HintButton {
  action: ActionKey;
  /** 按钮上的动作名：「坐下」「使用马桶」「查看牛马榜」… */
  label: string;
  /** 键帽字面量：Z / X / F，同时用于 aria-keyshortcuts */
  key: string;
}

/**
 * 提示文案 → 动作的唯一映射。
 *
 * 不按正则从「按 Z 坐下」里抠键帽：文案改字不会破坏点击行为。
 * 用 `Record<HintCopy, …>` 而不是 Partial，新增提示却忘了归类时编译期就会报错。
 */
const HINT_BUTTONS: Record<HintCopy, HintButton | null> = {
  [HINT.seat]: { action: 'sit', label: '坐下', key: 'Z' },
  [HINT.toilet]: { action: 'sit', label: '使用马桶', key: 'Z' },
  [HINT.bed]: { action: 'lie', label: '躺平', key: 'X' },
  [HINT.board]: { action: 'interact', label: '查看牛马榜', key: 'F' },
  [HINT.bulletin]: { action: 'interact', label: '查看放假倒计时', key: 'F' },
  [HINT.interact]: { action: 'interact', label: '互动', key: 'F' },
  [HINT.shrine]: { action: 'interact', label: '上香祈福', key: 'F' },
  [HINT.tea]: { action: 'interact', label: '续杯养生茶', key: 'F' },
  [HINT.boss]: { action: 'vent', label: '发泄', key: 'E' },
  // 劝阻文案没有可执行动作：保留纯文本，避免把「不能躺」渲染成按钮
  [HINT.lieOnSeat]: null,
  [HINT.sitOnBed]: null,
  [HINT.bedOnly]: null,
};

/** 可互动提示返回按钮描述；劝阻、状态与未知文案返回 null */
export function hintButton(hint: string): HintButton | null {
  // 不能直接下标读取：'toString' 会沿原型链捞到 Object.prototype 上的函数
  return Object.prototype.hasOwnProperty.call(HINT_BUTTONS, hint)
    ? HINT_BUTTONS[hint as HintCopy]
    : null;
}

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
  [HINT.bulletin]: '点「互动」查看放假倒计时',
  [HINT.interact]: '点「互动」',
  [HINT.shrine]: '点「互动」上香祈福',
  [HINT.tea]: '点「互动」续杯养生茶',
  [HINT.boss]: '点「发泄」踹老板一脚',
  [HINT.lieOnSeat]: '座位上不能躺，先点「起身」',
  [HINT.sitOnBed]: '床上只能躺，点「起身」',
  [HINT.bedOnly]: '床上只能躺，点「躺平」',
};

/** 无按键的提示（已到达某地、附近没有设施等）原样透传，不做通用替换 */
export function touchHint(hint: string): string {
  return (TOUCH_HINTS as Record<string, string>)[hint] ?? hint;
}

/**
 * 这一拍该发到界面上的提示：瞬时文案在到期前优先，其余时间始终回到环境提示。
 *
 * 环境提示从不被阻断，只是暂时让位；`now` 与 `transientUntil` 用同一时钟
 * （`performance.now()`），掉帧时 1.6 秒不会被截断成好几秒。
 */
export function resolveVisibleHint(
  context: string | null,
  transient: string | null,
  transientUntil: number,
  now: number,
): string | null {
  return transient !== null && now < transientUntil ? transient : context;
}
