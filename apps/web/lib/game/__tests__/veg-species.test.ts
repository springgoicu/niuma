import { describe, expect, it } from 'bun:test';
import { WORLD_LAYOUT } from '@niuma/shared-types';
import {
  TREE_SPECIES,
  TREE_SPECIES_ORDER,
  speciesAt,
  speciesIndexAt,
  type TreeSpeciesId,
} from '../vegetation-species';

/**
 * 树种派生（去国风重塑）：只看纯数据，不加载 Pixi。
 *
 * 要守住三件事：
 * 1. 同一坐标永远同一物种——视口来回移动不会让树换脸；
 * 2. 五树种在岛内都能采到，不是一个把全图染成绿色的实现；
 * 3. 色板不带纯黑纯白，也不带中性死灰。
 */

const ISLAND = { x0: 2560, y0: 2412, x1: 5600, y1: 5780 };

describe('树种派生', () => {
  it('同一坐标永远同一物种', () => {
    const points: ReadonlyArray<readonly [number, number]> = [
      [3000, 3000],
      [4096, 4096],
      [5200, 5200],
      [3500, 4600],
    ];
    for (const [x, y] of points) {
      expect(speciesAt(x, y)).toBe(speciesAt(x, y));
      expect(speciesIndexAt(x, y)).toBe(TREE_SPECIES_ORDER.indexOf(speciesAt(x, y)));
    }
  });

  it('五树种在岛内都能采到', () => {
    const seen = new Set<TreeSpeciesId>();
    for (let y = ISLAND.y0; y < ISLAND.y1; y += 40) {
      for (let x = ISLAND.x0; x < ISLAND.x1; x += 40) seen.add(speciesAt(x, y));
    }
    expect(seen.size).toBe(TREE_SPECIES_ORDER.length);
  });

  it('水面及其外圈 360px 是柳带', () => {
    for (const lake of WORLD_LAYOUT.lakes) {
      const x = lake.rect.x + lake.rect.w / 2;
      const y = lake.rect.y + lake.rect.h / 2;
      expect(speciesAt(x, y)).toBe('willow');
    }
  });

  it('非法坐标回落到罗汉松，不抛错也不返回 undefined', () => {
    expect(speciesAt(Number.NaN, 0)).toBe('pine');
    expect(speciesAt(0, Number.POSITIVE_INFINITY)).toBe('pine');
  });
});

describe('树种色板', () => {
  it('每档都不是纯黑纯白，且带色相', () => {
    for (const id of TREE_SPECIES_ORDER) {
      const palette = TREE_SPECIES[id];
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `${id}.${key} 不应是纯黑`).not.toBe(0x000000);
        expect(value, `${id}.${key} 不应是纯白`).not.toBe(0xffffff);
        const r = (value >> 16) & 0xff;
        const g = (value >> 8) & 0xff;
        const b = value & 0xff;
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${id}.${key} 不应是中性死灰`).toBeGreaterThan(0);
      }
    }
  });

  it('明度阶梯有序：外沿暗于主色，高光亮于主色', () => {
    const luminance = (value: number): number => {
      const r = (value >> 16) & 0xff;
      const g = (value >> 8) & 0xff;
      const b = value & 0xff;
      return r * 0.299 + g * 0.587 + b * 0.114;
    };
    for (const id of TREE_SPECIES_ORDER) {
      const palette = TREE_SPECIES[id];
      expect(luminance(palette.canopyEdge)).toBeLessThan(luminance(palette.canopyMid));
      expect(luminance(palette.canopyDeep)).toBeLessThan(luminance(palette.canopyMid));
      expect(luminance(palette.canopyLight)).toBeGreaterThan(luminance(palette.canopyMid));
      expect(luminance(palette.canopyGlow)).toBeGreaterThan(luminance(palette.canopyLight));
    }
  });

  it('色相拉得开：银杏最暖、羽毛枫次之、松柏偏冷', () => {
    const warmth = (id: TreeSpeciesId): number => {
      const { canopyMid } = TREE_SPECIES[id];
      return ((canopyMid >> 16) & 0xff) - (canopyMid & 0xff);
    };
    expect(warmth('ginkgo')).toBeGreaterThan(warmth('maple'));
    expect(warmth('maple')).toBeGreaterThan(warmth('pine'));
  });
});
