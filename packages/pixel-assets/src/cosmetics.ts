/**
 * 配件是独立小图：不带 tint、固定配色，按方向锚点叠加在角色容器上。
 * 目录顺序必须与 packages/shared-types/src/catalog.ts 保持一致（不含 none）。
 *
 * ADR-0007：配件从胸口/嘴部迁到头顶、眼线、颈线。16×16 的图标仍按 1:1 叠加，
 * 但同一件配件要按朝向各出一张——帽子搬到头上以后，一张图没法同时表达
 * 帽檐朝前、朝侧、朝后；朝左的图由生成器镜像朝右的图。
 */
export const COSMETIC_CATALOG = {
  head: ['grad', 'cap', 'beret', 'helmet', 'top'],
  eyes: ['round', 'sun', 'monocle'],
  neck: ['scarf', 'collar', 'phones'],
  back: ['laptop', 'briefcase'],
} as const;

export type CosmeticKind = keyof typeof COSMETIC_CATALOG;

/** 作画朝向：down 正面 / side 侧面（朝右）/ up 背面 */
export type CosmeticDirection = 'down' | 'side' | 'up';

/**
 * 图标画布 16×16：与角色同格，1:1 叠加不缩放。
 * 同类配件共用同一套局部基准——帽檐压在同一条 y、镜片套在同一条眼线、
 * 颈饰压在同一条颈线——锚点只用类别偏移，不逐个 id 手调。
 */
const SIZE = 16;

const INK = 0x141a16;
const STEEL = 0xcfd8d0;
const WHITE = 0xf7faf5;
const NAVY = 0x2c4a7c;
const NAVY_LIGHT = 0x4a6a9c;
const NAVY_DARK = 0x1d3355;
const WINE = 0x8a3f6b;
const WINE_LIGHT = 0xb0608f;
const WINE_DARK = 0x6b2f52;
const BLACK = 0x232b26;
const BLACK_LIGHT = 0x3a423c;
const AMBER = 0xffc53d;
const AMBER_DARK = 0xd99a1f;
const RUST = 0xc94f3a;
const RUST_DARK = 0x8f3327;
const MINT = 0x4fe3c1;
/** 镜框必须同时压过奶白脸与深棕脸，还要和纯黑的眼珠分开：中灰是最稳的一档 */
const FRAME = 0x66756a;
const FRAME_LIGHT = 0x9fb0a1;

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

  /** 以图标竖直中线为轴的一对矩形：正/背面的对称件只写一半 */
  pair(x: number, y: number, w: number, h: number, hex: number): void {
    this.rect(x, y, w, h, hex);
    this.rect(SIZE - x - w, y, w, h, hex);
  }

  /** 以中线为轴、宽 halfWidth×2 的一横行 */
  band(y: number, halfWidth: number, hex: number): void {
    this.rect(SIZE / 2 - halfWidth, y, halfWidth * 2, 1, hex);
  }

  /** 1px 硬描边：配件要在任何身体色上都能读出来 */
  silhouette(): void {
    const snapshot = Uint8Array.from(this.data);
    const filled = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
      return snapshot[(y * SIZE + x) * 4 + 3]! > 0;
    };
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (filled(x, y)) continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          this.set(x, y, INK);
        }
      }
    }
  }
}

/**
 * 帽子的三类构图：正面看是「顶 + 前檐」，侧面看是「顶 + 向前伸的檐」，
 * 背面看没有檐，只留后箍与调节扣。所有帽檐都压在同一个基准高度（row 8 上沿）。
 */
function drawHeadwear(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (id === 'grad') {
    // 学士帽：平顶板 + 帽箍 + 流苏，平顶比头宽一圈，是这个尺度下最好读的帽型
    icon.band(5, 6, BLACK_LIGHT);
    icon.band(6, 6, BLACK);
    icon.band(7, 2, BLACK);
    icon.band(8, 2, BLACK);
    const tasselX = dir === 'side' ? 4 : 13;
    icon.rect(tasselX, 7, 1, 2, AMBER);
    icon.rect(tasselX - 1, 9, 2, 2, AMBER);
  } else if (id === 'cap') {
    if (dir === 'side') {
      // 侧面：檐朝前（右），所以整顶帽子偏后压
      icon.rect(6, 3, 6, 1, NAVY);
      icon.rect(4, 4, 8, 1, NAVY);
      icon.rect(5, 4, 3, 1, NAVY_LIGHT);
      icon.rect(4, 5, 8, 1, NAVY);
      icon.rect(3, 6, 9, 1, NAVY);
      icon.rect(5, 7, 10, 1, NAVY_LIGHT);
      icon.rect(8, 2, 2, 1, MINT);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：没有檐，后箍 + 调节扣
      icon.rect(5, 3, 6, 1, NAVY);
      icon.rect(4, 4, 8, 1, NAVY);
      icon.rect(4, 5, 8, 1, NAVY);
      icon.rect(3, 6, 10, 1, NAVY);
      icon.rect(3, 7, 10, 1, NAVY_DARK);
      icon.rect(7, 7, 2, 1, MINT);
      return finished(icon);
    }
    // 正面：顶 + 前檐
    icon.rect(6, 3, 4, 1, NAVY);
    icon.rect(5, 4, 2, 1, NAVY_LIGHT);
    icon.rect(4, 4, 8, 1, NAVY);
    icon.rect(4, 5, 8, 1, NAVY);
    icon.rect(3, 6, 10, 1, NAVY);
    icon.rect(2, 7, 12, 1, NAVY_LIGHT);
    icon.rect(7, 2, 2, 1, MINT);
  } else if (id === 'beret') {
    // 贝雷帽：往上歪的一坨 + 小揪，檐没有硬边，靠底部一档暗色收口
    if (dir === 'side') {
      icon.rect(3, 3, 1, 1, WINE);
      icon.rect(1, 4, 10, 1, WINE);
      icon.rect(1, 5, 11, 1, WINE);
      icon.rect(3, 5, 4, 1, WINE_LIGHT);
      icon.rect(2, 6, 10, 1, WINE);
      icon.rect(3, 7, 9, 1, WINE_DARK);
      return finished(icon);
    }
    icon.rect(8, 3, 2, 1, WINE);
    icon.rect(3, 4, 10, 1, WINE);
    icon.rect(2, 5, 12, 1, WINE);
    icon.rect(4, 5, 4, 1, WINE_LIGHT);
    icon.rect(2, 6, 12, 1, WINE);
    icon.rect(3, 7, 10, 1, WINE_DARK);
  } else if (id === 'helmet') {
    // 安全帽：顶脊 + 圆顶 + 一圈外翻檐，黄色在奶白与深棕身上都压得住
    if (dir === 'side') {
      icon.rect(7, 2, 3, 1, AMBER_DARK);
      icon.rect(5, 3, 7, 1, AMBER);
      icon.rect(4, 4, 9, 1, AMBER);
      icon.rect(5, 4, 3, 1, WHITE);
      icon.rect(3, 5, 11, 1, AMBER);
      icon.rect(2, 6, 13, 1, AMBER);
      icon.rect(3, 7, 13, 1, AMBER_DARK);
      return finished(icon);
    }
    icon.rect(7, 2, 2, 1, AMBER_DARK);
    icon.rect(5, 3, 6, 1, AMBER);
    icon.rect(4, 4, 8, 1, AMBER);
    icon.rect(5, 4, 3, 1, WHITE);
    icon.rect(3, 5, 10, 1, AMBER);
    icon.rect(2, 6, 12, 1, AMBER);
    // 背面只露出两侧檐口：帽檐在身后的宽度收一半
    icon.rect(dir === 'up' ? 3 : 1, 7, dir === 'up' ? 10 : 14, 1, AMBER_DARK);
  } else {
    // 礼帽：高筒 + 红帽带 + 宽檐；侧面的檐向前多伸一列
    icon.rect(6, 1, 4, 1, BLACK);
    icon.rect(5, 2, 6, 4, BLACK);
    icon.rect(5, 6, 6, 1, RUST_DARK);
    if (dir === 'side') icon.rect(2, 7, 13, 1, BLACK);
    else icon.rect(1, 7, 14, 1, BLACK);
  }

  return finished(icon);
}

function finished(icon: Icon): Icon {
  icon.silhouette();
  return icon;
}

/**
 * 眼镜要能透过镜片看见眼睛：自检一下就会发现眼珠是 2×3，所以镜框做成
 * 4×5 的空心圈，内圈正好 2×3，套在眼睛外沿而不是盖住它。
 */
function drawEyewear(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (dir === 'side') {
    // 侧面只看得到近侧那片，加一条镜腿
    if (id === 'sun') {
      icon.rect(6, 6, 4, 3, INK);
      icon.set(7, 6, STEEL);
      icon.rect(2, 7, 4, 1, INK);
      return icon;
    }
    icon.rect(7, 5, 2, 1, FRAME_LIGHT);
    icon.rect(6, 6, 1, 3, FRAME);
    icon.rect(9, 6, 1, 3, FRAME);
    icon.rect(7, 9, 2, 1, FRAME);
    icon.rect(2, 7, 4, 1, FRAME);
    if (id === 'monocle') {
      // 单眼镜的链子从镜框右下角垂下来
      icon.set(9, 10, AMBER);
      icon.set(9, 11, AMBER);
      icon.set(10, 12, AMBER);
    }
    return icon;
  }

  if (id === 'sun') {
    // 墨镜：不透明镜片盖住眼珠，左上角一道高光
    icon.pair(2, 7, 4, 3, INK);
    icon.set(3, 7, STEEL);
    icon.set(11, 7, STEEL);
    icon.rect(6, 8, 4, 1, INK);
    return icon;
  }

  // 圆框：留空的镜圈，内圈正好 2×3 露出眼珠；框用中灰，别和眼珠糊成一块黑
  const ring = (x0: number): void => {
    icon.rect(x0 + 1, 6, 2, 1, FRAME_LIGHT);
    icon.rect(x0, 7, 1, 3, FRAME);
    icon.rect(x0 + 3, 7, 1, 3, FRAME);
    icon.rect(x0 + 1, 10, 2, 1, FRAME);
  };

  if (id === 'monocle') {
    // 只戴右眼，左眼裸露；链子从右下垂到胸前
    ring(10);
    icon.set(13, 11, AMBER);
    icon.set(12, 12, AMBER);
    icon.set(11, 13, AMBER);
    return icon;
  }

  ring(2);
  ring(10);
  icon.rect(6, 8, 4, 1, FRAME);
  icon.set(1, 8, FRAME);
  icon.set(14, 8, FRAME);
  return icon;
}

function drawNeckwear(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (id === 'scarf') {
    if (dir === 'side') {
      // 侧面：围在喉下、垂一条在胸前
      icon.rect(5, 9, 6, 1, RUST);
      icon.rect(5, 10, 6, 1, RUST_DARK);
      icon.rect(5, 11, 3, 2, RUST);
      icon.rect(5, 13, 3, 1, RUST_DARK);
      return icon;
    }
    if (dir === 'up') {
      // 背面正好是打结处：结 + 两条尾巴
      icon.band(9, 5, RUST);
      icon.rect(6, 9, 4, 2, RUST_DARK);
      icon.rect(4, 11, 2, 2, RUST);
      icon.rect(10, 11, 2, 2, RUST);
      return icon;
    }
    icon.band(9, 6, RUST);
    icon.band(10, 5, RUST_DARK);
    icon.rect(4, 11, 3, 2, RUST);
    icon.rect(4, 13, 3, 1, RUST_DARK);
    return icon;
  }

  if (id === 'collar') {
    // 项圈只有 1px 高，皮革色在深棕马身上几乎看不见，改用藏青 + 金吊牌
    if (dir === 'side') {
      icon.rect(5, 9, 5, 1, NAVY);
      icon.rect(8, 10, 2, 2, AMBER);
      return icon;
    }
    icon.band(9, 5, NAVY);
    if (dir === 'up') {
      // 背面看到的是扣环
      icon.rect(7, 9, 2, 1, STEEL);
    } else {
      icon.rect(7, 10, 2, 2, AMBER);
    }
    return icon;
  }

  // 挂脖耳机：带子压在颈线，耳罩落在两侧
  if (dir === 'side') {
    icon.rect(3, 9, 7, 1, NAVY_DARK);
    icon.rect(9, 9, 2, 3, NAVY);
    icon.rect(2, 9, 2, 3, NAVY);
    icon.set(9, 10, MINT);
    return icon;
  }
  icon.band(9, 5, NAVY_DARK);
  icon.pair(1, 9, 2, 3, NAVY);
  if (dir === 'down') {
    icon.set(1, 10, MINT);
    icon.set(14, 10, MINT);
  }
  return icon;
}

function drawBack(id: string): Icon {
  const icon = new Icon();
  if (id === 'laptop') {
    // 背包类可以画满一些：它本来就在身后，不抢脸
    icon.rect(1, 4, 13, 8, 0x232b26);
    icon.rect(1, 4, 13, 1, INK);
    icon.rect(1, 11, 13, 1, INK);
    icon.rect(1, 4, 1, 8, INK);
    icon.rect(13, 4, 1, 8, INK);
    icon.rect(2, 5, 11, 6, 0x101713);
    icon.rect(3, 6, 6, 1, MINT);
    icon.rect(3, 8, 8, 1, 0x2fb59a);
    icon.rect(3, 9, 4, 1, 0x2fb59a);
    icon.rect(1, 12, 13, 2, 0x2f3a33);
    icon.rect(5, 12, 4, 1, MINT);
    return icon;
  }
  icon.rect(5, 2, 6, 1, 0x4a3b2e);
  icon.rect(5, 3, 1, 3, 0x4a3b2e);
  icon.rect(10, 3, 1, 3, 0x4a3b2e);
  icon.rect(2, 5, 11, 8, 0x6b4a32);
  icon.rect(2, 5, 11, 1, 0x3a2a1d);
  icon.rect(2, 12, 11, 1, 0x3a2a1d);
  icon.rect(2, 5, 1, 8, 0x3a2a1d);
  icon.rect(12, 5, 1, 8, 0x3a2a1d);
  icon.rect(3, 6, 9, 1, 0x8a6244);
  icon.rect(3, 9, 9, 1, 0x4a3b2e);
  icon.rect(7, 8, 2, 3, AMBER);
  return icon;
}

export function drawCosmetic(kind: CosmeticKind, id: string, dir: CosmeticDirection = 'down'): Uint8Array {
  if (kind === 'head') return drawHeadwear(id, dir).data;
  if (kind === 'eyes') return drawEyewear(id, dir).data;
  if (kind === 'neck') return drawNeckwear(id, dir).data;
  return drawBack(id).data;
}

/** 朝左的图直接镜像朝右：框架已经按相同规则把朝左的帧整体翻转，两边对得上 */
export function mirrorCosmetic(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const src = (y * SIZE + x) * 4;
      const dst = (y * SIZE + (SIZE - 1 - x)) * 4;
      out[dst] = data[src]!;
      out[dst + 1] = data[src + 1]!;
      out[dst + 2] = data[src + 2]!;
      out[dst + 3] = data[src + 3]!;
    }
  }
  return out;
}

export const COSMETIC_SIZE = SIZE;
