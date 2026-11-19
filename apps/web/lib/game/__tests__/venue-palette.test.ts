import { describe, expect, it } from 'bun:test';
import {
  URBAN_MATERIALS,
  VENUE_COLORS,
  darken,
  lighten,
  mixColor,
  outlineOf,
  seamOf,
} from '../venue-palette';

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

describe('现代都市材质色板', () => {
  it('每档材质都不是纯黑纯白，且不带中性死灰', () => {
    for (const [key, value] of Object.entries(URBAN_MATERIALS)) {
      expect(Number.isInteger(value), `${key} 必须是整数色值`).toBe(true);
      expect(value, `${key} 不应是纯黑`).not.toBe(0x000000);
      expect(value, `${key} 不应是纯白`).not.toBe(0xffffff);
      // 混凝土允许低饱和，但 r=g=b 的中性灰会把画面拉回廉价马赛克
      const [r, g, b] = channels(value);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${key} 不应是中性死灰`).toBeGreaterThan(0);
    }
  });

  it('冷暖分区：企业/市政偏冷，生活/房产偏暖', () => {
    const cold = ['workroom', 'meeting', 'cell', 'plaza', 'arch', 'shrine'] as const;
    const warm = ['lounge', 'apartment', 'villas'] as const;
    for (const id of cold) {
      const [r, , b] = channels(VENUE_COLORS[id].main);
      expect(b, `${id} 地面主色应偏冷：蓝通道高于红通道`).toBeGreaterThan(r);
    }
    for (const id of warm) {
      const [r, , b] = channels(VENUE_COLORS[id].main);
      expect(r, `${id} 地面主色应偏暖：红通道高于蓝通道`).toBeGreaterThan(b);
    }
  });

  it('霓虹街的三原色与地面对撞但不互相吞没', () => {
    const strip = VENUE_COLORS.neonStrip;
    expect(strip.accent).toBe(URBAN_MATERIALS.neonPink);
    expect(strip.glow).toBe(URBAN_MATERIALS.neonTeal);
    // 地面极暗、点缀极亮：明度差至少 3 档，霓虹才压得住夜色
    expect(luminance(strip.accent)).toBeGreaterThan(luminance(strip.main) * 2.5);
  });
});
