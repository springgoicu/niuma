import { S, SLOT_TABLE, type LayerName, type Slot } from './palette';
import { FRAME_SIZE } from './layout';

/** 一个点：[x, y]，允许小数，落笔时按像素中心判定 */
export type Point = readonly [number, number];

/**
 * 索引位图：每个像素存一个 slot，绘制期不做颜色混合，导出期才拆层。
 *
 * 画法纪律（这套美术「清不清楚」全靠它）：
 * 1) 只允许硬边，禁止抗锯齿 / 羽化 / 半透明；
 * 2) 每个形体最多两阶——本体 + 一档阴影，阴影靠整块偏移得到，不逐列扫描；
 * 3) 描边一律 1px 且闭合，对角针孔必须在导出前补掉。
 */
export class Px {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w = FRAME_SIZE, h = FRAME_SIZE) {
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

  /** 圆角矩形：cx/cy 是中心，w/h 是整宽整高。方块躯干（牛）与圆肩躯干（马）共用 */
  roundRect(cx: number, cy: number, w: number, h: number, r: number, slot: Slot): void {
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    const x0 = Math.round(cx - W / 2);
    const y0 = Math.round(cy - H / 2);
    const rr = Math.min(r, W / 2, H / 2);
    for (let iy = 0; iy < H; iy += 1) {
      const dy = Math.min(iy + 0.5, H - iy - 0.5);
      let inset = 0;
      if (dy < rr) inset = Math.round(rr - Math.sqrt(Math.max(0, rr * rr - (rr - dy) * (rr - dy))));
      this.rect(x0 + inset, y0 + iy, W - inset * 2, 1, slot);
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

  /** 多边形按像素中心做奇偶扫描填充；颈、腿、角、尾都是靠它画硬边形状 */
  polygon(points: ReadonlyArray<Point>, slot: Slot): void {
    if (points.length < 3) return;
    const ys = points.map((point) => point[1]);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
    for (let y = minY; y <= maxY; y += 1) {
      const scan = y + 0.5;
      const hits: number[] = [];
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) {
          hits.push(a[0] + ((scan - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      hits.sort((p, q) => p - q);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const from = Math.ceil(hits[i]! - 0.5);
        const to = Math.floor(hits[i + 1]! - 0.5);
        for (let x = from; x <= to; x += 1) this.set(x, y, slot);
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
   * 描边归属改写：整帧只出一遍描边，但尾巴要独立染色（ADR-0011）。
   * 四邻接里只有目标图层的描边像素改成该图层自己的描边槽，尾巴的边就不会被主体色带跑；
   * 与躯干相接的那一圈仍留给主体。相邻的描边像素不参与判定，否则 1px 轮廓互相挡住自己。
   */
  retagOutline(from: Slot, layer: LayerName, to: Slot): void {
    const snapshot = this.data.slice();
    for (let y = 0; y < this.h; y += 1) {
      for (let x = 0; x < this.w; x += 1) {
        if (snapshot[y * this.w + x] !== from) continue;
        let touches = false;
        let other = false;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const slot = snapshot[ny * this.w + nx]!;
          if (slot === from) continue;
          const info = SLOT_TABLE[slot];
          if (!info) continue;
          if (info.layer === layer) touches = true;
          else other = true;
        }
        if (touches && !other) this.set(x, y, to);
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

/**
 * 两阶明暗的唯一入口：同一个形体先按 (dx,dy) 偏移画一档阴影，再用本体色盖回原位。
 * 结果是一圈 1px 硬暗边（右下），不产生逐列扫描的阶梯噪点。
 */
export function solid(
  px: Px,
  body: Slot,
  shade: Slot,
  draw: (slot: Slot, dx: number, dy: number) => void,
  dx = 1,
  dy = 1,
): void {
  draw(shade, dx, dy);
  draw(body, 0, 0);
}

/**
 * 锥形四边带：把「一条有粗细的线」表达成四边形，颈、腿、角、尾共用。
 * 宽度从 wa 线性收到 wb，用来画上粗下细的腿与上粗下细的颈。
 */
export function taper(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  wa: number,
  wb: number,
): Point[] {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 0.5;
  const ny = (dx / len) * 0.5;
  return [
    [ax + nx * wa, ay + ny * wa],
    [bx + nx * wb, by + ny * wb],
    [bx - nx * wb, by - ny * wb],
    [ax - nx * wa, ay - ny * wa],
  ];
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
