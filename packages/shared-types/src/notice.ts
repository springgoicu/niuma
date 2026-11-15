/**
 * 系统提示（园区频道里的「系统消息」）。
 *
 * 一条系统提示只有两件事：编号决定样式与将来的过滤开关，文案决定玩家看到什么。
 * 文案集中在这张表里，服务端广播与客户端本地播报共用同一份实现，
 * 所以新增一种自动化提示只需要三步：
 *
 * 1. 在 `SYSTEM_NOTICE_KIND` 里加一个编号（协议字段是 u8，1–255 都可用）；
 * 2. 在 `TEMPLATES` 里加一条文案函数，参数只放有限个简单值；
 * 3. 触发点：服务端事件调 `sim/notice.ts` 的 `broadcastSystemNotice`，
 *    客户端本地事件调 `session` 的 `pushLocalNotice`。
 *
 * 协议不用动——包体里的 `text` 已经是套好模板的成品，未知编号也能照常显示。
 */
export const SYSTEM_NOTICE_KIND = {
  /** 有人进入园区：服务端只发给看得见他的玩家 */
  Enter: 1,
  /** 有人离开园区：主动退出、关标签页、掉线在服务端不可区分，统一中性说法 */
  Leave: 2,
  /** 本地在岗时长提醒：只有自己看得到，不走网络 */
  OnDuty: 3,
  /** 园区公告（装修 / 活动）：入场后本地播一条，只有自己看得到 */
  Renovation: 4,
  /** 保安执法：附近有人被请进小黑屋（ADR-0072） */
  Detained: 5,
  /** 打人警告：只发给动手的本人，旁人不该知道保安在盯谁（ADR-0074） */
  AssaultWarn: 6,
  /** 保安带走动手的人：发给看得见他的人（ADR-0074） */
  DetainedFight: 7,
  /** 公寓窗口住满了：只发给站在门口按 F 的本人（ADR-0098） */
  ApartmentFull: 8,
} as const;

export type SystemNoticeKind = (typeof SYSTEM_NOTICE_KIND)[keyof typeof SYSTEM_NOTICE_KIND];

export interface SystemNoticeParams {
  /** 进园 / 离园这类以某个人为主语的提示 */
  name?: string;
  /** 在岗时长提醒的分钟数 */
  minutes?: number;
}

type NoticeTemplate = (params: SystemNoticeParams) => string | null;

/** 分钟数换成人话：整小时说小时，其余说分钟 */
function formatDuration(minutes: number): string {
  if (minutes < 60 || minutes % 60 !== 0) return `${minutes} 分钟`;
  return `${minutes / 60} 小时`;
}

const TEMPLATES: Readonly<Record<number, NoticeTemplate>> = {
  [SYSTEM_NOTICE_KIND.Enter]: ({ name }) => (name ? `${name} 进入了园区` : null),
  [SYSTEM_NOTICE_KIND.Leave]: ({ name }) => (name ? `${name} 离开了园区` : null),
  [SYSTEM_NOTICE_KIND.OnDuty]: ({ minutes }) =>
    minutes && minutes > 0 ? `你已经在岗 ${formatDuration(minutes)}，起来走动两步。` : null,
  [SYSTEM_NOTICE_KIND.Renovation]: () =>
    '园区重装修完成：北门内四角新院已启用，工作区 / 会议室 / 宿舍区 / 卫生间已归位。',
  // 「不许色色」是这条提示的固定落点，名字只换主语，文案不随阶段变
  [SYSTEM_NOTICE_KIND.Detained]: ({ name }) =>
    name ? `${name} 被保安请进了小黑屋：园区内不许色色。` : null,
  // 警告只说「再打一次」，不报次数：玩家不该从文案里反推判定阈值
  [SYSTEM_NOTICE_KIND.AssaultWarn]: () =>
    '保安盯上你了：园区内不许动手，再打一次就请你进小黑屋。',
  [SYSTEM_NOTICE_KIND.DetainedFight]: ({ name }) =>
    name ? `${name} 被保安请进了小黑屋：园区内不许动手。` : null,
  [SYSTEM_NOTICE_KIND.ApartmentFull]: () => '这栋楼的窗口都住满了，换一栋试试。',
};

/**
 * 套模板。未知编号或参数不够时返回 `null`，调用方直接跳过——
 * 这样新服务端配旧模板表、或模板表被改坏，都不会给玩家看半句话。
 */
export function formatSystemNotice(kind: number, params: SystemNoticeParams = {}): string | null {
  const template = TEMPLATES[kind];
  if (!template) return null;
  const text = template(params);
  return text && text.length > 0 ? text : null;
}
