import { describe, expect, it } from 'bun:test';
import { LIMIT_KIND } from '@niuma/shared-types';
import { AdmissionGovernor, type GovernorConfig } from './governor';
import type { LoadWatermark } from './watermark';

const config: GovernorConfig = {
  maxOnline: 60,
  minCapacity: 10,
  highWatermark: 0.85,
  lowWatermark: 0.65,
  capacityStep: 2,
  shrinkRatio: 0.75,
  stableMs: 30_000,
  shrinkIntervalMs: 10_000,
  breakerFactor: 2,
  breakerStrikes: 3,
};

function mark(bandwidth: number, players = 0, tick = 0): LoadWatermark {
  return {
    utilization: Math.max(bandwidth, players, tick),
    dominant: LIMIT_KIND.Bandwidth,
    ratios: { bandwidth, players, tick },
  };
}

describe('AdmissionGovernor', () => {
  it('closes above the high watermark and only reopens below the low one', () => {
    const governor = new AdmissionGovernor(config);
    expect(governor.open).toBe(true);

    expect(governor.update(mark(0.9), 0)?.kind).toBe('closed');
    expect(governor.open).toBe(false);

    // 水位回落到滞回区间内：闸门必须保持关闭，否则排队屏会闪烁
    expect(governor.update(mark(0.8), 500)).toBeNull();
    expect(governor.open).toBe(false);

    expect(governor.update(mark(0.6), 1000)?.kind).toBe('opened');
    expect(governor.open).toBe(true);
  });

  it('does not flap when the watermark oscillates around the threshold', () => {
    const governor = new AdmissionGovernor(config);
    governor.update(mark(0.9), 0);
    for (let i = 1; i <= 20; i += 1) {
      const event = governor.update(mark(i % 2 === 0 ? 0.84 : 0.86), i * 500);
      expect(event).toBeNull();
      expect(governor.open).toBe(false);
    }
  });

  it('grows capacity only after a long stable window, capped at maxOnline', () => {
    const governor = new AdmissionGovernor(config);
    governor.update(mark(0.3), 0);
    expect(governor.update(mark(0.3), 29_000)).toBeNull();
    expect(governor.limit).toBe(60);

    // 已经在上限：稳定期再长也不该越界
    const capped = new AdmissionGovernor({ ...config, maxOnline: 20 });
    capped.update(mark(0.3), 0);
    expect(capped.update(mark(0.3), 31_000)).toBeNull();
    expect(capped.limit).toBe(20);
  });

  it('shrinks on overload, but honors the shrink interval and the floor', () => {
    const governor = new AdmissionGovernor(config);
    governor.update(mark(0.3), 0);

    expect(governor.update(mark(1.2), 1_000)?.kind).toBe('shrunk');
    expect(governor.limit).toBe(45);

    // 间隔内再次越界不重复收缩
    expect(governor.update(mark(1.2), 5_000)).toBeNull();
    expect(governor.limit).toBe(45);

    // 跨过间隔后继续收缩，但不低于下限
    let now = 11_000;
    for (let i = 0; i < 10; i += 1) {
      governor.update(mark(1.2), now);
      now += 10_000;
    }
    expect(governor.limit).toBe(10);
    expect(governor.open).toBe(false);
  });

  it('never lets the floor push capacity above maxOnline', () => {
    const small = new AdmissionGovernor({ ...config, maxOnline: 5, minCapacity: 10 });
    small.update(mark(0.3), 0);
    small.update(mark(1.4), 1_000);
    expect(small.limit).toBe(5);

    small.update(mark(1.4), 20_000);
    expect(small.limit).toBeLessThanOrEqual(5);
  });

  it('trips the breaker after three consecutive tick spikes', () => {
    const governor = new AdmissionGovernor(config);
    governor.update(mark(0.3), 0);

    expect(governor.update(mark(0.3, 0, 2.1), 500)?.kind).toBe('closed');
    expect(governor.update(mark(0.3, 0, 2.1), 1_000)).toBeNull();
    const trip = governor.update(mark(0.3, 0, 2.1), 11_000);
    expect(trip?.kind).toBe('tripped');
    expect(governor.open).toBe(false);
    expect(governor.breakerTripped).toBe(true);
    expect(governor.limit).toBe(45);

    // 尖刺消失后熔断解除；容量已经削到 45，低水位重开不会立刻再次过载
    governor.update(mark(0.3, 0, 0.5), 12_000);
    expect(governor.breakerTripped).toBe(false);
    expect(governor.limit).toBe(45);
    expect(governor.open).toBe(true);
  });
});
