'use client';

import { Graphics, Rectangle, Sprite, type Application, type Texture } from 'pixi.js';
import { PLAZA_CENTER } from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import { paintLantern } from './lighting/lanterns';
import { lightToneAt } from './lighting/tone';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';
import {
  BUNTING_LAMP_GAP,
  festivalDecorPlan,
  festivalLights,
  type FestivalAnchor,
} from './festival-decor';

/**
 * 节日装饰渲染（ADR-0063）：彩旗、门楣挂饰与树梢灯笼。
 *
 * 三条纪律：
 * 1. **构造期烘一次**：全部贴图在 `attach()` 里 `bake()`，帧循环只切 `texture` 与写 `tint / alpha`，
 *    不 `generateTexture`、不 new 对象；
 * 2. **像素对齐**：贴图 1:1、nearest、整数纹素；竖挂彩旗用 90° 整角旋转，不产生斜边重采样；
 * 3. **昼夜只采样一处**：亮度与 `lightToneAt` 同频（30s 一次），6 处真实光池在 `renderer` 里注册。
 */

type TextureFactory = Application['renderer'];

/** 跨路彩旗贴图宽度 = 成对灯柱间距，端点正好落在灯头上 */
const BUNTING_W = BUNTING_LAMP_GAP;
const BUNTING_H = 48;
/** 门楣彩旗贴在牌坊横枋上：148 = 两根牌坊立柱的间距 */
const GATE_BUNTING_W = 148;
const GATE_BUNTING_H = 44;
const TREE_LANTERN_W = 24;
const TREE_LANTERN_H = 32;

/** 两帧飘动的切换周期：720ms 一个来回，比待机呼吸略快 */
const FRAME_MS = 720;
const TONE_SAMPLE_MS = 30_000;

const STRING = 0x7d2418;

interface Palette {
  /** 三角旗三色轮换：朱红为主，金 / 奶油 / 薄荷 / 蜜桃做点缀 */
  readonly flags: readonly [number, number, number];
  readonly string: number;
}

const PALETTES: readonly Palette[] = [
  { flags: [0xd8452f, 0xe8c46a, 0xfff6e0], string: STRING },
  { flags: [0xd8452f, 0x8fe3c7, 0xfff6e0], string: STRING },
  { flags: [0xd8452f, 0xffb59e, 0xe8c46a], string: STRING },
];

/** 位置哈希只决定相位，不决定任何世界坐标 */
function phaseOf(x: number, y: number): 0 | 1 {
  return (((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 5) & 1) as 0 | 1;
}

/**
 * 一条彩旗：1px 阶梯弧线 + 每 15px 一面三角旗 + 中央一盏宫灯。
 * 弧线用整数抛物线，不用 `Math.sin`：跨引擎末位一致，且永远落在整纹素上。
 */
function paintBunting(g: Graphics, width: number, palette: Palette, frame: 0 | 1, sagMax: number): void {
  for (let x = 0; x < width; x += 1) {
    const t = x / (width - 1);
    const sag = Math.round(sagMax * 4 * t * (1 - t));
    g.rect(x, sag, 1, 1).fill(palette.string);
  }
  // 旗宽取偶数：三角旗顶点必须落在整纹素，避免 1:1 烘焙时出现半像素边
  const flagW = 8;
  const flagH = 8;
  let index = 0;
  for (let x = 8 + (frame === 0 ? 0 : 3); x < width - 8; x += 15) {
    const t = x / (width - 1);
    const sag = Math.round(sagMax * 4 * t * (1 - t));
    const color = palette.flags[(index + frame) % 3]!;
    g.poly([x, sag + 1, x + flagW, sag + 1, x + flagW / 2, sag + 1 + flagH]).fill(color);
    g.rect(x, sag + 1, flagW, 1).fill(palette.string);
    index += 1;
  }
  // 中央大灯笼：光池的光心就落在这盏灯正下方的地面
  paintLantern(g, Math.round(width / 2), sagMax - 2);
}

/** 树梢小灯笼：一根横杆 + 两盏并排的宫灯，挂在树冠下三分之一 */
function paintTreeLantern(g: Graphics): void {
  g.rect(6, 3, 13, 1).fill(STRING);
  g.rect(6, 0, 1, 4).fill(STRING);
  g.rect(18, 0, 1, 4).fill(STRING);
  paintLantern(g, 6, 4);
  paintLantern(g, 18, 4);
}

interface AnimatedEntry {
  readonly sprite: Sprite;
  readonly textures: readonly [Texture, Texture];
  readonly phase: 0 | 1;
  frame: 0 | 1;
}

export class FestivalArt {
  /** 6 处真实光池：renderer 在 `lightmap.register()` 之前一次取走 */
  readonly lights: LightSpec[];
  private readonly plan: readonly FestivalAnchor[];
  private readonly winter: boolean;
  private readonly textures: Texture[] = [];
  private readonly sprites: Sprite[] = [];
  private readonly animated: AnimatedEntry[] = [];
  private nextToneAt = 0;

  constructor(options: { winter: boolean; plan?: readonly FestivalAnchor[] }) {
    this.winter = options.winter;
    this.plan = options.plan ?? festivalDecorPlan();
    this.lights = festivalLights(this.plan);
  }

  attach(depth: DepthSink, renderer: TextureFactory): void {
    const bunting = [0, 1, 2].map((variant) => this.bakeBuntingPair(renderer, PALETTES[variant]!, BUNTING_W, BUNTING_H, 16));
    const gate = [0, 1].map((variant) => this.bakeBuntingPair(renderer, PALETTES[variant]!, GATE_BUNTING_W, GATE_BUNTING_H, 12));
    const treeTexture = bake(renderer, paintTreeLantern, {
      frame: new Rectangle(0, 0, TREE_LANTERN_W, TREE_LANTERN_H),
    });
    this.textures.push(treeTexture);

    for (const anchor of this.plan) {
      if (anchor.kind === 'tree-lantern') {
        const sprite = new Sprite(treeTexture);
        sprite.anchor.set(0.5, 0);
        sprite.position.set(anchor.x, anchor.y);
        this.add(depth, anchor, sprite);
        continue;
      }

      if (anchor.kind === 'gate-bunting') {
        const pair = gate[anchor.variant % 2]!;
        const sprite = new Sprite(pair[0]);
        sprite.anchor.set(0.5, 0);
        sprite.position.set(anchor.x, anchor.y);
        this.add(depth, anchor, sprite);
        this.animated.push({ sprite, textures: pair, phase: phaseOf(anchor.x, anchor.y), frame: 0 });
        continue;
      }

      const pair = bunting[anchor.variant % 3]!;
      const sprite = new Sprite(pair[0]);
      this.placeBunting(sprite, anchor);
      this.add(depth, anchor, sprite);
      this.animated.push({ sprite, textures: pair, phase: phaseOf(anchor.x, anchor.y), frame: 0 });
    }

    this.applyTone();
  }

  /** 每帧只比较相位与切 `texture`；昼夜 tint 30s 才写一次，全程不分配对象 */
  update(nowMs: number): void {
    const step = Math.floor(nowMs / FRAME_MS);
    for (const entry of this.animated) {
      const frame = (((step + entry.phase) & 1) as 0 | 1);
      if (frame === entry.frame) continue;
      entry.frame = frame;
      entry.sprite.texture = entry.textures[frame];
    }
    if (nowMs < this.nextToneAt) return;
    this.nextToneAt = nowMs + TONE_SAMPLE_MS;
    this.applyTone();
  }

  destroy(): void {
    for (const sprite of this.sprites) sprite.destroy();
    this.sprites.length = 0;
    this.animated.length = 0;
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
  }

  private bakeBuntingPair(
    renderer: TextureFactory,
    palette: Palette,
    width: number,
    height: number,
    sagMax: number,
  ): readonly [Texture, Texture] {
    const frames = [0, 1].map((frame) =>
      bake(renderer, (g) => paintBunting(g, width, palette, frame as 0 | 1, sagMax), {
        frame: new Rectangle(0, 0, width, height),
      }),
    ) as [Texture, Texture];
    this.textures.push(frames[0], frames[1]);
    return frames;
  }

  /**
   * 横向彩旗：贴图左端对准左灯头；纵向彩旗用整 90° 旋转，
   * 旗面朝远离广场的一侧翻，东西两路看起来不会同向「倒」。
   */
  private placeBunting(sprite: Sprite, anchor: FestivalAnchor): void {
    const toX = anchor.toX ?? anchor.x;
    const toY = anchor.toY ?? anchor.y;
    sprite.anchor.set(0, 0);
    if (Math.abs(toX - anchor.x) >= Math.abs(toY - anchor.y)) {
      sprite.position.set(Math.min(anchor.x, toX), anchor.y);
      return;
    }
    if (anchor.x < PLAZA_CENTER.x) {
      sprite.angle = 90;
      sprite.position.set(anchor.x, anchor.y);
    } else {
      sprite.angle = -90;
      sprite.position.set(anchor.x, Math.max(anchor.y, toY));
    }
  }

  private add(depth: DepthSink, anchor: FestivalAnchor, sprite: Sprite): void {
    depth.add(anchor.depthY, sprite);
    this.sprites.push(sprite);
  }

  /**
   * 白天把彩旗压到暖米色，入夜拉满白：同一个 sprite 在夜里相对更亮，
   * 与光图的冷蓝底形成「灯自己会亮」的层次。真实亮度仍由 6 处光池负责。
   */
  private applyTone(): void {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const label = lightToneAt(hour, this.winter).label;
    const night = label === 'night';
    const tint = night ? 0xffffff : label === 'dusk' ? 0xf6ead6 : 0xe9dfcd;
    for (const sprite of this.sprites) sprite.tint = tint;
  }
}
