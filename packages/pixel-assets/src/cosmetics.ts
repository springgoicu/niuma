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

/**
 * 图标画布 16×16，但图本身只占中间一小块：16 格与角色同格，1:1 叠加不缩放，
 * 靠留白控制视觉尺寸——直接画满 16 格会盖住半个身子。
 */
const SIZE = 16;

const INK = 0x141a16;

class Icon {
  readonly data = new Uint8Array(SIZE * SIZE * 4);

  set(x: number, y: number, hex: number, alpha = 255): void {
    const tx = Math.round(x);
    const ty = Math.round(y);
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

  /** 1px 硬描边：配件要在任何身体色上都能读出来 */
  outline(x0: number, y0: number, x1: number, y1: number, hex = INK): void {
    this.rect(x0, y0, x1 - x0 + 1, 1, hex);
    this.rect(x0, y1, x1 - x0 + 1, 1, hex);
    this.rect(x0, y0, 1, y1 - y0 + 1, hex);
    this.rect(x1, y0, 1, y1 - y0 + 1, hex);
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

/**
 * 工牌：挂绳 + 7×8 卡面（色条、证件照、两行信息）。
 * 卡面再大就盖住半个胸口了——大头小身的比例下，配件的视觉重量必须收着。
 */
function drawBadge(id: string): Icon {
  const icon = new Icon();
  const accent = ACCENT[id] ?? 0x9fb0a1;
  icon.rect(7, 1, 2, 3, 0x2a3b33);
  icon.rect(6, 3, 4, 1, 0x2a3b33);

  icon.rect(4, 4, 7, 8, 0xe6ede6);
  icon.outline(4, 4, 10, 11);
  icon.rect(4, 4, 7, 2, accent);
  icon.rect(5, 5, 5, 1, 0xffffff);
  // 证件照 + 两行信息：这个尺寸下还读得出「工牌」的下限
  icon.rect(5, 7, 2, 2, 0x9fb0a1);
  icon.rect(8, 7, 2, 1, 0x66756a);
  icon.rect(8, 9, 2, 1, 0x66756a);
  icon.rect(5, 10, 5, 1, 0xb9c4b7);
  return icon;
}

function drawTie(id: string): Icon {
  const icon = new Icon();
  const color = TIE_COLOR[id] ?? 0xb8332f;

  if (id === 'bow') {
    icon.rect(3, 6, 4, 4, color);
    icon.rect(9, 6, 4, 4, color);
    icon.rect(4, 7, 2, 2, 0xffffff);
    icon.rect(10, 7, 2, 2, 0xffffff);
    icon.rect(7, 5, 2, 2, INK);
    icon.rect(7, 7, 2, 5, INK);
    icon.rect(6, 11, 4, 2, color);
    return icon;
  }

  icon.rect(7, 4, 2, 2, INK);
  // 板型：领结 → 收腰 → 下摆，宽度 2/3/4 逐段放开
  for (let y = 6; y <= 12; y += 1) {
    const width = y < 8 ? 2 : y < 10 ? 3 : 4;
    icon.rect(8 - Math.floor(width / 2), y, width, 1, color);
  }
  if (id === 'striped') {
    icon.rect(7, 8, 3, 1, 0x4a3b2e);
    icon.rect(7, 11, 3, 1, 0x4a3b2e);
  } else {
    // 一道高光，领带才不是一块扁色
    icon.rect(7, 7, 1, 5, 0xffffff);
  }
  return icon;
}

function drawMouth(id: string): Icon {
  const icon = new Icon();
  if (id === 'coffee') {
    icon.rect(4, 7, 5, 5, 0xf0ebdf);
    icon.outline(4, 7, 8, 11, 0x6b4a32);
    icon.rect(5, 8, 3, 1, 0x6b4a32);
    icon.rect(8, 8, 2, 2, 0xf0ebdf);
    icon.rect(9, 8, 1, 1, 0x6b4a32);
    icon.rect(6, 3, 1, 3, 0x9fb0a1);
    icon.rect(7, 2, 1, 4, 0x9fb0a1);
    return icon;
  }
  if (id === 'grass') {
    icon.rect(3, 12, 9, 1, 0x6fae3c);
    icon.rect(4, 9, 1, 3, 0xa8ff6b);
    icon.rect(6, 7, 1, 5, 0x7fbf4a);
    icon.rect(8, 9, 1, 3, 0x6fae3c);
    icon.rect(10, 8, 1, 4, 0x7fbf4a);
    return icon;
  }
  // 笔：斜着的一支，笔尖朝下，笔帽一截亮色
  icon.rect(4, 11, 3, 1, 0x4fe3c1);
  icon.rect(5, 10, 1, 1, 0x4fe3c1);
  icon.rect(6, 9, 5, 1, 0x2fb59a);
  icon.rect(10, 4, 3, 1, 0x2fb59a);
  icon.rect(12, 5, 1, 2, 0x2a3b33);
  return icon;
}

function drawBack(id: string): Icon {
  const icon = new Icon();
  if (id === 'laptop') {
    // 背包类可以画满一些：它本来就在身后，不抢脸
    icon.rect(1, 4, 13, 8, 0x232b26);
    icon.outline(1, 4, 13, 11);
    icon.rect(2, 5, 11, 6, 0x101713);
    icon.rect(3, 6, 6, 1, 0x4fe3c1);
    icon.rect(3, 8, 8, 1, 0x2fb59a);
    icon.rect(3, 9, 4, 1, 0x2fb59a);
    icon.rect(1, 12, 13, 2, 0x2f3a33);
    icon.rect(5, 12, 4, 1, 0x4fe3c1);
    return icon;
  }
  icon.rect(5, 2, 6, 1, 0x4a3b2e);
  icon.rect(5, 3, 1, 3, 0x4a3b2e);
  icon.rect(10, 3, 1, 3, 0x4a3b2e);
  icon.rect(2, 5, 11, 8, 0x6b4a32);
  icon.outline(2, 5, 12, 12, 0x3a2a1d);
  icon.rect(3, 6, 9, 1, 0x8a6244);
  icon.rect(3, 9, 9, 1, 0x4a3b2e);
  icon.rect(7, 8, 2, 3, 0xffc53d);
  return icon;
}

export function drawCosmetic(kind: CosmeticKind, id: string): Uint8Array {
  if (kind === 'badge') return drawBadge(id).data;
  if (kind === 'tie') return drawTie(id).data;
  if (kind === 'mouth') return drawMouth(id).data;
  return drawBack(id).data;
}

export const COSMETIC_SIZE = SIZE;
