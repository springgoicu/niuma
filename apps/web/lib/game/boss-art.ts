'use client';

import type { Graphics } from 'pixi.js';

/**
 * 发泄区的像素画法（ADR-0070）：地面垫子与老板本体都按 1:1 texel 手绘，
 * 由 `bake()` 烘焙成 nearest 纹理。这里只有纯 Graphics 绘制，不碰 Pixi 场景图。
 *
 * 调色板沿用设计稿：深灰橡胶 + 黄黑警示条 + 手绘粉笔，与园区暖色草地对着来；
 * 老板用深灰西装 + 白衬衫 + 朱红领带，倒下时整只换成去饱和灰版。
 */

export interface BossPalette {
  outline: number;
  suit: number;
  suitLight: number;
  suitEdge: number;
  shirt: number;
  shirtShade: number;
  tie: number;
  tieDark: number;
  skin: number;
  skinShade: number;
  hair: number;
  shoe: number;
  gold: number;
}

export const BOSS_COLOR: BossPalette = {
  outline: 0x15171b,
  suit: 0x3a4048,
  suitLight: 0x4a5159,
  suitEdge: 0x2a2f35,
  shirt: 0xede6d6,
  shirtShade: 0xc9c2b2,
  tie: 0xd94f3d,
  tieDark: 0xa83b2d,
  skin: 0xe8c39e,
  skinShade: 0xcfa47c,
  hair: 0x4a4d52,
  shoe: 0x15171b,
  gold: 0xf2c14e,
};

/** 倒下后的灰版：只保留三档灰，不再有冷暖差 */
export const BOSS_GRAY: BossPalette = {
  outline: 0x33363a,
  suit: 0x6e7278,
  suitLight: 0x808589,
  suitEdge: 0x4a4d52,
  shirt: 0xb9bcc0,
  shirtShade: 0x9aa0a6,
  tie: 0x8a8e93,
  tieDark: 0x6e7278,
  skin: 0x9aa0a6,
  skinShade: 0x808589,
  hair: 0x4a4d52,
  shoe: 0x33363a,
  gold: 0x7c8085,
};

const ARENA_COLOR = {
  matEdge: 0x14161a,
  mat: 0x1b1d22,
  matLight: 0x23262c,
  stripe: 0xf2c14e,
  stripeDark: 0x15171b,
  chalk: 0xede6d6,
  stamp: 0xd94f3d,
} as const;

/** 警示条：一条带内画 45° 斜纹，越界部分由烘焙框裁掉 */
function hazardBand(g: Graphics, x: number, y: number, w: number, h: number, horizontal: boolean): void {
  g.rect(x, y, w, h).fill(ARENA_COLOR.stripe);
  const step = horizontal ? 24 : 22;
  for (let offset = -h; offset < w + h; offset += step) {
    if (horizontal) {
      g.poly([x + offset, y + h, x + offset + h, y + h, x + offset + h * 2, y, x + offset + h, y]).fill(
        ARENA_COLOR.stripeDark,
      );
    } else {
      g.poly([x, y + offset, x, y + offset + w, x + w, y + offset + w * 2, x + w, y + offset + w]).fill(
        ARENA_COLOR.stripeDark,
      );
    }
  }
}

/** 粉笔圆环：两圈错位叠画，边缘留几处缺口，读起来是手画的而不是贴图 */
function chalkRing(g: Graphics, cx: number, cy: number, radius: number): void {
  g.circle(cx, cy, radius).stroke({ width: 4, color: ARENA_COLOR.chalk, alpha: 0.92 });
  g.circle(cx + 1, cy - 1, radius + 1).stroke({ width: 2, color: ARENA_COLOR.chalk, alpha: 0.35 });
  for (const angle of [-0.6, 0.4, 1.9, 3.4]) {
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    g.rect(Math.round(cx + nx * radius) - 2, Math.round(cy + ny * radius) - 4, 5, 8).fill(ARENA_COLOR.mat);
  }
}

/** 发泄区地面：420×320，左上角对齐 BOSS_ARENA，不参与 y 排序 */
export function drawBossGround(g: Graphics, w: number, h: number): void {
  g.roundRect(0, 0, w, h, 8).fill(ARENA_COLOR.matEdge);
  g.roundRect(2, 2, w - 4, h - 4, 6).fill(ARENA_COLOR.mat);

  for (let y = 20; y < h - 18; y += 9) {
    g.rect(16, y, w - 32, 1).fill({ color: ARENA_COLOR.matLight, alpha: 0.5 });
  }

  const band = 12;
  hazardBand(g, 2, 2, w - 4, band, true);
  hazardBand(g, 2, h - 2 - band, w - 4, band, true);
  hazardBand(g, 2, 2 + band, band, h - 4 - band * 2, false);
  hazardBand(g, w - 2 - band, 2 + band, band, h - 4 - band * 2, false);

  chalkRing(g, w / 2, h * 0.66, Math.min(w, h) * 0.36);

  for (const [x, y, len] of [
    [w * 0.28, h * 0.86, 26],
    [w * 0.72, h * 0.2, 20],
    [w * 0.78, h * 0.9, 16],
  ] as const) {
    g.rect(Math.round(x), Math.round(y), len, 2).fill({ color: ARENA_COLOR.chalk, alpha: 0.5 });
  }

  // 「禁止内卷」印章框：文字由 Pixi Text 叠上去。
  // 放左上：老板头占住垫子北侧中段，右上角留给「发泄区」三个字
  g.roundRect(16, 26, 88, 22, 3).stroke({ width: 2, color: ARENA_COLOR.stamp, alpha: 0.8 });
}

/** 梨形躯干的外轮廓，两次手写只为让 1px 硬描边留在形外 */
const TORSO_OUTER: number[] = [
  58, 88, 142, 88, 154, 100, 170, 130, 180, 160, 176, 190, 162, 214, 138, 228, 100, 232, 62, 228, 38, 214,
  24, 190, 20, 160, 30, 130, 46, 100,
];
const TORSO_INNER: number[] = [
  61, 91, 139, 91, 151, 103, 167, 132, 177, 160, 173, 188, 159, 211, 136, 225, 100, 229, 64, 225, 41, 211,
  27, 188, 23, 160, 33, 132, 49, 103,
];

/**
 * 老板本体：200×256，脚底对齐画布底边。
 * 形是一颗梨：窄肩、肚子撑开衬衫、短腿、双手背在身后。
 */
export function drawBossBody(g: Graphics, c: BossPalette): void {
  g.ellipse(100, 250, 72, 11).fill({ color: 0x14161a, alpha: 0.22 });

  // 皮鞋：两段圆角，鞋头略外八
  for (const x of [62, 100]) {
    g.roundRect(x, 234, 40, 18, 5).fill(c.outline);
    g.roundRect(x + 2, 236, 36, 13, 4).fill(c.shoe);
    g.rect(x + 4, 237, 12, 2).fill(c.suitLight);
  }

  // 短腿：西裤垂到鞋面
  for (const x of [74, 108]) {
    g.rect(x, 198, 22, 42).fill(c.outline);
    g.rect(x + 2, 200, 18, 38).fill(c.suitEdge);
    g.rect(x + 4, 200, 3, 38).fill(c.suit);
  }

  g.poly(TORSO_OUTER).fill(c.outline);
  g.poly(TORSO_INNER).fill(c.suit);
  // 左侧一条窄高光：单侧受光，另一侧留给肚子
  g.poly([61, 91, 74, 91, 55, 160, 53, 190, 41, 211, 27, 188, 23, 160, 33, 132, 49, 103]).fill(c.suitLight);

  // 衬衫肚子：被西装敞开的外套夹在中间
  g.ellipse(104, 166, 56, 60).fill(c.outline);
  g.ellipse(104, 166, 52, 56).fill(c.shirt);
  g.ellipse(112, 176, 26, 34).fill({ color: c.shirtShade, alpha: 0.35 });
  for (const x of [86, 102, 118]) {
    g.rect(x, 146, 2, 22).fill({ color: c.shirtShade, alpha: 0.45 });
  }

  // 西装翻领：从肩线折向胸口，扣住衬衫的两侧
  g.poly([70, 90, 98, 128, 86, 152, 60, 112]).fill(c.suitEdge);
  g.poly([130, 90, 102, 128, 114, 152, 140, 112]).fill(c.suitEdge);
  g.poly([72, 92, 96, 126, 88, 140, 66, 110]).fill(c.suit);
  g.poly([128, 92, 104, 126, 112, 140, 134, 110]).fill(c.suit);

  // 领带：松垮地压进肚子，末端被撑开的衬衫顶起
  g.poly([94, 104, 106, 104, 109, 142, 100, 152, 91, 142]).fill(c.tieDark);
  g.poly([96, 106, 104, 106, 105, 136, 100, 144, 95, 136]).fill(c.tie);

  // 金表链：肚子下沿一串亮点
  for (const [x, y] of [
    [66, 190],
    [72, 198],
    [82, 203],
    [94, 205],
    [106, 205],
  ] as const) {
    g.rect(x, y, 3, 3).fill(c.gold);
  }

  // 头：圆脸、秃顶、两撮鬓发
  g.ellipse(100, 62, 45, 42).fill(c.outline);
  g.ellipse(100, 62, 42, 39).fill(c.skin);
  g.ellipse(100, 46, 30, 16).fill({ color: c.skinShade, alpha: 0.25 });
  for (const [x, y, w] of [
    [56, 40, 12],
    [64, 30, 10],
    [70, 26, 8],
    [132, 40, 12],
    [126, 30, 10],
    [122, 26, 8],
  ] as const) {
    g.rect(x, y, w, 8).fill(c.hair);
  }
  g.rect(58, 62, 6, 16).fill(c.skinShade);
  g.rect(136, 62, 6, 16).fill(c.skinShade);

  // 五官：上挑眉、压低的眼、下垂的嘴，读作「不情愿被踢」
  for (const [x, flip] of [
    [76, 1],
    [112, -1],
  ] as const) {
    g.rect(x, 56, 16, 3).fill(c.hair);
    g.rect(flip > 0 ? x + 12 : x, 53, 4, 3).fill(c.hair);
    g.rect(x + 2, 64, 12, 5).fill(c.outline);
    g.rect(x + 2, 64, 12, 2).fill(c.skinShade);
    g.rect(x + 4, 65, 3, 2).fill(0xf5f1e8);
  }
  g.rect(96, 70, 8, 8).fill(c.skinShade);
  g.rect(88, 86, 24, 3).fill(c.skinShade);
  g.rect(94, 90, 12, 2).fill(c.outline);
  g.ellipse(100, 96, 26, 10).fill({ color: c.skinShade, alpha: 0.3 });
}

/** 头顶名牌的两种底板：活着是木牌，倒下换成一张潦草的纸板 */
export type BossPlateKind = 'wood' | 'cardboard';

export function drawBossPlate(g: Graphics, w: number, h: number, kind: BossPlateKind): void {
  if (kind === 'wood') {
    g.roundRect(0, 0, w, h, 3).fill(0x2a1c14);
    g.roundRect(1, 1, w - 2, h - 2, 3).fill(0x8a5a3b);
    g.rect(2, 3, w - 4, 3).fill(0x9e6b46);
    g.rect(2, h - 5, w - 4, 2).fill(0x6b442c);
    // 四角铆钉：2×2 的亮点，比圆更容易在 1:1 下读成金属
    for (const [x, y] of [
      [4, 4],
      [w - 6, 4],
      [4, h - 6],
      [w - 6, h - 6],
    ] as const) {
      g.rect(x, y, 2, 2).fill(0xd8a33f);
    }
    g.rect(w / 2 - 16, h - 4, 32, 1).fill(0x4a2f1e);
    return;
  }

  // 纸板：牛皮色 + 手撕的锯齿边 + 一道封箱胶带
  g.roundRect(0, 0, w, h, 2).fill(0x7a5a3f);
  g.rect(1, 1, w - 2, h - 2).fill(0xc79a6b);
  for (let x = 2; x < w - 2; x += 4) {
    g.rect(x, 0, 2, 2).fill(0x7a5a3f);
    g.rect(x + 2, h - 2, 2, 2).fill(0x7a5a3f);
  }
  g.rect(w / 2 - 22, 0, 44, 6).fill({ color: 0xd8c9a8, alpha: 0.85 });
  g.rect(w / 2 - 22, 0, 44, 1).fill({ color: 0xf2ead6, alpha: 0.6 });
  g.rect(4, h - 6, 14, 1).fill(0x7a5a3f);
}
