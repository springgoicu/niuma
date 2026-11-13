import { describe, expect, it } from 'vitest';
import { APPEARANCE_BYTES } from '../constants';
import { HAIR_IDS, HEADWEAR_IDS, NECKWEAR_IDS, catalogIndexOf } from '../catalog';
import { decodeAppearance, encodeAppearance } from '../appearance-codec';
import { DEFAULT_APPEARANCE } from '../types';

/**
 * 国风配件的字节位（ADR-0061）。
 *
 * 需求要求「32 字节外观编码完美映射新部件编号」，所以这里直接把编号钉死：
 * 追加位一旦被动过，旧存档的同一条字节会解成别的帽子，而且不会有任何报错。
 */
describe('国风配件的 32 字节编码位（ADR-0061）', () => {
  it('新 id 全部追加在末尾，旧 id 的编号一位不变', () => {
    expect(catalogIndexOf(HEADWEAR_IDS, 'grad')).toBe(1);
    expect(catalogIndexOf(HEADWEAR_IDS, 'top')).toBe(5);
    expect(catalogIndexOf(HEADWEAR_IDS, 'god_of_wealth')).toBe(6);
    expect(catalogIndexOf(HEADWEAR_IDS, 'bamboo_hat')).toBe(7);
    expect(catalogIndexOf(HEADWEAR_IDS, 'curse_hoop')).toBe(8);

    expect(catalogIndexOf(NECKWEAR_IDS, 'phones')).toBe(3);
    expect(catalogIndexOf(NECKWEAR_IDS, 'chinese_knot')).toBe(4);
    expect(catalogIndexOf(NECKWEAR_IDS, 'jade_pendant')).toBe(5);

    // 警用件同样只追加在末尾：玩家不可选，但字节编号必须稳定
    expect(catalogIndexOf(HEADWEAR_IDS, 'police_cap')).toBe(9);
    expect(catalogIndexOf(NECKWEAR_IDS, 'epaulette')).toBe(6);

    expect(catalogIndexOf(HAIR_IDS, 'slick')).toBe(5);
    expect(catalogIndexOf(HAIR_IDS, 'topknot')).toBe(6);
    expect(catalogIndexOf(HAIR_IDS, 'braid')).toBe(7);
  });

  it('编码仍是 32 字节，四个配件槽逐字节落在 [27..30]，往返无损', () => {
    const base = DEFAULT_APPEARANCE.cow;
    const bytes = encodeAppearance({
      ...base,
      cosmetics: {
        headwear: 'curse_hoop',
        eyewear: 'round',
        neckwear: 'jade_pendant',
        hairstyle: 'braid',
      },
    });

    expect(bytes.byteLength).toBe(APPEARANCE_BYTES);
    expect(APPEARANCE_BYTES).toBe(32);
    expect([bytes[27], bytes[28], bytes[29], bytes[30]]).toEqual([8, 1, 5, 7]);

    const back = decodeAppearance(bytes);
    expect(back.cosmetics).toEqual({
      headwear: 'curse_hoop',
      eyewear: 'round',
      neckwear: 'jade_pendant',
      hairstyle: 'braid',
    });
  });

  it('旧档字节仍解成原来的配件：追加不会把帽子变成别的东西', () => {
    const legacy = encodeAppearance({
      ...DEFAULT_APPEARANCE.cow,
      cosmetics: { headwear: 'top', eyewear: 'sun', neckwear: 'scarf', hairstyle: 'slick' },
    });
    const back = decodeAppearance(legacy);
    expect(back.cosmetics.headwear).toBe('top');
    expect(back.cosmetics.eyewear).toBe('sun');
    expect(back.cosmetics.neckwear).toBe('scarf');
    expect(back.cosmetics.hairstyle).toBe('slick');
  });
});
