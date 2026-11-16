import { DICE_BOARD_METRIC, DICE_BOARD_SCOPE, DICE_TABLES, DICE_SIDE_NAME } from '@niuma/shared-types';

/**
 * 骰桌台账的展示层（ADR-0110）。
 *
 * 只做「数字怎么念、颜色怎么分、页签怎么叫」，不碰网络也不碰 React：
 * 结算单、我的战绩与排行榜三个面板读同一份口径，避免三处各写一套符号规则。
 */

/** 千分位整数：负数先取符号，再按三位分组 */
function groupDigits(value: number): string {
  const total = Math.round(Math.abs(value));
  return String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 不带符号的币额：投入额、到手、奖池都用它 */
export function plainCoins(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return groupDigits(Math.max(0, value));
}

/**
 * 带符号净盈亏：赢写 `+130`、输写 `-50`、平整写 `0`。
 *
 * 0 不带符号是有意的：退款局的「打平」不该被读成一笔小赚。
 */
export function signedCoins(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const sign = value > 0 ? '+' : '-';
  return `${sign}${groupDigits(value)}`;
}

/** 净盈亏的色调：盈 amber、亏 ember、平 mist */
export function netTone(value: number): 'win' | 'lose' | 'draw' {
  if (value > 0) return 'win';
  if (value < 0) return 'lose';
  return 'draw';
}

/** 净盈亏文字类：与 netTone 一一对应，表格与摘要条共用 */
export function netClass(value: number): string {
  const tone = netTone(value);
  if (tone === 'win') return 'text-amber-400';
  if (tone === 'lose') return 'text-ember-500';
  return 'text-mist-300';
}

/** 胜率文本：`-1`（还没有分出胜负）显示破折号，绝不用 0% 假装输光 */
export function percentText(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return '—';
  return `${Math.round(Math.min(1, rate) * 100)}%`;
}

/** 档位短名：结算行里的徽标用「大 / 小 / 同点」 */
export function sideLabel(side: number): string {
  return DICE_SIDE_NAME[side] ?? '未投';
}

/** 榜单范围文案：总榜 / 两张桌按骰桌表的名字走 */
export function diceScopeLabel(scope: number): string {
  if (scope === DICE_BOARD_SCOPE.Table0) return DICE_TABLES[0]?.name ?? '翡翠桌';
  if (scope === DICE_BOARD_SCOPE.Table1) return DICE_TABLES[1]?.name ?? '鎏金桌';
  return '全场总榜';
}

/** 榜单口径文案 */
export function diceMetricLabel(metric: number): string {
  return metric === DICE_BOARD_METRIC.WinRate ? '胜率' : '净收益';
}
