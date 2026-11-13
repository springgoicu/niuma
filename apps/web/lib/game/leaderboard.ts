import { BOARD_METRIC, type BoardMetric } from '@niuma/shared-types';

/**
 * 牛马榜的展示层（ADR-0054 / 当日化 ADR）。
 *
 * 这里只做「指标叫什么、数值怎么念」：不碰网络、不碰 React、不碰二进制。
 * 协议里的 metric 编号是唯一键；面板、空态与页签全部读这一份，
 * 新增指标时只改这里与 shared-types 的 `BOARD_METRIC`。
 *
 * 五个指标全部是「今日」口径，文案里不再出现本次 / 本周 / 累计，
 * 避免玩家把服务端会话时长和本地今日工时读成两套数字。
 */
export interface BoardMetricMeta {
  id: BoardMetric;
  /** 页签上的短标签：五个标签要能在一屏里排下 */
  label: string;
  /** 榜单内容上方的口径说明 */
  caption: string;
  /** 空榜时的一句话，语气与园区公告一致 */
  empty: string;
  /** 数值后缀；工时与如厕自带单位，留空 */
  unit: string;
}

export const BOARD_METRICS: readonly BoardMetricMeta[] = [
  {
    id: BOARD_METRIC.TodayMinutes,
    label: '工时',
    caption: '今日累计工时 · 本人浏览器计时',
    empty: '今天还没有人上报工时，先坐下摸一会儿鱼。',
    unit: '',
  },
  {
    id: BOARD_METRIC.TodayToilet,
    label: '如厕',
    caption: '今日如厕时长 · 工时的一部分',
    empty: '今天还没有人上报如厕，马桶座还空着。',
    unit: '',
  },
  {
    id: BOARD_METRIC.TodayKnockdown,
    label: '击倒',
    caption: '今日成功击倒他人次数 · 本人自报',
    empty: '今天还没有人成功击倒，园区很和平。',
    unit: '次',
  },
  {
    id: BOARD_METRIC.TodayVented,
    label: '被创',
    caption: '今日被他人击倒次数 · 本人自报',
    empty: '今天还没有人被创，大家都很稳。',
    unit: '次',
  },
  {
    id: BOARD_METRIC.TodaySteps,
    label: '步数',
    caption: '今日搬砖步数 · 本人自报',
    empty: '今天还没有人上报步数，先走两步。',
    unit: '步',
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

/**
 * 分钟换成人话：不足一小时只说分钟，整小时不带 0 分。
 *
 * 「有值但不足一分钟」显示 `<1m`：刚进园的整排 `0m` 会被读成「没在计时」，
 * 而它其实只是还没攒够一格。
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const total = Math.floor(minutes);
  if (total === 0) return '<1m';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * 榜单数值的显示文本。
 *
 * 工时与如厕是分钟（`1h 5m`），击倒 / 被创 / 步数是计数（千分位）。
 * 负数与 NaN 一律落到 0，不把坏数据画成 `NaN` 或负排名。
 */
export function formatBoardValue(metric: BoardMetric, value: number): string {
  switch (metric) {
    case BOARD_METRIC.TodayMinutes:
    case BOARD_METRIC.TodayToilet:
      return formatMinutes(value);
    case BOARD_METRIC.TodayKnockdown:
    case BOARD_METRIC.TodayVented:
    case BOARD_METRIC.TodaySteps:
      return groupDigits(value);
  }
}

/**
 * 面板打开后的遮罩免疫窗（毫秒）。
 *
 * 面板是被鼠标 / 手指点开的，而它的遮罩铺满整个屏幕：同一次手势的余波
 * （触屏合成 click）或手快的第二下都会落在遮罩上，把刚打开的面板立刻关掉。
 * 这段时间内的遮罩按压一律不算「我要关闭」。
 */
export const BOARD_CLOSE_GUARD_MS = 400;

/** 遮罩按压是否算关闭意图：打开后 400ms 内一律不算 */
export function isBackdropCloseAllowed(openedAt: number, now: number): boolean {
  if (!Number.isFinite(openedAt) || !Number.isFinite(now)) return false;
  return now - openedAt >= BOARD_CLOSE_GUARD_MS;
}
