import { describe, expect, it } from 'bun:test';
import { landmarksOf } from '../quadruped';
import { COSMETIC_CATALOG, COSMETIC_SIZE, drawCosmetic, mirrorCosmetic, type CosmeticKind } from '../cosmetics';
import { BACK_IDS, EYEWEAR_IDS, HEADWEAR_IDS, NECKWEAR_IDS } from '../../../shared-types/src/catalog';

const CATALOGS = {
  head: HEADWEAR_IDS,
  eyes: EYEWEAR_IDS,
  neck: NECKWEAR_IDS,
  back: BACK_IDS,
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
      if (kind === 'back') continue;
      for (const id of COSMETIC_CATALOG[kind]) {
        const dirs = kind === 'eyes' ? (['down', 'side'] as const) : (['down', 'side', 'up'] as const);
        for (const dir of dirs) {
          expect(opaquePixels(drawCosmetic(kind, id, dir))).toBeGreaterThan(8);
        }
      }
    }
  });

  it('图标不铺满 16×16：配件靠留白控制视觉重量', () => {
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

describe('配件挂点', () => {
  it('背面没有眼睛，其余朝向都有', () => {
    for (const species of ['cow', 'horse'] as const) {
      for (let column = 0; column < 16; column += 1) {
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
      for (let column = 0; column < 16; column += 1) {
        const lm = landmarksOf(species, 2, column);
        expect(lm.headTop[1]).toBeLessThan(lm.head[1]);
        expect(lm.neck[1]).toBeGreaterThan(lm.head[1]);
      }
    }
  });
});
