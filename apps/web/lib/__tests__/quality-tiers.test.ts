import { describe, expect, it } from 'bun:test';
import { createQualitySignal, QUALITY_SAMPLE_MS, stepQualitySignal } from '../game/runtime/quality-tiers';

/** 连续喂同一个 fps，返回最终档位 */
function feed(signal: ReturnType<typeof createQualitySignal>, fps: number, windows: number) {
  let tier = signal.tier;
  for (let i = 0; i < windows; i += 1) tier = stepQualitySignal(signal, fps, QUALITY_SAMPLE_MS);
  return tier;
}

describe('低帧自适应画质档', () => {
  it('起手是高档，满帧不动', () => {
    const signal = createQualitySignal();
    expect(signal.tier).toBe('high');
    expect(feed(signal, 60, 100)).toBe('high');
  });

  it('连续 3 个窗口低于 45 才降一档，两档降到底', () => {
    const signal = createQualitySignal();
    expect(feed(signal, 40, 2)).toBe('high');
    expect(feed(signal, 40, 1)).toBe('balanced');
    expect(feed(signal, 40, 2)).toBe('balanced');
    expect(feed(signal, 40, 1)).toBe('low');
    // 到底之后不再有下一档
    expect(feed(signal, 20, 50)).toBe('low');
  });

  it('一次低帧不算数：中间插回满帧就清零重计', () => {
    const signal = createQualitySignal();
    feed(signal, 40, 2);
    feed(signal, 60, 1);
    expect(feed(signal, 40, 2)).toBe('high');
    expect(feed(signal, 40, 1)).toBe('balanced');
  });

  it('45–55 是滞回区，既不降也不升', () => {
    const signal = createQualitySignal();
    expect(feed(signal, 50, 100)).toBe('high');
    signal.tier = 'low';
    expect(feed(signal, 50, 100)).toBe('low');
  });

  it('升档要连续 12 秒高于 55：low → balanced → high', () => {
    const signal = createQualitySignal();
    signal.tier = 'low';
    expect(feed(signal, 60, 23)).toBe('low');
    expect(feed(signal, 60, 1)).toBe('balanced');
    expect(feed(signal, 60, 23)).toBe('balanced');
    expect(feed(signal, 60, 1)).toBe('high');
    expect(feed(signal, 60, 100)).toBe('high');
  });

  it('恢复期掉一次就重新计满 12 秒', () => {
    const signal = createQualitySignal();
    signal.tier = 'low';
    feed(signal, 60, 20);
    feed(signal, 50, 1);
    expect(feed(signal, 60, 5)).toBe('low');
    expect(feed(signal, 60, 19)).toBe('balanced');
  });

  it('fps 为 0（还没测出来）不参与判定，避免启动瞬间误降档', () => {
    const signal = createQualitySignal();
    expect(feed(signal, 0, 50)).toBe('high');
    signal.tier = 'low';
    expect(feed(signal, 0, 50)).toBe('low');
  });
});
