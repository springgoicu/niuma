import { describe, expect, it } from 'bun:test';
import { DICE_BOARD_METRIC, DICE_BOARD_SCOPE } from '@niuma/shared-types';
import {
  diceMetricLabel,
  diceScopeLabel,
  netClass,
  netTone,
  percentText,
  plainCoins,
  signedCoins,
  sideLabel,
} from '../dice-hall-format';

describe('骰桌台账展示层（ADR-0110）', () => {
  it('净盈亏带符号且千分位，0 不带符号', () => {
    expect(signedCoins(12800)).toBe('+12,800');
    expect(signedCoins(-900)).toBe('-900');
    expect(signedCoins(0)).toBe('0');
    expect(signedCoins(Number.NaN)).toBe('0');
  });

  it('不带符号的金额只保留非负整数', () => {
    expect(plainCoins(1120)).toBe('1,120');
    expect(plainCoins(-50)).toBe('0');
    expect(plainCoins(1200.4)).toBe('1,200');
  });

  it('胜率：无有效局显示破折号，绝不假装 0%', () => {
    expect(percentText(-1)).toBe('—');
    expect(percentText(0.72)).toBe('72%');
    expect(percentText(1.4)).toBe('100%');
  });

  it('色调三分：盈 amber、亏 ember、平 mist', () => {
    expect(netTone(1)).toBe('win');
    expect(netTone(-1)).toBe('lose');
    expect(netTone(0)).toBe('draw');
    expect(netClass(80)).toContain('amber');
    expect(netClass(-80)).toContain('ember');
    expect(netClass(0)).toContain('mist');
  });

  it('口径文案与协议枚举对齐，不会把单桌榜读成总榜', () => {
    expect(diceScopeLabel(DICE_BOARD_SCOPE.All)).toBe('全场总榜');
    expect(diceScopeLabel(DICE_BOARD_SCOPE.Table0)).not.toBe('全场总榜');
    expect(diceScopeLabel(DICE_BOARD_SCOPE.Table1)).not.toBe(diceScopeLabel(DICE_BOARD_SCOPE.Table0));
    expect(diceMetricLabel(DICE_BOARD_METRIC.Net)).toBe('净收益');
    expect(diceMetricLabel(DICE_BOARD_METRIC.WinRate)).toBe('胜率');
  });

  it('未知档位不显示成空白徽标', () => {
    expect(sideLabel(0)).not.toBe('');
    expect(sideLabel(99)).toBe('未投');
  });
});
