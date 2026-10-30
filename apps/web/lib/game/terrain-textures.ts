'use client';

import { Graphics, type Application, type Texture } from 'pixi.js';
import { seeded } from './seeded';
import { TERRAIN_COLORS as C } from './terrain-palette';

/**
 * 地形贴图工厂：全部 1:1 生成 + nearest 采样（ADR-0005）。
 * 只有整数尺寸的平铺图块与精灵，运行期不再 generateTexture。
 */

type TextureFactory = Application['renderer'];

function bake(renderer: TextureFactory, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    resolution: 1,
    antialias: false,
    textureSourceOptions: { scaleMode: 'nearest' },
  });
  g.destroy();
  return texture;
}

/** 草地基底：深苔绿 + 亮边草簇，密度压到不抢角色 */
export function makeGrassTexture(renderer: TextureFactory): Texture {
  const size = 256;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.grassBase);
    for (let y = 0; y < size; y += 32) {
      for (let x = 0; x < size; x += 32) {
        if (((x + y) / 32) % 2 === 0) g.rect(x, y, 32, 32).fill(C.grassAlt);
      }
    }
    const random = seeded(0x51ed270b);
    for (let i = 0; i < 260; i += 1) {
      const x = Math.floor(random() * (size - 2));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1, random() > 0.55 ? 2 : 1).fill(C.grassTuft);
    }
    for (let i = 0; i < 26; i += 1) {
      const x = Math.floor(random() * (size - 3));
      const y = Math.floor(random() * (size - 3));
      g.rect(x, y, 2, 1).fill(C.grassStone);
    }
  });
}

/** 办公广场地砖：沿用旧版地面的砖缝 / 线缆槽 / 纸屑，保证园区中心还是那个园区 */
export function makePlazaTexture(renderer: TextureFactory): Texture {
  const size = 256;
  const tile = 32;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.plazaBase);
    for (let y = 0; y < size; y += tile) {
      for (let x = 0; x < size; x += tile) {
        const odd = (x / tile + y / tile) % 2 === 0;
        g.rect(x, y, tile, tile).fill(odd ? C.plazaAlt : 0x121a13);
        // 砖缝只画上、左两条，平铺时不会出现 2px 双线
        g.rect(x, y, tile, 1).fill(C.plazaSeam);
        g.rect(x, y, 1, tile).fill(C.plazaSeam);
        g.rect(x + 1, y + 1, tile - 2, 1).fill(C.plazaHighlight);
      }
    }
    const speckles: Array<[number, number, number, number]> = [
      [24, 58, 2, 1],
      [78, 22, 1, 2],
      [140, 74, 2, 2],
      [206, 40, 1, 1],
      [40, 150, 2, 1],
      [176, 166, 1, 1],
      [112, 214, 2, 2],
      [244, 232, 1, 1],
    ];
    for (const [x, y, w, h] of speckles) g.rect(x, y, w, h).fill(C.plazaEdge);

    // 线缆槽：一条横贯的地槽，两端各留 8px 让平铺接缝对齐
    g.rect(8, 122, size - 16, 3).fill(C.plazaSeam);
    g.rect(8, 125, size - 16, 1).fill(C.plazaHighlight);

    // 纸屑、咖啡渍、通风口：各来一处，密度低才不抢角色
    g.rect(196, 92, 5, 4).fill(0x8f9a8c);
    g.rect(197, 93, 3, 1).fill(0x6d776c);
    g.rect(60, 196, 9, 5).fill(0x17201a);
    g.rect(62, 195, 6, 1).fill(C.plazaEdge);
    g.rect(150, 20, 8, 8).fill(0x101711);
    for (let i = 0; i < 3; i += 1) g.rect(151, 22 + i * 2, 6, 1).fill(0x1d281e);
  });
}

/** 土路：车辙方向不固定，只用碎石与深浅斑，纵横都看不出接缝 */
export function makeDirtTexture(renderer: TextureFactory): Texture {
  const size = 128;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.dirtBase);
    for (let y = 0; y < size; y += 32) {
      for (let x = 0; x < size; x += 32) {
        if (((x + y) / 32) % 2 === 0) g.rect(x, y, 32, 32).fill(C.dirtAlt);
      }
    }
    const random = seeded(0x2c9fd3a1);
    for (let i = 0; i < 90; i += 1) {
      const x = Math.floor(random() * (size - 4));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1 + Math.floor(random() * 3), 1).fill(C.dirtRut);
    }
    for (let i = 0; i < 34; i += 1) {
      const x = Math.floor(random() * (size - 2));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1 + Math.floor(random() * 2), 1).fill(C.dirtPebble);
    }
  });
}

/** 水面：32px 起平铺，波纹错行排布，滚动时不会看到接缝 */
export function makeWaterTexture(renderer: TextureFactory): Texture {
  const size = 32;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.waterDeep);
    for (let band = 0; band < 4; band += 1) {
      const y = band * 8;
      const offset = (band % 2) * 8;
      g.rect(0, y, size, 1).fill(C.waterMid);
      g.rect(offset, y + 1, 12, 1).fill(C.waterCrest);
      g.rect(offset + 18, y + 1, 6, 1).fill(C.waterCrest);
      g.rect(offset + 2, y + 2, 4, 1).fill(C.waterFoam);
      g.rect(offset + 22, y + 2, 2, 1).fill(C.waterFoam);
    }
  });
}

/** 四种树形：行宽不同、树干高度不同，凑近看才不像复制粘贴 */
const TREE_PROFILES: number[][] = [
  [0.18, 0.38, 0.58, 0.75, 0.88, 0.97, 1, 0.97, 0.88, 0.72, 0.52, 0.3],
  [0.22, 0.44, 0.64, 0.8, 0.92, 0.99, 0.94, 0.84, 0.68, 0.46, 0.26],
  [0.14, 0.3, 0.5, 0.68, 0.84, 0.95, 1, 0.96, 0.86, 0.7, 0.5, 0.28],
  [0.28, 0.5, 0.7, 0.86, 0.96, 1, 0.92, 0.78, 0.58, 0.36],
];
const TREE_ROW_HEIGHT = 3;
const TREE_CANVAS_HEIGHT = 68;
const TREE_CENTER = 32;

function makeTreeTexture(renderer: TextureFactory, variant: number): Texture {
  const profile = TREE_PROFILES[variant % TREE_PROFILES.length]!;
  const canopyWidth = 30 + (variant % 2) * 4;
  return bake(renderer, (g) => {
    const trunkWidth = 4 + (variant % 2) * 2;
    const trunkHeight = 15 + (variant % 3) * 3;
    const trunkX = Math.round(TREE_CENTER - trunkWidth / 2);
    const trunkTop = TREE_CANVAS_HEIGHT - trunkHeight;

    // 树干：左侧一列压暗，给平面图形一点体积
    g.rect(trunkX - 1, trunkTop, trunkWidth + 2, trunkHeight).fill(C.trunkDark);
    g.rect(trunkX, trunkTop, trunkWidth, trunkHeight).fill(C.trunkLight);
    g.rect(trunkX, trunkTop, 1, trunkHeight).fill(C.trunkDark);

    const random = seeded(0x7f4a + variant * 977);
    profile.forEach((ratio, index) => {
      const width = Math.max(4, Math.round(ratio * canopyWidth));
      const y = trunkTop - (index + 1) * TREE_ROW_HEIGHT;
      const x = Math.round(TREE_CENTER - width / 2);
      // 先铺 1px 暗边再压主体，剪影才立得住
      g.rect(x - 1, y, width + 2, TREE_ROW_HEIGHT).fill(C.canopyEdge);
      g.rect(x, y, width, TREE_ROW_HEIGHT).fill(C.canopyMid);
      g.rect(x, y, width, 1).fill(C.canopyLight);
      g.rect(x, y + TREE_ROW_HEIGHT - 1, width, 1).fill(C.canopyDeep);

      const marks = 2 + Math.floor(random() * 3);
      for (let m = 0; m < marks; m += 1) {
        const mx = x + 1 + Math.floor(random() * Math.max(1, width - 3));
        const my = y + Math.floor(random() * 2);
        const bright = random() > 0.5;
        g.rect(mx, my, random() > 0.65 ? 2 : 1, 1).fill(bright ? C.canopyLight : C.canopyDeep);
      }
    });
  });
}

export function makeTreeTextures(renderer: TextureFactory): Texture[] {
  return TREE_PROFILES.map((_, index) => makeTreeTexture(renderer, index));
}

/** 石头：只做视觉点缀，不参与碰撞 */
export function makeRockTexture(renderer: TextureFactory): Texture {
  return bake(renderer, (g) => {
    g.rect(1, 4, 10, 5).fill(C.rock);
    g.rect(2, 3, 8, 1).fill(C.rockLight);
    g.rect(3, 5, 3, 2).fill(C.rockLight);
    g.rect(1, 9, 10, 1).fill(C.canopyEdge);
    g.rect(9, 5, 1, 3).fill(C.canopyEdge);
  });
}

/** 广场花箱：矮木箱 + 一丛灌木，站在它后面会被挡住半个身子 */
export function makePlanterTexture(renderer: TextureFactory): Texture {
  return bake(renderer, (g) => {
    g.rect(3, 18, 22, 14).fill(C.fenceDark);
    g.rect(4, 19, 20, 12).fill(C.bridgeWood);
    g.rect(4, 19, 20, 2).fill(C.fenceLight);
    g.rect(4, 29, 20, 2).fill(C.bridgeSeam);

    g.rect(5, 8, 18, 11).fill(C.canopyEdge);
    g.rect(6, 7, 16, 11).fill(C.canopyMid);
    g.rect(7, 6, 14, 2).fill(C.canopyLight);
    g.rect(9, 10, 4, 2).fill(C.canopyLight);
    g.rect(16, 12, 3, 2).fill(C.canopyLight);
    g.rect(8, 15, 12, 3).fill(C.canopyDeep);
  });
}

/** 芦苇：水边三根错落的茎 */
export function makeReedTexture(renderer: TextureFactory): Texture {
  return bake(renderer, (g) => {
    const stalks: Array<[number, number]> = [
      [1, 12],
      [4, 15],
      [6, 10],
    ];
    for (const [x, height] of stalks) {
      g.rect(x, 16 - height, 1, height).fill(C.reed);
      g.rect(x, 16 - height, 1, 3).fill(C.reedLight);
    }
    g.rect(0, 15, 9, 1).fill(C.canopyEdge);
  });
}
