import { describe, expect, it } from 'vitest';
import {
  WORLD_HOTSPOTS,
  hotspotById,
  hotspotRequiresSeat,
  seatMatchesHotspot,
  workDeskIndexOfSeat,
} from '../index';

describe('入座判定（ADR-0093）', () => {
  it('工位热区按 deskIndex 比对，坐错工位不算', () => {
    const desk = WORLD_HOTSPOTS.find((def) => def.kind === 'workDesk')!;
    const seatId = desk.deskIndex! + 1;
    expect(workDeskIndexOfSeat(seatId)).toBe(desk.deskIndex);
    expect(seatMatchesHotspot(desk, seatId)).toBe(true);
    expect(seatMatchesHotspot(desk, seatId + 1)).toBe(false);
    expect(seatMatchesHotspot(desk, 0)).toBe(false);
  });

  it('没坐下 / 座位 id 不合法一律判未入座', () => {
    const desk = WORLD_HOTSPOTS.find((def) => def.kind === 'workDesk')!;
    expect(hotspotRequiresSeat(desk)).toBe(true);
    for (const seatId of [0, -1, Number.NaN, 1.5, 99999]) {
      expect(seatMatchesHotspot(desk, seatId)).toBe(false);
    }
  });

  it('不带座位门槛的热区不参与入座玩法', () => {
    const board = hotspotById('bulletin')!;
    expect(hotspotRequiresSeat(board)).toBe(false);
    expect(seatMatchesHotspot(board, 0)).toBe(true);
  });
});
