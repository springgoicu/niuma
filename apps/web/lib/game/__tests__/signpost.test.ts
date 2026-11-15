import { describe, expect, it } from 'bun:test';
import { NAV_TARGETS, WELCOME_LANDMARKS } from '@niuma/shared-types';
import { navReadings } from '../nav';
import { SIGN_PLATE_ROW, signPlateTop, signPlates } from '../signpost';

const DIRECTORY = WELCOME_LANDMARKS.directory;

describe('世界指路牌牌面（ADR-0078）', () => {
  it('牌面恰为园区级目标，名称与顺序来自 NAV_TARGETS', () => {
    const plates = signPlates(DIRECTORY.x, DIRECTORY.y, DIRECTORY.height);
    const grounds = NAV_TARGETS.filter((target) => target.area === 'grounds');
    expect(plates.map((plate) => plate.label)).toEqual(grounds.map((target) => target.name));
    // 删目标只会少一块牌，不会再出现「找不到就指向北」的静默兜底
    expect(plates).toHaveLength(grounds.length);
    expect(plates).toHaveLength(7);
  });

  it('箭头方位取真实读数，不写死', () => {
    const plates = signPlates(DIRECTORY.x, DIRECTORY.y, DIRECTORY.height);
    const readings = navReadings(DIRECTORY.x, DIRECTORY.y).filter(
      (reading) => reading.target.area === 'grounds',
    );
    expect(plates.map((plate) => plate.octant)).toEqual(readings.map((reading) => reading.octant));
  });

  it('行位置自上而下单调、等距，且不压标题牌与底牌', () => {
    const plates = signPlates(DIRECTORY.x, DIRECTORY.y, DIRECTORY.height);
    for (let i = 1; i < plates.length; i += 1) {
      expect(plates[i]!.top - plates[i - 1]!.top).toBe(SIGN_PLATE_ROW);
    }
    expect(plates[0]!.top).toBeGreaterThanOrEqual(16);
    expect(plates[plates.length - 1]!.top + SIGN_PLATE_ROW).toBeLessThanOrEqual(DIRECTORY.height - 10);
  });

  it('超过画布容量时退回顶对齐，不把已有的牌挤到看不清', () => {
    // 120 高放得下 6 块；8 块（假想目标继续增加）才走顶对齐兜底
    expect(signPlateTop(0, 6, DIRECTORY.height)).toBeGreaterThanOrEqual(16);
    expect(signPlateTop(0, 8, DIRECTORY.height)).toBe(16);
    expect(signPlateTop(7, 8, DIRECTORY.height)).toBe(16 + 7 * SIGN_PLATE_ROW);
    // 负数下标收敛到第一块
    expect(signPlateTop(-1, 3, DIRECTORY.height)).toBe(signPlateTop(0, 3, DIRECTORY.height));
  });
});
