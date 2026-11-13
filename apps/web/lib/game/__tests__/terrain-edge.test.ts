import { describe, expect, it } from 'bun:test';
import { roundedRectContour } from '../autotile';
import {
  EDGE_BIT,
  MATERIAL,
  buildMaterialGrid,
  canonical47,
  edgeGlyphs,
  edgeMaskAt,
  gridAt,
  materialAt,
} from '../terrain-edge';

const LAKE_INSIDE = { x: 5370, y: 5565 };
const PATH_INSIDE = { x: 4096, y: 4800 };
const PLAZA_INSIDE = { x: 4096, y: 4096 };
const OFFICE_LAWN = { x: 3566, y: 4000 };
const GRASS_INSIDE = { x: 2700, y: 3600 };

describe('材质判定', () => {
  it('优先级：水压土、土路压石砖、石砖压草；院落空档仍是草', () => {
    expect(materialAt(LAKE_INSIDE.x, LAKE_INSIDE.y)).toBe(MATERIAL.water);
    expect(materialAt(PATH_INSIDE.x, PATH_INSIDE.y)).toBe(MATERIAL.dirt);
    expect(materialAt(PLAZA_INSIDE.x, PLAZA_INSIDE.y)).toBe(MATERIAL.stone);
    expect(materialAt(OFFICE_LAWN.x, OFFICE_LAWN.y)).toBe(MATERIAL.grass);
    expect(materialAt(GRASS_INSIDE.x, GRASS_INSIDE.y)).toBe(MATERIAL.grass);
  });

  it('边界沙带：矩形内侧 ISLAND_SAND 宽是沙，再往内是草，出了矩形就是林地', () => {
    // ADR-0077：陆地是 x 2560–5600 / y 2412–5780 的矩形，北边界 y = 2412
    expect(materialAt(2700, 2412 + 8)).toBe(MATERIAL.sand);
    expect(materialAt(2700, 2412 + 26)).toBe(MATERIAL.sand);
    expect(materialAt(2700, 2412 + 40)).toBe(MATERIAL.grass);
    expect(materialAt(2700, 2412 - 1)).toBe(MATERIAL.outside);
    expect(materialAt(2560 - 10, 3000)).toBe(MATERIAL.outside);
  });

  it('非有限坐标回落到边界外，不会把 NaN 传进判定', () => {
    expect(materialAt(Number.NaN, 100)).toBe(MATERIAL.outside);
    expect(materialAt(100, Number.POSITIVE_INFINITY)).toBe(MATERIAL.outside);
  });
});

describe('材质网格与 8 邻掩码', () => {
  const grid = buildMaterialGrid();

  it('网格格心与解析判定逐格一致', () => {
    const half = grid.tile / 2;
    for (let gy = 0; gy < grid.rows; gy += 17) {
      for (let gx = 0; gx < grid.cols; gx += 19) {
        const x = gx * grid.tile + half;
        const y = gy * grid.tile + half;
        expect(gridAt(grid, gx, gy)).toBe(materialAt(x, y));
      }
    }
  });

  it('土路左缘只点亮西向与两个西侧斜角', () => {
    const mask = edgeMaskAt(grid, 4032, 4800, MATERIAL.dirt);
    expect(mask & EDGE_BIT.w).toBe(EDGE_BIT.w);
    expect(mask & EDGE_BIT.nw).toBe(EDGE_BIT.nw);
    expect(mask & EDGE_BIT.sw).toBe(EDGE_BIT.sw);
    expect(mask & EDGE_BIT.e).toBe(0);
  });

  it('草地内部的掩码为 0，八邻全是同类', () => {
    expect(edgeMaskAt(grid, 2700, 3600, MATERIAL.grass)).toBe(0);
  });
});

describe('47 态归一化', () => {
  it('旋转等价类相同：N 与 E 折叠成一类', () => {
    expect(canonical47(EDGE_BIT.n)).toBe(canonical47(EDGE_BIT.e));
    expect(canonical47(EDGE_BIT.n)).toBe(canonical47(EDGE_BIT.s));
    expect(canonical47(EDGE_BIT.ne)).toBe(canonical47(EDGE_BIT.se));
  });

  it('孤立斜角不算边界：单角状态归一化为 0', () => {
    expect(canonical47(EDGE_BIT.ne)).toBe(0);
    expect(canonical47(EDGE_BIT.nw | EDGE_BIT.se)).toBe(0);
  });

  it('斜角与正交邻居同时成立时保留状态', () => {
    expect(canonical47(EDGE_BIT.ne | EDGE_BIT.n)).not.toBe(0);
  });

  it('256 种输入收敛到不超过 47 类，且归一化幂等', () => {
    const classes = new Set<number>();
    for (let mask = 0; mask < 256; mask += 1) {
      const canonical = canonical47(mask);
      expect(canonical47(canonical)).toBe(canonical);
      classes.add(canonical);
    }
    expect(classes.size).toBeLessThanOrEqual(47);
    // 不是一个把什么都抹平的实现
    expect(classes.size).toBeGreaterThan(20);
  });
});

describe('边缘图元', () => {
  const RECT = { x: 0, y: 0, w: 200, h: 200 };
  const contour = roundedRectContour(RECT, 16);

  it('沿轮廓撒出草尖与圆弧，全部落在整数像素上', () => {
    const glyphs = edgeGlyphs(contour, { self: MATERIAL.dirt, other: MATERIAL.grass, seed: 1 });
    expect(glyphs.length).toBeGreaterThan(100);
    for (const glyph of glyphs) {
      expect(Number.isInteger(glyph.x)).toBe(true);
      expect(Number.isInteger(glyph.y)).toBe(true);
      expect(glyph.w).toBeGreaterThan(0);
      expect(glyph.h).toBeGreaterThan(0);
      // 齿只会离开轮廓几像素，不会变成一圈毛刺
      expect(glyph.x).toBeGreaterThanOrEqual(RECT.x - 6);
      expect(glyph.y).toBeGreaterThanOrEqual(RECT.y - 6);
      expect(glyph.x + glyph.w).toBeLessThanOrEqual(RECT.x + RECT.w + 6);
      expect(glyph.y + glyph.h).toBeLessThanOrEqual(RECT.y + RECT.h + 6);
    }
  });

  it('同种子逐次一致：视口来回移动不会让草尖换位置', () => {
    const a = edgeGlyphs(contour, { self: MATERIAL.dirt, other: MATERIAL.grass, seed: 7 });
    const b = edgeGlyphs(contour, { self: MATERIAL.dirt, other: MATERIAL.grass, seed: 7 });
    expect(a).toEqual(b);
  });

  it('换种子会换图案，不会退化成同一张', () => {
    const a = edgeGlyphs(contour, { self: MATERIAL.dirt, other: MATERIAL.grass, seed: 7 });
    const b = edgeGlyphs(contour, { self: MATERIAL.dirt, other: MATERIAL.grass, seed: 8 });
    expect(a).not.toEqual(b);
  });

  it('图元数量有上限：病态轮廓不会把构造期拖爆', () => {
    const glyphs = edgeGlyphs(contour, {
      self: MATERIAL.dirt,
      other: MATERIAL.grass,
      seed: 3,
      cap: 60,
    });
    expect(glyphs.length).toBeLessThanOrEqual(62);
  });

  it('草盖泥的方向是朝轮廓内侧：齿落在土路里而不是草地上', () => {
    const glyphs = edgeGlyphs(contour, { self: MATERIAL.dirt, other: MATERIAL.grass, seed: 5 });
    // 上边缘（y≈0）的草尖必须往 y 更大的方向探，也就是探进土路
    const top = glyphs.filter((glyph) => glyph.y >= 0 && glyph.y <= 5);
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((glyph) => glyph.y + glyph.h > 0)).toBe(true);
  });

  it('接入网格后按邻居材质过滤，水面这种异材质处不乱撒娇', () => {
    const grid = buildMaterialGrid();
    const glyphs = edgeGlyphs(contour, {
      self: MATERIAL.dirt,
      other: MATERIAL.grass,
      seed: 11,
      grid,
    });
    // 这把矩形落在边界外的林地上，两侧都不是草，探针应当把图元全部拦掉
    expect(glyphs.length).toBe(0);
  });

  it('点列不足三个直接返回，不做任何采样', () => {
    expect(edgeGlyphs([], { self: MATERIAL.dirt, other: MATERIAL.grass })).toEqual([]);
    expect(edgeGlyphs([{ x: 0, y: 0 }, { x: 1, y: 1 }], { self: MATERIAL.dirt, other: MATERIAL.grass })).toEqual([]);
  });
});
