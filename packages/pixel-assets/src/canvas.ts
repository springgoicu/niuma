import { S, SLOT_TABLE, type LayerName, type Slot } from './palette';

/** 索引位图：每个像素存一个 slot，绘制期不做颜色混合，导出期才拆层 */
export class Px {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w = 48, h = 48) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
  }

  set(x: number, y: number, slot: Slot): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    this.data[iy * this.w + ix] = slot;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x]!;
  }

  rect(x: number, y: number, w: number, h: number, slot: Slot): void {
    for (let iy = 0; iy < h; iy += 1) {
      for (let ix = 0; ix < w; ix += 1) {
        this.set(x + ix, y + iy, slot);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, slot: Slot): void {
    if (rx <= 0 || ry <= 0) return;
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    const minX = Math.floor(cx - rx);
    const maxX = Math.ceil(cx + rx);
    const minY = Math.floor(cy - ry);
    const maxY = Math.ceil(cy + ry);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) this.set(x, y, slot);
      }
    }
  }

  /** 只在主体轮廓内落笔，用于斑纹；mask 预先算好一次 */
  ellipseMasked(cx: number, cy: number, rx: number, ry: number, slot: Slot, mask: Uint8Array): void {
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if (!mask[y * this.w + x]) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) this.set(x, y, slot);
      }
    }
  }

  maskOf(layers: LayerName[]): Uint8Array {
    const mask = new Uint8Array(this.data.length);
    for (let i = 0; i < this.data.length; i += 1) {
      const info = SLOT_TABLE[this.data[i]!];
      if (info && layers.includes(info.layer)) mask[i] = 1;
    }
    return mask;
  }

  /** 轮廓：对透明像素做 4 邻域膨胀，一次性快照避免连锁扩散 */
  outline(slot: Slot = S.Outline): void {
    const snapshot = this.data.slice();
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        if (snapshot[y * this.w + x] !== 0) continue;
        const left = x > 0 && snapshot[y * this.w + x - 1] !== 0;
        const right = x < this.w - 1 && snapshot[y * this.w + x + 1] !== 0;
        const up = y > 0 && snapshot[(y - 1) * this.w + x] !== 0;
        const down = y < this.h - 1 && snapshot[(y + 1) * this.w + x] !== 0;
        if (left || right || up || down) this.set(x, y, slot);
      }
    }
  }

  /**
   * 补齐描边的对角针孔：两像素沿对角线相接、四面全空的那个格子填实。
   * 不补的话轮廓在 45° 处会出现断点，放大后像毛边。
   */
  closeDiagonalGaps(slot: Slot = S.Outline): void {
    const snapshot = this.data.slice();
    const filled = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      return snapshot[y * this.w + x] !== 0;
    };
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        if (snapshot[y * this.w + x] !== 0) continue;
        if (filled(x, y - 1) || filled(x, y + 1) || filled(x - 1, y) || filled(x + 1, y)) continue;
        const diagonal = (filled(x - 1, y - 1) && filled(x + 1, y + 1)) || (filled(x + 1, y - 1) && filled(x - 1, y + 1));
        if (diagonal) this.set(x, y, slot);
      }
    }
  }

  /** 每列最低的若干主体像素压暗，制造底边体积感 */
  bottomShade(slot: Slot = S.BodyShade, thickness = 2): void {
    for (let x = 0; x < this.w; x += 1) {
      let painted = 0;
      for (let y = this.h - 1; y >= 0 && painted < thickness; y -= 1) {
        const current = this.data[y * this.w + x]!;
        if (current === S.Body || current === S.BodyShade) {
          this.set(x, y, slot);
          painted += 1;
        }
      }
    }
  }

  flipX(): Px {
    const out = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        out.data[y * this.w + (this.w - 1 - x)] = this.data[y * this.w + x]!;
      }
    }
    return out;
  }

  blit(src: Px): void {
    this.data.set(src.data);
  }
}

/** 确定性伪随机，保证每次生成的美术完全一致 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
