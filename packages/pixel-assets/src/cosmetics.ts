/**
 * 配件是独立小图：不带 tint、固定配色，按方向锚点叠加在角色容器上。
 * 目录顺序必须与 packages/shared-types/src/catalog.ts 保持一致。
 */
export const COSMETIC_CATALOG = {
  badge: ['intern', 'dev', 'pm', 'ops', 'boss'],
  tie: ['crimson', 'navy', 'striped', 'bow'],
  mouth: ['coffee', 'grass', 'pen'],
  back: ['laptop', 'briefcase'],
} as const;

export type CosmeticKind = keyof typeof COSMETIC_CATALOG;

/** 图标成品边长：按 1:1 叠到 48×48 角色上，不缩放，所以每个像素都是硬像素 */
const SIZE = 12;
/** 绘制坐标系沿用 16 格，构图不用重画，输出时按 0.75 落到 12 格 */
const SOURCE = 16;
const K = SIZE / SOURCE;

class Icon {
  readonly data = new Uint8Array(SIZE * SIZE * 4);

  set(x: number, y: number, hex: number, alpha = 255): void {
    // 16→12 的整数取整映射：构图位置不变，但落笔永远是整像素，不会出现半像素
    const tx = Math.floor(x * K);
    const ty = Math.floor(y * K);
    if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE) return;
    const i = (ty * SIZE + tx) * 4;
    this.data[i] = (hex >> 16) & 0xff;
    this.data[i + 1] = (hex >> 8) & 0xff;
    this.data[i + 2] = hex & 0xff;
    this.data[i + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, hex: number): void {
    for (let iy = 0; iy < h; iy += 1) {
      for (let ix = 0; ix < w; ix += 1) {
        this.set(x + ix, y + iy, hex);
      }
    }
  }
}

const ACCENT: Record<string, number> = {
  intern: 0xffc53d,
  dev: 0x4fe3c1,
  pm: 0xff6b3d,
  ops: 0xa8ff6b,
  boss: 0xff3d5a,
};

const TIE_COLOR: Record<string, number> = {
  crimson: 0xb8332f,
  navy: 0x2c4a7c,
  striped: 0xcfd8d0,
  bow: 0x8a3f6b,
};

function drawBadge(id: string): Icon {
  const icon = new Icon();
  icon.rect(7, 0, 2, 4, 0x2a3b33);
  icon.rect(4, 3, 8, 10, 0xe6ede6);
  icon.rect(4, 3, 8, 3, ACCENT[id] ?? 0x9fb0a1);
  icon.rect(6, 8, 4, 1, 0x66756a);
  icon.rect(6, 10, 5, 1, 0x66756a);
  icon.rect(4, 12, 8, 1, 0xb9c4b7);
  return icon;
}

function drawTie(id: string): Icon {
  const icon = new Icon();
  const color = TIE_COLOR[id] ?? 0xb8332f;
  if (id === 'bow') {
    icon.rect(3, 5, 4, 3, color);
    icon.rect(9, 5, 4, 3, color);
    icon.rect(7, 4, 2, 5, 0x2a2622);
    icon.rect(7, 9, 2, 2, 0x2a2622);
    return icon;
  }
  icon.rect(7, 2, 2, 2, 0x2a2622);
  for (let y = 4; y < 13; y += 1) {
    const width = y < 7 ? 2 : y < 11 ? 4 : 2;
    icon.rect(8 - Math.floor(width / 2), y, width, 1, color);
  }
  if (id === 'striped') {
    icon.rect(6, 6, 4, 1, 0x4a3b2e);
    icon.rect(6, 9, 4, 1, 0x4a3b2e);
  }
  return icon;
}

function drawMouth(id: string): Icon {
  const icon = new Icon();
  if (id === 'coffee') {
    icon.rect(4, 8, 6, 5, 0xf0ebdf);
    icon.rect(5, 9, 4, 1, 0x6b4a32);
    icon.rect(10, 9, 2, 3, 0xf0ebdf);
    icon.rect(6, 5, 1, 2, 0x9fb0a1);
    icon.rect(8, 4, 1, 3, 0x9fb0a1);
    return icon;
  }
  if (id === 'grass') {
    icon.rect(3, 10, 9, 1, 0x6fae3c);
    icon.rect(5, 8, 1, 4, 0xa8ff6b);
    icon.rect(7, 7, 1, 5, 0x7fbf4a);
    icon.rect(9, 9, 1, 3, 0x6fae3c);
    return icon;
  }
  icon.rect(4, 11, 8, 1, 0x4fe3c1);
  icon.rect(11, 10, 1, 3, 0x2fb59a);
  icon.rect(3, 12, 8, 1, 0x2a3b33);
  return icon;
}

function drawBack(id: string): Icon {
  const icon = new Icon();
  if (id === 'laptop') {
    icon.rect(7, 2, 2, 4, 0x2a3b33);
    icon.rect(3, 5, 10, 8, 0x232b26);
    icon.rect(3, 5, 10, 2, 0x141a16);
    icon.rect(3, 12, 10, 1, 0x0b0f0d);
    icon.rect(8, 8, 2, 2, 0x4fe3c1);
    return icon;
  }
  icon.rect(6, 3, 4, 1, 0x4a3b2e);
  icon.rect(6, 4, 1, 2, 0x4a3b2e);
  icon.rect(9, 4, 1, 2, 0x4a3b2e);
  icon.rect(3, 6, 10, 7, 0x6b4a32);
  icon.rect(3, 6, 10, 1, 0x8a6244);
  icon.rect(7, 8, 2, 2, 0xffc53d);
  return icon;
}

export function drawCosmetic(kind: CosmeticKind, id: string): Uint8Array {
  if (kind === 'badge') return drawBadge(id).data;
  if (kind === 'tie') return drawTie(id).data;
  if (kind === 'mouth') return drawMouth(id).data;
  return drawBack(id).data;
}

export const COSMETIC_SIZE = SIZE;
