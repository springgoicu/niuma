import { describe, expect, it } from 'bun:test';
import { EgressMeter } from './metrics';

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
