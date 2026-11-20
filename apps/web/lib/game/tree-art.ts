'use client';

import { Graphics, Rectangle, Texture, type Application } from 'pixi.js';
import { seeded } from './seeded';
import { WINTER_COLORS as W } from './terrain-palette';
import {
  TREE_SPECIES,
  TREE_SPECIES_ORDER,
  type TreeSpeciesId,
  type TreeSpeciesPalette,
} from './vegetation-species';

/**
 * 程序化像素植栽绘本引擎（浮世绘绘本风 × 9 树种 × 3 变体 + 6 棵百岁古树）：
 *
 * 纪律：
 * - 树干与树冠共用同一帧画布尺寸（标准 84×120 / 古树 128×152），确保锚点 (0.5, 1) 逐像素对齐；
 * - 全部着色走实体树种色板（不含纯黑 0x000000、纯白 0xffffff 与中性死灰）；
 * - 全部图块只在构造期烘焙一次，`resolution: 1`、`antialias: false`、`scaleMode: 'nearest'`。
 */

type TextureFactory = Application['renderer'];

export const TREE_W = 84;
export const TREE_H = 120;
export const HERO_TREE_W = 128;
export const HERO_TREE_H = 152;
export const TREE_VARIANTS_PER_SPECIES = 3;

export interface TreeTextures {
  trunk: Texture;
  canopy: Texture;
}

export interface TreeTextureBank {
  readonly bySpecies: Record<TreeSpeciesId, TreeTextures[]>;
  readonly heroBySpecies: Record<TreeSpeciesId, TreeTextures>;
  /** 扁平按物种主顺序索引的兼容数组（供边界林、冬季或工具测试直接按索引取值） */
  readonly flat: TreeTextures[];
}

function bakeFrame(renderer: TextureFactory, w: number, h: number, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, w, h),
    resolution: 1,
    antialias: false,
    textureSourceOptions: { scaleMode: 'nearest' },
  });
  g.destroy();
  return texture;
}

interface ClusterSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 0 = 扁云松片 / 平底；1 = 圆柔叶团；2 = 尖挑枫叶/火焰梢 */
  shape?: 0 | 1 | 2;
}

/** 扫描线整数化像素叶团，轮廓带微小有机抖动，绝不出现平滑抗锯齿边 */
function fillPixelLobe(
  g: Graphics,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
  shape: 0 | 1 | 2 = 1,
): void {
  const rxi = Math.max(1, Math.round(rx));
  const ryi = Math.max(1, Math.round(ry));
  for (let dy = -ryi; dy <= ryi; dy += 1) {
    const ny = dy / ryi;
    // shape 0: 底部平切云松；shape 2: 上尖下丰满
    let factorSq = 1 - ny * ny;
    if (shape === 0 && dy > ryi * 0.42) factorSq *= 0.92 - (dy / ryi - 0.42) * 1.1;
    if (shape === 2) {
      const taper = ny < 0 ? 1 + ny * 0.45 : 1 - ny * 0.15;
      factorSq *= taper;
    }
    if (factorSq <= 0) continue;
    const half = Math.max(1, Math.round(rxi * Math.sqrt(factorSq)));
    g.rect(Math.round(cx) - half, Math.round(cy) + dy, half * 2, 1).fill(color);
  }
}

/** 多层统一光影叶簇：暗边廓 → 背阴底 → 主叶肉 → 西北受光高光 → 叶隙点彩 */
function drawFoliageClusters(
  g: Graphics,
  clusters: ReadonlyArray<ClusterSpec>,
  palette: TreeSpeciesPalette,
  random: () => number,
  winter: boolean,
  options: { denseGlow?: boolean; berryGlow?: boolean; rimBlossoms?: boolean } = {},
): void {
  // 1. 最外层暗色轮廓边
  for (const c of clusters) {
    fillPixelLobe(g, c.cx, c.cy, c.rx + 1, c.ry + 1, palette.canopyEdge, c.shape ?? 1);
  }
  // 2. 下部阴影主体
  for (const c of clusters) {
    fillPixelLobe(g, c.cx, c.cy + 1, c.rx, c.ry, palette.canopyDeep, c.shape ?? 1);
  }
  // 3. 中调叶面（略向左上抬光）
  for (const c of clusters) {
    fillPixelLobe(g, c.cx - 1, c.cy - 1, Math.max(2, c.rx - 1), Math.max(2, c.ry - 1), palette.canopyMid, c.shape ?? 1);
  }
  // 4. 上层受光冠顶
  for (const c of clusters) {
    const hx = c.cx - Math.max(1, Math.round(c.rx * 0.2));
    const hy = c.cy - Math.max(1, Math.round(c.ry * 0.28));
    fillPixelLobe(
      g,
      hx,
      hy,
      Math.max(2, Math.round(c.rx * 0.62)),
      Math.max(2, Math.round(c.ry * 0.52)),
      palette.canopyLight,
      c.shape ?? 1,
    );
  }
  // 5. 质感点彩（叶隙、花簇或红果）
  for (const c of clusters) {
    const count = options.denseGlow ? 9 : options.berryGlow ? 4 : 5;
    for (let i = 0; i < count; i += 1) {
      const px = Math.round(c.cx + (random() - 0.52) * c.rx * 1.45);
      const py = Math.round(c.cy + (random() - 0.55) * c.ry * 1.35);
      const bright = random() > 0.35;
      if (options.berryGlow) {
        g.rect(px, py, 2, 2).fill(bright ? palette.canopyGlow : palette.canopyDeep);
      } else {
        g.rect(px, py, random() > 0.55 ? 2 : 1, random() > 0.65 ? 2 : 1).fill(
          bright ? palette.canopyGlow : palette.canopyDeep,
        );
      }
    }
    if (options.rimBlossoms && random() > 0.3) {
      for (let p = 0; p < 3; p += 1) {
        const bx = Math.round(c.cx + (random() - 0.5) * (c.rx * 2 + 6));
        const by = Math.round(c.cy + (random() - 0.35) * (c.ry * 2 + 4));
        g.rect(bx, by, 1, 1).fill(palette.canopyGlow);
      }
    }
  }
  // 6. 冬季积雪帽：压在每团上半坡面上，边缘留一像素冰影
  if (winter) {
    for (const c of clusters) {
      const topOffset = Math.max(2, Math.round(c.ry * 0.46));
      fillPixelLobe(g, c.cx - 1, c.cy - topOffset, Math.max(2, Math.round(c.rx * 0.78)), Math.max(2, Math.round(c.ry * 0.36)), W.snowShade, 0);
      fillPixelLobe(g, c.cx - 1, c.cy - topOffset - 1, Math.max(2, Math.round(c.rx * 0.72)), Math.max(1, Math.round(c.ry * 0.28)), W.snowBase, 0);
      fillPixelLobe(g, c.cx - 2, c.cy - topOffset - 2, Math.max(1, Math.round(c.rx * 0.46)), Math.max(1, Math.round(c.ry * 0.16)), W.snowLight, 0);
    }
  }
}

/** 分叉、盘根树干绘制：按树种区分曲直粗细与冬季根雪 */
function drawSpeciesTrunk(
  g: Graphics,
  cx: number,
  bottomY: number,
  trunkH: number,
  trunkW: number,
  lean: number,
  forked: boolean,
  palette: TreeSpeciesPalette,
  winter: boolean,
  random: () => number,
): void {
  const half = Math.floor(trunkW / 2);
  const topY = bottomY - trunkH;

  // 1. 抓地盘根
  g.rect(cx - half - 4, bottomY - 4, trunkW + 8, 4).fill(palette.trunk);
  g.rect(cx - half - 2, bottomY - 6, trunkW + 4, 3).fill(palette.trunkLight);

  // 2. 逐行微曲树干（保证倾斜感与左亮右暗体积）
  for (let row = 0; row < trunkH; row += 1) {
    const t = row / Math.max(1, trunkH);
    const curX = Math.round(cx + lean * (1 - t));
    const taper = t > 0.7 ? 1 : 0;
    const curW = Math.max(3, trunkW + taper * 2);
    const sx = curX - Math.floor(curW / 2);
    const y = topY + row;
    g.rect(sx - 1, y, curW + 2, 1).fill(palette.trunk);
    g.rect(sx, y, curW, 1).fill(palette.trunkLight);
    // 右侧暗面纹理
    g.rect(sx + Math.max(1, curW - 2), y, 2, 1).fill(palette.trunk);
  }

  // 3. 树皮斜纹与主干分叉枝条
  for (let b = 0; b < 5; b += 1) {
    const by = topY + 4 + Math.floor(random() * Math.max(4, trunkH - 10));
    const bx = cx + lean * 0.4 + (random() > 0.5 ? 1 : -1);
    g.rect(Math.round(bx), by, 1, 3).fill(palette.trunk);
  }

  if (forked) {
    const midY = topY + Math.round(trunkH * 0.35);
    const tx = cx + lean;
    for (let s = 0; s < 10; s += 1) {
      g.rect(Math.round(tx - s), Math.round(midY - s * 0.7), 3, 2).fill(palette.trunk);
      g.rect(Math.round(tx + s), Math.round(midY - s * 0.6), 3, 2).fill(palette.trunk);
      if (s < 7) {
        g.rect(Math.round(tx - s), Math.round(midY - s * 0.7), 2, 1).fill(palette.trunkLight);
        g.rect(Math.round(tx + s), Math.round(midY - s * 0.6), 2, 1).fill(palette.trunkLight);
      }
    }
  }

  if (winter) {
    g.rect(cx - half - 5, bottomY - 6, trunkW + 10, 3).fill(W.snowBase);
    g.rect(cx - half - 4, bottomY - 7, trunkW + 8, 1).fill(W.snowLight);
    g.rect(cx - half - 6, bottomY - 3, trunkW + 12, 2).fill(W.snowShade);
  }
}

/** 垂柳专有下垂柳条：细丝连缀叶节，向下飘过树腰 */
function drawWillowTendrils(
  g: Graphics,
  cx: number,
  topY: number,
  spanW: number,
  dropLen: number,
  palette: TreeSpeciesPalette,
  random: () => number,
  winter: boolean,
): void {
  const strands = Math.round(spanW / 4);
  for (let i = 0; i < strands; i += 1) {
    const t = i / Math.max(1, strands - 1) - 0.5;
    const x = Math.round(cx + t * spanW);
    const localLen = Math.round(dropLen * (0.72 + random() * 0.36) * (1 - Math.abs(t) * 0.3));
    const archY = topY + Math.round(Math.abs(t) * 10);
    for (let y = 0; y < localLen; y += 1) {
      const sway = y > localLen * 0.6 && random() > 0.6 ? (t >= 0 ? 1 : -1) : 0;
      const tone = y < 6 ? palette.canopyDeep : y < localLen - 6 ? palette.canopyMid : palette.canopyGlow;
      g.rect(x + sway, archY + y, y % 3 === 0 ? 2 : 1, 1).fill(tone);
      if (winter && y < 4 && random() > 0.55) {
        g.rect(x + sway, archY + y, 1, 1).fill(W.snowBase);
      }
    }
  }
}

/** 为 9 种植物各自定制截然不同的骨架与冠型 */
function clustersForSpecies(
  species: TreeSpeciesId,
  cx: number,
  trunkTop: number,
  variant: number,
  hero: boolean,
): {
  clusters: ClusterSpec[];
  trunkW: number;
  trunkH: number;
  lean: number;
  forked: boolean;
  opts: { denseGlow?: boolean; berryGlow?: boolean; rimBlossoms?: boolean; willowSpan?: number; willowDrop?: number };
} {
  const scale = hero ? 1.38 : 1;
  const vShift = (variant - 1) * 3;
  const lean = hero ? (variant === 0 ? -3 : 3) : variant === 1 ? 0 : variant === 0 ? -2 : 2;

  switch (species) {
    case 'sakura': {
      const trunkH = Math.round(32 * scale);
      const top = trunkTop - Math.round(6 * scale);
      return {
        trunkW: Math.round((8 + (variant % 2)) * scale),
        trunkH,
        lean: lean * 2,
        forked: true,
        opts: { denseGlow: true, rimBlossoms: true },
        clusters: [
          { cx: cx - 14 * scale, cy: top - 16 * scale, rx: 16 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + 15 * scale, cy: top - 14 * scale, rx: 15 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + vShift, cy: top - 28 * scale, rx: 19 * scale, ry: 14 * scale, shape: 1 },
          { cx: cx - 5 * scale + vShift, cy: top - 12 * scale, rx: 18 * scale, ry: 11 * scale, shape: 1 },
        ],
      };
    }
    case 'ginkgo': {
      const trunkH = Math.round(36 * scale);
      const top = trunkTop - Math.round(4 * scale);
      return {
        trunkW: Math.round((8 + (variant === 1 ? 2 : 0)) * scale),
        trunkH,
        lean,
        forked: true,
        opts: { denseGlow: true },
        clusters: [
          { cx: cx - 12 * scale, cy: top - 16 * scale, rx: 14 * scale, ry: 12 * scale, shape: 2 },
          { cx: cx + 12 * scale, cy: top - 15 * scale, rx: 14 * scale, ry: 12 * scale, shape: 2 },
          { cx: cx + vShift, cy: top - 34 * scale, rx: 16 * scale, ry: 16 * scale, shape: 2 },
          { cx: cx + vShift * 0.5, cy: top - 19 * scale, rx: 20 * scale, ry: 11 * scale, shape: 1 },
        ],
      };
    }
    case 'maple': {
      const trunkH = Math.round(34 * scale);
      const top = trunkTop - Math.round(5 * scale);
      return {
        trunkW: Math.round(7 * scale),
        trunkH,
        lean: lean * 2,
        forked: true,
        opts: { rimBlossoms: true },
        clusters: [
          { cx: cx - 15 * scale, cy: top - 12 * scale, rx: 14 * scale, ry: 10 * scale, shape: 2 },
          { cx: cx + 15 * scale, cy: top - 15 * scale, rx: 15 * scale, ry: 10 * scale, shape: 2 },
          { cx: cx - 4 * scale + vShift, cy: top - 27 * scale, rx: 16 * scale, ry: 13 * scale, shape: 2 },
          { cx: cx + 8 * scale, cy: top - 23 * scale, rx: 12 * scale, ry: 11 * scale, shape: 2 },
        ],
      };
    }
    case 'pine': {
      const trunkH = Math.round(40 * scale);
      const top = trunkTop;
      return {
        trunkW: Math.round(8 * scale),
        trunkH,
        lean: lean * 2,
        forked: true,
        opts: {},
        clusters: [
          { cx: cx - 15 * scale, cy: top - 12 * scale, rx: 16 * scale, ry: 7 * scale, shape: 0 },
          { cx: cx + 14 * scale, cy: top - 20 * scale, rx: 16 * scale, ry: 7 * scale, shape: 0 },
          { cx: cx - 6 * scale + vShift, cy: top - 30 * scale, rx: 15 * scale, ry: 7 * scale, shape: 0 },
          { cx: cx + 3 * scale, cy: top - 40 * scale, rx: 12 * scale, ry: 6 * scale, shape: 0 },
        ],
      };
    }
    case 'willow': {
      const trunkH = Math.round(36 * scale);
      const top = trunkTop - Math.round(8 * scale);
      return {
        trunkW: Math.round(8 * scale),
        trunkH,
        lean,
        forked: true,
        opts: { willowSpan: Math.round(44 * scale), willowDrop: Math.round(34 * scale) },
        clusters: [
          { cx: cx - 12 * scale, cy: top - 18 * scale, rx: 14 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + 12 * scale, cy: top - 17 * scale, rx: 14 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + vShift, cy: top - 28 * scale, rx: 17 * scale, ry: 13 * scale, shape: 1 },
        ],
      };
    }
    case 'jacaranda': {
      const trunkH = Math.round(36 * scale);
      const top = trunkTop - Math.round(6 * scale);
      return {
        trunkW: Math.round(7 * scale),
        trunkH,
        lean,
        forked: true,
        opts: { denseGlow: true, rimBlossoms: true },
        clusters: [
          { cx: cx - 16 * scale, cy: top - 18 * scale, rx: 16 * scale, ry: 10 * scale, shape: 0 },
          { cx: cx + 16 * scale, cy: top - 17 * scale, rx: 16 * scale, ry: 10 * scale, shape: 0 },
          { cx: cx + vShift, cy: top - 28 * scale, rx: 22 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx - 4 * scale, cy: top - 14 * scale, rx: 15 * scale, ry: 9 * scale, shape: 1 },
        ],
      };
    }
    case 'cypress': {
      const trunkH = Math.round(24 * scale);
      const top = trunkTop - Math.round(4 * scale);
      return {
        trunkW: Math.round(6 * scale),
        trunkH,
        lean: 0,
        forked: false,
        opts: {},
        clusters: [
          { cx: cx + vShift * 0.3, cy: top - 14 * scale, rx: 12 * scale, ry: 15 * scale, shape: 2 },
          { cx: cx + vShift * 0.4, cy: top - 32 * scale, rx: 10 * scale, ry: 15 * scale, shape: 2 },
          { cx: cx + vShift * 0.4, cy: top - 49 * scale, rx: 7 * scale, ry: 13 * scale, shape: 2 },
          { cx: cx + vShift * 0.4, cy: top - 62 * scale, rx: 4 * scale, ry: 9 * scale, shape: 2 },
        ],
      };
    }
    case 'holly': {
      const trunkH = Math.round(30 * scale);
      const top = trunkTop - Math.round(4 * scale);
      return {
        trunkW: Math.round(7 * scale),
        trunkH,
        lean: 0,
        forked: false,
        opts: { berryGlow: true },
        clusters: [
          { cx: cx - 10 * scale, cy: top - 15 * scale, rx: 12 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + 10 * scale, cy: top - 15 * scale, rx: 12 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx, cy: top - 24 * scale, rx: 16 * scale, ry: 16 * scale, shape: 1 },
        ],
      };
    }
    case 'osmanthus': {
      const trunkH = Math.round(33 * scale);
      const top = trunkTop - Math.round(5 * scale);
      return {
        trunkW: Math.round(8 * scale),
        trunkH,
        lean,
        forked: true,
        opts: { denseGlow: true },
        clusters: [
          { cx: cx - 13 * scale, cy: top - 15 * scale, rx: 14 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + 13 * scale, cy: top - 14 * scale, rx: 14 * scale, ry: 12 * scale, shape: 1 },
          { cx: cx + vShift, cy: top - 27 * scale, rx: 18 * scale, ry: 14 * scale, shape: 1 },
          { cx: cx, cy: top - 13 * scale, rx: 16 * scale, ry: 11 * scale, shape: 1 },
        ],
      };
    }
  }
}

function makeOneTree(
  renderer: TextureFactory,
  species: TreeSpeciesId,
  variant: number,
  winter: boolean,
  hero: boolean,
): TreeTextures {
  const w = hero ? HERO_TREE_W : TREE_W;
  const h = hero ? HERO_TREE_H : TREE_H;
  const cx = Math.round(w / 2);
  const palette = TREE_SPECIES[species];
  const speciesIdx = TREE_SPECIES_ORDER.indexOf(species);
  const seedBase = 0x7f4a + speciesIdx * 1993 + variant * 409 + (hero ? 997 : 0);

  const trunkEstimate = hero ? 48 : 34;
  const spec = clustersForSpecies(species, cx, h - trunkEstimate, variant, hero);

  const trunk = bakeFrame(renderer, w, h, (g) => {
    const rand = seeded(seedBase);
    drawSpeciesTrunk(g, cx, h, spec.trunkH, spec.trunkW, spec.lean, spec.forked, palette, winter, rand);
  });

  const canopy = bakeFrame(renderer, w, h, (g) => {
    const rand = seeded(seedBase ^ 0x51a7);
    const trunkTop = h - spec.trunkH;
    const clusters = clustersForSpecies(species, cx + spec.lean, trunkTop, variant, hero).clusters;
    if (spec.opts.willowSpan && spec.opts.willowDrop) {
      drawWillowTendrils(
        g,
        cx + spec.lean,
        trunkTop - 16,
        spec.opts.willowSpan,
        spec.opts.willowDrop,
        palette,
        rand,
        winter,
      );
    }
    drawFoliageClusters(g, clusters, palette, rand, winter, spec.opts);
  });

  return { trunk, canopy };
}

/** 一次烘焙全部 9 树种 × 3 变体（27 套）与 9 树种古树版（9 套） */
export function makeTreeTextureBank(renderer: TextureFactory, winter = false): TreeTextureBank {
  const bySpecies = {} as Record<TreeSpeciesId, TreeTextures[]>;
  const heroBySpecies = {} as Record<TreeSpeciesId, TreeTextures>;
  const flat: TreeTextures[] = [];

  for (const species of TREE_SPECIES_ORDER) {
    const variants: TreeTextures[] = [];
    for (let v = 0; v < TREE_VARIANTS_PER_SPECIES; v += 1) {
      variants.push(makeOneTree(renderer, species, v, winter, false));
    }
    bySpecies[species] = variants;
    heroBySpecies[species] = makeOneTree(renderer, species, 0, winter, true);
    flat.push(variants[0]!);
  }

  return { bySpecies, heroBySpecies, flat };
}
