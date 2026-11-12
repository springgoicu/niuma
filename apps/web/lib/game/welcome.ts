'use client';

import { Container, Graphics, Rectangle, Sprite, Text, type Application, type Texture } from 'pixi.js';
import { WELCOME_LANDMARKS } from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 中央迎宾地标（ADR-0047）：霓虹拱门 + 园区导览地图立牌 + 打卡签到处。
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
  mint: 0x8fe3c7,
  mintDark: 0x5cc4a0,
  /** 薄荷字的墨色档：奶油底牌上仍保证小字号可读 */
  mintInk: 0x2f8a6e,
  mintGlow: 0xd9fff2,
  iron: 0x4a4f58,
  ironLight: 0x6f7680,
  grass: 0x9fc47a,
  water: 0x63b3c2,
  dirt: 0xd1ae86,
  pin: 0xc4827b,
} as const;

const ARCH = WELCOME_LANDMARKS.arch;
const DIRECTORY = WELCOME_LANDMARKS.directory;
const CHECKIN = WELCOME_LANDMARKS.checkin;

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

/** 园区导览地图立牌：木柱 + 纸面小地图（草块 / 湖 / 路 / 你在这里） */
function drawDirectory(g: Graphics, w: number, h: number): void {
  g.ellipse(w / 2, h - 1, 24, 3).fill({ color: COLOR.shadow, alpha: 0.22 });

  // 两根木柱
  for (const x of [8, w - 12]) {
    box(g, x, 44, 4, h - 46, COLOR.woodDark, COLOR.woodEdge);
    box(g, x + 1, 46, 2, h - 50, COLOR.woodLight, COLOR.woodDark);
  }

  // 纸面
  box(g, 2, 2, w - 4, 46, COLOR.woodDark, COLOR.woodEdge);
  box(g, 4, 4, w - 8, 42, COLOR.paper, COLOR.paperEdge);
  g.rect(4, 16, w - 8, 28).fill(COLOR.grass);

  // 小地图：两片水、两条路、一个打卡点
  g.ellipse(w * 0.64, 30, 9, 6).fill(COLOR.water);
  g.ellipse(w * 0.64, 30, 5, 3).fill({ color: COLOR.mintGlow, alpha: 0.5 });
  g.ellipse(w * 0.24, 38, 5, 4).fill(COLOR.water);
  g.rect(0, 26, w, 2).fill(COLOR.dirt);
  g.rect(w * 0.42, 16, 2, 28).fill(COLOR.dirt);
  g.rect(w * 0.3, 33, 4, 4).fill(COLOR.pin);
  g.rect(w * 0.3 + 1, 34, 2, 2).fill(COLOR.paper);

  // 顶部标题条 + 底部「你在这里」的深色字条：小字号在草地上仍读得清
  g.rect(4, 4, w - 8, 12).fill(COLOR.paper);
  neonLine(g, 6, 14, w - 12, 1);
  g.rect(8, 38, w - 16, 8).fill(COLOR.inkSoft);
}

/** 打卡签到处：一根像素立柱，顶部纸牌 + 中间小屏 + 薄荷进度条 */
function drawCheckin(g: Graphics, w: number, h: number): void {
  g.ellipse(w / 2, h - 1, 12, 3).fill({ color: COLOR.shadow, alpha: 0.22 });
  box(g, 2, h - 8, w - 4, 8, COLOR.ironLight, COLOR.iron);
  box(g, 5, 14, w - 10, h - 22, COLOR.woodLight, COLOR.woodDark);
  box(g, 3, 1, w - 6, 15, COLOR.paper, COLOR.paperEdge);
  neonLine(g, 5, 14, w - 10, 1);

  // 小屏：深铁框 + 薄荷底 + 一个像素对勾
  box(g, 6, 22, w - 12, 16, COLOR.iron, COLOR.ink);
  g.rect(8, 24, w - 16, 12).fill(COLOR.mintDark);
  g.rect(10, 28, 2, 2).fill(COLOR.paper);
  g.rect(12, 30, 2, 2).fill(COLOR.paper);
  g.rect(14, 28, 4, 2).fill(COLOR.mintGlow);

  // 底部一条指示灯
  g.rect(8, h - 14, w - 16, 2).fill({ color: COLOR.mint, alpha: 0.6 });
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
    this.buildDirectory(depth, renderer, devicePxPerTexel);
    this.buildCheckin(depth, renderer, devicePxPerTexel);
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

  private buildDirectory(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    const texture = bake(renderer, (g) => drawDirectory(g, DIRECTORY.width, DIRECTORY.height), {
      frame: new Rectangle(0, 0, DIRECTORY.width, DIRECTORY.height),
    });
    const root = new Container();
    root.position.set(DIRECTORY.x, DIRECTORY.y);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    root.addChild(sprite);

    const base = -DIRECTORY.height;
    this.addText(root, devicePxPerTexel, {
      text: '园区导览',
      x: 0,
      y: base + 9,
      size: 9,
      weight: '600',
      fill: COLOR.inkSoft,
      spacing: 1,
    });
    this.addText(root, devicePxPerTexel, {
      text: '你在这里',
      x: 0,
      y: base + 43,
      size: 6,
      fill: COLOR.paper,
      spacing: 1,
    });

    depth.add(DIRECTORY.y, root);
    this.landmarks.push({ root, texture });
  }

  private buildCheckin(depth: DepthSink, renderer: TextureFactory, devicePxPerTexel: number): void {
    const texture = bake(renderer, (g) => drawCheckin(g, CHECKIN.width, CHECKIN.height), {
      frame: new Rectangle(0, 0, CHECKIN.width, CHECKIN.height),
    });
    const root = new Container();
    root.position.set(CHECKIN.x, CHECKIN.y);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    root.addChild(sprite);

    const base = -CHECKIN.height;
    this.addText(root, devicePxPerTexel, {
      text: '打卡',
      x: 0,
      y: base + 7,
      size: 7,
      weight: '600',
      fill: COLOR.inkSoft,
      spacing: 1,
    });
    this.addText(root, devicePxPerTexel, {
      text: '签到',
      x: 0,
      y: base + 16,
      size: 6,
      fill: COLOR.inkSoft,
      spacing: 1,
    });

    depth.add(CHECKIN.y, root);
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
