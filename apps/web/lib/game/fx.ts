'use client';

import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';

/** 只用到 generateTexture：这样外部不必把整个 Application 传进来 */
type TextureFactory = Application['renderer'];

/**
 * 脚下特效：接触阴影 + 踏步尘土。
 *
 * 两条硬约束（ADR-0005）：
 * 1. 纹理 1:1 生成、nearest 采样，缩放只取整数倍——否则像素块会在远景里糊成雾；
 * 2. 帧循环里不 new 对象：尘土是固定大小的对象池，只改 position / alpha / visible。
 */

/** 阴影按行宽手画，比 Graphics.ellipse 更容易保证边缘是硬像素 */
const SHADOW_ROWS = [6, 11, 15, 16, 15, 11, 6];
const SHADOW_W = 16;

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
      sprite.tint = 0x3c4a3c;
      this.container.addChild(sprite);
      this.particles.push({ sprite, vx: 0, vy: 0, age: 0, life: 0, active: false });
    }
  }

  /** 阴影纹理：所有实体共用一张，才能继续合批 */
  static shadowTexture(renderer: TextureFactory): Texture {
    const g = new Graphics();
    SHADOW_ROWS.forEach((width, row) => {
      g.rect((SHADOW_W - width) / 2, row, width, 1).fill({ color: 0x040807, alpha: 0.55 });
    });
    const texture = renderer.generateTexture({
      target: g,
      resolution: 1,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    g.destroy();
    return texture;
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

  update(dtMs: number): void {
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
  }
}
