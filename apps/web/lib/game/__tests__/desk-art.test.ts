import { describe, expect, it } from 'bun:test';
import { DIRECTION, type Direction } from '@niuma/shared-types';
import { DESK_ART_SIZE, deskArtFor, type DeskArt } from '../desk-art';

const FACINGS: Array<{ facing: Direction; name: string }> = [
  { facing: DIRECTION.Up, name: '人坐桌南、面朝北' },
  { facing: DIRECTION.Down, name: '人坐桌北、面朝南' },
  { facing: DIRECTION.Left, name: '人坐桌东、面朝西' },
  { facing: DIRECTION.Right, name: '人坐桌西、面朝东' },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 桌面陈设的实际占位（含描边与马克杯把手） */
function detailBoxes(art: DeskArt): Box[] {
  return [
    { x: art.details.plantCx - 8, y: 10, w: 16, h: 18 },
    { x: art.details.mugX, y: 19, w: 12, h: 9 },
    { x: art.details.noteX, y: 33, w: 9, h: 7 },
  ];
}

describe('工位桌贴图的四向几何', () => {
  it('四个朝向的显示器位置互不相同', () => {
    const seen = new Set(FACINGS.map(({ facing }) => JSON.stringify(deskArtFor(facing).monitor)));
    expect(seen.size).toBe(FACINGS.length);
  });

  it('屏幕永远朝向椅子：屏幕朝向 = 入座朝向的相反一侧', () => {
    // 人朝北 → 坐在桌南 → 屏幕朝南（朝镜头）；人朝南 → 屏幕朝北（背对镜头）；
    // 人朝西 → 坐在桌东 → 屏幕朝东；人朝东 → 坐在桌西 → 屏幕朝西
    expect(deskArtFor(DIRECTION.Up).screen).toBe('front');
    expect(deskArtFor(DIRECTION.Down).screen).toBe('back');
    expect(deskArtFor(DIRECTION.Left).screen).toBe('east');
    expect(deskArtFor(DIRECTION.Right).screen).toBe('west');
  });

  it('显示器贴在桌子背对椅子的那条边', () => {
    const up = deskArtFor(DIRECTION.Up).monitor;
    const down = deskArtFor(DIRECTION.Down).monitor;
    const left = deskArtFor(DIRECTION.Left).monitor;
    const right = deskArtFor(DIRECTION.Right).monitor;
    // 屏幕朝北 / 朝南：显示器在帧的远边 / 近边
    expect(up.y).toBeLessThanOrEqual(6);
    expect(down.y + down.h).toBeGreaterThanOrEqual(44);
    // 屏幕朝西 / 朝东：显示器在帧的东端 / 西端
    expect(left.x + left.w).toBeGreaterThanOrEqual(DESK_ART_SIZE.w - 12);
    expect(right.x).toBeLessThanOrEqual(12);
  });

  it('显示器不越出单帧画布', () => {
    for (const { facing } of FACINGS) {
      const m = deskArtFor(facing).monitor;
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.x + m.w).toBeLessThanOrEqual(DESK_ART_SIZE.w);
      expect(m.y + m.h).toBeLessThanOrEqual(DESK_ART_SIZE.h);
    }
  });

  it('桌面陈设（绿植 / 马克杯 / 便签）不压在显示器上', () => {
    for (const { facing, name } of FACINGS) {
      const art = deskArtFor(facing);
      for (const box of detailBoxes(art)) {
        expect({ facing: name, blocked: overlaps(box, art.monitor) }).toEqual({ facing: name, blocked: false });
      }
    }
  });
});
