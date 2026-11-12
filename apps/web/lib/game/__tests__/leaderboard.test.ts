import { describe, expect, it } from 'bun:test';
import { BOARD_METRIC } from '@niuma/shared-types';
import {
  advanceBoardValue,
  BOARD_METRICS,
  formatBoardValue,
  isBackdropCloseAllowed,
  metricMeta,
} from '../leaderboard';

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

  it('不足一分钟的工时读作 <1m，不跟「没工时」共用 0m', () => {
    expect(formatBoardValue(BOARD_METRIC.Week, 0)).toBe('0m');
    expect(formatBoardValue(BOARD_METRIC.Week, 0.4)).toBe('<1m');
  });
});

describe('面板关闭手势', () => {
  it('打开后 400ms 内的遮罩按压不算关闭意图', () => {
    const openedAt = 1_000;
    expect(isBackdropCloseAllowed(openedAt, openedAt)).toBe(false);
    expect(isBackdropCloseAllowed(openedAt, openedAt + 399)).toBe(false);
    expect(isBackdropCloseAllowed(openedAt, openedAt + 400)).toBe(true);
  });

  it('坏时间戳一律当作不可关闭，不误关刚打开的面板', () => {
    expect(isBackdropCloseAllowed(Number.NaN, 1_500)).toBe(false);
    expect(isBackdropCloseAllowed(1_000, Number.NaN)).toBe(false);
  });
});

describe('快照本地推进', () => {
  it('在岗按秒推进，工时按整分钟推进', () => {
    expect(advanceBoardValue(BOARD_METRIC.Duty, 60, 12.9)).toBe(72);
    expect(advanceBoardValue(BOARD_METRIC.Duty, 60, 0)).toBe(60);
    expect(advanceBoardValue(BOARD_METRIC.Week, 60, 12.9)).toBe(60);
    expect(advanceBoardValue(BOARD_METRIC.Week, 60, 61)).toBe(61);
  });

  it('计数类不随时间推进，坏数值落到 0', () => {
    expect(advanceBoardValue(BOARD_METRIC.Steps, 30, 90)).toBe(30);
    expect(advanceBoardValue(BOARD_METRIC.Likes, 3, 90)).toBe(3);
    expect(advanceBoardValue(BOARD_METRIC.Duty, -5, 10)).toBe(0);
    expect(advanceBoardValue(BOARD_METRIC.Duty, Number.NaN, 10)).toBe(0);
  });
});
