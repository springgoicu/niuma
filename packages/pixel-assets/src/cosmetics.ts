/**
 * 配件是独立小图，按方向锚点叠加在角色容器上。
 * 目录顺序必须与 packages/shared-types/src/catalog.ts 保持一致（不含 none）。
 *
 * ADR-0007：配件从胸口/嘴部迁到头顶、眼线、颈线。20×20 的图标仍按 1:1 叠加，
 * 但同一件配件要按朝向各出一张——帽子搬到头上以后，一张图没法同时表达
 * 帽檐朝前、朝侧、朝后；朝左的图由生成器镜像朝右的图。
 *
 * ADR-0011：配件整件单色化。图标只写明度档位（本体 / 阴影 / 深部 / 描边），
 * 跑图集时落成灰度 PNG，客户端用 Sprite.tint 染色——换色只改 tint，不重建纹理。
 * 代价是帽子上的薄荷标、单眼镜的金链不再保色，靠明度差区分材质。
 *
 * 尺寸 20 的由来：头径从 13.6（48 网格）长到 17（64 网格）是 1.25 倍，
 * 16 × 1.25 = 20，所以帽子相对头宽的比例和旧版完全一致，不需要重调锚点偏移。
 */
export const COSMETIC_CATALOG = {
  head: ['grad', 'cap', 'beret', 'helmet', 'top'],
  eyes: ['round', 'sun', 'monocle'],
  neck: ['scarf', 'collar', 'phones'],
  hair: ['buzz', 'bangs', 'ponytail', 'afro', 'slick'],
} as const;

export type CosmeticKind = keyof typeof COSMETIC_CATALOG;

/** 作画朝向：down 正面 / side 侧面（朝右）/ up 背面 */
export type CosmeticDirection = 'down' | 'side' | 'up';

/**
 * 图标画布 20×20：与角色同格，1:1 叠加不缩放。
 * 同类配件共用同一套局部基准——帽檐压在同一条 y（row 10）、镜圈套在同一条眼线（row 10）、
 * 颈饰压在同一条颈线——锚点只用类别偏移，不逐个 id 手调。
 */
const SIZE = 20;

/**
 * 单色染色只有明度可调（tint 是乘法，色相与饱和度由玩家决定）。
 * 四档就够：本体 / 体积阴影 / 深部与材质切换 / 描边。
 */
const BASE = 255;
const SHADE = 208;
const DEEP = 150;
const TRIM = 236;
const OUTLINE = 52;

class Icon {
  readonly data = new Uint8Array(SIZE * SIZE * 4);

  set(x: number, y: number, luma: number, alpha = 255): void {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE) return;
    const i = (ty * SIZE + tx) * 4;
    this.data[i] = luma;
    this.data[i + 1] = luma;
    this.data[i + 2] = luma;
    this.data[i + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, luma: number): void {
    for (let iy = 0; iy < h; iy += 1) {
      for (let ix = 0; ix < w; ix += 1) {
        this.set(x + ix, y + iy, luma);
      }
    }
  }

  /** 以图标竖直中线为轴的一对矩形：正/背面的对称件只写一半 */
  pair(x: number, y: number, w: number, h: number, luma: number): void {
    this.rect(x, y, w, h, luma);
    this.rect(SIZE - x - w, y, w, h, luma);
  }

  /** 以中线为轴、宽 halfWidth×2 的一横行 */
  band(y: number, halfWidth: number, luma: number): void {
    this.rect(SIZE / 2 - halfWidth, y, halfWidth * 2, 1, luma);
  }

  /** 1px 硬描边：配件要在任何身体色上都能读出来，描边本身也跟着 tint 变暗 */
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
          this.set(x, y, OUTLINE);
        }
      }
    }
  }
}

/**
 * 帽子的三类构图：正面看是「顶 + 前檐」，侧面看是「顶 + 向前伸的檐」，
 * 背面看没有檐，只留后箍与调节扣。所有帽檐都压在同一个基准高度（row 10），
 * 也就是头顶点下 1px——帽子略微咬住头顶，才不像浮在半空。
 */
function drawHeadwear(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (id === 'grad') {
    // 学士帽：方板（三行才不是一块木板）+ 帽箍 + 流苏。方板比头宽一圈，是这个尺度下最好读的帽型
    icon.band(4, 9, SHADE);
    icon.band(5, 9, BASE);
    icon.band(6, 9, BASE);
    icon.band(7, 5, SHADE);
    icon.band(8, 5, BASE);
    icon.band(9, 5, SHADE);
    const tasselX = dir === 'side' ? 3 : 17;
    icon.rect(tasselX, 7, 1, 3, DEEP);
    icon.rect(tasselX - 1, 10, 2, 2, DEEP);
  } else if (id === 'cap') {
    if (dir === 'side') {
      // 侧面：檐朝前（右），所以整顶帽子偏后压
      icon.rect(7, 3, 8, 1, BASE);
      icon.rect(5, 4, 10, 1, BASE);
      icon.rect(6, 4, 4, 1, TRIM);
      icon.rect(5, 5, 10, 1, BASE);
      icon.rect(4, 6, 12, 1, BASE);
      icon.rect(4, 7, 12, 2, BASE);
      icon.rect(6, 9, 13, 2, DEEP);
      icon.rect(10, 2, 2, 1, TRIM);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：没有檐，后箍 + 调节扣
      icon.rect(6, 2, 8, 1, BASE);
      icon.rect(5, 3, 10, 1, BASE);
      icon.rect(4, 4, 12, 1, BASE);
      icon.rect(4, 5, 12, 2, BASE);
      icon.rect(3, 7, 14, 2, DEEP);
      icon.rect(9, 7, 2, 2, TRIM);
      return finished(icon);
    }
    // 正面：顶 + 前檐
    icon.rect(7, 2, 6, 1, BASE);
    icon.rect(5, 3, 10, 1, BASE);
    icon.rect(4, 4, 12, 1, BASE);
    icon.rect(6, 4, 4, 1, TRIM);
    icon.rect(4, 5, 12, 1, BASE);
    icon.rect(3, 6, 14, 3, BASE);
    icon.rect(2, 9, 16, 2, DEEP);
    icon.rect(9, 1, 2, 1, TRIM);
  } else if (id === 'beret') {
    // 贝雷帽：往上歪的一坨 + 小揪，檐没有硬边，靠底部一档暗色收口
    if (dir === 'side') {
      icon.rect(4, 3, 1, 1, SHADE);
      icon.rect(1, 4, 13, 1, SHADE);
      icon.rect(1, 5, 14, 1, BASE);
      icon.rect(4, 5, 5, 1, TRIM);
      icon.rect(2, 6, 13, 2, SHADE);
      icon.rect(4, 8, 11, 2, DEEP);
      return finished(icon);
    }
    icon.rect(10, 2, 3, 1, SHADE);
    icon.rect(4, 3, 12, 1, SHADE);
    icon.rect(2, 4, 16, 2, BASE);
    icon.rect(5, 5, 5, 1, TRIM);
    icon.rect(3, 6, 14, 2, SHADE);
    icon.rect(4, 8, 12, 2, DEEP);
  } else if (id === 'helmet') {
    // 安全帽：顶脊 + 圆顶 + 一圈外翻檐，明度拉满在奶白与深棕身上都压得住
    if (dir === 'side') {
      icon.rect(9, 2, 4, 1, DEEP);
      icon.rect(6, 3, 9, 1, BASE);
      icon.rect(5, 4, 11, 1, BASE);
      icon.rect(7, 4, 3, 1, TRIM);
      icon.rect(4, 5, 13, 1, BASE);
      icon.rect(3, 6, 15, 2, BASE);
      icon.rect(4, 8, 14, 2, BASE);
      icon.rect(3, 9, 16, 2, DEEP);
      return finished(icon);
    }
    icon.rect(9, 1, 2, 2, DEEP);
    icon.rect(6, 2, 8, 1, BASE);
    icon.rect(5, 3, 10, 1, BASE);
    icon.rect(4, 4, 12, 1, BASE);
    icon.rect(6, 4, 3, 1, TRIM);
    icon.rect(3, 5, 14, 2, BASE);
    // 背面只露出两侧檐口：帽檐在身后的宽度收一半
    icon.rect(dir === 'up' ? 3 : 2, 7, dir === 'up' ? 14 : 16, 2, BASE);
    icon.rect(3, 9, 14, 1, DEEP);
  } else {
    // 礼帽：高筒 + 帽带 + 宽檐；侧面的檐向前多伸两列。筒与檐之间不能留空，否则檐像飘着
    icon.rect(7, 0, 6, 1, BASE);
    icon.rect(6, 1, 8, 7, BASE);
    icon.rect(6, 5, 8, 1, DEEP);
    if (dir === 'side') icon.rect(2, 8, 15, 2, BASE);
    else icon.rect(1, 8, 18, 2, BASE);
    icon.rect(2, 9, dir === 'side' ? 15 : 16, 1, SHADE);
  }

  return finished(icon);
}

function finished(icon: Icon): Icon {
  icon.silhouette();
  return icon;
}

/**
 * 眼镜要能透过镜片看见眼睛：眼珠是 4×3，所以镜框做成 6×7 的空心圈，
 * 内圈正好 4×3，套在眼睛外沿而不是盖住它。
 */
function drawEyewear(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (dir === 'side') {
    // 侧面只看得到近侧那片，加一条镜腿
    if (id === 'sun') {
      icon.rect(7, 7, 6, 4, OUTLINE);
      icon.set(8, 7, TRIM);
      icon.rect(2, 9, 5, 1, DEEP);
      return icon;
    }
    icon.rect(8, 6, 3, 1, SHADE);
    icon.rect(7, 7, 1, 4, BASE);
    icon.rect(11, 7, 1, 4, BASE);
    icon.rect(8, 11, 3, 1, BASE);
    icon.rect(2, 9, 5, 1, DEEP);
    if (id === 'monocle') {
      // 单眼镜的链子从镜框右下角垂下来
      icon.set(11, 12, TRIM);
      icon.set(12, 13, TRIM);
      icon.set(12, 14, TRIM);
    }
    return icon;
  }

  if (id === 'sun') {
    // 墨镜：不透明镜片盖住眼珠，左上角一道高光
    icon.pair(2, 7, 6, 4, OUTLINE);
    icon.set(3, 7, TRIM);
    icon.set(13, 7, TRIM);
    icon.rect(7, 8, 6, 1, DEEP);
    return icon;
  }

  // 圆框：留空的镜圈，内圈正好 4×3 露出眼珠；框比眼珠亮一档，别糊成一块黑
  const ring = (x0: number): void => {
    icon.rect(x0 + 1, 6, 4, 1, SHADE);
    icon.rect(x0, 7, 1, 4, BASE);
    icon.rect(x0 + 5, 7, 1, 4, BASE);
    icon.rect(x0 + 1, 11, 4, 1, BASE);
  };

  if (id === 'monocle') {
    // 只戴右眼，左眼裸露；链子从右下垂到胸前
    ring(13);
    icon.set(17, 12, TRIM);
    icon.set(16, 13, TRIM);
    icon.set(16, 14, TRIM);
    return icon;
  }

  ring(2);
  ring(13);
  icon.rect(7, 8, 5, 1, DEEP);
  icon.set(1, 9, DEEP);
  icon.set(18, 9, DEEP);
  return icon;
}

function drawNeckwear(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (id === 'scarf') {
    if (dir === 'side') {
      // 侧面：围在喉下、垂一条在胸前
      icon.rect(6, 8, 8, 2, BASE);
      icon.rect(6, 9, 8, 1, DEEP);
      icon.rect(6, 10, 4, 4, BASE);
      icon.rect(6, 13, 4, 2, DEEP);
      return icon;
    }
    if (dir === 'up') {
      // 背面正好是打结处：结 + 两条尾巴
      icon.band(8, 6, BASE);
      icon.band(9, 6, DEEP);
      icon.rect(8, 9, 4, 2, DEEP);
      icon.rect(5, 11, 3, 3, BASE);
      icon.rect(12, 11, 3, 3, BASE);
      return icon;
    }
    icon.band(8, 7, BASE);
    icon.band(9, 6, DEEP);
    icon.rect(5, 10, 4, 4, BASE);
    icon.rect(5, 13, 4, 1, DEEP);
    return icon;
  }

  if (id === 'collar') {
    // 项圈只有 1px 高，靠吊牌与扣环提供第二个明度档，否则在深色身体上只是一条线
    if (dir === 'side') {
      icon.rect(6, 9, 7, 2, BASE);
      icon.rect(10, 11, 2, 3, DEEP);
      return icon;
    }
    icon.band(9, 6, BASE);
    if (dir === 'up') {
      // 背面看到的是扣环
      icon.rect(9, 9, 2, 2, TRIM);
    } else {
      icon.rect(9, 10, 2, 3, DEEP);
    }
    return icon;
  }

  // 挂脖耳机：带子压在颈线，耳罩落在两侧
  if (dir === 'side') {
    icon.rect(4, 9, 9, 1, DEEP);
    icon.rect(11, 8, 3, 5, BASE);
    icon.rect(2, 8, 3, 5, BASE);
    icon.set(12, 10, TRIM);
    return icon;
  }
  icon.band(9, 6, DEEP);
  icon.pair(1, 8, 3, 6, BASE);
  if (dir === 'down') {
    icon.set(2, 10, TRIM);
    icon.set(17, 10, TRIM);
  }
  return icon;
}

/**
 * 发块：以 bottom 为底边、向上收成半椭圆的一坨头发。
 * 用行宽公式而不是椭圆填充，是为了让发际线是一条干净的水平边——刘海才读得出来。
 */
function heap(icon: Icon, cx: number, bottom: number, rx: number, ry: number, luma: number): void {
  for (let y = Math.round(bottom - ry); y <= Math.round(bottom); y += 1) {
    const t = ry <= 0 ? 1 : (y - (bottom - ry)) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    const w = Math.round(half * 2);
    if (w <= 0) continue;
    icon.rect(cx - Math.round(w / 2), y, w, 1, luma);
  }
}

/** 头顶发块：本体铺满 + 最底一行压暗，单色染色下只靠这一行读体积 */
function crown(icon: Icon, cx: number, bottom: number, rx: number, ry: number): void {
  heap(icon, cx, bottom, rx, ry, BASE);
  icon.rect(cx - rx, bottom, rx * 2, 1, SHADE);
}

/**
 * 发型（ADR-0011）：取代原来的背包槽位。
 *
 * 锚点 = 头顶再下 1px，所以图标 row 9 就是头顶点，row 14 约等于眼睛上沿。
 * 因此正面与侧面的发块只画到 row 13–14，别压住眼睛；只有背面（up）可以垂到后颈。
 */
function drawHair(id: string, dir: CosmeticDirection): Icon {
  const icon = new Icon();

  if (id === 'buzz') {
    // 寸头：贴着颅骨的一层，两侧带很短的鬓角
    if (dir === 'side') {
      crown(icon, 11, 13, 7, 5);
      icon.rect(4, 12, 3, 3, SHADE);
      icon.rect(15, 11, 2, 2, BASE);
      return finished(icon);
    }
    if (dir === 'up') {
      crown(icon, 10, 14, 8, 6);
      icon.rect(6, 13, 8, 2, SHADE);
      return finished(icon);
    }
    crown(icon, 10, 13, 8, 5);
    icon.rect(2, 11, 1, 3, SHADE);
    icon.rect(17, 11, 1, 3, SHADE);
    return finished(icon);
  }

  if (id === 'bangs') {
    // 齐刘海：一条水平的发梢压在眼睛上沿，两侧额角留长；与寸头的差别全在这条直边
    if (dir === 'side') {
      crown(icon, 12, 11, 6, 3);
      icon.rect(13, 10, 6, 5, BASE);
      icon.rect(13, 14, 6, 1, SHADE);
      icon.rect(2, 11, 4, 6, BASE);
      icon.rect(2, 16, 4, 1, SHADE);
      icon.set(15, 13, DEEP);
      return finished(icon);
    }
    if (dir === 'up') {
      crown(icon, 10, 12, 8, 4);
      icon.rect(3, 12, 14, 4, BASE);
      icon.rect(3, 15, 14, 1, SHADE);
      icon.set(7, 13, DEEP);
      icon.set(13, 13, DEEP);
      return finished(icon);
    }
    crown(icon, 10, 12, 9, 4);
    icon.rect(1, 12, 18, 3, BASE);
    icon.rect(1, 14, 18, 1, SHADE);
    icon.rect(1, 12, 2, 6, SHADE);
    icon.rect(17, 12, 2, 6, SHADE);
    icon.set(6, 13, DEEP);
    icon.set(13, 13, DEEP);
    return finished(icon);
  }

  if (id === 'ponytail') {
    // 马尾：头顶收紧，发束从一侧/身后甩出来，发圈压一档深色
    if (dir === 'side') {
      crown(icon, 12, 12, 6, 4);
      icon.rect(2, 10, 4, 3, BASE);
      icon.rect(1, 12, 3, 5, SHADE);
      icon.rect(5, 11, 1, 2, DEEP);
      icon.rect(2, 17, 3, 1, SHADE);
      return finished(icon);
    }
    if (dir === 'up') {
      crown(icon, 10, 13, 7, 4);
      icon.rect(8, 13, 4, 1, DEEP);
      icon.rect(8, 14, 4, 4, BASE);
      icon.rect(8, 18, 4, 1, SHADE);
      return finished(icon);
    }
    crown(icon, 10, 12, 7, 4);
    icon.rect(16, 9, 2, 6, BASE);
    icon.rect(15, 15, 4, 3, SHADE);
    icon.rect(16, 12, 2, 1, DEEP);
    return finished(icon);
  }

  if (id === 'afro') {
    // 爆炸头：三坨叠出蓬松剪影，边缘故意不齐才不像戴了个头盔
    if (dir === 'side') {
      heap(icon, 11, 15, 9, 8, BASE);
      heap(icon, 4, 12, 3, 4, BASE);
      heap(icon, 10, 7, 4, 3, BASE);
      icon.rect(2, 15, 18, 1, SHADE);
      return finished(icon);
    }
    if (dir === 'up') {
      heap(icon, 10, 16, 9, 8, BASE);
      heap(icon, 5, 11, 3, 4, BASE);
      heap(icon, 15, 11, 3, 4, BASE);
      icon.rect(1, 16, 18, 1, SHADE);
      return finished(icon);
    }
    heap(icon, 10, 15, 9, 7, BASE);
    heap(icon, 3, 10, 3, 4, BASE);
    heap(icon, 17, 10, 3, 4, BASE);
    icon.rect(1, 15, 18, 1, SHADE);
    return finished(icon);
  }

  // 大背头：前额全部梳上去，顶上鼓起一坨，后脑收干净
  if (dir === 'side') {
    crown(icon, 12, 12, 6, 3);
    icon.rect(2, 5, 7, 6, BASE);
    icon.rect(3, 4, 5, 1, BASE);
    icon.rect(2, 10, 10, 1, SHADE);
    icon.set(6, 7, DEEP);
    return finished(icon);
  }
  if (dir === 'up') {
    crown(icon, 10, 13, 7, 4);
    icon.rect(7, 6, 6, 6, BASE);
    icon.rect(8, 5, 4, 1, BASE);
    icon.rect(7, 11, 6, 1, SHADE);
    icon.set(9, 8, DEEP);
    return finished(icon);
  }
  crown(icon, 10, 12, 7, 3);
  icon.rect(6, 5, 8, 6, BASE);
  icon.rect(7, 4, 6, 1, BASE);
  icon.rect(6, 10, 8, 1, SHADE);
  icon.set(8, 7, DEEP);
  return finished(icon);
}

export function drawCosmetic(kind: CosmeticKind, id: string, dir: CosmeticDirection = 'down'): Uint8Array {
  if (kind === 'head') return drawHeadwear(id, dir).data;
  if (kind === 'eyes') return drawEyewear(id, dir).data;
  if (kind === 'neck') return drawNeckwear(id, dir).data;
  return drawHair(id, dir).data;
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
