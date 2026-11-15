'use client';

import { serverMonth } from './server-date';
import { serverNow, serverTzOffsetMin } from './server-clock';

/**
 * 季节判定：整个冬季雪景只有这一个入口。
 *
 * 为什么把季节收敛成一个纯函数而不是各图层各读一次日期：
 * 地形、树、飘雪、柔光、道具若各自读一次 `new Date()`，跨月那一分钟里
 * 就会出现「地面还在夏天、雪已经在飘」的裂缝。`GameRenderer.buildLayers()`
 * 只调用一次 `readSeason`，其余模块一律接收 `winter: boolean`，
 * 同一帧里所有图层的季节判断天然一致。
 *
 * 为什么不做服务端季节：服务端权威结算碰撞，而地形是双端共用的静态几何。
 * 季节一旦进入服务端，冬夏的可行走区域就会不同，`地形不进协议` 的边界被打破
 * （见 ADR-0046）。冬季因此是纯表现层，连积雪的雪人都不参与碰撞。
 */

/** 冬季区间：11 月、12 月、1 月、2 月（`Date.getMonth()` 的 0 基月份） */
export const WINTER_MONTHS: readonly number[] = [10, 11, 0, 1];

export type SeasonSource = 'date' | 'url-on' | 'url-off';

export interface SeasonState {
  /** 是否进入冬季雪景 */
  winter: boolean;
  /** 飘雪粒子是否开启：`?snow=0` 只关粒子，覆雪地面与冬季道具保留 */
  snow: boolean;
  /** 判定来源：线上定位观感问题时一眼能看出「是日期生效还是参数生效」 */
  source: SeasonSource;
}

/** 纯函数：0 基月份是否属于冬季 */
export function isWinterMonth(month: number): boolean {
  return Number.isInteger(month) && WINTER_MONTHS.includes(month);
}

/** 纯函数：按园区日期判断；只看月份，所以固定时区偏移已足够 */
export function isWinterDate(date: Date, tz: number = serverTzOffsetMin()): boolean {
  return isWinterMonth(serverMonth(date.getTime(), tz));
}

/** `?season=` 的取值：只有明确的开关才覆盖日期，非法值一律回落到日期 */
function readSeasonFlag(raw: string | null): SeasonSource | null {
  if (raw === null || raw === '') return null;
  const value = raw.toLowerCase();
  if (value === 'winter' || value === '1' || value === 'on' || value === '冬') return 'url-on';
  if (value === 'off' || value === '0' || value === 'summer' || value === '夏') return 'url-off';
  return null;
}

/**
 * 读季节开关。`search` 是 `location.search`（含前导 `?`）而不是 `URLSearchParams`：
 * 参数来自调用方，纯函数才能在单测里直接喂字符串。
 *
 * 三个开关与既有 `?light=0` / `?flat=1` 同一套写法：
 * - `?season=winter` 强制入冬（7 月也能看完整冬景，用于验收与截图）
 * - `?season=off` 强制关冬（1 月退回改动前的常夏园区）
 * - `?snow=0` 只关飘雪粒子，用于定位「是雪粒吵还是雪景本身有问题」
 */
export function readSeason(
  search: string,
  now: Date = new Date(serverNow()),
  tz: number = serverTzOffsetMin(),
): SeasonState {
  const params = new URLSearchParams(search);
  const flag = readSeasonFlag(params.get('season'));
  const winter = flag === 'url-on' ? true : flag === 'url-off' ? false : isWinterDate(now, tz);
  const snowRaw = params.get('snow');
  const snow = winter && snowRaw !== '0' && snowRaw !== 'off';
  return {
    winter,
    snow,
    source: flag ?? 'date',
  };
}
