import { describe, expect, it } from 'bun:test';
import { COLUMNS } from '../layout';
import { landmarksOf } from '../quadruped';
import { COSMETIC_CATALOG, COSMETIC_SIZE, drawCosmetic, mirrorCosmetic, type CosmeticKind } from '../cosmetics';
import { EYEWEAR_IDS, HAIR_IDS, HEADWEAR_IDS, NECKWEAR_IDS } from '../../../shared-types/src/catalog';

const CATALOGS = {
  head: HEADWEAR_IDS,
  eyes: EYEWEAR_IDS,
  neck: NECKWEAR_IDS,
  hair: HAIR_IDS,
} as const;

const KINDS = Object.keys(COSMETIC_CATALOG) as CosmeticKind[];

function opaquePixels(data: Uint8Array): number {
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]) count += 1;
  }
  return count;
}

describe('配件目录', () => {
  it('与 shared-types 的目录顺序一致（不含 none）', () => {
    // 两端各写一份顺序，错位就会把帽子画成眼镜，必须在测试里钉死
    for (const kind of KINDS) {
      const expected = (CATALOGS[kind] as readonly string[]).filter((id) => id !== 'none');
      expect([...COSMETIC_CATALOG[kind]] as string[]).toEqual(expected);
    }
  });

  it('每个 id 在支持的朝向都有实际像素', () => {
    for (const kind of KINDS) {
      for (const id of COSMETIC_CATALOG[kind]) {
        const dirs = kind === 'eyes' ? (['down', 'side'] as const) : (['down', 'side', 'up'] as const);
        for (const dir of dirs) {
          expect(opaquePixels(drawCosmetic(kind, id, dir))).toBeGreaterThan(8);
        }
      }
    }
  });

  it('图标是纯灰度：染色只该改色相，不该和烘焙配色打架', () => {
    for (const kind of KINDS) {
      for (const id of COSMETIC_CATALOG[kind]) {
        for (const dir of ['down', 'side', 'up'] as const) {
          if (kind === 'eyes' && dir === 'up') continue;
          const data = drawCosmetic(kind, id, dir);
          for (let i = 0; i < data.length; i += 4) {
            if (!data[i + 3]) continue;
            expect(data[i]).toBe(data[i + 1]!);
            expect(data[i]).toBe(data[i + 2]!);
          }
        }
      }
    }
  });

  it('图标不铺满画布：配件靠留白控制视觉重量', () => {
    for (const kind of KINDS) {
      for (const id of COSMETIC_CATALOG[kind]) {
        const count = opaquePixels(drawCosmetic(kind, id, 'down'));
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(COSMETIC_SIZE * COSMETIC_SIZE);
      }
    }
  });

  it('镜像两次回到原图：朝左的图就是朝右的镜像', () => {
    for (const kind of KINDS) {
      for (const id of COSMETIC_CATALOG[kind]) {
        const side = drawCosmetic(kind, id, 'side');
        expect(Array.from(mirrorCosmetic(mirrorCosmetic(side)))).toEqual(Array.from(side));
      }
    }
  });
});

describe('国风配件（ADR-0061）', () => {
  const lumaAt = (data: Uint8Array, x: number, y: number): number => data[(y * COSMETIC_SIZE + x) * 4] ?? 0;
  const alphaAt = (data: Uint8Array, x: number, y: number): number => data[(y * COSMETIC_SIZE + x) * 4 + 3] ?? 0;

  it('斗笠的檐口是一条连续的亮色编织纹，不是散点', () => {
    // 「边缘留 1px 浅褐编织纹」在灰度图里就是檐口那一行取最亮档并且整条连着
    const hat = drawCosmetic('head', 'bamboo_hat', 'down');
    let run = 0;
    for (let x = 0; x < COSMETIC_SIZE; x += 1) if (lumaAt(hat, x, 9) > 200) run += 1;
    expect(run).toBeGreaterThanOrEqual(14);
  });

  it('平安扣中心 1px 明显暗于四邻，且不是透明洞', () => {
    // 透气孔只能靠明度表达：silhouette 只沿外沿生长，真留透明会被身体色直接穿透
    const jade = drawCosmetic('neck', 'jade_pendant', 'down');
    const center = lumaAt(jade, 9, 12);
    expect(alphaAt(jade, 9, 12)).toBeGreaterThan(0);
    expect(center).toBeLessThan(lumaAt(jade, 9, 11));
    expect(center).toBeLessThan(lumaAt(jade, 7, 12));
  });

  it('中国结的双流苏垂到画布底部一行', () => {
    const knot = drawCosmetic('neck', 'chinese_knot', 'down');
    let lowest = -1;
    for (let y = 0; y < COSMETIC_SIZE; y += 1) {
      for (let x = 0; x < COSMETIC_SIZE; x += 1) if (alphaAt(knot, x, y)) lowest = y;
    }
    expect(lowest).toBeGreaterThanOrEqual(18);
  });

  it('紧箍是一道压在前额的横箍，不是飘在头顶的帽子', () => {
    const hoop = drawCosmetic('head', 'curse_hoop', 'down');
    let top = -1;
    for (let y = 0; y < COSMETIC_SIZE && top < 0; y += 1) {
      for (let x = 0; x < COSMETIC_SIZE; x += 1) {
        if (alphaAt(hoop, x, y)) {
          top = y;
          break;
        }
      }
    }
    expect(top).toBeGreaterThanOrEqual(8);
    let band = 0;
    for (let x = 0; x < COSMETIC_SIZE; x += 1) if (alphaAt(hoop, x, 10)) band += 1;
    expect(band).toBeGreaterThanOrEqual(14);
  });

  it('官帽有向两侧平伸的展角：左右两列在帽体之外仍有像素', () => {
    const hat = drawCosmetic('head', 'god_of_wealth', 'down');
    expect(alphaAt(hat, 0, 6) + alphaAt(hat, 1, 6)).toBeGreaterThan(0);
    expect(alphaAt(hat, 18, 6) + alphaAt(hat, 19, 6)).toBeGreaterThan(0);
  });
});

describe('保安警用件', () => {
  const lumaAt = (data: Uint8Array, x: number, y: number): number => data[(y * COSMETIC_SIZE + x) * 4] ?? 0;
  const alphaAt = (data: Uint8Array, x: number, y: number): number => data[(y * COSMETIC_SIZE + x) * 4 + 3] ?? 0;

  it('大檐警帽正面是一整条宽帽檐，帽徽比帽箍亮', () => {
    const cap = drawCosmetic('head', 'police_cap', 'down');
    let brim = 0;
    for (let x = 0; x < COSMETIC_SIZE; x += 1) if (alphaAt(cap, x, 8) > 0) brim += 1;
    expect(brim).toBeGreaterThanOrEqual(14);
    expect(lumaAt(cap, 9, 4)).toBeGreaterThan(lumaAt(cap, 5, 5));
  });

  it('肩章左右各有一块，胸前反光条连续', () => {
    const badge = drawCosmetic('neck', 'epaulette', 'down');
    expect(alphaAt(badge, 2, 10) + alphaAt(badge, 3, 10)).toBeGreaterThan(0);
    expect(alphaAt(badge, 16, 10) + alphaAt(badge, 17, 10)).toBeGreaterThan(0);
    let strip = 0;
    for (let x = 0; x < COSMETIC_SIZE; x += 1) if (alphaAt(badge, x, 13) > 0) strip += 1;
    expect(strip).toBeGreaterThanOrEqual(10);
  });
});

describe('配件挂点', () => {
  it('背面没有眼睛，其余朝向都有', () => {
    for (const species of ['cow', 'horse'] as const) {
      for (let column = 0; column < COLUMNS; column += 1) {
        expect(landmarksOf(species, 0, column).eye).not.toBeNull();
        expect(landmarksOf(species, 1, column).eye).not.toBeNull();
        expect(landmarksOf(species, 3, column).eye).toBeNull();
      }
    }
  });

  it('躺姿的挂点跟着头走，不会留在站立位置', () => {
    // 旧实现按朝向写死锚点，切到躺平配件会悬空十几像素，这条断言就是那个 bug 的回归
    const standFront = landmarksOf('cow', 0, 0);
    const lieFront = landmarksOf('cow', 0, 11);
    expect(lieFront.head[1] - standFront.head[1]).toBeGreaterThan(8);

    const standSide = landmarksOf('cow', 2, 0);
    const lieSide = landmarksOf('cow', 2, 11);
    expect(lieSide.head[1] - standSide.head[1]).toBeGreaterThan(15);
    expect(lieSide.neck[1] - standSide.neck[1]).toBeGreaterThan(15);
  });

  it('头顶永远在头心之上，颈点永远在头心之下', () => {
    for (const species of ['cow', 'horse'] as const) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const lm = landmarksOf(species, 2, column);
        expect(lm.headTop[1]).toBeLessThan(lm.head[1]);
        expect(lm.neck[1]).toBeGreaterThan(lm.head[1]);
      }
    }
  });
});
