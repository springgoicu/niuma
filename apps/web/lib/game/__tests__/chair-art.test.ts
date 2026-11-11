import { describe, expect, it } from 'bun:test';
import { DIRECTION, type Direction } from '@niuma/shared-types';
import { chairArtFor, type ChairArt } from '../chair-art';

const FACINGS: Array<{ facing: Direction; name: string }> = [
  { facing: DIRECTION.Up, name: '人朝北：靠背在南' },
  { facing: DIRECTION.Down, name: '人朝南：靠背在北' },
  { facing: DIRECTION.Left, name: '人朝西：靠背在东' },
  { facing: DIRECTION.Right, name: '人朝东：靠背在西' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function center(box: Box): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * 靠背中心相对座面中心的主方向：取位移更大的那条轴。
 * 侧视时靠背同时偏上（靠背比座面高），只看位移更大的轴才不会误判。
 */
function backDirection(art: ChairArt): { x: number; y: number } {
  const back = center(art.back);
  const seat = center(art.seat);
  const dx = back.x - seat.x;
  const dy = back.y - seat.y;
  return Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

function inside(box: Box, art: ChairArt): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= art.frame.w && box.y + box.h <= art.frame.h;
}

describe('工位椅四向几何', () => {
  it('四个朝向共用 26×30 的帧与同一锚点：椅子不会因为朝向改变尺寸', () => {
    for (const { facing } of FACINGS) {
      const { frame } = chairArtFor(facing);
      expect(frame).toEqual({ w: 26, h: 30 });
    }
  });

  it('靠背永远在入座朝向的反侧', () => {
    const expected: Record<Direction, { x: number; y: number }> = {
      [DIRECTION.Up]: { x: 0, y: 1 },
      [DIRECTION.Down]: { x: 0, y: -1 },
      [DIRECTION.Left]: { x: 1, y: 0 },
      [DIRECTION.Right]: { x: -1, y: 0 },
    };
    for (const { facing, name } of FACINGS) {
      expect({ facing: name, back: backDirection(chairArtFor(facing)) }).toEqual({
        facing: name,
        back: expected[facing],
      });
    }
  });

  it('座面在靠背的人那一侧：靠背不压住坐垫', () => {
    for (const { facing, name } of FACINGS) {
      const art = chairArtFor(facing);
      const dir = backDirection(art);
      const back = center(art.back);
      const seat = center(art.seat);
      const seatTowardPerson =
        dir.x !== 0 ? Math.sign(seat.x - back.x) === -dir.x : Math.sign(seat.y - back.y) === -dir.y;
      expect({ facing: name, seatTowardPerson }).toEqual({ facing: name, seatTowardPerson: true });
    }
  });

  it('所有盒子都在帧内，且靠背与座面相接', () => {
    for (const { facing } of FACINGS) {
      const art = chairArtFor(facing);
      for (const box of [art.seat, art.back, art.highlight, art.base]) expect(inside(box, art)).toBe(true);
      // 靠背与座面至少贴边：不能悬空成两件家具
      const overlaps =
        art.back.x < art.seat.x + art.seat.w &&
        art.back.x + art.back.w > art.seat.x &&
        art.back.y < art.seat.y + art.seat.h &&
        art.back.y + art.back.h > art.seat.y;
      expect(overlaps).toBe(true);
    }
  });
});
