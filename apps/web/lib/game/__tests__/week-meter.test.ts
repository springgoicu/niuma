import { describe, expect, it } from 'bun:test';
import { WEEK_METER_BASELINE_HOURS, weekMeterState } from '../week-meter';

describe('week meter', () => {
  it('treats an unreported career as an empty track, not zero hours', () => {
    const state = weekMeterState(0, false);
    expect(state).toEqual({ percent: 0, tone: 'empty', overHours: 0, hours: 0 });
  });

  it('maps normal hours onto the 40h baseline', () => {
    expect(weekMeterState(0, true)).toMatchObject({ percent: 0, tone: 'normal', overHours: 0 });
    expect(weekMeterState(20, true)).toMatchObject({ percent: 50, tone: 'normal', overHours: 0 });
    expect(weekMeterState(WEEK_METER_BASELINE_HOURS, true)).toMatchObject({
      percent: 100,
      tone: 'normal',
      overHours: 0,
    });
  });

  it('clamps the bar at 100% and reports the overtime amount', () => {
    const state = weekMeterState(52.5, true);
    expect(state.percent).toBe(100);
    expect(state.tone).toBe('over');
    expect(state.overHours).toBe(12.5);
    expect(state.hours).toBe(52.5);
  });

  it('floors negative and non-finite values instead of drawing a broken bar', () => {
    expect(weekMeterState(-8, true)).toMatchObject({ percent: 0, hours: 0, tone: 'normal' });
    expect(weekMeterState(Number.NaN, true)).toMatchObject({ percent: 0, hours: 0 });
    expect(weekMeterState(Number.POSITIVE_INFINITY, true)).toMatchObject({ percent: 0, hours: 0 });
  });

  it('keeps one decimal of precision for the bar width', () => {
    expect(weekMeterState(12.5, true).percent).toBe(31.3);
  });
});
