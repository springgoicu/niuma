import { describe, expect, it } from 'bun:test';
import { BOARD_METRIC } from '@niuma/shared-types';
import {
  BOARD_METRICS,
  formatBoardValue,
  formatMinutes,
  isBackdropCloseAllowed,
  metricMeta,
} from '../leaderboard';

describe('牛马榜展示口径', () => {
  it('五个指标全部是今日口径，不重不漏', () => {
    expect(BOARD_METRICS.map((meta) => meta.id).sort()).toEqual(
      [
        BOARD_METRIC.TodayMinutes,
        BOARD_METRIC.TodayToilet,
        BOARD_METRIC.TodayKnockdown,
        BOARD_METRIC.TodayVented,
        BOARD_METRIC.TodaySteps,
      ].sort(),
    );
    expect(new Set(BOARD_METRICS.map((meta) => meta.label)).size).toBe(5);
    expect(metricMeta(BOARD_METRIC.TodayMinutes).label).toBe('工时');
    expect(metricMeta(BOARD_METRIC.TodayToilet).label).toBe('如厕');
    expect(metricMeta(BOARD_METRIC.TodaySteps).label).toBe('步数');
  });

  it('时间类按小时 + 分钟念，整小时不拖 0 分', () => {
    expect(formatBoardValue(BOARD_METRIC.TodayMinutes, 0)).toBe('0m');
    expect(formatBoardValue(BOARD_METRIC.TodayMinutes, 45)).toBe('45m');
    expect(formatBoardValue(BOARD_METRIC.TodayMinutes, 120)).toBe('2h');
    expect(formatBoardValue(BOARD_METRIC.TodayMinutes, 65)).toBe('1h 5m');
    expect(formatBoardValue(BOARD_METRIC.TodayToilet, 90)).toBe('1h 30m');
    expect(formatBoardValue(BOARD_METRIC.TodayToilet, -30)).toBe('0m');
  });

  it('计数类指标千分位展示，不把小数或负数画进榜单', () => {
    expect(formatBoardValue(BOARD_METRIC.TodaySteps, 12_345)).toBe('12,345');
    expect(formatBoardValue(BOARD_METRIC.TodaySteps, 999)).toBe('999');
    expect(formatBoardValue(BOARD_METRIC.TodayKnockdown, -3)).toBe('0');
    expect(formatBoardValue(BOARD_METRIC.TodayVented, Number.NaN)).toBe('0');
  });

  it('不足一分钟的工时读作 <1m，不跟「没工时」共用 0m', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(0.4)).toBe('<1m');
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
