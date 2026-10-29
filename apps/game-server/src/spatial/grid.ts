import { CELL_SIZE } from '@niuma/shared-types';

/**
 * 2D 空间哈希网格（AOI 的核心）。
 * 只回答「谁可能在我附近」，精确距离由调用方决定；
 * 跨格返回 true，让上层只在必要时重算视野订阅，避免每 Tick 全量遍历。
 */
export class SpatialGrid {
  private readonly cells = new Map<number, Set<number>>();
  private readonly cellOf = new Map<number, number>();

  constructor(private readonly cellSize: number = CELL_SIZE) {}

  private static cellIndex(value: number, cellSize: number): number {
    const cell = Math.floor(value / cellSize);
    return cell < 0 ? 0 : cell;
  }

  private keyAt(x: number, y: number): number {
    const cx = SpatialGrid.cellIndex(x, this.cellSize);
    const cy = SpatialGrid.cellIndex(y, this.cellSize);
    return cx * 1024 + cy;
  }

  insert(id: number, x: number, y: number): void {
    const key = this.keyAt(x, y);
    this.cellOf.set(id, key);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = new Set();
      this.cells.set(key, bucket);
    }
    bucket.add(id);
  }

  remove(id: number): void {
    const key = this.cellOf.get(id);
    if (key === undefined) return;
    this.cellOf.delete(id);
    const bucket = this.cells.get(key);
    if (!bucket) return;
    bucket.delete(id);
    if (bucket.size === 0) this.cells.delete(key);
  }

  /** @returns 是否发生了跨格（需要重算视野） */
  update(id: number, x: number, y: number): boolean {
    const key = this.keyAt(x, y);
    const previous = this.cellOf.get(id);
    if (previous === key) return false;
    if (previous === undefined) {
      this.insert(id, x, y);
      return true;
    }
    const oldBucket = this.cells.get(previous);
    oldBucket?.delete(id);
    if (oldBucket && oldBucket.size === 0) this.cells.delete(previous);

    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = new Set();
      this.cells.set(key, bucket);
    }
    bucket.add(id);
    this.cellOf.set(id, key);
    return true;
  }

  /** 收集半径覆盖到的格子内全部 id（超集，未做圆距过滤） */
  queryNear(x: number, y: number, radius: number, out: Set<number>): void {
    const minCx = SpatialGrid.cellIndex(x - radius, this.cellSize);
    const maxCx = SpatialGrid.cellIndex(x + radius, this.cellSize);
    const minCy = SpatialGrid.cellIndex(y - radius, this.cellSize);
    const maxCy = SpatialGrid.cellIndex(y + radius, this.cellSize);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        const bucket = this.cells.get(cx * 1024 + cy);
        if (!bucket) continue;
        for (const id of bucket) out.add(id);
      }
    }
  }

  get size(): number {
    return this.cellOf.size;
  }

  get bucketCount(): number {
    return this.cells.size;
  }
}
