'use client';

import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';
import { WINTER_COLORS as W } from './terrain-palette';

/** 只用到 generateTexture：这样外部不必把整个 Application 传进来 */
type TextureFactory = Application['renderer'];

/**
 * 脚下特效：接触阴影 + 踏步尘土。
 *
 * 两条硬约束（ADR-0005）：
 * 1. 纹理 1:1 生成、nearest 采样，缩放只取整数倍——否则像素块会在远景里糊成雾；
 * 2. 帧循环里不 new 对象：尘土是固定大小的对象池，只改 position / alpha / visible。
 *
 * 阴影三档（ADR-0013）：squash & stretch 用换纹理实现，不做浮点缩放——
 * 亚像素缩放会立刻让硬像素边变成毛边。
 */

/**
 * 阴影是冷靛蓝而不是炭黑：暖色地面上，纯黑影子会把周围的暖调吸掉。
 * 两档 alpha 手画椭圆，外圈 0.16 / 内芯 0.28，叠出「贴地」的柔边。
 */
export const SHADOW_COLOR = 0x191e3c;
const SHADOW_W = 28;
const SHADOW_H = 14;

interface ShadowShape {
  rx: number;
  ry: number;
}

/** 0 宽扁（腾空 / 深吸气）、1 常态、2 窄高（落地压缩） */
const SHADOW_SHAPES: ShadowShape[] = [
  { rx: 13, ry: 4 },
  { rx: 11, ry: 5 },
  { rx: 9, ry: 6 },
];

export const SHADOW_NORMAL = 1;

/**
 * 逐行填椭圆：Graphics.ellipse 会引入曲线细分，手画行宽才能保证边缘是硬像素。
 *
 * 画布尺寸有默认值：角色的三档阴影必须逐像素不变，
 * 树/花箱/石头的底座投影只是换一套 boxW/boxH 复用同一段填色算法。
 */
export function fillEllipse(
  g: Graphics,
  rx: number,
  ry: number,
  color: number,
  alpha: number,
  boxW: number = SHADOW_W,
  boxH: number = SHADOW_H,
): void {
  for (let row = 0; row < boxH; row += 1) {
    const dy = (row + 0.5 - boxH / 2) / ry;
    if (dy <= -1 || dy >= 1) continue;
    const half = Math.round(rx * Math.sqrt(1 - dy * dy));
    if (half <= 0) continue;
    g.rect(boxW / 2 - half, row, half * 2, 1).fill({ color, alpha });
  }
}

/** 尘土四种形状：一撮、两撮、三点、单点，随机挑一种看起来才不像同一颗球 */
const DUST_SHAPES: number[][][] = [
  [[0, 0, 2, 1], [1, 1, 1, 1]],
  [[0, 0, 1, 1], [2, 0, 1, 1], [1, 1, 2, 1]],
  [[0, 0, 1, 1], [2, 1, 1, 1], [1, 2, 1, 1]],
  [[1, 1, 2, 2]],
];

const DUST_SIZE = 4;
const DUST_COUNT = 48;
/** 尘土存活时长：再长就会在脚边留一片灰雾 */
const DUST_LIFE = 260;

/**
 * 雪地脚印（ADR-0046）：1 张 3×2 的硬边纹理，左右两只脚靠水平镜像区分。
 *
 * 为什么复用尘土的对象池写法而不是另建粒子系统：脚印和扬尘是同一条触地通路
 * （`onFootfall`）产出的两类足迹，共用一层容器、同一段 `update`，
 * 帧循环里不会多出第二个遍历与第二套计时器。
 */
const FOOTPRINT_W = 3;
const FOOTPRINT_H = 2;
const FOOTPRINT_COUNT = 96;
/** 脚印存活时长：雪面化得慢，9s 足够留下「刚有人走过」的痕迹 */
const FOOTPRINT_LIFE = 9000;
/** 三档 alpha：像素画不做渐变贴图，靠整数档位淡出 */
const FOOTPRINT_ALPHA = [0.52, 0.34, 0.18] as const;

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  age: number;
  life: number;
  active: boolean;
}

export class GroundFx {
  readonly container = new Container();
  private readonly dustTextures: Texture[];
  private readonly particles: Particle[] = [];
  private next = 0;
  private cursor = 0;

  /** 脚印层：压在尘土之下，角色走过之后先看到脚印再看到扬尘 */
  private readonly printLayer = new Container();
  private readonly printTexture: Texture;
  private readonly prints: Particle[] = [];
  private printNext = 0;

  constructor(renderer: TextureFactory) {
    this.dustTextures = DUST_SHAPES.map((shape) => {
      const g = new Graphics();
      for (const [x, y, w, h] of shape) g.rect(x, y, w, h).fill(0xffffff);
      const texture = renderer.generateTexture({
        target: g,
        resolution: 1,
        antialias: false,
        textureSourceOptions: { scaleMode: 'nearest' },
      });
      g.destroy();
      return texture;
    });

    for (let i = 0; i < DUST_COUNT; i += 1) {
      const sprite = new Sprite(this.dustTextures[i % this.dustTextures.length]!);
      sprite.anchor.set(0.5, 0.5);
      sprite.visible = false;
      // 尘土跟着暖色地面走，灰绿会让它看起来像掉渣
      sprite.tint = 0xc9b48f;
      this.container.addChild(sprite);
      this.particles.push({ sprite, vx: 0, vy: 0, age: 0, life: 0, active: false });
    }

    // 脚印纹理：3×2 的压痕，上沿亮一线（雪被挤起来）、下沿暗一档（凹陷）
    const print = new Graphics();
    print.rect(0, 0, FOOTPRINT_W, 1).fill(0xffffff);
    print.rect(1, 1, FOOTPRINT_W - 1, 1).fill(0xffffff);
    this.printTexture = renderer.generateTexture({
      target: print,
      resolution: 1,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    print.destroy();
    this.container.addChild(this.printLayer);
    for (let i = 0; i < FOOTPRINT_COUNT; i += 1) {
      const sprite = new Sprite(this.printTexture);
      // 锚点贴左上：3 宽的纹理用 0.5 会落在半纹素上，描边会糊一档（ADR-0005）
      sprite.anchor.set(0, 0);
      sprite.visible = false;
      this.printLayer.addChild(sprite);
      this.prints.push({ sprite, vx: 0, vy: 0, age: 0, life: 0, active: false });
    }
  }

  /**
   * 阴影纹理：三档形态共用一张 28×14 画布，所有实体共用这几张纹理，
   * 才能继续合批；切换形态只是换 texture 引用。
   */
  static shadowTextures(renderer: TextureFactory): Texture[] {
    return SHADOW_SHAPES.map(({ rx, ry }) => {
      const g = new Graphics();
      fillEllipse(g, rx, ry, SHADOW_COLOR, 0.16);
      fillEllipse(g, Math.round(rx * 0.62), Math.round(ry * 0.62), SHADOW_COLOR, 0.14);
      const texture = renderer.generateTexture({
        target: g,
        resolution: 1,
        antialias: false,
        textureSourceOptions: { scaleMode: 'nearest' },
      });
      g.destroy();
      return texture;
    });
  }

  /** 落脚扬尘：只在接触帧触发，坐标已经吸附到整纹素 */
  spawn(x: number, y: number): void {
    const particle = this.particles[this.next]!;
    this.next = (this.next + 1) % this.particles.length;
    const shape = this.dustTextures[this.cursor % this.dustTextures.length]!;
    this.cursor += 1;
    particle.sprite.texture = shape;
    particle.sprite.position.set(Math.round(x), Math.round(y));
    particle.sprite.alpha = 0.6;
    particle.sprite.scale.set(1);
    particle.sprite.visible = true;
    particle.vx = (this.cursor % 2 === 0 ? 1 : -1) * 0.008;
    particle.vy = -0.01;
    particle.age = 0;
    particle.life = DUST_LIFE;
    particle.active = true;
  }

  /**
   * 雪地脚印：与扬尘同一条触地通路，只是留在原地慢慢淡掉。
   * `flip` 由调用方按左右脚交替给出，镜像只翻 3px 的整数纹理，不会糊边。
   */
  spawnFootprint(x: number, y: number, flip: boolean): void {
    const print = this.prints[this.printNext]!;
    this.printNext = (this.printNext + 1) % this.prints.length;
    const sprite = print.sprite;
    sprite.scale.x = flip ? -1 : 1;
    // 锚点在左上：x 让开半张纹理，镜像时再翻回来，脚印永远压在脚底中心
    sprite.position.set(Math.round(x) - (flip ? -(FOOTPRINT_W - 1) : 1), Math.round(y));
    sprite.tint = W.footprint;
    sprite.alpha = FOOTPRINT_ALPHA[0]!;
    sprite.visible = true;
    print.age = 0;
    print.life = FOOTPRINT_LIFE;
    print.active = true;
  }

  update(dtMs: number): void {
    for (const print of this.prints) {
      if (!print.active) continue;
      print.age += dtMs;
      if (print.age >= print.life) {
        print.active = false;
        print.sprite.visible = false;
        continue;
      }
      const k = print.age / print.life;
      print.sprite.alpha = FOOTPRINT_ALPHA[k < 0.34 ? 0 : k < 0.68 ? 1 : 2]!;
    }

    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.age += dtMs;
      if (particle.age >= particle.life) {
        particle.active = false;
        particle.sprite.visible = false;
        continue;
      }
      const k = particle.age / particle.life;
      particle.sprite.x += particle.vx * dtMs;
      particle.sprite.y += particle.vy * dtMs;
      // 只在中段跳一档整数缩放：亚像素放大在像素风里会立刻露出插值边
      particle.sprite.scale.set(k > 0.5 ? 2 : 1);
      particle.sprite.alpha = 0.6 * (1 - k);
    }
  }

  destroy(): void {
    // 先销毁精灵再销毁纹理：反过来会让还在引用纹理的 Sprite 悬空
    this.container.destroy({ children: true });
    for (const texture of this.dustTextures) texture.destroy(true);
    this.printTexture.destroy(true);
  }
}
