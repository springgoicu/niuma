'use client';

import { Container, Graphics, Rectangle, Sprite, Text, type Application, type Texture } from 'pixi.js';
import { WELCOME_LANDMARKS } from '@niuma/shared-types';
import { navReadings } from './nav';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 中央迎宾地标（ADR-0047 / ADR-0049）：霓虹拱门 + 四向园区导览牌。
 *
 * 与 PropsView 同一条纪律：形体在构造期用 Graphics 烘焙成 1:1 纹理，
 * 中文交给 Pixi `Text`（系统 CJK 字体栈，resolution 跟设备像素走），
 * 帧循环里没有生成、没有分配。每个地标按脚底 y 进 SortLayer，
 * 玩家可以走到拱门前把它挡住，也可以贴着导览牌合影。
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
  clothLight: 0xfff3c9,
  mint: 0x8fe3c7,
  mintDark: 0x5cc4a0,
  /** 薄荷字的墨色档：奶油底牌上仍保证小字号可读 */
  mintInk: 0x2f8a6e,
  mintGlow: 0xd9fff2,
  iron: 0x4a4f58,
  ironLight: 0x6f7680,
} as const;

const ARCH = WELCOME_LANDMARKS.arch;
const DIRECTORY = WELCOME_LANDMARKS.directory;

/** 一个带 1px 描边的圆角矩形：与 props.ts 的 box 同一种画法 */
function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number = COLOR.ink): void {
  g.roundRect(x, y, w, h, 2).fill(line);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 1).fill(fill);
}

/** 霓虹灯管：一条 1px 芯线 + 一层低透明外晕，静态像素发光 */
function neonLine(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x - 1, y - 1, w + 2, h + 2).fill({ color: COLOR.mint, alpha: 0.18 });
  g.rect(x, y, w, h).fill(COLOR.mintGlow);
}

/**
 * 迎宾拱门：两根铸铁/深木立柱 + 横梁 + 奶油底牌。
 * 牌面由 Pixi Text 写「牛马园区 / NIOMA」，Graphics 只负责形与霓虹边。
 */
function drawArch(g: Graphics, w: number, h: number): void {
  g.ellipse(w / 2, h - 2, w / 2 - 18, 5).fill({ color: COLOR.shadow, alpha: 0.22 });

  // 立柱与柱脚
  for (const x of [10, w - 24]) {
    box(g, x + 4, h - 12, 10, 8, COLOR.ironLight, COLOR.iron);
    box(g, x, 22, 18, h - 32, COLOR.woodDark, COLOR.woodEdge);
    box(g, x + 2, 24, 14, h - 36, COLOR.woodLight, COLOR.woodDark);
    // 铸铁包角：上下各一段，读起来是「木柱包铁」
    box(g, x + 1, 26, 16, 6, COLOR.iron, COLOR.woodEdge);
    box(g, x + 1, h - 22, 16, 6, COLOR.iron, COLOR.woodEdge);
  }

  // 横梁
  box(g, 8, 8, w - 16, 16, COLOR.woodDark, COLOR.woodEdge);
  box(g, 10, 10, w - 20, 12, COLOR.woodLight, COLOR.woodDark);
  for (let x = 18; x < w - 18; x += 28) {
    g.rect(x, 14, 2, 2).fill(COLOR.iron);
    g.rect(x + 4, 14, 2, 2).fill(COLOR.ironLight);
  }

  // 招牌：奶油底牌 + 薄荷霓虹描边 + 四角灯钉。
  // 牌面底边离地 50px（世界 y ≈ 4358），玩家从下面穿过时身体不会被整块盖住。
  box(g, 24, 10, w - 48, 52, COLOR.paper, COLOR.paperEdge);
  g.rect(26, 12, w - 52, 2).fill({ color: COLOR.mintDark, alpha: 0.5 });
  neonLine(g, 28, 14, w - 56, 2);
  neonLine(g, 28, 58, w - 56, 2);
  for (const [x, y] of [
    [30, 18],
    [w - 32, 18],
    [30, 56],
    [w - 32, 56],
  ] as const) {
    g.circle(x, y, 3).fill({ color: COLOR.mint, alpha: 0.22 });
    g.rect(x - 1, y - 1, 2, 2).fill(COLOR.mintGlow);
  }
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

/**
 * 四向指路牌：一根木柱上叠四块纸牌，箭头方向由 NAV_TARGETS 的真实方位决定。
 * 横坐标全部由传入画布推导，96×92 时与 ADR-0047 之前的像素坐标逐一重合。
 */
function drawSignpost(g: Graphics, w: number, h: number, arrows: readonly number[]): void {
  const plateX = Math.round((w - 72) / 2);
  const tagX = Math.round((w - 52) / 2);
  const tagY = h - 12;

  g.ellipse(w / 2, h - 1, 24, 3).fill({ color: COLOR.shadow, alpha: 0.22 });
  box(g, w / 2 - 4, 4, 8, h - 4, COLOR.woodLight, COLOR.woodDark);
  g.rect(w / 2 - 2, 8, 1, h - 14).fill(COLOR.clothLight);

  // 顶牌：园区导览
  box(g, plateX, 0, 72, 14, COLOR.paper, COLOR.paperEdge);
  g.rect(plateX, 0, 4, 14).fill(COLOR.mintDark);
  // 标题左侧的菱形记号：读作「导览」，不冒充指北针
  g.poly([plateX + 12, 3, plateX + 16, 7, plateX + 12, 11, plateX + 8, 7]).fill(COLOR.mintDark);

  // 四块设施牌：自上而下按 NAV_TARGETS 顺序
  for (let i = 0; i < 4; i += 1) {
    const top = 16 + i * 16;
    box(g, 6, top, w - 12, 14, COLOR.paper, COLOR.paperEdge);
    g.rect(6, top + 13, w - 12, 1).fill(COLOR.clothLight);
    drawArrow(g, 20, top + 7, arrows[i] ?? 0);
  }

  // 底牌：反色小标签，给「你在这里」一个视觉落点
  box(g, tagX, tagY, 52, 10, COLOR.inkSoft, COLOR.woodDark);
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
    this.buildArch(depth, renderer, devicePxPerTexel);
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

  private buildArch(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    const texture = bake(renderer, (g) => drawArch(g, ARCH.width, ARCH.height), {
      frame: new Rectangle(0, 0, ARCH.width, ARCH.height),
    });
    const root = new Container();
    root.position.set(ARCH.x, ARCH.y);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    root.addChild(sprite);

    this.addText(root, devicePxPerTexel, {
      text: '牛马园区',
      x: 0,
      y: -(ARCH.height - 30),
      size: 18,
      weight: '600',
      fill: COLOR.inkSoft,
      spacing: 3,
    });
    this.addText(root, devicePxPerTexel, {
      text: 'NIOMA · NEON PARK',
      x: 0,
      y: -(ARCH.height - 45),
      size: 8,
      font: MONO_FONT,
      fill: COLOR.mintInk,
      spacing: 1,
    });
    this.addText(root, devicePxPerTexel, {
      text: '欢迎光临 · 打卡上班',
      x: 0,
      y: -(ARCH.height - 54),
      size: 7,
      fill: COLOR.inkSoft,
      spacing: 2,
    });

    depth.add(ARCH.y, root);
    this.landmarks.push({ root, texture });
  }

  private buildSignpost(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    const readings = signReadings();
    const texture = bake(
      renderer,
      (g) => drawSignpost(g, DIRECTORY.width, DIRECTORY.height, readings.map((reading) => reading.octant)),
      { frame: new Rectangle(0, 0, DIRECTORY.width, DIRECTORY.height) },
    );
    const root = new Container();
    root.position.set(DIRECTORY.x, DIRECTORY.y);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    root.addChild(sprite);

    const base = -DIRECTORY.height;
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
        x: -DIRECTORY.width / 2 + 30,
        y: base + 23 + i * 16,
        size: 9,
        fill: COLOR.inkSoft,
        anchorX: 0,
      });
    }
    this.addText(root, devicePxPerTexel, {
      text: '你在这里',
      x: 0,
      y: base + DIRECTORY.height - 7,
      size: 7,
      fill: COLOR.paper,
    });

    depth.add(DIRECTORY.y, root);
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
  return navReadings(DIRECTORY.x, DIRECTORY.y);
}
