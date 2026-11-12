import { beforeEach, describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE, APPEARANCE_COLOR_KEYS, normalizeColor, sanitizeAppearance } from '@niuma/shared-types';
import { LOOK_PALETTES, lookSwatches, useCreatorStore } from '../creator-store';

const reset = () =>
  useCreatorStore.setState({
    appearance: sanitizeAppearance(DEFAULT_APPEARANCE.cow),
    dirty: false,
  });

describe('整妆配色', () => {
  beforeEach(reset);

  it('每套都只写已知色槽，并且都带主体色', () => {
    for (const palette of LOOK_PALETTES) {
      expect(palette.name.length).toBeGreaterThan(0);
      expect(typeof palette.colors.body).toBe('number');
      for (const key of Object.keys(palette.colors)) {
        expect(APPEARANCE_COLOR_KEYS).toContain(key as (typeof APPEARANCE_COLOR_KEYS)[number]);
      }
    }
  });

  it('一键套用只动颜色，物种、配件与佩戴项原样保留', () => {
    const before = useCreatorStore.getState().appearance;
    const palette = LOOK_PALETTES[0]!;

    useCreatorStore.getState().applyPalette(palette.colors);
    const after = useCreatorStore.getState().appearance;

    expect(after.species).toBe(before.species);
    expect(after.parts).toEqual(before.parts);
    expect(after.cosmetics).toEqual(before.cosmetics);
    expect(after.colors.body).toBe(normalizeColor(palette.colors.body!));
    expect(useCreatorStore.getState().dirty).toBe(true);
  });

  it('没写进配色的槽保持原值，不顺手抹掉手调色', () => {
    const before = useCreatorStore.getState().appearance;
    useCreatorStore.getState().applyPalette({ body: 0x123456, hoof: 0x654321 });
    const after = useCreatorStore.getState().appearance;

    expect(after.colors.eyewear).toBe(before.colors.eyewear);
    expect(after.colors.neckwear).toBe(before.colors.neckwear);
    expect(after.colors.body).toBe(normalizeColor(0x123456));
  });

  it('迷你条取主体 / 斑纹 / 角鬃三色，且按 565 归一', () => {
    for (const palette of LOOK_PALETTES) {
      expect(lookSwatches(palette)).toHaveLength(3);
      expect(lookSwatches(palette)[0]).toBe(normalizeColor(palette.colors.body!));
    }
  });
});
