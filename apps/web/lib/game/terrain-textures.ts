'use client';

import { Graphics, Rectangle, Texture, type Application } from 'pixi.js';
import { DECAL_KINDS } from './decals';
import { fillEllipse } from './fx';
import { seeded } from './seeded';
import { TERRAIN_COLORS as C, URBAN_GROUND as U, WINTER_COLORS as W } from './terrain-palette';
import { makeTreeTextureBank } from './tree-art';
export {
  HERO_TREE_H,
  HERO_TREE_W,
  TREE_H,
  TREE_W,
  makeTreeTextureBank,
  type TreeTextureBank,
  type TreeTextures,
} from './tree-art';

/**
 * 地形贴图工厂：全部 1:1 生成 + nearest 采样（ADR-0005）。
 * 只有整数尺寸的平铺图块与精灵，运行期不再 generateTexture。
 *
 * 色温纪律（ADR-0013）：所有形体只有「本体 + 一档暗边」，
 * 暗边一律取本体色相压暗（EDGE_TINT），不出现纯黑。
 *
 * 地面纪律（ADR-0017）：所有地面材质都走「底色 + `organicBlob` 单像素行色簇 + 1px 噪点」，
 * 没有任何一格与平铺边界平行的直边——广场不再铺装，只留路缘。
 *
 * 尺度基准（ADR-0010）：角色从 41 texel 长到 48 texel，地形件按 1.25 一起放大。
 * 树高 = 角色 ×2.25、路缘宽 10px、围栏齐胸。
 */

type TextureFactory = Application['renderer'];

interface BakeOptions {
  /** 固定画布框：拆层后的树干与树冠必须共用同一帧，锚点才对得上 */
  frame?: Rectangle;
}

export function bake(renderer: TextureFactory, draw: (g: Graphics) => void, options: BakeOptions = {}): Texture {
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

/** 平铺图案跨过边界时分块补画，避免纹理接缝露出直切边 */
function wrappedRect(g: Graphics, x: number, y: number, w: number, h: number, size: number, fill: number): void {
  const left = ((x % size) + size) % size;
  const top = ((y % size) + size) % size;
  const horizontal: Array<[number, number]> =
    left + w > size ? [[left, size - left], [0, left + w - size]] : [[left, w]];
  const vertical: Array<[number, number]> =
    top + h > size ? [[top, size - top], [0, top + h - size]] : [[top, h]];
  for (const [px, pw] of horizontal) {
    for (const [py, ph] of vertical) g.rect(px, py, pw, ph).fill(fill);
  }
}

/**
 * 平铺用的有机斑块：单像素行组成的柔和色簇。
 * 种子固定、边缘起伏，靠 `wrappedRect` 在平铺边界无缝衔接——
 * 草 / 土 / 水 / 海共用这一份，各材质只差半径、行高与配色。
 */
function organicBlob(
  g: Graphics,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  size: number,
  color: number,
  random: () => number,
): void {
  for (let row = -radiusY; row <= radiusY; row += 1) {
    const falloff = Math.sqrt(Math.max(0, 1 - (row / radiusY) ** 2));
    const width = Math.max(1, Math.round(radiusX * 2 * falloff + (random() - 0.5) * 4));
    const offset = Math.round((random() - 0.5) * 3);
    wrappedRect(g, centerX + offset - Math.floor(width / 2), centerY + row, width, 1, size, color);
  }
}

/**
 * 草地基底：低对比的圆润色簇 + 零散草叶。
 * 对比压得比暗调时代更平——细节交给贴花层，地面只负责退到背景里。
 */
export function makeGrassTexture(renderer: TextureFactory): Texture {
  const size = 512;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.grassBase);
    const random = seeded(0x51ed270b);
    // 大小不一、彼此交叠的色簇打散平铺感，不沿固定格线拼方块
    for (let i = 0; i < 54; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        12 + Math.floor(random() * 22),
        7 + Math.floor(random() * 13),
        size,
        C.grassAlt,
        random,
      );
    }
    // 细节密度按纹理面积等比缩放，仍然只是远看不抢眼的像素颗粒
    for (let i = 0; i < 640; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      g.rect(x, y, 1, 1).fill(C.grassDeep);
    }
    for (let i = 0; i < 1680; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      g.rect(x, y, 1, random() > 0.55 ? 2 : 1).fill(C.grassTuft);
    }
    for (let i = 0; i < 136; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      g.rect(x, y, 2, 1).fill(C.grassStone);
    }
  });
}

/**
 * 积雪地面：512px 平铺，与草地同尺寸——换季只是换这层纹理，平铺相位与遮罩都不用重算。
 *
 * 画法刻意压平对比：雪面若靠明暗撑细节，整张地图会先在背景上「花掉」，
 * 角色的 48 纹素剪影就浮不出来。真正提供质感的是三处极轻的颗粒：
 * 受光雪堆（snowLight）、堆间雪影（snowShade）、以及从雪里探头的零星草尖。
 */
export function makeSnowTexture(renderer: TextureFactory): Texture {
  const size = 512;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(W.snowBase);
    const random = seeded(0x2c9f41b7);
    // 雪堆：比草地色簇更大更扁，边缘仍走 wrappedRect 无缝收口
    for (let i = 0; i < 46; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        18 + Math.floor(random() * 30),
        6 + Math.floor(random() * 11),
        size,
        random() > 0.45 ? W.snowLight : W.snowShade,
        random,
      );
    }
    // 雪影：极淡的 1px 颗粒，近看才有雪粒的沙感
    for (let i = 0; i < 520; i += 1) {
      wrappedRect(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        random() > 0.6 ? 2 : 1,
        1,
        size,
        W.snowShade,
      );
    }
    // 压痕：几条 3–9px 的浅雪沟，暗示「有人踩过一脚」
    for (let i = 0; i < 26; i += 1) {
      wrappedRect(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        3 + Math.floor(random() * 7),
        1,
        size,
        W.snowDeep,
      );
    }
    // 露出的草尖：雪没盖严的地方，几根 1×2 的草从雪面探出来
    for (let i = 0; i < 54; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, 1, 2, size, C.grassDeep);
      if (random() > 0.55) wrappedRect(g, x, y, 1, 1, size, C.grassTuft);
    }
  });
}

/**
 * 土路：暖棕底上叠大小不一的有机色簇，再用 1px 石子与短车辙打散。
 * 没有任何一条边与平铺边界平行，所以看不出「一块块」的拼贴。
 */
export function makeDirtTexture(renderer: TextureFactory): Texture {
  const size = 128;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.dirtBase);
    const random = seeded(0x2c9fd3a1);
    // 浅棕斑簇：半径与位置全按种子走，彼此交叠成软边
    for (let i = 0; i < 30; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        7 + Math.floor(random() * 13),
        3 + Math.floor(random() * 6),
        size,
        C.dirtAlt,
        random,
      );
    }
    // 车辙：2~5px 的短划，纵向也叠少量，看不出固定走向
    for (let i = 0; i < 140; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      const length = 2 + Math.floor(random() * 4);
      if (random() > 0.82) wrappedRect(g, x, y, 1, length, size, C.dirtRut);
      else wrappedRect(g, x, y, length, 1, size, C.dirtRut);
    }
    // 石子：1px 为主，偶尔 2px
    for (let i = 0; i < 88; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, random() > 0.72 ? 2 : 1, 1, size, C.dirtPebble);
    }
  });
}

/**
 * 石砖：128px 平铺，32px 错缝方砖 + 1px 砖缝 + 极轻的磨面颗粒。
 * 砖缝沿平铺边界连续，圆庭的 mask 只负责切外轮廓，不会露出方块感。
 */
export function makeStoneTexture(renderer: TextureFactory): Texture {
  const size = 128;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(C.stoneBase);
    const random = seeded(0x5d3a71b9);
    for (let row = 0; row < 4; row += 1) {
      const y = row * 32;
      g.rect(0, y, size, 1).fill(C.stoneSeam);
      const offset = row % 2 === 0 ? 0 : 16;
      for (let x = offset; x < size; x += 32) {
        g.rect(x, y, 1, 32).fill(C.stoneSeam);
        // 每块砖一点点亮面，砖面不整片死平
        if (random() > 0.55) wrappedRect(g, x + 2, y + 2, 26, 1, size, C.stoneLight);
      }
    }
    // 磨面颗粒：1px 的浅灰与暗灰，密度压到只做质感
    for (let i = 0; i < 90; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, 1, 1, size, random() > 0.5 ? C.stoneAlt : C.stoneSeam);
    }
  });
}

/**
 * 现代沥青主干道：128px 平铺（与 `ASPHALT_TILE` 必须同值）。
 *
 * 工艺与土路同源（底色 + `organicBlob` 色簇 + 1px 噪点），换的是色相：
 * - 微雨湿面用 `asphaltWet` 压出深浅，不叠半透图元，避免平铺边界露出发暗的直角；
 * - 裂纹是 1px 折线短划，绝不横贯整块，否则会读成地砖缝；
 * - 反光只做零星 1–3px 短条，低频出现，让「微雨」是暗示而不是镜面。
 */
export function makeAsphaltTexture(renderer: TextureFactory): Texture {
  const size = 128;
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(U.asphalt);
    const random = seeded(0x6a1f3c57);
    for (let i = 0; i < 26; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        9 + Math.floor(random() * 18),
        4 + Math.floor(random() * 9),
        size,
        U.asphaltWet,
        random,
      );
    }
    // 微裂纹：1px 随机游走，每段 3–7 步，走向不固定
    for (let i = 0; i < 18; i += 1) {
      let x = Math.floor(random() * size);
      let y = Math.floor(random() * size);
      const length = 3 + Math.floor(random() * 5);
      for (let step = 0; step < length; step += 1) {
        wrappedRect(g, x, y, 1, 1, size, U.asphaltSeam);
        if (random() > 0.5) x += random() > 0.5 ? 1 : -1;
        else y += random() > 0.5 ? 1 : -1;
      }
    }
    // 石子与湿面反光：亮一档的点与短条，密度压到只做质感
    for (let i = 0; i < 70; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, random() > 0.86 ? 3 : 1, 1, size, U.asphaltSheen);
    }
    for (let i = 0; i < 8; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, 4 + Math.floor(random() * 6), 1, size, U.asphaltSheen);
    }
  });
}

/** 水面色：夏冬两套键名一致，绘制代码只换表不换写法 */
function seasonPalette(winter: boolean): typeof C {
  return winter ? (W as unknown as typeof C) : C;
}

/**
 * 水面：96px 平铺，波纹是短弧而不是横贯整块的直杠（与 terrain.ts 的 WATER_TILE 必须同值）。
 * 冬季换一张冷调纹理而不是给精灵加 `tint`：multiply 只能压亮部，调不出「更冷更淡」的水。
 */
export function makeWaterTexture(renderer: TextureFactory, winter = false): Texture {
  const size = 96;
  const P = seasonPalette(winter);
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(P.waterDeep);
    const random = seeded(0x37a7c29d);
    // 波纹：扁平的有机色簇，长度随位置变化，平铺边界靠 wrappedRect 收口
    for (let i = 0; i < 30; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        5 + Math.floor(random() * 11),
        1 + Math.floor(random() * 2),
        size,
        P.waterMid,
        random,
      );
    }
    // 浪脊：贴在波纹上沿的短高光，偶尔再补一撮泡沫
    for (let i = 0; i < 28; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      const length = 2 + Math.floor(random() * 5);
      wrappedRect(g, x, y, length, 1, size, P.waterCrest);
      if (random() > 0.72) wrappedRect(g, x + 1, y + 1, 2, 1, size, P.waterFoam);
    }
    // 零星泡沫点：让水面有颗粒，不靠条纹撑细节
    for (let i = 0; i < 36; i += 1) {
      wrappedRect(g, Math.floor(random() * size), Math.floor(random() * size), 1, 1, size, P.waterFoam);
    }
  });
}

/**
 * 边界外林地：96px 平铺，深绿底 + 疏散的叶簇与短线。
 *
 * ADR-0064：地图四边之外是一片密林而不是海。这层只做「林墙脚下」的底色，
 * 真正的树影由 `border-forest.ts` 的剪影压在上面；颗粒因此压得很低，
 * 免得抢走林墙的轮廓。
 */
export function makeWildTexture(renderer: TextureFactory, winter = false): Texture {
  const size = 96;
  const P = seasonPalette(winter);
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(P.wildBase);
    const random = seeded(0x3c1b7a51);
    // 叶簇：扁平的有机暗块，平铺边界靠 wrappedRect 收口
    for (let i = 0; i < 22; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        7 + Math.floor(random() * 13),
        4 + Math.floor(random() * 7),
        size,
        P.wildMid,
        random,
      );
    }
    // 枝梢与叶尖：2~5px 的短亮线，疏到只做质感
    for (let i = 0; i < 26; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, 2 + Math.floor(random() * 4), 1, size, P.wildCrest);
    }
    // 叶隙暗点：把整体明度再压一档，林墙后面才够沉
    for (let i = 0; i < 40; i += 1) {
      wrappedRect(g, Math.floor(random() * size), Math.floor(random() * size), 1, 1, size, P.wildBase);
    }
  });
}

/* ------------------------------------------------------------------ *
 * 树贴图已抽离至 `tree-art.ts`（9 树种 × 3 变体 + 古树冠）
 * ------------------------------------------------------------------ */

/** 9 树种主序兼容数组：供边界林与旧测试接口直接按物种顺序取贴图 */
export function makeTreeTextures(renderer: TextureFactory, winter = false) {
  return makeTreeTextureBank(renderer, winter).flat;
}

/* ------------------------------------------------------------------ *
 * 大物件底座投影：树 / 古树 / 花箱 / 石头共用一套逐行椭圆
 *
 * 只压 0.2 一档、内芯再补 0.06：再深就会在暖色草地上糊出一块灰。
 * 缩放一律走纹素整数倍，不做 alpha 渐变贴图——渐变会把硬像素边磨成雾。
 * ------------------------------------------------------------------ */

export const PROP_SHADOW = {
  tree: { w: 46, h: 18 },
  heroTree: { w: 72, h: 24 },
  planter: { w: 22, h: 10 },
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

/**
 * 广场花箱：矮木箱 + 一丛灌木，站在它后面会被挡住半个身子。
 *
 * 34×44 → 26×34：旧尺寸几乎与角色（48 纹素）等高，摆四个就像四件家具；
 * 现在齐腰高，成组摆在路角才像「小物」。固定画框保证锚点与裁剪余量可推导。
 */
export function makePlanterTexture(renderer: TextureFactory): Texture {
  return bake(
    renderer,
    (g) => {
      g.rect(2, 20, 22, 14).fill(C.fenceDark);
      g.rect(3, 21, 20, 12).fill(C.bridgeWood);
      g.rect(3, 21, 20, 2).fill(C.fenceLight);
      g.rect(3, 31, 20, 2).fill(C.bridgeSeam);

      g.rect(4, 10, 18, 12).fill(C.canopyEdge);
      g.rect(5, 8, 16, 12).fill(C.canopyMid);
      g.rect(6, 7, 14, 2).fill(C.canopyLight);
      g.rect(9, 12, 6, 2).fill(C.canopyGlow);
      g.rect(16, 15, 3, 2).fill(C.canopyGlow);
      g.rect(8, 17, 12, 3).fill(C.canopyDeep);
    },
    { frame: new Rectangle(0, 0, 26, 34) },
  );
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

/** 林间落叶：一片斜躺的 6×5 叶子 + 2px 叶柄，三档暖色压出层次 */
function drawLeaf(g: Graphics, x: number): void {
  g.rect(x + 8, 11, 1, 3).fill(C.trunkDark);
  g.rect(x + 5, 6, 5, 4).fill(C.leafAmber);
  g.rect(x + 10, 7, 2, 3).fill(C.leafRust);
  g.rect(x + 6, 5, 3, 1).fill(C.leafGold);
  g.rect(x + 5, 10, 3, 1).fill(C.leafRust);
  g.rect(x + 9, 11, 2, 1).fill(C.leafAmber);
}

/**
 * 竹笋（ADR-0061）：一支主笋 + 一支侧笋，笋壳三道斜压。
 * 贴花只有 16×16，笋壳不能画成横线——三道斜压已经在读成「竹」的下限。
 */
function drawShoot(g: Graphics, x: number): void {
  // 主笋：下宽上尖
  g.rect(x + 6, 10, 4, 6).fill(C.bambooShootDark);
  g.rect(x + 7, 7, 3, 9).fill(C.bambooShoot);
  g.rect(x + 8, 5, 1, 3).fill(C.bambooShoot);
  // 笋壳
  g.rect(x + 6, 12, 4, 1).fill(C.bambooHusk);
  g.rect(x + 7, 10, 3, 1).fill(C.bambooHusk);
  g.rect(x + 8, 8, 2, 1).fill(C.bambooHusk);
  // 侧笋
  g.rect(x + 12, 12, 2, 4).fill(C.bambooShoot);
  g.rect(x + 12, 13, 2, 1).fill(C.bambooHusk);
  // 根部压一档暗草
  g.rect(x + 5, 15, 9, 1).fill(C.grassDeep);
}

/** 熏衣草花穗：高挑竖直紫穗 + 青灰茎 */
function drawBloomLavender(g: Graphics, x: number): void {
  g.rect(x + 4, 9, 1, 7).fill(C.reed);
  g.rect(x + 8, 7, 1, 9).fill(C.reed);
  g.rect(x + 12, 10, 1, 6).fill(C.reed);
  g.rect(x + 3, 5, 3, 5).fill(C.bloomLavender);
  g.rect(x + 4, 4, 2, 2).fill(C.bloomLavenderDeep);
  g.rect(x + 7, 3, 3, 6).fill(C.bloomLavender);
  g.rect(x + 8, 2, 1, 2).fill(C.petalRose);
  g.rect(x + 11, 6, 3, 5).fill(C.bloomLavender);
  g.rect(x + 12, 8, 2, 2).fill(C.bloomLavenderDeep);
  g.rect(x + 3, 15, 10, 1).fill(C.grassDeep);
}

/** 落樱瓣：三枚错落斜飞粉瓣，铺在樱林草皮下 */
function drawPetalPink(g: Graphics, x: number): void {
  g.rect(x + 4, 11, 3, 2).fill(C.petalPink);
  g.rect(x + 5, 10, 1, 1).fill(C.petalPinkDeep);
  g.rect(x + 9, 8, 2, 2).fill(C.petalPink);
  g.rect(x + 10, 12, 3, 2).fill(C.petalPinkDeep);
  g.rect(x + 10, 12, 2, 1).fill(C.petalPink);
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
      drawLeaf(g, at('leaf'));
      drawShoot(g, at('shoot'));
      drawBloomLavender(g, at('bloomLavender'));
      drawPetalPink(g, at('petalPink'));
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
