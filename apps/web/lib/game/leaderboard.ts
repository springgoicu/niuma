import { BOARD_METRIC, type BoardMetric } from '@niuma/shared-types';
import { formatOnline } from './badge';

/**
 * 牛马榜的展示层（ADR-0054）。
 *
 * 这里只做「指标叫什么、数值怎么念」：不碰网络、不碰 React、不碰二进制。
 * 协议里的 metric 编号是唯一键；面板、空态与页签全部读这一份，
 * 新增指标时只改这里与 shared-types 的 `BOARD_METRIC`。
 */
export interface BoardMetricMeta {
  id: BoardMetric;
  /** 页签上的短标签：五个标签要能在一屏里排下 */
  label: string;
  /** 榜单内容上方的口径说明 */
  caption: string;
  /** 空榜时的一句话，语气与园区公告一致 */
  empty: string;
  /** 数值后缀；在岗与工时已经自带单位，留空 */
  unit: string;
}

export const BOARD_METRICS: readonly BoardMetricMeta[] = [
  {
    id: BOARD_METRIC.Duty,
    label: '在岗',
    caption: '本次连续在岗 · 服务端计时',
    empty: '还没有人上榜，先打卡上班。',
    unit: '',
  },
  {
    id: BOARD_METRIC.Week,
    label: '工时',
    caption: '本周累计工时 · 本人自报',
    empty: '本周还没有人上报工时，先坐下摸一会儿鱼。',
    unit: '',
  },
  {
    id: BOARD_METRIC.Slack,
    label: '摸鱼',
    caption: '坐下摸鱼次数 · 本人自报',
    empty: '还没有人摸鱼，大家都太卷了。',
    unit: '次',
  },
  {
    id: BOARD_METRIC.Knockdown,
    label: '击倒',
    caption: '成功击倒他人次数 · 本人自报',
    empty: '还没有人成功击倒，园区今天很和平。',
    unit: '次',
  },
  {
    id: BOARD_METRIC.Steps,
    label: '步数',
    caption: '累计搬砖步数 · 本人自报',
    empty: '还没有人上报步数，先走两步。',
    unit: '步',
  },
  {
    id: BOARD_METRIC.Likes,
    label: '人气',
    caption: '收到的工牌点赞 · 本园区本次运行',
    empty: '还没有人收到点赞。打开别人的工牌，点个赞。',
    unit: '赞',
  },
];

export function metricMeta(metric: BoardMetric): BoardMetricMeta {
  return BOARD_METRICS.find((item) => item.id === metric) ?? BOARD_METRICS[0]!;
}

/** 千分位：榜单数值用等宽字体读，分隔符只帮忙扫读，不加单位 */
function groupDigits(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return String(Math.floor(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 分钟换成人话：不足一小时只说分钟，整小时不带 0 分 */
function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const total = Math.floor(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * 榜单数值的显示文本。
 *
 * 在岗是秒级走秒（`HH:MM:SS`，小时不封顶），工时是分钟（`36h 30m`），
 * 摸鱼 / 击倒 / 步数是计数（千分位）。负数与 NaN 一律落到 0，
 * 不把坏数据画成 `NaN` 或负排名。
 */
export function formatBoardValue(metric: BoardMetric, value: number): string {
  switch (metric) {
    case BOARD_METRIC.Duty:
      return formatOnline(value);
    case BOARD_METRIC.Week:
      return formatMinutes(value);
    case BOARD_METRIC.Slack:
    case BOARD_METRIC.Knockdown:
    case BOARD_METRIC.Steps:
    case BOARD_METRIC.Likes:
      return groupDigits(value);
  }
}
