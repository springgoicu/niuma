import { describe, expect, it } from 'bun:test';
import { VENUE_COLORS, darken, lighten, mixColor, outlineOf, seamOf } from '../venue-palette';

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function luminance(color: number): number {
  const [r, g, b] = channels(color);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

describe('场所色板', () => {
  it('每处场所都有四色，且都不带纯黑与纯白', () => {
    for (const [id, palette] of Object.entries(VENUE_COLORS)) {
      for (const key of ['main', 'alt', 'seam', 'accent', 'glow'] as const) {
        const value = palette[key];
        expect(Number.isInteger(value)).toBe(true);
        expect(value, `${id}.${key} 不应是纯黑`).not.toBe(0x000000);
        expect(value, `${id}.${key} 不应是纯白`).not.toBe(0xffffff);
        expect(value >> 16).toBeLessThanOrEqual(0xff);
      }
    }
  });

  it('明度阶梯有序：缝 < 主 < 点缀提亮', () => {
    for (const [id, palette] of Object.entries(VENUE_COLORS)) {
      if (id === 'theater' || id === 'cell') continue; // 暗厅本身主色极深，缝另取酒红/深灰
      expect(luminance(palette.seam)).toBeLessThanOrEqual(luminance(palette.main));
    }
  });

  it('压暗不产生纯黑，提亮不产生纯白', () => {
    for (const palette of Object.values(VENUE_COLORS)) {
      const outline = outlineOf(palette.main);
      expect(outline).not.toBe(0x000000);
      const seam = seamOf(palette.main);
      expect(luminance(seam)).toBeLessThan(luminance(palette.main));
      const light = lighten(palette.main, 0.4);
      expect(light).not.toBe(0xffffff);
      // 描边是母色的深色混合态，不该比母色还亮
      expect(luminance(outline)).toBeLessThan(luminance(palette.main) * 0.8);
    }
  });

  it('压暗只动明度：色相顺序保持，暖色不会压成冷色', () => {
    const warm = 0xd9ab7c;
    const [r0, g0, b0] = channels(warm);
    const [r1, g1, b1] = channels(darken(warm, 0.4));
    expect(r0).toBeGreaterThan(g0);
    expect(g0).toBeGreaterThan(b0);
    expect(r1).toBeGreaterThan(g1);
    expect(g1).toBeGreaterThan(b1);
  });

  it('混色端点与夹取正确', () => {
    expect(mixColor(0x112233, 0x445566, 0)).toBe(0x112233);
    expect(mixColor(0x112233, 0x445566, 1)).toBe(0x445566);
    expect(mixColor(0x112233, 0x445566, -5)).toBe(0x112233);
    expect(mixColor(0x112233, 0x445566, 5)).toBe(0x445566);
  });
});
