import { describe, expect, it } from 'vitest';
import { BEACON_PHASE_MS, beaconPhase } from '../police-beacon';

describe('保安警灯相位', () => {
  it('每 400ms 在红蓝之间交替', () => {
    expect(beaconPhase(0)).toBe(0);
    expect(beaconPhase(BEACON_PHASE_MS - 1)).toBe(0);
    expect(beaconPhase(BEACON_PHASE_MS)).toBe(1);
    expect(beaconPhase(BEACON_PHASE_MS * 2)).toBe(0);
    expect(beaconPhase(BEACON_PHASE_MS * 3)).toBe(1);
  });

  it('负数与非有限时间退回红灯，不产生 NaN', () => {
    expect(beaconPhase(-1)).toBe(0);
    expect(beaconPhase(Number.NaN)).toBe(0);
    expect(beaconPhase(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('相位是一个循环：两盏灯各亮一半时间', () => {
    let red = 0;
    for (let now = 0; now < BEACON_PHASE_MS * 100; now += 10) {
      if (beaconPhase(now) === 0) red += 1;
    }
    // 100 个 400ms 周期、每周期 40 个采样点，红灯正好占一半
    expect(red).toBe(2_000);
  });
});
