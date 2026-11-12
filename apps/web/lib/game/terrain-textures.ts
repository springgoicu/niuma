'use client';

import { Graphics, Rectangle, Texture, type Application } from 'pixi.js';
import { DECAL_KINDS } from './decals';
import { fillEllipse } from './fx';
import { seeded } from './seeded';
import { TERRAIN_COLORS as C, WINTER_COLORS as W } from './terrain-palette';

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

/** 水面色：夏冬两套键名一致，绘制代码只换表不换写法 */
function waterPalette(winter: boolean): typeof C {
  return winter ? (W as unknown as typeof C) : C;
}

/**
 * 水面：96px 平铺，波纹是短弧而不是横贯整块的直杠（与 terrain.ts 的 WATER_TILE 必须同值）。
 * 冬季换一张冷调纹理而不是给精灵加 `tint`：multiply 只能压亮部，调不出「更冷更淡」的水。
 */
export function makeWaterTexture(renderer: TextureFactory, winter = false): Texture {
  const size = 96;
  const P = waterPalette(winter);
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
 * 深海：96px 平铺，波纹比湖面更稀更慢。
 * 海面只在海岸附近进入视野，密度再高就会抢沙滩的过渡。
 */
export function makeSeaTexture(renderer: TextureFactory, winter = false): Texture {
  const size = 96;
  const P = waterPalette(winter);
  return bake(renderer, (g) => {
    g.rect(0, 0, size, size).fill(P.seaBase);
    const random = seeded(0x5ea5a17);
    // 深海波纹：比湖面更扁更稀的有机色簇，不再有横贯整块的直线
    for (let i = 0; i < 16; i += 1) {
      organicBlob(
        g,
        Math.floor(random() * size),
        Math.floor(random() * size),
        9 + Math.floor(random() * 15),
        1 + Math.floor(random() * 2),
        size,
        P.seaMid,
        random,
      );
    }
    // 浪脊：4~9px 的短高光，疏到只做点缀
    for (let i = 0; i < 14; i += 1) {
      const x = Math.floor(random() * size);
      const y = Math.floor(random() * size);
      wrappedRect(g, x, y, 4 + Math.floor(random() * 6), 1, size, P.seaCrest);
    }
    // 泡沫点：海面只在海岸附近进视野，颗粒压到最低
    for (let i = 0; i < 44; i += 1) {
      wrappedRect(g, Math.floor(random() * size), Math.floor(random() * size), 1, 1, size, P.seaFoam);
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

/** 四种不对称树冠轮廓：宽度随高度变化，避免规整的锥形堆叠 */
const TREE_PROFILES: number[][] = [
  [0.12, 0.2, 0.3, 0.42, 0.56, 0.7, 0.83, 0.94, 1, 0.98, 0.94, 0.91, 0.96, 1, 0.98, 0.94, 0.88, 0.81, 0.74, 0.66, 0.57, 0.46, 0.32, 0.18],
  [0.18, 0.3, 0.44, 0.59, 0.74, 0.87, 0.96, 1, 0.96, 0.9, 0.83, 0.77, 0.82, 0.9, 0.97, 0.94, 0.88, 0.81, 0.73, 0.64, 0.54, 0.42, 0.28, 0.14],
  [0.1, 0.19, 0.3, 0.43, 0.57, 0.71, 0.84, 0.95, 0.99, 0.94, 0.87, 0.8, 0.76, 0.82, 0.91, 0.99, 0.97, 0.91, 0.83, 0.74, 0.64, 0.52, 0.36, 0.2],
  [0.16, 0.28, 0.42, 0.57, 0.72, 0.85, 0.96, 1, 0.97, 0.92, 0.86, 0.8, 0.76, 0.8, 0.88, 0.95, 0.98, 0.94, 0.86, 0.77, 0.67, 0.55, 0.4, 0.23],
];
const TREE_ROW_HEIGHT = 3;
const TREE_CANOPY_WIDTHS = [58, 62, 64, 60] as const;

export interface TreeTextures {
  trunk: Texture;
  canopy: Texture;
}

function makeTreeParts(renderer: TextureFactory, variant: number, winter = false): TreeTextures {
  const profile = TREE_PROFILES[variant % TREE_PROFILES.length]!;
  const canopyWidth = TREE_CANOPY_WIDTHS[variant % TREE_CANOPY_WIDTHS.length]!;
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
      if (winter) {
        // 树根积雪：贴地一圈，雪才像「堆在树脚」而不是悬浮在树干上
        g.rect(trunkX - 4, TREE_H - 7, trunkWidth + 8, 3).fill(W.snowBase);
        g.rect(trunkX - 3, TREE_H - 6, trunkWidth + 6, 1).fill(W.snowLight);
        g.rect(trunkX - 5, TREE_H - 4, trunkWidth + 10, 2).fill(W.snowShade);
      }
    },
    { frame: TREE_FRAME },
  );

  const canopy = bake(
    renderer,
    (g) => {
      let centerShift = 0;
      /** 雪帽要按行宽重新铺一遍，所以行几何必须留到循环之后 */
      const rows: Array<{ x: number; y: number; width: number }> = [];
      profile.forEach((ratio, index) => {
        const width = Math.max(6, Math.round(ratio * canopyWidth));
        const y = trunkTop - (index + 1) * TREE_ROW_HEIGHT;
        const drift = random();
        centerShift = Math.max(-2, Math.min(2, centerShift + (drift > 0.7 ? 1 : drift < 0.3 ? -1 : 0)));
        const x = Math.round(TREE_CENTER + centerShift - width / 2);
        rows.push({ x, y, width });
        // 叶簇外沿保留一档暗色，轮廓高低变化而不是齐刷刷叠成层层方片
        const overhang = random() > 0.76 ? 2 : 1;
        g.rect(x - overhang, y, width + overhang * 2, TREE_ROW_HEIGHT).fill(C.canopyEdge);
        g.rect(x, y, width, TREE_ROW_HEIGHT).fill(C.canopyMid);
        if (random() > 0.34) {
          const highlightX = x + 1 + Math.floor(random() * Math.max(1, width - 4));
          g.rect(highlightX, y, 2 + Math.floor(random() * 3), 1).fill(C.canopyLight);
        }
        if (random() > 0.48) {
          const shadeX = x + 1 + Math.floor(random() * Math.max(1, width - 3));
          g.rect(shadeX, y + TREE_ROW_HEIGHT - 1, 2 + Math.floor(random() * 2), 1).fill(C.canopyDeep);
        }

        // 受光斑点分散成小叶簇，不沿每一行横向排成条纹
        const marks = 1 + Math.floor(random() * 3);
        for (let m = 0; m < marks; m += 1) {
          const mx = x + 2 + Math.floor(random() * Math.max(1, width - 5));
          const my = y + Math.floor(random() * TREE_ROW_HEIGHT);
          const bright = random() > 0.45;
          g.rect(mx, my, random() > 0.6 ? 3 : 1, 1).fill(bright ? C.canopyGlow : C.canopyDeep);
        }
      });

      if (winter) {
        // 雪帽：只压上半部，越靠顶越厚。逐行都盖满会在 3px 行距上拉出一道道横纹，
        // 所以下半部只在外沿枝尖点雪，中间留出叶色。
        const snowStart = Math.floor(rows.length * 0.66);
        for (let i = snowStart; i < rows.length; i += 1) {
          const row = rows[i]!;
          const t = (i - snowStart) / Math.max(1, rows.length - 1 - snowStart);
          const thickness = t > 0.62 ? 2 : 1;
          const cover = Math.max(4, Math.round(row.width * (0.78 + 0.18 * t)));
          const x = row.x + Math.round((row.width - cover) / 2);
          g.rect(x, row.y, cover, thickness).fill(W.snowBase);
          if (t > 0.55) g.rect(x + 1, row.y + 1, Math.max(2, cover - 2), 1).fill(W.snowLight);
        }
        // 雪线：雪帽下沿压一道雪影，帽才不会像贴上去的白纸
        const edgeRow = rows[snowStart];
        if (edgeRow) g.rect(edgeRow.x, edgeRow.y + 1, edgeRow.width, 1).fill(W.snowShade);
        // 枝尖薄雪：外沿左右各点几粒，雪挂在探出的枝条上
        for (let i = Math.floor(rows.length * 0.34); i < snowStart; i += 1) {
          const row = rows[i]!;
          if (random() > 0.45) continue;
          const side = random() > 0.5;
          const sx = side ? row.x - 1 : row.x + row.width - 1;
          g.rect(sx, row.y, 2, 1).fill(W.snowShade);
          g.rect(sx, row.y + 1, 1, 1).fill(W.snowLight);
        }
      }
      // 树冠底缘：向下收一档暗边，和树干之间才有厚度
      const bottomY = trunkTop - TREE_ROW_HEIGHT;
      const bottomWidth = Math.round(profile[profile.length - 1]! * canopyWidth);
      g.rect(Math.round(TREE_CENTER + centerShift - bottomWidth / 2) - 1, bottomY + 1, bottomWidth + 2, 2).fill(C.canopyDeep);
    },
    { frame: TREE_FRAME },
  );

  return { trunk, canopy };
}

export function makeTreeTextures(renderer: TextureFactory, winter = false): TreeTextures[] {
  return TREE_PROFILES.map((_, index) => makeTreeParts(renderer, index, winter));
}

/* ------------------------------------------------------------------ *
 * 大物件底座投影：树 / 花箱 / 石头共用一套逐行椭圆
 *
 * 只压 0.2 一档、内芯再补 0.06：再深就会在暖色草地上糊出一块灰。
 * 缩放一律走纹素整数倍，不做 alpha 渐变贴图——渐变会把硬像素边磨成雾。
 * ------------------------------------------------------------------ */

export const PROP_SHADOW = {
  tree: { w: 46, h: 18 },
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
