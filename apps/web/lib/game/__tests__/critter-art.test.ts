import { describe, expect, it } from 'bun:test';
import type { Graphics } from 'pixi.js';
import {
  BUTTERFLY_FRAMES,
  BUTTERFLY_VARIANTS,
  CRITTER_CELL,
  CRITTER_COLUMNS,
  CRITTER_ROWS,
  FISH_FRAMES,
  FISH_VARIANTS,
  GROUND_FRAMES,
  GROUND_VIEWS,
  butterflyCell,
  fishCell,
  groundCell,
  paintCritterSheet,
} from '../critter-art';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 记录型 Graphics：只关心「画在哪个像素上」。
 * 图集最怕的是某笔越界糊到隔壁帧——这种错在游戏里表现为「兔子脸上长猫耳朵」，
 * 肉眼极难定位，必须在构造期用坐标约束钉死。
 */
function record(): Rect[] {
  const rects: Rect[] = [];
  const stub = {
    rect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h });
      return { fill: () => undefined };
    },
  };
  paintCritterSheet(stub as unknown as Graphics);
  return rects;
}

describe('小动物图集绘制', () => {
  const rects = record();

  it('确实画了东西', () => {
    expect(rects.length).toBeGreaterThan(2000);
  });

  it('每一笔都完整落在 32px 的格子里，不会糊到相邻帧', () => {
    for (const rect of rects) {
      const left = Math.floor(rect.x / CRITTER_CELL);
      const right = Math.floor((rect.x + rect.w - 1) / CRITTER_CELL);
      const top = Math.floor(rect.y / CRITTER_CELL);
      const bottom = Math.floor((rect.y + rect.h - 1) / CRITTER_CELL);
      expect(left).toBe(right);
      expect(top).toBe(bottom);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  });

  it('每一笔都在画布范围内', () => {
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(CRITTER_COLUMNS * CRITTER_CELL);
      expect(rect.y + rect.h).toBeLessThanOrEqual(CRITTER_ROWS * CRITTER_CELL);
    }
  });

  it('全部地面帧与蝴蝶帧都被真的画过，没有空格子', () => {
    const touched = new Set<number>();
    for (const rect of rects) {
      const col = Math.floor(rect.x / CRITTER_CELL);
      const row = Math.floor(rect.y / CRITTER_CELL);
      touched.add(row * CRITTER_COLUMNS + col);
    }
    // 地面 108 + 蝴蝶 6 + 小鱼 6：图集 12×10 刚好画满（ADR-0045）
    const expected =
      3 * 3 * GROUND_VIEWS * GROUND_FRAMES +
      BUTTERFLY_VARIANTS * BUTTERFLY_FRAMES +
      FISH_VARIANTS * FISH_FRAMES;
    expect(touched.size).toBe(expected);
    expect(expected).toBe(CRITTER_COLUMNS * CRITTER_ROWS);
  });

  it('地面帧号与蝴蝶帧号不重叠且连续覆盖', () => {
    const used = new Set<number>();
    for (let species = 0; species < 3; species += 1) {
      for (let variant = 0; variant < 3; variant += 1) {
        for (let view = 0; view < GROUND_VIEWS; view += 1) {
          for (let frame = 0; frame < GROUND_FRAMES; frame += 1) {
            const cell = groundCell(species, variant, view, frame);
            expect(used.has(cell)).toBe(false);
            used.add(cell);
          }
        }
      }
    }
    for (let variant = 0; variant < BUTTERFLY_VARIANTS; variant += 1) {
      for (let frame = 0; frame < BUTTERFLY_FRAMES; frame += 1) {
        const cell = butterflyCell(variant, frame);
        expect(used.has(cell)).toBe(false);
        expect(cell).toBeGreaterThanOrEqual(used.size);
        used.add(cell);
      }
    }
    for (let variant = 0; variant < FISH_VARIANTS; variant += 1) {
      for (let frame = 0; frame < FISH_FRAMES; frame += 1) {
        const cell = fishCell(variant, frame);
        expect(used.has(cell)).toBe(false);
        expect(cell).toBeGreaterThanOrEqual(used.size);
        used.add(cell);
      }
    }
    expect(used.size).toBe(CRITTER_COLUMNS * CRITTER_ROWS);
  });
});
