import { describe, expect, it } from 'bun:test';
import { DIRECTION, chairOffset, deskFootprint, type Direction } from '@niuma/shared-types';
import { deskArtFor, type DeskArt } from '../desk-art';

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

const FACING_VECTOR: Record<Direction, { x: number; y: number }> = {
  [DIRECTION.Down]: { x: 0, y: 1 },
  [DIRECTION.Left]: { x: -1, y: 0 },
  [DIRECTION.Right]: { x: 1, y: 0 },
  [DIRECTION.Up]: { x: 0, y: -1 },
};

/**
 * 椅子锚点在贴图局部坐标里的位置：帧底 = 桌面占地的南边（精灵锚点），
 * 椅子在朝向的反侧、离桌心 `chairOffset`，因此落在帧外——正好用来判断「哪一面朝人」。
 */
function chairPoint(art: DeskArt, facing: Direction): { x: number; y: number } {
  const footprint = deskFootprint(facing);
  const dir = FACING_VECTOR[facing];
  const gap = chairOffset(facing);
  return {
    x: -dir.x * gap + art.frame.w / 2,
    y: -dir.y * gap - footprint.h / 2 + art.frame.h,
  };
}

/** 显示器屏幕面与机背的中点（屏幕面 = 朝向椅子的一面） */
function screenFaces(art: DeskArt): { screen: { x: number; y: number }; back: { x: number; y: number } } {
  const m = art.monitor;
  const mx = m.x + m.w / 2;
  const my = m.y + m.h / 2;
  switch (art.screen) {
    case 'front':
      return { screen: { x: mx, y: m.y + m.h }, back: { x: mx, y: m.y } };
    case 'back':
      return { screen: { x: mx, y: m.y }, back: { x: mx, y: m.y + m.h } };
    case 'east':
      return { screen: { x: m.x + m.w, y: my }, back: { x: m.x, y: my } };
    case 'west':
    default:
      return { screen: { x: m.x, y: my }, back: { x: m.x + m.w, y: my } };
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 桌面陈设的实际占位（含描边、马克杯把手与绿植叶片） */
function detailBoxes(art: DeskArt): Array<{ name: string; box: Box }> {
  const { plant, mug, note } = art.details;
  return [
    { name: 'plant', box: { x: plant.cx - 8, y: plant.bottom - 18, w: 16, h: 18 } },
    { name: 'mug', box: { x: mug.x, y: mug.y, w: 12, h: 9 } },
    { name: 'note', box: { x: note.x, y: note.y, w: 9, h: 7 } },
  ];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('工位桌贴图的四向几何', () => {
  it('横桌 96×66、侧放桌 48×92，帧尺寸随朝向转置', () => {
    for (const { facing } of FACINGS) {
      const { frame } = deskArtFor(facing);
      const side = facing === DIRECTION.Left || facing === DIRECTION.Right;
      expect(frame.w).toBe(side ? 48 : 96);
      expect(frame.h).toBe(side ? 92 : 66);
    }
  });

  it('四个朝向的显示器位置互不相同', () => {
    const seen = new Set(FACINGS.map(({ facing }) => JSON.stringify(deskArtFor(facing).monitor)));
    expect(seen.size).toBe(FACINGS.length);
  });

  it('屏幕永远朝向椅子：屏幕面比机背更靠近椅子', () => {
    for (const { facing, name } of FACINGS) {
      const art = deskArtFor(facing);
      const chair = chairPoint(art, facing);
      const { screen, back } = screenFaces(art);
      const screenDistance = distance(screen, chair);
      const backDistance = distance(back, chair);
      expect({ facing: name, ok: screenDistance < backDistance }).toEqual({ facing: name, ok: true });
    }
  });

  it('屏幕朝向 = 入座朝向的相反一侧', () => {
    // 人朝北 → 坐在桌南 → 屏幕朝南（朝镜头）；人朝南 → 屏幕朝北（背对镜头）；
    // 人朝西 → 坐在桌东 → 屏幕朝东；人朝东 → 坐在桌西 → 屏幕朝西
    expect(deskArtFor(DIRECTION.Up).screen).toBe('front');
    expect(deskArtFor(DIRECTION.Down).screen).toBe('back');
    expect(deskArtFor(DIRECTION.Left).screen).toBe('east');
    expect(deskArtFor(DIRECTION.Right).screen).toBe('west');
  });

  it('桌面与前挡板覆盖朝向占地：横向 88 宽、纵向 40 宽，帧底就是占地南边', () => {
    for (const { facing, name } of FACINGS) {
      const art = deskArtFor(facing);
      const { w, h } = deskFootprint(facing);
      expect({ facing: name, bodyWidth: art.top.w, footprintWidth: w }).toEqual({
        facing: name,
        bodyWidth: w,
        footprintWidth: w,
      });
      // 帧底 = 精灵锚点 = 桌脚占地的南边：桌子不会「陷进」地里或浮空
      expect(art.front.y + art.front.h).toBeLessThanOrEqual(art.frame.h);
      expect(art.top.x + art.top.w / 2).toBe(art.frame.w / 2);
      expect(art.front.x + art.front.w / 2).toBe(art.frame.w / 2);
      // 前挡板在桌面下方，桌腿在前挡板底部
      expect(art.front.y).toBeGreaterThanOrEqual(art.top.y + art.top.h - 1);
      for (const leg of art.legs) {
        expect(leg.y).toBeGreaterThanOrEqual(art.front.y);
        expect(leg.y + leg.h).toBeLessThanOrEqual(art.frame.h);
      }
      expect(h).toBeGreaterThan(0);
    }
  });

  it('显示器不越出单帧画布', () => {
    for (const { facing } of FACINGS) {
      const { monitor: m, frame } = deskArtFor(facing);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.x + m.w).toBeLessThanOrEqual(frame.w);
      expect(m.y + m.h).toBeLessThanOrEqual(frame.h);
    }
  });

  it('桌面陈设（绿植 / 马克杯 / 便签）不压在显示器上，也不越出桌面与帧', () => {
    for (const { facing, name } of FACINGS) {
      const art = deskArtFor(facing);
      for (const { name: detail, box } of detailBoxes(art)) {
        expect({ facing: name, detail, blocked: overlaps(box, art.monitor) }).toEqual({
          facing: name,
          detail,
          blocked: false,
        });
        expect(box.x).toBeGreaterThanOrEqual(art.top.x);
        expect(box.x + box.w).toBeLessThanOrEqual(art.top.x + art.top.w);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.h).toBeLessThanOrEqual(art.frame.h);
      }
    }
  });

  it('桌面陈设落在桌面上：绿植与马克杯不悬空', () => {
    for (const { facing, name } of FACINGS) {
      const { details, top } = deskArtFor(facing);
      for (const [label, y] of [
        ['plant', details.plant.bottom],
        ['mug', details.mug.y + 9],
        ['note', details.note.y + 7],
      ] as const) {
        expect({ facing: name, label, onDesk: y >= top.y && y <= top.y + top.h }).toEqual({
          facing: name,
          label,
          onDesk: true,
        });
      }
    }
  });
});
