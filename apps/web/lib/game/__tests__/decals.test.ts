import { describe, expect, it } from 'bun:test';
import { DECAL_CELL, DECAL_CHANCE, DECAL_KINDS, hashCell, scatterDecals } from '../decals';

const BOUNDS = { x: 0, y: 0, w: 64 * 40, h: 64 * 40 };

describe('贴花撒点', () => {
  it('命中概率落在需求的 8%–15% 带内', () => {
    expect(DECAL_CHANCE).toBeGreaterThanOrEqual(0.08);
    expect(DECAL_CHANCE).toBeLessThanOrEqual(0.15);

    const placements = scatterDecals(BOUNDS, () => true, 0x6d2b79f5);
    const cells = (BOUNDS.w / DECAL_CELL) * (BOUNDS.h / DECAL_CELL);
    const rate = placements.length / cells;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.15);
  });

  it('位置哈希是纯函数：同一格永远同一个值，换格才换数', () => {
    for (let i = 0; i < 32; i += 1) {
      const a = hashCell(i * 7, i * 13, 0x1234);
      const b = hashCell(i * 7, i * 13, 0x1234);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    expect(hashCell(1, 1, 1)).not.toBe(hashCell(2, 1, 1));
  });

  it('同种子逐项一致：视口来回移动不会让三叶草换位置', () => {
    const a = scatterDecals(BOUNDS, () => true, 0xabc);
    const b = scatterDecals(BOUNDS, () => true, 0xabc);
    expect(a).toEqual(b);
  });

  it('换种子会换分布，但密度量级不变', () => {
    const a = scatterDecals(BOUNDS, () => true, 1);
    const b = scatterDecals(BOUNDS, () => true, 2);
    expect(a).not.toEqual(b);
    expect(Math.abs(a.length - b.length) / a.length).toBeLessThan(0.25);
  });

  it('被 allow 拒绝的位置一个都不生成（水面 / 土路）', () => {
    const walled = scatterDecals(BOUNDS, (x) => x < BOUNDS.w / 2, 0x55);
    expect(walled.length).toBeGreaterThan(0);
    for (const placement of walled) expect(placement.x).toBeLessThan(BOUNDS.w / 2);
  });

  it('种类索引落在图集帧数内，坐标是整纹素', () => {
    for (const placement of scatterDecals(BOUNDS, () => true, 0x77)) {
      expect(placement.kind).toBeGreaterThanOrEqual(0);
      expect(placement.kind).toBeLessThan(DECAL_KINDS.length);
      expect(Number.isInteger(placement.x)).toBe(true);
      expect(Number.isInteger(placement.y)).toBe(true);
    }
  });

  it('贴花不会排成方阵：抖动落在格内而不是格心', () => {
    const placements = scatterDecals(BOUNDS, () => true, 0x99);
    const onGrid = placements.filter(
      (placement) => placement.x % DECAL_CELL === 0 && placement.y % DECAL_CELL === 0,
    );
    expect(onGrid.length).toBe(0);
  });
});
