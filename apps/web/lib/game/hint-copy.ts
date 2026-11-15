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
  /** 世界指路牌（拱门东侧）：纯客户端互动，只展开园区导览卡 */
  directory: '[F] 看园区导览',
  interact: '按 F 互动',
  /** 赛博财神供案（ADR-0061） */
  shrine: '[F] 上香祈福',
  /** 老干部紫砂茶台（ADR-0061 → ADR-0085）：改为打开属性强化面板 */
  tea: '[F] 打开属性强化',
  /** 发泄区老板（ADR-0070）：出招键是 E，不是互动键 F */
  boss: '[E] 发泄·踹老板一脚',
  /** 三人擂台（ADR-0073）：报名入口只有场边 F 传送，围绳不能靠走进去 */
  ringJoin: '[F] 报名擂台',
  ringLeave: '[F] 取消报名',
  /** 颁奖期（ADR-0076）：奖牌已入账，参赛者不必站满窗口 */
  ringAwardLeave: '[F] 领奖离场',
  ringFull: '擂台已满员，先在外围绕观',
  ringFighting: '擂台比赛中，等本局结束',
  ringAward: '颁奖中，稍后再来',
  lieOnSeat: '座位上不能躺，先按 Z 起身',
  sitOnBed: '床上只能躺，按 X 起身',
  bedOnly: '床上只能躺，按 X 上床',
  // ---- 热区建筑（ADR-0087 → ADR-0093） ----
  /** 摸鱼大赌场：坐上本桌圆凳即自动入局，F 只是重新打开面板 */
  dice: '[F] 押一把（大 / 小 / 豹子）',
  /** 站在赌桌旁但没坐上本桌凳子：只提示，不给可点的「押一把」 */
  diceNeedSeat: '按 Z 坐进本桌凳子再押注',
  /** 绩效八角笼观战长椅 */
  arenaBet: '[F] 押红方 / 蓝方',
  /** 站在长椅旁但没坐上去 */
  arenaNeedSeat: '按 Z 坐到观战长椅上再押注',
  /** 豪宅小院门口 */
  villa: '[F] 查看小院牌匾',
  /** 院内摇钱树 */
  villaTree: '[F] 收摇钱树',
  /** 牛马公寓门口：按 F 从空闲窗口探头（ADR-0098） */
  apartment: '[F] 进入牛马公寓',
  /** 人在窗口里：任意时刻按 F 都回门口 */
  apartmentExit: '[F] 出门',
  // ---- 打工产出与随机事件（ADR-0088） ----
  /** 工位：坐好之后按 F 开工 */
  work: '[F] 开始加班搬砖',
  /** 站在工位旁但没坐下：先坐下才能开工 */
  workNeedSeat: '按 Z 坐到自己工位上再搬砖',
  /** 红包雨：站在红包上按 F 抢 */
  redPacket: '[F] 抢红包',
  // ---- 弱交互场所（会议室 / 影音室 / 游乐园 / 摸鱼亭）----
  /** 坐在会议椅上按 F 发言（纯客户端气泡，不发包） */
  meeting: '[F] 开会发言',
  /** 坐在影厅座椅上按 F 换频道（纯客户端切画面） */
  theater: '[F] 换个频道',
  /** 站在游乐园器械旁按 F 打卡拍照 */
  parkPhoto: '[F] 打卡拍照',
  /** 坐在摸鱼亭石鼓凳上按 F 发会儿呆 */
  pavilion: '[F] 对着湖发呆',
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
  [HINT.directory]: { action: 'interact', label: '看园区导览', key: 'F' },
  [HINT.interact]: { action: 'interact', label: '互动', key: 'F' },
  [HINT.shrine]: { action: 'interact', label: '上香祈福', key: 'F' },
  [HINT.tea]: { action: 'interact', label: '打开属性强化', key: 'F' },
  [HINT.boss]: { action: 'vent', label: '发泄', key: 'E' },
  [HINT.ringJoin]: { action: 'interact', label: '报名擂台', key: 'F' },
  [HINT.ringLeave]: { action: 'interact', label: '取消报名', key: 'F' },
  [HINT.ringAwardLeave]: { action: 'interact', label: '领奖离场', key: 'F' },
  // 劝阻文案没有可执行动作：保留纯文本，避免把「不能躺」渲染成按钮
  [HINT.ringFull]: null,
  [HINT.ringFighting]: null,
  [HINT.ringAward]: null,
  [HINT.lieOnSeat]: null,
  [HINT.sitOnBed]: null,
  [HINT.bedOnly]: null,
  [HINT.dice]: { action: 'interact', label: '押一把', key: 'F' },
  // 没坐下时不可执行：只提醒，不给按钮（ADR-0093）
  [HINT.diceNeedSeat]: null,
  [HINT.arenaBet]: { action: 'interact', label: '押注', key: 'F' },
  [HINT.arenaNeedSeat]: null,
  [HINT.villa]: { action: 'interact', label: '查看牌匾', key: 'F' },
  [HINT.villaTree]: { action: 'interact', label: '收摇钱树', key: 'F' },
  [HINT.apartment]: { action: 'interact', label: '进公寓', key: 'F' },
  [HINT.apartmentExit]: { action: 'interact', label: '出门', key: 'F' },
  // 公寓窗口里没有别的可做，这一条就是唯一的按键
  [HINT.work]: { action: 'interact', label: '搬砖', key: 'F' },
  // 没坐下时不可执行：只提醒，不给按钮
  [HINT.workNeedSeat]: null,
  [HINT.redPacket]: { action: 'interact', label: '抢红包', key: 'F' },
  // 弱交互场所：四条都是纯客户端反馈，按键仍是 F
  [HINT.meeting]: { action: 'interact', label: '开会发言', key: 'F' },
  [HINT.theater]: { action: 'interact', label: '换频道', key: 'F' },
  [HINT.parkPhoto]: { action: 'interact', label: '打卡拍照', key: 'F' },
  [HINT.pavilion]: { action: 'interact', label: '发会儿呆', key: 'F' },
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
  [HINT.directory]: '点「互动」看园区导览',
  [HINT.interact]: '点「互动」',
  [HINT.shrine]: '点「互动」上香祈福',
  [HINT.tea]: '点「互动」打开属性强化',
  [HINT.boss]: '点「发泄」踹老板一脚',
  [HINT.ringJoin]: '点「互动」报名擂台',
  [HINT.ringLeave]: '点「互动」取消报名',
  [HINT.ringAwardLeave]: '点「互动」领奖离场',
  [HINT.ringFull]: '擂台已满员，先在外围绕观',
  [HINT.ringFighting]: '擂台比赛中，等本局结束',
  [HINT.ringAward]: '颁奖中，稍后再来',
  [HINT.lieOnSeat]: '座位上不能躺，先点「起身」',
  [HINT.sitOnBed]: '床上只能躺，点「起身」',
  [HINT.bedOnly]: '床上只能躺，点「躺平」',
  [HINT.dice]: '点「互动」押一把',
  [HINT.diceNeedSeat]: '点「坐下」坐进本桌凳子再押注',
  [HINT.arenaBet]: '点「互动」押注',
  [HINT.arenaNeedSeat]: '点「坐下」坐到观战长椅上再押注',
  [HINT.villa]: '点「互动」查看牌匾',
  [HINT.villaTree]: '点「互动」收摇钱树',
  [HINT.apartment]: '点「互动」进公寓',
  [HINT.apartmentExit]: '点「互动」出门',
  [HINT.work]: '点「互动」搬砖',
  [HINT.workNeedSeat]: '点「坐下」坐到自己工位上再搬砖',
  [HINT.redPacket]: '点「互动」抢红包',
  [HINT.meeting]: '点「互动」开会发言',
  [HINT.theater]: '点「互动」换频道',
  [HINT.parkPhoto]: '点「互动」打卡拍照',
  [HINT.pavilion]: '点「互动」发会儿呆',
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
