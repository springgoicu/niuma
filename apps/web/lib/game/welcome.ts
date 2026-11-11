'use client';

import { Container, Graphics, Rectangle, Sprite, Text, type Application, type Texture } from 'pixi.js';
import { WELCOME_LANDMARKS } from '@niuma/shared-types';
import { navReadings } from './nav';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 北门迎宾地标（ADR-0036）：布幡横幅 + 四向指路牌。
 *
 * 与 PropsView 同一条纪律：形体在构造期用 Graphics 烘焙成 1:1 纹理，
 * 中文交给 Pixi `Text`（系统 CJK 字体栈，resolution 跟设备像素走），
 * 帧循环里没有生成、没有分配。整组只有两个容器，按脚底 y 进 SortLayer，
 * 玩家可以走到横幅前面把它挡住，也可以贴着指路牌合影。
 */

type TextureFactory = Application['renderer'];

const CJK_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
const MONO_FONT = "'JetBrains Mono', monospace";

/** 沿用 props.ts 的木质 / 纸色 / 薄荷调色板，不引入新色系 */
const COLOR = {
  ink: 0x2a3142,
  inkSoft: 0x2b2118,
  shadow: 0x1e2846,
  woodLight: 0xe0b48a,
  woodDark: 0x8a6446,
  woodEdge: 0x6b4a32,
  paper: 0xfff6e0,
  paperEdge: 0x8a6446,
  cloth: 0xffe49a,
  clothLight: 0xfff3c9,
  clothEdge: 0xe8856d,
  mint: 0x8fe3c7,
  mintDark: 0x5cc4a0,
} as const;

const BANNER = WELCOME_LANDMARKS.banner;
const SIGNPOST = WELCOME_LANDMARKS.signpost;
/** 指路牌形体尺寸：96×92 让四行中文与箭头都落在整数像素上 */
const SIGN_WIDTH = 96;
const SIGN_HEIGHT = 92;

/** 一个带 1px 描边的矩形：与 props.ts 的 box 同一种画法 */
function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number = COLOR.ink): void {
  g.roundRect(x, y, w, h, 2).fill(line);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 1).fill(fill);
}

/** 八向单位向量（屏幕坐标：y 向下），下标与 NavOctant 一致 */
const OCTANT_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0.7, -0.7],
  [1, 0],
  [0.7, 0.7],
  [0, 1],
  [-0.7, 0.7],
  [-1, 0],
  [-0.7, -0.7],
];

/**
 * 12×12 的像素箭头：尾杆 2px + 三角箭头。
 * 坐标全部取整，烘焙后仍是硬边；八向各画一遍，不靠旋转（旋转会把 1px 描边糊开）。
 */
function drawArrow(g: Graphics, cx: number, cy: number, octant: number): void {
  const [ux, uy] = OCTANT_VECTORS[((octant % 8) + 8) % 8]!;
  const px = -uy;
  const py = ux;
  const tipX = Math.round(cx + ux * 5);
  const tipY = Math.round(cy + uy * 5);
  const jointX = Math.round(cx + ux * 1.4);
  const jointY = Math.round(cy + uy * 1.4);
  const tailX = Math.round(cx - ux * 5);
  const tailY = Math.round(cy - uy * 5);
  g.poly([tailX + px, tailY + py, tailX - px, tailY - py, jointX - px, jointY - py, jointX + px, jointY + py]).fill(
    COLOR.mintDark,
  );
  g.poly([
    tipX,
    tipY,
    Math.round(jointX + px * 3.2),
    Math.round(jointY + py * 3.2),
    Math.round(jointX - px * 3.2),
    Math.round(jointY - py * 3.2),
  ]).fill(COLOR.mintDark);
}

/** 布幡横幅：两根木柱 + 横杆 + 奶油布 + 三角流苏 + 左侧薄荷小旗 */
function drawBanner(g: Graphics, w: number, h: number): void {
  g.ellipse(w / 2, h - 2, w / 2 - 10, 4).fill({ color: COLOR.shadow, alpha: 0.2 });

  box(g, 6, 8, w - 12, 5, COLOR.woodDark, COLOR.woodEdge);
  box(g, 10, 12, w - 20, 36, COLOR.cloth, COLOR.clothEdge);
  g.rect(14, 15, w - 28, 2).fill(COLOR.clothLight);
  g.rect(10, 44, w - 20, 3).fill(COLOR.clothEdge);

  // 流苏：七枚三角，宽窄随布幡一起缩放
  const teeth = 7;
  const step = (w - 20) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const x0 = 10 + Math.round(i * step);
    const x1 = 10 + Math.round((i + 1) * step);
    const mid = Math.round((x0 + x1) / 2);
    g.poly([x0, 47, x1, 47, mid, 55]).fill(COLOR.clothEdge);
    g.poly([x0 + 1, 48, x1 - 1, 48, mid, 52]).fill(COLOR.cloth);
  }

  // 柱子最后画：布幡从杆后穿过去，两根木柱才是承重的那一层
  for (const x of [12, w - 20]) {
    box(g, x, 8, 8, h - 8, COLOR.woodLight, COLOR.woodDark);
    box(g, x - 2, 3, 12, 7, COLOR.mint, COLOR.woodDark);
  }
}

/** 四向指路牌：一根木柱上叠四块纸牌，箭头方向由 NAV_TARGETS 的真实方位决定 */
function drawSignpost(g: Graphics, w: number, h: number, arrows: readonly number[]): void {
  g.ellipse(w / 2, h - 1, 24, 3).fill({ color: COLOR.shadow, alpha: 0.22 });
  box(g, w / 2 - 4, 4, 8, h - 4, COLOR.woodLight, COLOR.woodDark);
  g.rect(w / 2 - 2, 8, 1, h - 14).fill(COLOR.clothLight);

  // 顶牌：园区导览
  box(g, 12, 0, 72, 14, COLOR.paper, COLOR.paperEdge);
  g.rect(12, 0, 4, 14).fill(COLOR.mintDark);
  // 标题左侧的菱形记号：读作「导览」，不冒充指北针
  g.poly([24, 3, 28, 7, 24, 11, 20, 7]).fill(COLOR.mintDark);

  // 四块设施牌：自上而下按 NAV_TARGETS 顺序
  for (let i = 0; i < 4; i += 1) {
    const top = 16 + i * 16;
    box(g, 6, top, 84, 14, COLOR.paper, COLOR.paperEdge);
    g.rect(6, top + 13, 84, 1).fill(COLOR.clothLight);
    drawArrow(g, 20, top + 7, arrows[i] ?? 0);
  }

  // 底牌：反色小标签，给「你在这里」一个视觉落点
  box(g, 22, 80, 52, 10, COLOR.inkSoft, COLOR.woodDark);
}

interface Landmark {
  root: Container;
  texture: Texture;
}

export class WelcomeView {
  private readonly landmarks: Landmark[] = [];
  private readonly texts: Text[] = [];

  /** 构造期一次性建成；`devicePxPerTexel` 决定中文位图的分辨率 */
  build(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    this.buildBanner(depth, renderer, devicePxPerTexel);
    this.buildSignpost(depth, renderer, devicePxPerTexel);
  }

  private addText(
    root: Container,
    devicePxPerTexel: number,
    options: {
      text: string;
      x: number;
      y: number;
      size: number;
      fill: number;
      font?: string;
      weight?: '400' | '600';
      spacing?: number;
      anchorX?: number;
    },
  ): void {
    const text = new Text({
      text: options.text,
      resolution: devicePxPerTexel,
      style: {
        fontFamily: options.font ?? CJK_FONT,
        fontSize: options.size,
        fontWeight: options.weight ?? '400',
        fill: options.fill,
        letterSpacing: options.spacing ?? 0,
      },
    });
    text.anchor.set(options.anchorX ?? 0.5, 0.5);
    text.position.set(options.x, options.y);
    root.addChild(text);
    this.texts.push(text);
  }

  private buildBanner(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    const texture = bake(renderer, (g) => drawBanner(g, BANNER.width, BANNER.height), {
      frame: new Rectangle(0, 0, BANNER.width, BANNER.height),
    });
    const root = new Container();
    root.position.set(BANNER.x, BANNER.y);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    root.addChild(sprite);

    this.addText(root, devicePxPerTexel, {
      text: '欢迎来到牛马园',
      x: 0,
      y: -(BANNER.height - 26),
      size: 14,
      weight: '600',
      fill: COLOR.inkSoft,
      spacing: 3,
    });
    this.addText(root, devicePxPerTexel, {
      text: 'NIUMA PARK · 打卡上班',
      x: 0,
      y: -(BANNER.height - 39),
      size: 7,
      font: MONO_FONT,
      fill: COLOR.paperEdge,
      spacing: 1,
    });

    depth.add(BANNER.y, root);
    this.landmarks.push({ root, texture });
  }

  private buildSignpost(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    const readings = signReadings();
    const texture = bake(
      renderer,
      (g) => drawSignpost(g, SIGN_WIDTH, SIGN_HEIGHT, readings.map((reading) => reading.octant)),
      { frame: new Rectangle(0, 0, SIGN_WIDTH, SIGN_HEIGHT) },
    );
    const root = new Container();
    root.position.set(SIGNPOST.x, SIGNPOST.y);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    root.addChild(sprite);

    const base = -SIGN_HEIGHT;
    this.addText(root, devicePxPerTexel, {
      text: '园区导览',
      x: 0,
      y: base + 7,
      size: 8,
      weight: '600',
      fill: COLOR.inkSoft,
    });
    for (let i = 0; i < readings.length; i += 1) {
      this.addText(root, devicePxPerTexel, {
        text: readings[i]!.target.name,
        x: -SIGN_WIDTH / 2 + 30,
        y: base + 23 + i * 16,
        size: 9,
        fill: COLOR.inkSoft,
        anchorX: 0,
      });
    }
    this.addText(root, devicePxPerTexel, {
      text: '你在这里',
      x: 0,
      y: base + 85,
      size: 7,
      fill: COLOR.paper,
    });

    depth.add(SIGNPOST.y, root);
    this.landmarks.push({ root, texture });
  }

  /** DPR 变化时重设中文位图分辨率，否则文字会被拉伸到 2 倍而发虚 */
  setTextResolution(devicePxPerTexel: number): void {
    for (const text of this.texts) {
      if (text.resolution !== devicePxPerTexel) text.resolution = devicePxPerTexel;
    }
  }

  destroy(): void {
    for (const landmark of this.landmarks) {
      landmark.root.destroy({ children: true });
      landmark.texture.destroy(true);
    }
    this.landmarks.length = 0;
    this.texts.length = 0;
  }
}

/** 指路牌按自己的位置计算八向：移动地标不需要回来改箭头 */
function signReadings() {
  return navReadings(SIGNPOST.x, SIGNPOST.y);
}
