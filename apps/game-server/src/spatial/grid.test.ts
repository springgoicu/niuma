import { describe, expect, it } from 'bun:test';
import { CELL_SIZE } from '@niuma/shared-types';
import { SpatialGrid } from './grid';

describe('SpatialGrid', () => {
  it('reports crossing only when the entity leaves its cell', () => {
    const grid = new SpatialGrid();
    grid.insert(1, 10, 10);
    expect(grid.update(1, 20, 20)).toBe(false);
    expect(grid.update(1, CELL_SIZE + 5, 10)).toBe(true);
    expect(grid.update(1, CELL_SIZE + 6, 12)).toBe(false);
  });

  it('keeps membership consistent after removal', () => {
    const grid = new SpatialGrid();
    grid.insert(1, 100, 100);
    grid.insert(2, 120, 120);
    expect(grid.size).toBe(2);
    grid.remove(1);
    const found = new Set<number>();
    grid.queryNear(110, 110, 64, found);
    expect(found.has(1)).toBe(false);
    expect(found.has(2)).toBe(true);
    expect(grid.size).toBe(1);
  });

  it('queries exactly the cells touched by the radius', () => {
    const grid = new SpatialGrid();
    grid.insert(1, 512 * 3 + 1, 512 * 3 + 1);
    grid.insert(2, 512 * 12, 512 * 12);
    const near = new Set<number>();
    grid.queryNear(512 * 3, 512 * 3, 100, near);
    expect(near.has(1)).toBe(true);
    expect(near.has(2)).toBe(false);
  });

  it('handles negative coordinates by clamping into the first cell', () => {
    const grid = new SpatialGrid();
    grid.insert(7, -200, -200);
    const near = new Set<number>();
    grid.queryNear(0, 0, 64, near);
    expect(near.has(7)).toBe(true);
  });
});
