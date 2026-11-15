import { describe, expect, it } from 'bun:test';
import { DISTRICTS, WELCOME_LANDMARKS } from '@niuma/shared-types';
import { districtReadings } from '../nav';
import { SIGN_PLATE_ROW, signPlateTop, signPlates } from '../signpost';

const DIRECTORY = WELCOME_LANDMARKS.directory;

describe('世界指路牌牌面（ADR-0078 / ADR-0097）', () => {
  it('牌面恰为五座区门，名称与顺序来自 DISTRICTS', () => {
    const plates = signPlates(DIRECTORY.x, DIRECTORY.y, DIRECTORY.height);
    expect(plates.map((plate) => plate.label)).toEqual(DISTRICTS.map((district) => district.name));
    // 删一座区只会少一块牌，不会再出现「找不到就指向北」的静默兜底
    expect(plates).toHaveLength(DISTRICTS.length);
    expect(plates).toHaveLength(5);
  });

  it('箭头方位取真实读数，不写死', () => {
    const plates = signPlates(DIRECTORY.x, DIRECTORY.y, DIRECTORY.height);
    const readings = districtReadings(DIRECTORY.x, DIRECTORY.y);
    expect(plates.map((plate) => plate.octant)).toEqual(readings.map((reading) => reading.octant));
  });

  it('每块牌的书脊色等于对应区色，不另写一份配色', () => {
    const plates = signPlates(DIRECTORY.x, DIRECTORY.y, DIRECTORY.height);
    expect(plates.map((plate) => plate.color)).toEqual(DISTRICTS.map((district) => district.color));
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
    // 120 高放得下 6 块；8 块（假想区继续增加）才走顶对齐兜底
    expect(signPlateTop(0, 5, DIRECTORY.height)).toBeGreaterThanOrEqual(16);
    expect(signPlateTop(0, 8, DIRECTORY.height)).toBe(16);
    expect(signPlateTop(7, 8, DIRECTORY.height)).toBe(16 + 7 * SIGN_PLATE_ROW);
    // 负数下标收敛到第一块
    expect(signPlateTop(-1, 3, DIRECTORY.height)).toBe(signPlateTop(0, 3, DIRECTORY.height));
  });
});
