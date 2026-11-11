import { describe, expect, it } from 'bun:test';
import { EgressMeter, RingSampler } from './metrics';

describe('EgressMeter', () => {
  it('reports zero before any traffic', () => {
    expect(new EgressMeter().kbps(1_000)).toBe(0);
  });

  it('converts bytes inside the window into KB/s', () => {
    const meter = new EgressMeter(50, 24); // 1.15s 窗口
    for (let i = 0; i < 10; i += 1) meter.record(11_776, i * 50);
    expect(meter.kbps(500)).toBeCloseTo(100, 1);
  });

  it('drops buckets that fell out of the window instead of averaging forever', () => {
    const meter = new EgressMeter(50, 24);
    meter.record(1024 * 100, 0);
    expect(meter.kbps(0)).toBeGreaterThan(0);
    expect(meter.kbps(10_000)).toBe(0);
  });

  it('ignores empty and negative frames', () => {
    const meter = new EgressMeter(50, 24);
    meter.record(0, 0);
    meter.record(-64, 0);
    expect(meter.kbps(0)).toBe(0);
  });
});

/**
 * 分位数直接决定准入水位（GAME_TICK_BUDGET_MS = 25 的 0.85 处关闸），
 * 所以这里守的是「结果与排序后取下标完全一致」，而不是「大概差不多」。
 */
describe('RingSampler 分位数', () => {
  /**
   * 参考实现：老老实实排序，用来对照快速选择。
   * 采样器内部是 Float32Array，所以参考值也要先过 `Math.fround`——
   * 否则比的是单精度存储值与双精度字面量的差，测的就不是算法了。
   */
  function reference(values: number[], p: number): number {
    const sorted = values.map(Math.fround).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))]!;
  }

  it('与排序后取下标的结果一致', () => {
    const values: number[] = [];
    for (let i = 0; i < 500; i += 1) values.push((i * 37) % 113 / 10);
    const sampler = new RingSampler(600);
    for (const value of values) sampler.push(value);

    for (const p of [0, 0.5, 0.85, 0.95, 1]) {
      expect(sampler.percentile(p)).toBe(reference(values, p));
    }
  });

  it('大量重复值时仍给出正确分位数（三路划分的存在理由）', () => {
    const sampler = new RingSampler(600);
    for (let i = 0; i < 580; i += 1) sampler.push(0.1);
    for (let i = 0; i < 20; i += 1) sampler.push(158);
    const values = [...Array<number>(580).fill(0.1), ...Array<number>(20).fill(158)];

    expect(sampler.percentile(0.5)).toBe(reference(values, 0.5));
    expect(sampler.percentile(0.85)).toBe(reference(values, 0.85));
    expect(sampler.percentile(0.95)).toBe(reference(values, 0.95));
  });

  it('只统计窗口内已写入的样本，不把零值算进分位数', () => {
    const sampler = new RingSampler(600);
    sampler.push(9);
    sampler.push(7);
    sampler.push(5);
    expect(sampler.percentile(0)).toBe(5);
    expect(sampler.percentile(1)).toBe(9);
    expect(sampler.average()).toBeCloseTo(7, 6);
    expect(sampler.max()).toBe(9);
  });

  it('空窗口返回 0，不抛异常', () => {
    expect(new RingSampler(16).percentile(0.95)).toBe(0);
  });
});
