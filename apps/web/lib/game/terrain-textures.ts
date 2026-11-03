'use client';

import { Graphics, Rectangle, Texture, type Application } from 'pixi.js';
import { DECAL_KINDS } from './decals';
import { fillEllipse } from './fx';
import { seeded } from './seeded';
import { TERRAIN_COLORS as C } from './terrain-palette';

/**
 * 地形贴图工厂：全部 1:1 生成 + nearest 采样（ADR-0005）。
 * 只有整数尺寸的平铺图块与精灵，运行期不再 generateTexture。
 *
 * 色温纪律（ADR-0013）：所有形体只有「本体 + 一档暗边」，
 * 暗边一律取本体色相压暗（EDGE_TINT），不出现纯黑。
 *
 * 尺度基准（ADR-0010）：角色从 41 texel 长到 48 texel，地形件按 1.25 一起放大。
 * 树高 = 角色 ×2.25、地砖边长为角色身高的 1/3、围栏齐胸。
 */

type TextureFactory = Application['renderer'];

interface BakeOptions {
  /** 固定画布框：拆层后的树干与树冠必须共用同一帧，锚点才对得上 */
  frame?: Rectangle;
}

function bake(renderer: TextureFactory, draw: (g: Graphics) => void, options: BakeOptions = {}): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    frame: options.frame,
    resolution: 1,
    antialias: false,
    textureSourceOptions: { scaleMode: 'nearest' },
  });
  g.destroy();
  return texture;
}

/** 平铺图案要跨过边界时补画一条：否则 256 的图块接缝处会出现半块砖 */
function wrappedRect(g: Graphics, x: number, y: number, w: number, h: number, size: number, fill: number): void {
  const left = ((x % size) + size) % size;
  g.rect(left, y, w, h).fill(fill);
  if (left + w > size) g.rect(0, y, left + w - size, h).fill(fill);
}

/**
 * 草地基底：整块 64px 有机色块 + 草簇。
 * 对比压得比暗调时代更平——细节交给贴花层，地面只负责退到背景里。
 */
export function makeGrassTexture(renderer: TextureFactory): Texture {
  const size = 256;
  const patch = 64;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.grassBase);
    const random = seeded(0x51ed270b);
    // 色块不再对齐网格：每块随机偏移 ±12，平铺时看不出周期
    for (let y = 0; y < size; y += patch) {
      for (let x = 0; x < size; x += patch) {
        if (random() > 0.55) continue;
        const ox = Math.round((random() - 0.5) * 24);
        const oy = Math.round((random() - 0.5) * 24);
        wrappedRect(g, x + ox, y + oy, patch, patch, size, C.grassAlt);
      }
    }
    // 少量深色下层草叶：只在暗调基底上做体积，不参与明度对比
    for (let i = 0; i < 160; i += 1) {
      const x = Math.floor(random() * (size - 2));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1, 1).fill(C.grassDeep);
    }
    for (let i = 0; i < 420; i += 1) {
      const x = Math.floor(random() * (size - 2));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1, random() > 0.55 ? 2 : 1).fill(C.grassTuft);
    }
    for (let i = 0; i < 34; i += 1) {
      const x = Math.floor(random() * (size - 3));
      const y = Math.floor(random() * (size - 3));
      g.rect(x, y, 2, 1).fill(C.grassStone);
    }
  });
}

/**
 * 办公广场地砖：64×32 大板、上下错缝、只有 1px 深缝，取消每块砖的亮边。
 * 地面越「有图案」，角色越出不来。
 */
export function makePlazaTexture(renderer: TextureFactory): Texture {
  const size = 256;
  const bw = 64;
  const bh = 32;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.plazaSeam);
    for (let row = 0; row * bh < size; row += 1) {
      const y = row * bh;
      const offset = (row % 2) * (bw / 2);
      for (let brick = -1; brick * bw < size + bw; brick += 1) {
        const x = brick * bw + offset;
        // 两种板面只差一档明度：有错缝就已经够了，再拉对比地面就抢戏
        const tone = (row + brick) % 2 === 0 ? C.plazaBase : C.plazaAlt;
        wrappedRect(g, x + 1, y + 1, bw - 2, bh - 2, size, tone);
        wrappedRect(g, x + 1, y + 1, bw - 2, 1, size, C.plazaHighlight);
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
    g.rect(8, 122, size - 16, 4).fill(C.plazaSeam);
    g.rect(8, 126, size - 16, 1).fill(C.plazaHighlight);

    // 纸屑、咖啡渍、通风口：各来一处，密度低才不抢角色
    g.rect(196, 92, 5, 4).fill(C.plazaEdge);
    g.rect(197, 93, 3, 1).fill(C.plazaSeam);
    g.rect(60, 196, 9, 5).fill(C.bridgeSeam);
    g.rect(62, 195, 6, 1).fill(C.plazaEdge);
    g.rect(150, 20, 8, 8).fill(C.fenceDark);
    for (let i = 0; i < 3; i += 1) g.rect(151, 22 + i * 2, 6, 1).fill(C.trunkDark);
  });
}

/** 土路：车辙方向不固定，只用碎石与深浅斑，纵横都看不出接缝 */
export function makeDirtTexture(renderer: TextureFactory): Texture {
  const size = 128;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.dirtBase);
    const random = seeded(0x2c9fd3a1);
    for (let i = 0; i < 26; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      g.rect(x, y, 40 + Math.floor(random() * 24), 24 + Math.floor(random() * 16)).fill(C.dirtAlt);
    }
    for (let i = 0; i < 110; i += 1) {
      const x = Math.floor(random() * (size - 4));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1 + Math.floor(random() * 3), 1).fill(C.dirtRut);
    }
    for (let i = 0; i < 40; i += 1) {
      const x = Math.floor(random() * (size - 2));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1 + Math.floor(random() * 2), 1).fill(C.dirtPebble);
    }
  });
}

/** 水面：48px 起平铺，波纹错行排布，滚动时不会看到接缝（与 terrain.ts 的 WATER_TILE 必须同值） */
export function makeWaterTexture(renderer: TextureFactory): Texture {
  const size = 48;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.waterDeep);
    for (let band = 0; band < 4; band += 1) {
      const y = band * 12;
      const offset = (band % 2) * 12;
      g.rect(0, y, size, 1).fill(C.waterMid);
      g.rect(offset, y + 2, 18, 1).fill(C.waterCrest);
      g.rect(offset + 27, y + 2, 9, 1).fill(C.waterCrest);
      g.rect(offset + 3, y + 3, 6, 1).fill(C.waterFoam);
      g.rect(offset + 33, y + 3, 3, 1).fill(C.waterFoam);
    }
  });
}

/**
 * 深海：96px 平铺，波纹比湖面更稀更慢。
 * 海面只在海岸附近进入视野，密度再高就会抢沙滩的过渡。
 */
export function makeSeaTexture(renderer: TextureFactory): Texture {
  const size = 96;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.seaBase);
    const random = seeded(0x5ea5a17);
    for (let band = 0; band < 6; band += 1) {
      const y = band * 16;
      const offset = (band % 2) * 24;
      g.rect(0, y, size, 1).fill(C.seaMid);
      g.rect(offset, y + 4, 14, 1).fill(C.seaCrest);
      g.rect(offset + 58, y + 6, 9, 1).fill(C.seaCrest);
    }
    for (let i = 0; i < 48; i += 1) {
      const x = Math.floor(random() * (size - 4));
      const y = Math.floor(random() * (size - 2));
      g.rect(x, y, 1 + Math.floor(random() * 3), 1).fill(C.seaFoam);
    }
  });
}

/* ------------------------------------------------------------------ *
 * 树：树干与树冠拆成两张同帧纹理（ADR-0013）
 *
 * 拆层是为了「角色走到树后时只让树冠淡到 0.85」。两张纹理必须共用
 * 同一个 TREE_W × TREE_H 画布，否则 (0.5, 1) 锚点会让树冠整体偏移。
 * ------------------------------------------------------------------ */

export const TREE_W = 72;
export const TREE_H = 108;
const TREE_CENTER = TREE_W / 2;
const TREE_FRAME = new Rectangle(0, 0, TREE_W, TREE_H);

/** 四种树形：行宽不同、树干高度不同，凑近看才不像复制粘贴 */
const TREE_PROFILES: number[][] = [
  [0.16, 0.32, 0.5, 0.66, 0.8, 0.9, 0.96, 1, 1, 0.98, 0.94, 0.88, 0.8, 0.7, 0.58, 0.44, 0.3, 0.18],
  [0.2, 0.4, 0.58, 0.72, 0.86, 0.94, 1, 0.99, 0.94, 0.86, 0.76, 0.64, 0.52, 0.4, 0.28, 0.16],
  [0.12, 0.28, 0.46, 0.62, 0.78, 0.9, 0.98, 1, 0.98, 0.94, 0.86, 0.76, 0.64, 0.5, 0.36, 0.22],
  [0.24, 0.46, 0.66, 0.82, 0.94, 1, 0.98, 0.92, 0.82, 0.7, 0.56, 0.42, 0.28, 0.16],
];
const TREE_ROW_HEIGHT = 4;

export interface TreeTextures {
  trunk: Texture;
  canopy: Texture;
}

function makeTreeParts(renderer: TextureFactory, variant: number): TreeTextures {
  const profile = TREE_PROFILES[variant % TREE_PROFILES.length]!;
  const canopyWidth = 56 + (variant % 2) * 6;
  const trunkWidth = 7 + (variant % 2) * 3;
  const trunkHeight = 28 + (variant % 3) * 4;
  const trunkX = Math.round(TREE_CENTER - trunkWidth / 2);
  const trunkTop = TREE_H - trunkHeight;
  const random = seeded(0x7f4a + variant * 977);

  const trunk = bake(
    renderer,
    (g) => {
      // 树根：底部两格外扩，树才不是插在地上的一根棍
      g.rect(trunkX - 3, TREE_H - 5, trunkWidth + 6, 5).fill(C.trunkDark);
      g.rect(trunkX - 2, TREE_H - 6, trunkWidth + 4, 3).fill(C.trunkLight);
      g.rect(trunkX - 1, trunkTop, trunkWidth + 2, trunkHeight).fill(C.trunkDark);
      g.rect(trunkX, trunkTop, trunkWidth, trunkHeight).fill(C.trunkLight);
      g.rect(trunkX, trunkTop, 2, trunkHeight).fill(C.trunkDark);
      // 树皮纹理：只用同一族的两档，靠近黑的深棕会把暖色体系戳破
      for (let i = 0; i < 6; i += 1) {
        const y = trunkTop + 3 + Math.floor(random() * (trunkHeight - 6));
        g.rect(trunkX + 2 + Math.floor(random() * (trunkWidth - 3)), y, 1, 2).fill(C.trunkDark);
      }
      // 树干与树冠的接缝：压一档暗，树冠盖上去才有「长在树上」的感觉
      g.rect(trunkX - 1, trunkTop, trunkWidth + 2, 2).fill(C.trunkDark);
    },
    { frame: TREE_FRAME },
  );

  const canopy = bake(
    renderer,
    (g) => {
      profile.forEach((ratio, index) => {
        const width = Math.max(6, Math.round(ratio * canopyWidth));
        const y = trunkTop - (index + 1) * TREE_ROW_HEIGHT;
        const x = Math.round(TREE_CENTER - width / 2);
        // 先铺 1px 暗边再压主体，剪影才立得住
        g.rect(x - 2, y, width + 4, TREE_ROW_HEIGHT).fill(C.canopyEdge);
        g.rect(x, y, width, TREE_ROW_HEIGHT).fill(C.canopyMid);
        g.rect(x, y, width, 1).fill(C.canopyLight);
        g.rect(x, y + TREE_ROW_HEIGHT - 1, width, 1).fill(C.canopyDeep);

        // 受光的颜色斑块：随机撒，但只在行内，形状不会碎成噪点
        const marks = 2 + Math.floor(random() * 4);
        for (let m = 0; m < marks; m += 1) {
          const mx = x + 2 + Math.floor(random() * Math.max(1, width - 5));
          const my = y + Math.floor(random() * 3);
          const bright = random() > 0.45;
          g.rect(mx, my, random() > 0.6 ? 3 : 1, 1).fill(bright ? C.canopyGlow : C.canopyDeep);
        }
      });
      // 树冠底缘：向下收一档暗边，和树干之间才有厚度
      const bottomY = trunkTop - TREE_ROW_HEIGHT;
      const bottomWidth = Math.round(profile[profile.length - 1]! * canopyWidth);
      g.rect(Math.round(TREE_CENTER - bottomWidth / 2) - 1, bottomY + 1, bottomWidth + 2, 2).fill(C.canopyDeep);
    },
    { frame: TREE_FRAME },
  );

  return { trunk, canopy };
}

export function makeTreeTextures(renderer: TextureFactory): TreeTextures[] {
  return TREE_PROFILES.map((_, index) => makeTreeParts(renderer, index));
}

/* ------------------------------------------------------------------ *
 * 大物件底座投影：树 / 花箱 / 石头共用一套逐行椭圆
 *
 * 只压 0.2 一档、内芯再补 0.06：再深就会在暖色草地上糊出一块灰。
 * 缩放一律走纹素整数倍，不做 alpha 渐变贴图——渐变会把硬像素边磨成雾。
 * ------------------------------------------------------------------ */

export const PROP_SHADOW = {
  tree: { w: 46, h: 18 },
  planter: { w: 30, h: 12 },
  rock: { w: 18, h: 8 },
} as const;

export function makePropShadowTexture(renderer: TextureFactory, width: number, height: number): Texture {
  return bake(
    renderer,
    (g) => {
      const rx = Math.max(1, Math.round(width / 2) - 1);
      const ry = Math.max(1, Math.round(height / 2));
      fillEllipse(g, rx, ry, C.propShadow, 0.2, width, height);
      fillEllipse(g, Math.max(1, Math.round(rx * 0.6)), Math.max(1, Math.round(ry * 0.6)), C.propShadow, 0.06, width, height);
    },
    { frame: new Rectangle(0, 0, width, height) },
  );
}

/** 石头：只做视觉点缀，不参与碰撞 */
export function makeRockTexture(renderer: TextureFactory): Texture {
  return bake(renderer, (g) => {
    g.rect(1, 5, 14, 6).fill(C.rock);
    g.rect(3, 4, 11, 1).fill(C.rockLight);
    g.rect(4, 6, 4, 3).fill(C.rockLight);
    g.rect(1, 11, 14, 1).fill(C.grassDeep);
    g.rect(12, 6, 1, 4).fill(C.grassDeep);
  });
}

/** 广场花箱：矮木箱 + 一丛灌木，站在它后面会被挡住半个身子 */
export function makePlanterTexture(renderer: TextureFactory): Texture {
  return bake(renderer, (g) => {
    g.rect(4, 26, 30, 18).fill(C.fenceDark);
    g.rect(5, 27, 28, 16).fill(C.bridgeWood);
    g.rect(5, 27, 28, 3).fill(C.fenceLight);
    g.rect(5, 41, 28, 2).fill(C.bridgeSeam);

    g.rect(7, 12, 24, 15).fill(C.canopyEdge);
    g.rect(8, 10, 22, 15).fill(C.canopyMid);
    g.rect(9, 9, 20, 3).fill(C.canopyLight);
    g.rect(12, 14, 6, 3).fill(C.canopyGlow);
    g.rect(22, 17, 4, 3).fill(C.canopyGlow);
    g.rect(11, 21, 16, 4).fill(C.canopyDeep);
  });
}

/** 芦苇：水边三根错落的茎 */
export function makeReedTexture(renderer: TextureFactory): Texture {
  return bake(renderer, (g) => {
    const stalks: Array<[number, number]> = [
      [2, 18],
      [6, 23],
      [10, 15],
    ];
    for (const [x, height] of stalks) {
      g.rect(x, 24 - height, 1, height).fill(C.reed);
      g.rect(x, 24 - height, 1, 4).fill(C.reedLight);
    }
    g.rect(0, 23, 14, 1).fill(C.canopyEdge);
  });
}

/* ------------------------------------------------------------------ *
 * 贴花图集：三叶草 / 雏菊 / 微风草尖 / 小石粒（ADR-0013 第三层装饰）
 *
 * 一张 64×16 图、四帧 16×16，全部底对齐画在 y=16 上，
 * 精灵用 anchor(0.5, 1) 定位到世界格点，整数放置不会再抖。
 * ------------------------------------------------------------------ */

/** 单张贴花的画布边长；种类顺序由 decals.ts 的 DECAL_KINDS 决定 */
export const DECAL_SPRITE = 16;

export interface DecalAtlas {
  texture: Texture;
  frames: Texture[];
}

function drawClover(g: Graphics, x: number): void {
  const leaf = C.canopyLight;
  const rim = C.canopyMid;
  // 三片心形叶围成三角 + 一根 3px 茎
  g.rect(x + 6, 11, 1, 4).fill(C.grassDeep);
  g.rect(x + 6, 5, 4, 3).fill(leaf);
  g.rect(x + 4, 8, 4, 3).fill(leaf);
  g.rect(x + 9, 8, 4, 3).fill(leaf);
  g.rect(x + 7, 7, 2, 2).fill(rim);
  g.rect(x + 5, 10, 2, 1).fill(rim);
  g.rect(x + 10, 10, 2, 1).fill(rim);
}

function drawDaisy(g: Graphics, x: number): void {
  g.rect(x + 7, 11, 1, 4).fill(C.reed);
  g.rect(x + 7, 5, 2, 1).fill(C.flowerPetal);
  g.rect(x + 7, 9, 2, 1).fill(C.flowerPetal);
  g.rect(x + 5, 7, 1, 2).fill(C.flowerPetal);
  g.rect(x + 10, 7, 1, 2).fill(C.flowerPetal);
  g.rect(x + 6, 6, 1, 1).fill(C.flowerPetal);
  g.rect(x + 9, 6, 1, 1).fill(C.flowerPetal);
  g.rect(x + 6, 8, 1, 1).fill(C.flowerPetal);
  g.rect(x + 9, 8, 1, 1).fill(C.flowerPetal);
  g.rect(x + 7, 7, 2, 2).fill(C.flowerCore);
}

function drawGrassTip(g: Graphics, x: number): void {
  g.rect(x + 5, 9, 1, 7).fill(C.reed);
  g.rect(x + 5, 7, 1, 2).fill(C.reedLight);
  g.rect(x + 8, 6, 1, 10).fill(C.reed);
  g.rect(x + 9, 5, 1, 2).fill(C.reedLight);
  g.rect(x + 11, 10, 1, 6).fill(C.reed);
  g.rect(x + 11, 8, 1, 2).fill(C.reedLight);
}

function drawPebble(g: Graphics, x: number): void {
  g.rect(x + 5, 14, 6, 1).fill(C.grassDeep);
  g.rect(x + 5, 12, 5, 2).fill(C.decalStone);
  g.rect(x + 6, 11, 4, 1).fill(C.rockLight);
}

/**
 * 花海里的一朵花：6×6 的十字花瓣 + 2×2 花心，下缘压一档暗边。
 * 16px 的画布再细分就只剩噪点，所以三种花只靠「颜色 + 株高」区分。
 */
function drawBlossom(g: Graphics, cx: number, cy: number, petal: number, core: number, shade: number): void {
  g.rect(cx - 2, cy - 1, 1, 2).fill(petal);
  g.rect(cx + 1, cy - 1, 1, 2).fill(petal);
  g.rect(cx - 1, cy - 2, 2, 1).fill(petal);
  g.rect(cx - 1, cy + 1, 2, 1).fill(shade);
  g.rect(cx - 1, cy - 1, 2, 2).fill(core);
}

/** 白雏菊丛：三株高低错落，花瓣接近奶油色 */
function drawBloomWhite(g: Graphics, x: number): void {
  g.rect(x + 4, 10, 1, 6).fill(C.reed);
  g.rect(x + 9, 8, 1, 8).fill(C.reed);
  g.rect(x + 12, 12, 1, 4).fill(C.reed);
  g.rect(x + 5, 13, 2, 1).fill(C.canopyLight);
  g.rect(x + 10, 11, 2, 1).fill(C.canopyLight);
  drawBlossom(g, x + 4, 8, C.flowerPetal, C.flowerCore, C.petalShade);
  drawBlossom(g, x + 9, 6, C.flowerPetal, C.flowerCore, C.petalShade);
  drawBlossom(g, x + 12, 10, C.flowerPetal, C.flowerCore, C.petalShade);
  g.rect(x + 3, 15, 7, 1).fill(C.grassDeep);
  g.rect(x + 11, 15, 4, 1).fill(C.grassDeep);
}

/** 金盏：花头最大、花心最饱和，中间那朵比两侧高一头 */
function drawBloomGold(g: Graphics, x: number): void {
  g.rect(x + 4, 11, 1, 5).fill(C.reed);
  g.rect(x + 8, 9, 1, 7).fill(C.reed);
  g.rect(x + 11, 12, 1, 4).fill(C.reed);
  drawBlossom(g, x + 4, 9, C.petalGold, C.flowerCore, C.petalGoldDeep);
  drawBlossom(g, x + 8, 7, C.petalGold, C.flowerCore, C.petalGoldDeep);
  drawBlossom(g, x + 11, 10, C.petalGold, C.flowerCore, C.petalGoldDeep);
  g.rect(x + 6, 6, 1, 1).fill(C.flowerCore);
  g.rect(x + 3, 15, 7, 1).fill(C.grassDeep);
}

/** 暖粉：两朵主花 + 左右各一个花苞，密度看着最满 */
function drawBloomRose(g: Graphics, x: number): void {
  g.rect(x + 5, 10, 1, 6).fill(C.reed);
  g.rect(x + 10, 9, 1, 7).fill(C.reed);
  drawBlossom(g, x + 5, 8, C.petalRose, C.petalRoseDeep, C.petalRoseDeep);
  drawBlossom(g, x + 10, 7, C.petalRose, C.petalRoseDeep, C.petalRoseDeep);
  g.rect(x + 2, 11, 2, 2).fill(C.petalRose);
  g.rect(x + 2, 13, 2, 1).fill(C.petalRoseDeep);
  g.rect(x + 13, 12, 2, 2).fill(C.petalRose);
  g.rect(x + 13, 14, 2, 1).fill(C.petalRoseDeep);
  g.rect(x + 4, 15, 8, 1).fill(C.grassDeep);
}

export function makeDecalAtlas(renderer: TextureFactory): DecalAtlas {
  const at = (kind: (typeof DECAL_KINDS)[number]): number => DECAL_SPRITE * DECAL_KINDS.indexOf(kind);
  const texture = bake(
    renderer,
    (g) => {
      drawClover(g, at('clover'));
      drawDaisy(g, at('daisy'));
      drawGrassTip(g, at('grassTip'));
      drawPebble(g, at('pebble'));
      drawBloomWhite(g, at('bloomWhite'));
      drawBloomGold(g, at('bloomGold'));
      drawBloomRose(g, at('bloomRose'));
    },
    { frame: new Rectangle(0, 0, DECAL_SPRITE * DECAL_KINDS.length, DECAL_SPRITE) },
  );

  const frames = DECAL_KINDS.map(
    (_, index) =>
      new Texture({
        source: texture.source,
        frame: new Rectangle(index * DECAL_SPRITE, 0, DECAL_SPRITE, DECAL_SPRITE),
      }),
  );
  return { texture, frames };
}
