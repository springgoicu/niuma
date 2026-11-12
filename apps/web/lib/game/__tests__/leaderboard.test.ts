import { describe, expect, it } from 'bun:test';
import { BOARD_METRIC } from '@niuma/shared-types';
import { BOARD_METRICS, formatBoardValue, metricMeta } from '../leaderboard';

describe('牛马榜展示口径', () => {
  it('六个指标各有一条元数据，不重不漏', () => {
    expect(BOARD_METRICS.map((meta) => meta.id).sort()).toEqual(
      [
        BOARD_METRIC.Duty,
        BOARD_METRIC.Week,
        BOARD_METRIC.Slack,
        BOARD_METRIC.Knockdown,
        BOARD_METRIC.Steps,
        BOARD_METRIC.Likes,
      ].sort(),
    );
    expect(new Set(BOARD_METRICS.map((meta) => meta.label)).size).toBe(6);
    expect(metricMeta(BOARD_METRIC.Knockdown).label).toBe('击倒');
    expect(metricMeta(BOARD_METRIC.Likes).label).toBe('人气');
    expect(metricMeta(BOARD_METRIC.Likes).unit).toBe('赞');
  });

  it('在岗时长走 HH:MM:SS，与工牌同一把尺子', () => {
    expect(formatBoardValue(BOARD_METRIC.Duty, 0)).toBe('00:00:00');
    expect(formatBoardValue(BOARD_METRIC.Duty, 3_661)).toBe('01:01:01');
    expect(formatBoardValue(BOARD_METRIC.Duty, 360_000)).toBe('100:00:00');
    expect(formatBoardValue(BOARD_METRIC.Duty, -5)).toBe('00:00:00');
    expect(formatBoardValue(BOARD_METRIC.Duty, Number.NaN)).toBe('--:--');
  });

  it('本周工时按小时 + 分钟念，整小时不拖 0 分', () => {
    expect(formatBoardValue(BOARD_METRIC.Week, 0)).toBe('0m');
    expect(formatBoardValue(BOARD_METRIC.Week, 45)).toBe('45m');
    expect(formatBoardValue(BOARD_METRIC.Week, 120)).toBe('2h');
    expect(formatBoardValue(BOARD_METRIC.Week, 2_190)).toBe('36h 30m');
    expect(formatBoardValue(BOARD_METRIC.Week, -30)).toBe('0m');
  });

  it('计数类指标千分位展示，不把小数或负数画进榜单', () => {
    expect(formatBoardValue(BOARD_METRIC.Steps, 12_345)).toBe('12,345');
    expect(formatBoardValue(BOARD_METRIC.Steps, 999)).toBe('999');
    expect(formatBoardValue(BOARD_METRIC.Slack, 1_234.9)).toBe('1,234');
    expect(formatBoardValue(BOARD_METRIC.Knockdown, -3)).toBe('0');
    expect(formatBoardValue(BOARD_METRIC.Knockdown, Number.NaN)).toBe('0');
    expect(formatBoardValue(BOARD_METRIC.Likes, 1_024)).toBe('1,024');
    expect(formatBoardValue(BOARD_METRIC.Likes, -1)).toBe('0');
  });
});
