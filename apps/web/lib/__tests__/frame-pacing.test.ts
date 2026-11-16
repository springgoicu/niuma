import { describe, expect, it } from 'bun:test';
import { DEFAULT_TARGET_FPS, resolveTargetFps } from '../game/runtime/frame-pacing';

describe('帧节拍上限', () => {
  it('缺省按 60 帧推进：高刷屏不再双倍消耗', () => {
    expect(DEFAULT_TARGET_FPS).toBe(60);
    expect(resolveTargetFps('')).toBe(60);
    expect(resolveTargetFps('?park=main&zoom=2')).toBe(60);
    expect(resolveTargetFps('?light=0&season=winter')).toBe(60);
  });

  it('?fps=0 表示不设上限：与改造前完全等价，用于线上对照', () => {
    expect(resolveTargetFps('?fps=0')).toBe(0);
    expect(resolveTargetFps('?park=main&fps=0')).toBe(0);
  });

  it('1–240 的整数按原值生效', () => {
    expect(resolveTargetFps('?fps=30')).toBe(30);
    expect(resolveTargetFps('?fps=60')).toBe(60);
    expect(resolveTargetFps('?fps=120')).toBe(120);
    expect(resolveTargetFps('?fps=240')).toBe(240);
  });

  it('空串、负数、小数、超区间、非数字一律回落 60', () => {
    for (const bogus of ['?fps=', '?fps=%20', '?fps=-1', '?fps=59.5', '?fps=241', '?fps=abc', '?fps=60hz']) {
      expect(resolveTargetFps(bogus)).toBe(60);
    }
  });

  it('多参数并存时只认 fps，其它灰度开关不影响节拍', () => {
    expect(resolveTargetFps('?zoom=3&fps=30&light=0&lm=2&flat=1&bands=0')).toBe(30);
    expect(resolveTargetFps('?fps=30&fps=120')).toBe(30);
  });
});
