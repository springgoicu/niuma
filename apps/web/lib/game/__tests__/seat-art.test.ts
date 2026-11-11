import { describe, expect, it } from 'bun:test';
import { DIRECTION, type Direction, type SeatKind } from '@niuma/shared-types';
import { SEAT_TOP, chairArtFor } from '../chair-art';
import { SIT_HIP_Y, seatArtFor, seatLift } from '../seat-art';

const FACINGS: Array<{ facing: Direction; name: string }> = [
  { facing: DIRECTION.Up, name: '人坐桌南、面朝北' },
  { facing: DIRECTION.Down, name: '人坐桌北、面朝南' },
  { facing: DIRECTION.Left, name: '人坐桌东、面朝西' },
  { facing: DIRECTION.Right, name: '人坐桌西、面朝东' },
];

const NON_CHAIR: SeatKind[] = ['toilet', 'stool', 'sofa', 'bed'];

/** 26×30 帧、sink 6、座面顶在帧内 13 → 世界高度 = 6 - 30 + 13 */
const CHAIR_SINK_EXPECTED = 6 - 30 + SEAT_TOP;

describe('座位接触契约（ADR-0032）', () => {
  it('四向椅面顶面同高：同一把椅子转 90° 不改变座面高度', () => {
    const tops = FACINGS.map(({ facing }) => seatArtFor('chair', facing).contactY);
    expect(new Set(tops).size).toBe(1);
    expect(tops[0]).toBe(CHAIR_SINK_EXPECTED);
  });

  it('椅面顶 = 帧底向上 (帧高 - SEAT_TOP) 再叠加精灵下沉', () => {
    for (const { facing, name } of FACINGS) {
      const art = chairArtFor(facing);
      const seat = seatArtFor('chair', facing);
      expect({ facing: name, seatY: art.seat.y }).toEqual({ facing: name, seatY: SEAT_TOP });
      expect(seat.contactY).toBe(seat.sink - art.frame.h + SEAT_TOP);
    }
  });

  it('坐上去后的臀底正好落在座面顶：抬升量四向一致且为正', () => {
    const lifts = FACINGS.map(({ facing }) => seatLift('chair', facing));
    expect(new Set(lifts).size).toBe(1);
    for (const { facing, name } of FACINGS) {
      const seat = seatArtFor('chair', facing);
      const lift = seatLift('chair', facing);
      expect({ facing: name, liftedHip: SIT_HIP_Y - lift }).toEqual({
        facing: name,
        liftedHip: seat.contactY,
      });
      expect(lift).toBeGreaterThan(0);
    }
  });

  it('非椅子座位本轮不抬升：没有座面契约，抬升为 0', () => {
    for (const kind of NON_CHAIR) {
      for (const { facing } of FACINGS) {
        expect({ kind, contactY: seatArtFor(kind, facing).contactY }).toEqual({ kind, contactY: null });
        expect({ kind, lift: seatLift(kind, facing) }).toEqual({ kind, lift: 0 });
      }
    }
  });

  it('椅子帧与渲染层共用同一份尺寸，座面不越出帧', () => {
    for (const { facing, name } of FACINGS) {
      const art = chairArtFor(facing);
      const seat = seatArtFor('chair', facing);
      expect({ facing: name, frame: seat.frame }).toEqual({ facing: name, frame: art.frame });
      expect(art.seat.y + art.seat.h).toBeLessThanOrEqual(art.frame.h);
      expect(art.seat.y).toBeGreaterThanOrEqual(0);
    }
  });
});
