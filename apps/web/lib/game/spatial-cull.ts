'use client';

import type { Sprite } from 'pixi.js';

const DEFAULT_CHUNK_SIZE = 512;

function chunkKey(cx: number, cy: number): number {
  return (cx << 16) ^ (cy & 0xffff);
}

interface CullEntry {
  sprite: Sprite;
  x: number;
  y: number;
  padX: number;
  padY: number;
  stamp: number;
}

/**
 * 视口分块空间裁剪器：按 512px 分块索引静态精灵包围盒，帧循环内做到：
 * - 相机边界未变化时 O(1) 跳过整轮扫描；
 * - 相机平移时只检查视口覆盖的网格分块，并只翻转进/出视野的精灵 `renderable`。
 */
export class SpatialCuller {
  private readonly chunkSize: number;
  private readonly grid = new Map<number, CullEntry[]>();
  private readonly active: CullEntry[] = [];
  private readonly nextActive: CullEntry[] = [];
  private stamp = 0;
  private lastMinX = Number.NaN;
  private lastMinY = Number.NaN;
  private lastMaxX = Number.NaN;
  private lastMaxY = Number.NaN;

  constructor(chunkSize = DEFAULT_CHUNK_SIZE) {
    this.chunkSize = chunkSize;
  }

  add(sprite: Sprite, x: number, y: number, padX: number, padY: number): void {
    sprite.renderable = false;
    const entry: CullEntry = { sprite, x, y, padX, padY, stamp: 0 };
    const size = this.chunkSize;
    const fromX = Math.floor((x - padX) / size);
    const toX = Math.floor((x + padX) / size);
    const fromY = Math.floor((y - padY) / size);
    const toY = Math.floor(y / size);
    for (let cy = fromY; cy <= toY; cy += 1) {
      for (let cx = fromX; cx <= toX; cx += 1) {
        const key = chunkKey(cx, cy);
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(entry);
        else this.grid.set(key, [entry]);
      }
    }
  }

  cull(minX: number, minY: number, maxX: number, maxY: number): void {
    const qMinX = Math.floor(minX);
    const qMinY = Math.floor(minY);
    const qMaxX = Math.ceil(maxX);
    const qMaxY = Math.ceil(maxY);
    if (
      qMinX === this.lastMinX &&
      qMinY === this.lastMinY &&
      qMaxX === this.lastMaxX &&
      qMaxY === this.lastMaxY
    ) {
      return;
    }
    this.lastMinX = qMinX;
    this.lastMinY = qMinY;
    this.lastMaxX = qMaxX;
    this.lastMaxY = qMaxY;

    this.stamp += 1;
    if (this.stamp >= 0x7fffffff) {
      for (const bucket of this.grid.values()) {
        for (let i = 0; i < bucket.length; i += 1) bucket[i]!.stamp = 0;
      }
      this.stamp = 1;
    }
    const stamp = this.stamp;
    this.nextActive.length = 0;

    const size = this.chunkSize;
    const fromX = Math.floor(qMinX / size);
    const toX = Math.floor(qMaxX / size);
    const fromY = Math.floor(qMinY / size);
    const toY = Math.floor(qMaxY / size);

    for (let cy = fromY; cy <= toY; cy += 1) {
      for (let cx = fromX; cx <= toX; cx += 1) {
        const bucket = this.grid.get(chunkKey(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const entry = bucket[i]!;
          if (entry.stamp === stamp) continue;
          const visible =
            entry.x + entry.padX >= minX &&
            entry.x - entry.padX <= maxX &&
            entry.y >= minY &&
            entry.y - entry.padY <= maxY;
          if (!visible) continue;
          entry.stamp = stamp;
          entry.sprite.renderable = true;
          this.nextActive.push(entry);
        }
      }
    }

    for (let i = 0; i < this.active.length; i += 1) {
      const entry = this.active[i]!;
      if (entry.stamp !== stamp) entry.sprite.renderable = false;
    }

    this.active.length = 0;
    for (let i = 0; i < this.nextActive.length; i += 1) {
      this.active.push(this.nextActive[i]!);
    }
  }

  clear(): void {
    this.grid.clear();
    this.active.length = 0;
    this.nextActive.length = 0;
    this.lastMinX = Number.NaN;
    this.lastMinY = Number.NaN;
    this.lastMaxX = Number.NaN;
    this.lastMaxY = Number.NaN;
  }
}
