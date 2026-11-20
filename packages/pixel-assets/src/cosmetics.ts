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
  head: [
    'grad',
    'cap',
    'beret',
    'helmet',
    'top',
    'god_of_wealth',
    'bamboo_hat',
    'curse_hoop',
    'police_cap',
    'nurse_cap',
    // ADR-0088：打工经济上线后的一批「暴富」件（只许追加）
    'golden_helmet',
    'crown',
    // Stage 1：喜剧职场头饰（与 HEADWEAR_IDS 严格对齐）
    'balding_wig',
    'delivery_helmet',
  ],
  eyes: ['round', 'sun', 'monocle', 'cyber_shades', 'gold_rim_glasses'],
  neck: ['scarf', 'collar', 'phones', 'chinese_knot', 'jade_pendant', 'epaulette', 'gold_chain', 'red_scarf'],
  hair: ['buzz', 'bangs', 'ponytail', 'afro', 'slick', 'topknot', 'braid'],
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

  // ---- ADR-0088：打工经济上线后的两顶「暴富」帽，全部追加在末尾 ----
  if (id === 'golden_helmet') {
    // 黄金安全帽：厚檐 + 圆顶 + 中脊。檐压得比其它帽子更低，才读成「工地安全帽」
    if (dir === 'up') {
      // 背面：只留后箍与调节旋钮
      icon.rect(6, 2, 8, 1, SHADE);
      icon.rect(4, 3, 12, 1, BASE);
      icon.rect(4, 4, 12, 1, BASE);
      icon.rect(4, 5, 12, 1, SHADE);
      icon.rect(3, 6, 14, 2, DEEP);
      icon.rect(9, 4, 2, 2, TRIM);
      return finished(icon);
    }
    const brimRight = dir === 'side';
    icon.rect(7, 1, 6, 1, TRIM);
    icon.rect(5, 2, 10, 1, BASE);
    icon.rect(4, 3, 12, 1, BASE);
    icon.rect(4, 4, 12, 1, SHADE);
    // 中脊：一条比本体亮一档的竖线，安全帽的识别点
    icon.rect(9, 2, 2, 3, TRIM);
    icon.rect(3, 5, 14, 1, BASE);
    if (brimRight) {
      // 侧面：檐向前（右）探出两格
      icon.rect(2, 6, 16, 2, DEEP);
      icon.rect(13, 6, 6, 1, SHADE);
    } else {
      icon.rect(2, 6, 16, 2, DEEP);
      icon.rect(2, 6, 16, 1, SHADE);
    }
    return finished(icon);
  }

  if (id === 'crown') {
    // 皇冠：三尖 + 冠带 + 三颗宝石。尖顶只两格宽，20px 下才不会被读成锯齿
    if (dir === 'up') {
      icon.rect(5, 4, 10, 1, BASE);
      icon.rect(4, 5, 12, 3, BASE);
      icon.rect(4, 8, 12, 1, DEEP);
      icon.rect(6, 2, 2, 2, SHADE);
      icon.rect(12, 2, 2, 2, SHADE);
      icon.rect(9, 3, 2, 1, TRIM);
      return finished(icon);
    }
    const shift = dir === 'side' ? 1 : 0;
    // 冠带
    icon.rect(4 + shift, 6, 12, 3, BASE);
    icon.rect(4 + shift, 8, 12, 1, DEEP);
    // 三尖：中尖最高，两侧对称
    icon.rect(5 + shift, 3, 2, 3, BASE);
    icon.rect(9 + shift, 1, 2, 5, BASE);
    icon.rect(13 + shift, 3, 2, 3, BASE);
    // 宝石：中尖顶与冠带
    icon.rect(9 + shift, 1, 1, 1, TRIM);
    icon.rect(8 + shift, 7, 1, 1, TRIM);
    icon.rect(11 + shift, 7, 1, 1, TRIM);
    return finished(icon);
  }

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
  } else if (id === 'top') {
    // 礼帽：高筒 + 帽带 + 宽檐；侧面的檐向前多伸两列。筒与檐之间不能留空，否则檐像飘着
    icon.rect(7, 0, 6, 1, BASE);
    icon.rect(6, 1, 8, 7, BASE);
    icon.rect(6, 5, 8, 1, DEEP);
    if (dir === 'side') icon.rect(2, 8, 15, 2, BASE);
    else icon.rect(1, 8, 18, 2, BASE);
    icon.rect(2, 9, dir === 'side' ? 15 : 16, 1, SHADE);
  } else if (id === 'god_of_wealth') {
    // 财神官帽（ADR-0061）：硬质圆顶 + 金箍带 + 两侧展角飞翅。
    // 飞翅压在 row 6–7，与帽体同高——翅比檐高才是「乌纱」，比檐低会读成耳罩。
    if (dir === 'side') {
      // 侧面：翅向后（左）平伸，檐向前多压一列
      icon.rect(0, 6, 5, 1, SHADE);
      icon.rect(0, 7, 5, 1, DEEP);
      icon.rect(6, 2, 5, 1, BASE);
      icon.rect(5, 3, 8, 1, BASE);
      icon.rect(5, 4, 8, 1, TRIM);
      icon.rect(4, 5, 10, 1, BASE);
      icon.rect(4, 6, 10, 2, BASE);
      icon.rect(4, 8, 12, 1, BASE);
      icon.rect(4, 9, 14, 1, DEEP);
      icon.rect(6, 10, 12, 1, SHADE);
      icon.rect(11, 1, 2, 1, TRIM);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：后山高起（顶上多一档暗色），展角从两侧水平伸出
      icon.rect(0, 6, 4, 2, SHADE);
      icon.rect(16, 6, 4, 2, SHADE);
      icon.band(1, 2, SHADE);
      icon.band(2, 3, BASE);
      icon.band(3, 4, BASE);
      icon.band(4, 4, BASE);
      icon.band(5, 4, TRIM);
      icon.band(6, 5, BASE);
      icon.band(7, 6, BASE);
      icon.band(8, 7, BASE);
      icon.rect(3, 9, 14, 1, DEEP);
      icon.rect(9, 0, 2, 1, TRIM);
      return finished(icon);
    }
    // 正面：双翅 + 圆顶 + 金箍带 + 宽檐 + 顶珠
    icon.rect(0, 6, 4, 2, SHADE);
    icon.rect(16, 6, 4, 2, SHADE);
    icon.rect(0, 7, 4, 1, DEEP);
    icon.rect(16, 7, 4, 1, DEEP);
    icon.band(2, 3, BASE);
    icon.band(3, 5, BASE);
    icon.band(4, 5, BASE);
    icon.band(5, 5, TRIM);
    icon.band(6, 6, BASE);
    icon.band(7, 6, BASE);
    icon.band(8, 7, BASE);
    icon.rect(2, 9, 16, 1, DEEP);
    icon.rect(3, 10, 14, 1, SHADE);
    icon.rect(9, 1, 2, 1, TRIM);
  } else if (id === 'bamboo_hat') {
    // 江湖斗笠（ADR-0061）：顶点偏右 2px 制造下压倾斜，帽檐最外圈一档亮色当 1px 编织纹。
    // 倾斜靠每行左端收一列实现，不用斜线——1px 斜线在这个尺度会碎成噪点。
    if (dir === 'side') {
      icon.rect(12, 2, 2, 1, TRIM);
      icon.rect(10, 3, 4, 1, BASE);
      icon.rect(8, 4, 6, 1, BASE);
      icon.rect(6, 5, 8, 1, BASE);
      icon.rect(5, 6, 10, 1, BASE);
      icon.rect(3, 7, 15, 1, BASE);
      icon.rect(2, 8, 17, 1, SHADE);
      icon.rect(2, 9, 17, 1, TRIM);
      icon.rect(4, 10, 15, 1, DEEP);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：锥顶居中，颈后系带打一个结
      icon.rect(9, 2, 2, 1, TRIM);
      icon.rect(8, 3, 4, 1, BASE);
      icon.rect(6, 4, 8, 1, BASE);
      icon.rect(5, 5, 10, 1, BASE);
      icon.rect(4, 6, 12, 1, BASE);
      icon.rect(2, 7, 16, 1, BASE);
      icon.rect(1, 8, 18, 1, SHADE);
      icon.rect(1, 9, 18, 1, TRIM);
      icon.rect(9, 10, 2, 2, DEEP);
      return finished(icon);
    }
    icon.rect(11, 2, 2, 1, TRIM);
    icon.rect(9, 3, 4, 1, BASE);
    icon.rect(7, 4, 6, 1, BASE);
    icon.rect(5, 5, 9, 1, BASE);
    icon.rect(4, 6, 12, 1, BASE);
    icon.rect(2, 7, 16, 1, BASE);
    icon.rect(1, 8, 18, 1, SHADE);
    icon.rect(1, 9, 18, 1, TRIM);
    icon.rect(2, 10, 16, 1, DEEP);
  } else if (id === 'police_cap') {
    // 大檐警帽（保安专用）：平顶 + 深色帽箍 + 宽帽檐 + 正中帽徽。
    // 帽檐压在 row 7–8，比其它帽子高一档，给帽徽留出完整的帽箍高度。
    if (dir === 'side') {
      icon.rect(8, 1, 6, 1, SHADE);
      icon.rect(6, 2, 9, 1, BASE);
      icon.rect(5, 3, 10, 1, BASE);
      icon.rect(5, 4, 10, 1, TRIM);
      icon.rect(5, 5, 10, 2, DEEP);
      icon.rect(10, 4, 2, 2, TRIM);
      icon.rect(4, 7, 14, 1, BASE);
      icon.rect(4, 8, 13, 1, SHADE);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：没有檐，后箍收口
      icon.rect(6, 1, 8, 1, SHADE);
      icon.rect(5, 2, 10, 1, BASE);
      icon.rect(4, 3, 12, 1, BASE);
      icon.rect(4, 4, 12, 1, TRIM);
      icon.rect(4, 5, 12, 2, DEEP);
      icon.rect(8, 7, 4, 1, SHADE);
      return finished(icon);
    }
    icon.rect(6, 1, 8, 1, SHADE);
    icon.rect(5, 2, 10, 1, BASE);
    icon.rect(4, 3, 12, 1, BASE);
    icon.rect(4, 4, 12, 1, TRIM);
    icon.rect(4, 5, 12, 2, DEEP);
    icon.rect(8, 4, 4, 2, TRIM);
    icon.rect(2, 7, 16, 1, BASE);
    icon.rect(2, 8, 16, 1, SHADE);
  } else if (id === 'nurse_cap') {
    // 白色护士帽（ADR-0084）：后高前低的软帽轮廓，正中最上缘留十字压印。
    // 帽体只用 BASE/SHADE 两档，服务端把 headwear 配色刷成纯白即可；
    // 红十字由急救站渲染层按固定护士坐标叠上去，避免单色 tint 把红字染成灰字。
    if (dir === 'up') {
      icon.rect(7, 1, 6, 1, SHADE);
      icon.rect(5, 2, 10, 1, BASE);
      icon.rect(4, 3, 12, 1, BASE);
      icon.rect(4, 4, 12, 1, BASE);
      icon.rect(5, 5, 10, 1, SHADE);
      icon.rect(6, 6, 8, 1, SHADE);
      return finished(icon);
    }
    if (dir === 'side') {
      icon.rect(9, 1, 5, 1, SHADE);
      icon.rect(7, 2, 7, 1, BASE);
      icon.rect(6, 3, 8, 1, BASE);
      icon.rect(5, 4, 9, 1, BASE);
      icon.rect(5, 5, 9, 1, SHADE);
      icon.rect(4, 6, 10, 1, SHADE);
      return finished(icon);
    }
    icon.rect(7, 1, 6, 1, SHADE);
    icon.rect(5, 2, 10, 1, BASE);
    icon.rect(4, 3, 12, 1, BASE);
    icon.rect(4, 4, 12, 1, BASE);
    icon.rect(3, 5, 14, 1, SHADE);
    // 正面帽檐：中间压低一格，读成护士帽的前折
    icon.rect(4, 6, 12, 1, SHADE);
    icon.rect(8, 5, 4, 1, BASE);
    // 红十字压印（luma 档，白色 tint 下仍能读出货架十字的轮廓）
    icon.rect(10, 2, 2, 1, TRIM);
    icon.rect(9, 3, 1, 1, TRIM);
    icon.rect(12, 3, 1, 1, TRIM);
    icon.rect(10, 4, 2, 1, TRIM);
  } else if (id === 'curse_hoop') {
    // 赛博紧箍咒（ADR-0061）：贴前额的一圈金箍（row 10–12），
    // 上下各留一档亮边当「自带辉光」，正中 3×3 空心方环读成卷云纹。
    if (dir === 'side') {
      icon.rect(3, 9, 14, 1, TRIM);
      icon.rect(4, 10, 13, 2, BASE);
      icon.rect(5, 12, 11, 1, SHADE);
      icon.rect(10, 10, 2, 2, DEEP);
      return finished(icon);
    }
    icon.rect(2, 9, 16, 1, TRIM);
    icon.rect(2, 10, 16, 2, BASE);
    icon.rect(3, 12, 14, 1, SHADE);
    if (dir === 'up') {
      // 背面看到的是箍的内侧：卷云纹只在额前，背后只留一道暗槽
      icon.rect(9, 10, 2, 2, DEEP);
      return finished(icon);
    }
    // 正中卷云：3×3 空心方环
    icon.rect(9, 10, 3, 1, DEEP);
    icon.rect(10, 11, 1, 1, BASE);
    icon.rect(9, 11, 1, 1, DEEP);
    icon.rect(11, 11, 1, 1, DEEP);
    icon.rect(9, 12, 3, 1, DEEP);
  } else if (id === 'balding_wig') {
    // 资深秃顶假发：光亮光滑地中海发际线 + 两侧一圈碎发
    if (dir === 'side') {
      icon.rect(4, 5, 11, 2, TRIM);
      icon.rect(2, 7, 5, 4, SHADE);
      icon.rect(2, 8, 3, 3, DEEP);
      return finished(icon);
    }
    if (dir === 'up') {
      icon.rect(4, 5, 12, 2, TRIM);
      icon.rect(2, 7, 16, 4, SHADE);
      icon.rect(3, 9, 14, 2, DEEP);
      return finished(icon);
    }
    // 正面：头顶反光高光弧 + 两鬓「地中海」耳上毛发
    icon.rect(6, 5, 8, 1, TRIM);
    icon.rect(8, 6, 3, 1, TRIM);
    icon.rect(2, 7, 3, 4, SHADE);
    icon.rect(15, 7, 3, 4, SHADE);
    icon.rect(2, 9, 3, 2, DEEP);
    icon.rect(15, 9, 3, 2, DEEP);
  } else if (id === 'delivery_helmet') {
    // 闪送黄色头盔：圆润亮面盔体 + 双兔耳状小天线/反光风镜檐
    if (dir === 'side') {
      icon.rect(8, 1, 2, 2, TRIM);
      icon.rect(6, 3, 9, 1, BASE);
      icon.rect(4, 4, 12, 3, BASE);
      icon.rect(5, 7, 11, 2, SHADE);
      icon.rect(11, 7, 6, 2, DEEP);
      return finished(icon);
    }
    icon.rect(5, 1, 2, 2, TRIM);
    icon.rect(13, 1, 2, 2, TRIM);
    icon.rect(5, 3, 10, 1, BASE);
    icon.rect(3, 4, 14, 4, BASE);
    icon.rect(4, 8, 12, 2, DEEP);
    if (dir === 'down') {
      icon.rect(6, 5, 8, 1, TRIM);
    }
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

  // ---- ADR-0088：赛博墨镜与金丝眼镜 ----
  if (id === 'cyber_shades') {
    // 赛博墨镜：一条横贯的深色镜带 + 左上高光 + 侧边竖条，强调「一体式」
    if (dir === 'side') {
      icon.rect(6, 7, 8, 4, OUTLINE);
      icon.rect(7, 7, 3, 1, TRIM);
      icon.rect(2, 9, 5, 1, DEEP);
      return finished(icon);
    }
    icon.rect(2, 7, 16, 4, OUTLINE);
    icon.rect(2, 7, 16, 1, DEEP);
    icon.rect(3, 8, 3, 1, TRIM);
    icon.rect(13, 8, 3, 1, TRIM);
    // 两端竖条：读成镜腿的正面投影
    icon.rect(1, 7, 1, 4, DEEP);
    icon.rect(18, 7, 1, 4, DEEP);
    return finished(icon);
  }

  if (id === 'gold_rim_glasses') {
    // 金丝眼镜：细框空心圆 + 中桥 + 细镜腿，比圆框墨镜再细一档
    const thin = (x0: number): void => {
      icon.rect(x0 + 1, 7, 4, 1, BASE);
      icon.rect(x0, 8, 1, 3, BASE);
      icon.rect(x0 + 5, 8, 1, 3, BASE);
      icon.rect(x0 + 1, 11, 4, 1, BASE);
    };
    if (dir === 'side') {
      icon.rect(7, 7, 6, 1, BASE);
      icon.rect(7, 7, 1, 5, BASE);
      icon.rect(12, 7, 1, 5, BASE);
      icon.rect(7, 11, 6, 1, BASE);
      icon.rect(2, 9, 5, 1, DEEP);
      return finished(icon);
    }
    thin(2);
    thin(13);
    icon.rect(7, 9, 5, 1, TRIM);
    icon.rect(1, 8, 1, 1, DEEP);
    icon.rect(18, 8, 1, 1, DEEP);
    return finished(icon);
  }

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

  // ---- ADR-0088：大金链与红围巾 ----
  if (id === 'gold_chain') {
    // 大金链：粗节链环 + 胸口吊牌。链环用「深-亮-深」三段，才读成有厚度的链子
    if (dir === 'up') {
      icon.band(8, 6, DEEP);
      icon.band(9, 6, TRIM);
      icon.band(10, 5, DEEP);
      return finished(icon);
    }
    if (dir === 'side') {
      icon.rect(6, 8, 8, 2, DEEP);
      icon.rect(6, 8, 8, 1, TRIM);
      icon.rect(9, 10, 3, 3, BASE);
      icon.rect(10, 11, 1, 1, DEEP);
      return finished(icon);
    }
    icon.band(8, 7, DEEP);
    icon.band(9, 7, TRIM);
    icon.band(10, 6, DEEP);
    // 吊牌：方形金牌 + 中间压暗的「￥」感缺口
    icon.rect(8, 11, 4, 4, BASE);
    icon.rect(9, 12, 2, 2, DEEP);
    icon.rect(8, 11, 4, 1, TRIM);
    return finished(icon);
  }

  if (id === 'red_scarf') {
    // 红围巾：绕颈一圈 + 胸前垂尾。单色染色只靠明度分「绕圈」与「垂尾」
    if (dir === 'up') {
      icon.band(8, 6, BASE);
      icon.band(9, 6, DEEP);
      icon.band(10, 5, SHADE);
      return finished(icon);
    }
    if (dir === 'side') {
      icon.rect(6, 8, 9, 2, BASE);
      icon.rect(6, 9, 9, 1, DEEP);
      icon.rect(12, 10, 3, 5, BASE);
      icon.rect(12, 14, 3, 2, DEEP);
      return finished(icon);
    }
    icon.band(8, 7, BASE);
    icon.band(9, 7, DEEP);
    icon.band(10, 6, SHADE);
    // 垂尾：偏左一条，末端加宽一格
    icon.rect(5, 11, 4, 5, BASE);
    icon.rect(5, 15, 5, 2, DEEP);
    icon.rect(5, 12, 4, 1, SHADE);
    return finished(icon);
  }

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

  if (id === 'chinese_knot') {
    // 吉祥中国结（ADR-0061）：颈线一条暗带 + 胸口菱形盘长结 + 双流苏穗。
    // 结心用一档深色方块当「盘长」的孔，别画成实心菱形——实心就读成护身符牌。
    if (dir === 'side') {
      icon.rect(6, 8, 8, 1, DEEP);
      icon.rect(11, 10, 2, 1, BASE);
      icon.rect(10, 11, 4, 1, BASE);
      icon.rect(9, 12, 6, 1, BASE);
      icon.rect(10, 13, 4, 1, BASE);
      icon.rect(10, 12, 2, 1, DEEP);
      icon.rect(11, 14, 1, 5, DEEP);
      icon.rect(11, 19, 3, 1, SHADE);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：结打在颈后，只留两条短尾
      icon.band(8, 5, DEEP);
      icon.rect(8, 9, 4, 2, SHADE);
      icon.rect(9, 11, 2, 3, DEEP);
      return finished(icon);
    }
    icon.band(8, 5, DEEP);
    icon.rect(9, 10, 2, 1, BASE);
    icon.rect(8, 11, 4, 1, BASE);
    icon.rect(7, 12, 6, 1, BASE);
    icon.rect(8, 13, 4, 1, BASE);
    icon.rect(9, 14, 2, 1, BASE);
    // 盘长孔：结心压暗
    icon.rect(9, 12, 2, 1, DEEP);
    // 双流苏穗
    icon.rect(8, 15, 1, 4, DEEP);
    icon.rect(11, 15, 1, 4, DEEP);
    icon.rect(7, 19, 3, 1, SHADE);
    icon.rect(10, 19, 3, 1, SHADE);
    return finished(icon);
  }

  if (id === 'jade_pendant') {
    // 翡翠平安扣（ADR-0061）：外圈亮、内圈暗的三行环，中心留 1px 孔。
    // 孔必须是 OUTLINE 而不是透明：silhouette 只沿形状外沿生长，内部留空会被身体色直接穿透，
    // 1px 的洞在 20×20 里看不成洞。
    if (dir === 'side') {
      icon.rect(9, 8, 6, 1, DEEP);
      icon.rect(11, 9, 2, 1, DEEP);
      icon.rect(9, 11, 4, 1, BASE);
      icon.rect(9, 12, 4, 2, BASE);
      icon.rect(10, 12, 2, 2, SHADE);
      icon.set(10, 12, OUTLINE);
      icon.rect(9, 14, 4, 1, TRIM);
      return finished(icon);
    }
    if (dir === 'up') {
      // 背面：只剩挂绳与颈后的扣
      icon.band(8, 4, DEEP);
      icon.rect(9, 9, 2, 4, DEEP);
      icon.rect(8, 12, 4, 1, SHADE);
      return finished(icon);
    }
    icon.band(8, 4, DEEP);
    icon.rect(9, 9, 2, 1, DEEP);
    icon.rect(8, 11, 4, 1, BASE);
    icon.rect(7, 12, 6, 1, BASE);
    icon.rect(7, 13, 6, 1, BASE);
    icon.rect(8, 14, 4, 1, TRIM);
    icon.rect(9, 12, 2, 2, SHADE);
    icon.set(9, 12, OUTLINE);
    return finished(icon);
  }

  if (id === 'epaulette') {
    // 肩章 + 反光条（保安专用）：颈线压深色领口，左右肩章各带一颗星点，
    // 胸前两条横向反光条是最容易读的「制服」信号。
    if (dir === 'side') {
      icon.rect(6, 8, 8, 1, DEEP);
      icon.rect(12, 10, 3, 2, BASE);
      icon.set(13, 10, TRIM);
      icon.rect(7, 13, 8, 1, TRIM);
      icon.rect(8, 15, 6, 1, TRIM);
      return finished(icon);
    }
    icon.band(8, 5, DEEP);
    icon.pair(2, 10, 3, 2, BASE);
    icon.set(3, 10, TRIM);
    icon.set(16, 10, TRIM);
    icon.band(13, 6, TRIM);
    icon.band(15, 5, TRIM);
    return finished(icon);
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

  if (id === 'topknot') {
    // 发髻（ADR-0061）：颅顶照常铺一层，上面再收成一股圆髻，一根发簪横穿。
    // 髻必须压到 row 8 收口，和 crown 的顶行接上，否则中间留缝就读成「头上顶着个球」。
    if (dir === 'side') {
      crown(icon, 11, 12, 6, 3);
      icon.rect(9, 3, 4, 5, BASE);
      icon.rect(8, 4, 5, 3, BASE);
      icon.set(10, 5, DEEP);
      icon.rect(6, 6, 9, 1, TRIM);
      icon.rect(15, 9, 2, 3, SHADE);
      return finished(icon);
    }
    if (dir === 'up') {
      crown(icon, 10, 13, 7, 4);
      icon.rect(8, 3, 4, 5, BASE);
      icon.rect(7, 4, 6, 3, BASE);
      icon.set(9, 6, DEEP);
      icon.rect(5, 6, 10, 1, TRIM);
      return finished(icon);
    }
    crown(icon, 10, 12, 8, 4);
    icon.rect(8, 3, 4, 5, BASE);
    icon.rect(7, 4, 6, 3, BASE);
    icon.set(9, 5, DEEP);
    icon.set(10, 6, DEEP);
    icon.rect(5, 6, 10, 1, TRIM);
    return finished(icon);
  }

  if (id === 'braid') {
    // 长辫（ADR-0061）：正面只看得见肩头一截，侧面与背面整条垂到后腰；
    // 编股靠每两行换一档明度，比画锯齿更省像素也更读得出「辫」。
    if (dir === 'side') {
      crown(icon, 11, 12, 6, 3);
      icon.rect(2, 11, 3, 3, BASE);
      icon.rect(1, 12, 3, 3, DEEP);
      icon.rect(1, 15, 3, 3, BASE);
      icon.rect(2, 18, 2, 1, SHADE);
      return finished(icon);
    }
    if (dir === 'up') {
      crown(icon, 10, 13, 7, 4);
      icon.rect(9, 13, 3, 2, DEEP);
      icon.rect(9, 15, 3, 2, BASE);
      icon.rect(9, 17, 3, 2, DEEP);
      icon.rect(9, 19, 3, 1, SHADE);
      return finished(icon);
    }
    crown(icon, 10, 12, 8, 4);
    icon.rect(1, 12, 2, 3, SHADE);
    icon.rect(17, 12, 2, 3, SHADE);
    icon.rect(17, 12, 2, 2, BASE);
    icon.rect(17, 14, 2, 2, DEEP);
    icon.rect(17, 16, 2, 2, BASE);
    icon.rect(18, 18, 1, 1, SHADE);
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
