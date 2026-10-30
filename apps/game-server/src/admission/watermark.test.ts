import { describe, expect, it } from 'bun:test';
import { LIMIT_KIND } from '@niuma/shared-types';
import { measureLoad, toPermille } from './watermark';

const limits = { maxEgressKbps: 320, maxOnline: 60, tickBudgetMs: 25 };

describe('measureLoad', () => {
  it('takes the maximum of the three ratios instead of summing them', () => {
    const mark = measureLoad({ egressKbps: 160, online: 30, tickP95Ms: 5 }, limits);
    expect(mark.ratios.bandwidth).toBeCloseTo(0.5, 5);
    expect(mark.ratios.players).toBeCloseTo(0.5, 5);
    expect(mark.ratios.tick).toBeCloseTo(0.2, 5);
    expect(mark.utilization).toBeCloseTo(0.5, 5);
  });

  it('names the dominant dimension and prefers bandwidth on ties', () => {
    expect(measureLoad({ egressKbps: 320, online: 60, tickP95Ms: 1 }, limits).dominant).toBe(LIMIT_KIND.Bandwidth);
    expect(measureLoad({ egressKbps: 10, online: 60, tickP95Ms: 1 }, limits).dominant).toBe(LIMIT_KIND.Players);
    expect(measureLoad({ egressKbps: 10, online: 1, tickP95Ms: 50 }, limits).dominant).toBe(LIMIT_KIND.Tick);
  });

  it('reports none while every dimension is healthy', () => {
    const mark = measureLoad({ egressKbps: 100, online: 20, tickP95Ms: 4 }, limits);
    expect(mark.utilization).toBeLessThan(1);
    expect(mark.dominant).toBe(LIMIT_KIND.None);
  });

  it('survives garbage samples without producing NaN watermarks', () => {
    const mark = measureLoad({ egressKbps: Number.NaN, online: -5, tickP95Ms: Number.POSITIVE_INFINITY }, limits);
    expect(mark.utilization).toBe(0);
    expect(toPermille(mark.utilization)).toBe(0);

    const degenerate = measureLoad({ egressKbps: 10, online: 10, tickP95Ms: 10 }, {
      maxEgressKbps: 0,
      maxOnline: 0,
      tickBudgetMs: 0,
    });
    expect(Number.isFinite(degenerate.utilization)).toBe(true);
  });

  it('clamps the permille gauge into 0..1000', () => {
    expect(toPermille(0.923)).toBe(923);
    expect(toPermille(42)).toBe(1000);
    expect(toPermille(-1)).toBe(0);
  });
});
