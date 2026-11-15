import { describe, expect, it } from 'vitest';
import {
  DICE_HALL_SEAT_IDS,
  DICE_TABLES,
  RING_BENCH_SEAT_GROUP,
  WORLD_HOTSPOTS,
  hotspotById,
  hotspotRequiresSeat,
  seatById,
  seatInGroup,
  seatMatchesHotspot,
  workDeskIndexOfSeat,
} from '../index';

/** 某张桌上第 skip 个凳子：座位表里按 group 找，避免手写 id */
function diceStoolSeat(group: string, skip = 0): number {
  const stools = DICE_HALL_SEAT_IDS.filter((id) => seatById(id)?.group === group);
  expect(stools.length).toBeGreaterThan(skip);
  return stools[skip]!;
}

describe('入座判定（ADR-0093）', () => {
  it('坐在本桌凳子上才算入座', () => {
    for (const table of DICE_TABLES) {
      const hotspot = hotspotById(`dice-table-${table.id}`)!;
      expect(hotspotRequiresSeat(hotspot)).toBe(true);
      expect(seatMatchesHotspot(hotspot, diceStoolSeat(table.group))).toBe(true);
      const other = DICE_TABLES.find((item) => item.group !== table.group)!;
      expect(seatMatchesHotspot(hotspot, diceStoolSeat(other.group))).toBe(false);
    }
  });

  it('没坐下 / 座位 id 不合法一律判未入座', () => {
    const hotspot = hotspotById('dice-table-0')!;
    for (const seatId of [0, -1, Number.NaN, 1.5, 99999]) {
      expect(seatMatchesHotspot(hotspot, seatId)).toBe(false);
    }
  });

  it('观战长椅用同一套座位组常量', () => {
    const bench = WORLD_HOTSPOTS.find((def) => def.kind === 'arenaSeat')!;
    expect(bench.seatGroupId).toBe(RING_BENCH_SEAT_GROUP);
    expect(hotspotRequiresSeat(bench)).toBe(true);
    expect(seatInGroup(bench.seatGroupId === undefined ? 0 : 1, RING_BENCH_SEAT_GROUP)).toBe(false);
  });

  it('工位热区按 deskIndex 比对，坐错工位不算', () => {
    const desk = WORLD_HOTSPOTS.find((def) => def.kind === 'workDesk')!;
    const seatId = desk.deskIndex! + 1;
    expect(workDeskIndexOfSeat(seatId)).toBe(desk.deskIndex);
    expect(seatMatchesHotspot(desk, seatId)).toBe(true);
    expect(seatMatchesHotspot(desk, seatId + 1)).toBe(false);
    expect(seatMatchesHotspot(desk, 0)).toBe(false);
  });

  it('不带座位门槛的热区不参与入座玩法', () => {
    const board = hotspotById('bulletin')!;
    expect(hotspotRequiresSeat(board)).toBe(false);
    expect(seatMatchesHotspot(board, 0)).toBe(true);
  });

  it('seatInGroup 只认同组的座位', () => {
    const [a, b] = DICE_TABLES;
    const seatId = diceStoolSeat(a!.group);
    expect(seatInGroup(seatId, a!.group)).toBe(true);
    expect(seatInGroup(seatId, b!.group)).toBe(false);
    expect(seatInGroup(0, a!.group)).toBe(false);
  });
});
