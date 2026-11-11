'use client';

import { Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';
import { TERRAIN_COLORS } from './terrain-palette';

/**
 * 涉水表现：水线覆盖层 + 涟漪粒子池（ADR-0030）。
 *
 * 两条纪律与 fx.ts 一致：
 * 1. 纹理一次性生成、nearest 采样、不做浮点缩放——涟漪靠换帧变大，不靠 scale；
 * 2. 帧循环里不 new 对象：涟漪是固定池，只改 position / texture / alpha / visible。
 *
 * 水线覆盖层不复制地形水面：它只是一块 30×14 的半透明水色，压住角色小腿，
 * 顶部一行断续浅色像素当水线。所有角色共用同一张纹理，不破坏合批。
 */

type TextureFactory = Application['renderer'];

/** 水线覆盖层尺寸（纹素）：宽度盖住角色躯干，高度到小腿偏膝 */
export const WADING_W = 30;
export const WADING_H = 14;

/** 涟漪寿命：太短看不见扩散，太长会在脚边叠一圈「年轮」 */
const SPLASH_LIFE = 420;
/** 涟漪池大小：同屏几十人涉水时，每人每步一枚也够轮转 */
const SPLASH_COUNT = 24;
/** 涟漪画布：三帧共用，靠帧内容变大 */
const SPLASH_W = 20;
const SPLASH_H = 10;

/** 生成水线覆盖纹理：半透明水色 + 顶部断续水线 */
export function makeWadingTexture(renderer: TextureFactory): Texture {
  const g = new Graphics();
  // 主体：腿部在水下仍隐约可见，所以不用不透明色块
  g.rect(0, 0, WADING_W, WADING_H).fill({ color: TERRAIN_COLORS.waterMid, alpha: 0.42 });
  // 底部再压一档深色：水越往下越暗，水线才有厚度
  g.rect(0, WADING_H - 3, WADING_W, 3).fill({ color: TERRAIN_COLORS.waterDeep, alpha: 0.46 });
  // 顶部水线：断续的浅色像素，左右两端留 1px，免得像一条贴纸边
  const crest: Array<[number, number]> = [
    [1, 3],
    [5, 4],
    [10, 3],
    [14, 4],
    [19, 3],
    [23, 4],
    [28, 1],
  ];
  for (const [x, width] of crest) {
    g.rect(x, 0, width, 1).fill({ color: TERRAIN_COLORS.waterFoam, alpha: 0.82 });
  }
  // 水面下两条短波纹：让覆盖层不是一块纯色
  g.rect(4, 5, 5, 1).fill({ color: TERRAIN_COLORS.waterCrest, alpha: 0.42 });
  g.rect(17, 8, 6, 1).fill({ color: TERRAIN_COLORS.waterCrest, alpha: 0.36 });

  const texture = renderer.generateTexture({
    target: g,
    resolution: 1,
    antialias: false,
    textureSourceOptions: { scaleMode: 'nearest' },
  });
  g.destroy();
  return texture;
}

/**
 * 逐行 + 逐列描 1px 椭圆环。Graphics.ellipse 会引入曲线细分，
 * 硬像素风里必须手画，边缘才会保持整纹素。
 */
function traceSplashRing(g: Graphics, rx: number, ry: number, color: number, alpha: number): void {
  const halfW = SPLASH_W / 2;
  const halfH = SPLASH_H / 2;
  const fill = { color, alpha };
  for (let row = 0; row < SPLASH_H; row += 1) {
    const dy = (row + 0.5 - halfH) / ry;
    if (dy <= -1 || dy >= 1) continue;
    const half = Math.round(rx * Math.sqrt(1 - dy * dy));
    if (half <= 0) continue;
    // 每隔三行断开一次：完整椭圆环像戒指，断续才像水波
    if (row % 3 === 1) continue;
    g.rect(halfW - half, row, 1, 1).fill(fill);
    g.rect(halfW + half - 1, row, 1, 1).fill(fill);
  }
  for (let col = 0; col < SPLASH_W; col += 1) {
    const dx = (col + 0.5 - halfW) / rx;
    if (dx <= -1 || dx >= 1) continue;
    const half = Math.round(ry * Math.sqrt(1 - dx * dx));
    if (half <= 0) continue;
    if (col % 4 === 2) continue;
    g.rect(col, halfH - half, 1, 1).fill(fill);
    g.rect(col, halfH + half - 1, 1, 1).fill(fill);
  }
}

/** 三帧涟漪：环半径逐帧变大，颜色从泡沫过渡到浅水 */
function makeSplashTextures(renderer: TextureFactory): Texture[] {
  const frames: Array<{ rx: number; ry: number; color: number; alpha: number }> = [
    { rx: 3, ry: 2, color: TERRAIN_COLORS.waterFoam, alpha: 0.85 },
    { rx: 6, ry: 3, color: TERRAIN_COLORS.waterCrest, alpha: 0.7 },
    { rx: 9, ry: 4, color: TERRAIN_COLORS.waterCrest, alpha: 0.55 },
  ];
  return frames.map(({ rx, ry, color, alpha }) => {
    const g = new Graphics();
    traceSplashRing(g, rx, ry, color, alpha);
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

interface Splash {
  sprite: Sprite;
  age: number;
  life: number;
  active: boolean;
  big: boolean;
}

/** 涟漪粒子池：入水与水中落脚各触发一次 */
export class WaterFx {
  readonly container = new Container();
  private readonly textures: Texture[];
  private readonly particles: Splash[] = [];
  private next = 0;

  constructor(renderer: TextureFactory) {
    this.textures = makeSplashTextures(renderer);
    for (let i = 0; i < SPLASH_COUNT; i += 1) {
      const sprite = new Sprite(this.textures[0]!);
      sprite.anchor.set(0.5, 0.5);
      sprite.visible = false;
      this.container.addChild(sprite);
      this.particles.push({ sprite, age: 0, life: 0, active: false, big: false });
    }
  }

  /** `big` 用于入水那一下：寿命更长、起点更亮 */
  spawn(x: number, y: number, big = false): void {
    const particle = this.particles[this.next]!;
    this.next = (this.next + 1) % this.particles.length;
    particle.sprite.texture = this.textures[0]!;
    particle.sprite.position.set(Math.round(x), Math.round(y - 2));
    particle.sprite.alpha = big ? 0.9 : 0.65;
    particle.sprite.visible = true;
    particle.age = 0;
    particle.life = big ? SPLASH_LIFE * 1.25 : SPLASH_LIFE;
    particle.big = big;
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
      // 换帧变大，不做浮点缩放：像素边不能在扩散过程中被插值糊掉
      const frame = k < 0.34 ? 0 : k < 0.67 ? 1 : 2;
      particle.sprite.texture = this.textures[frame]!;
      particle.sprite.alpha = (particle.big ? 0.9 : 0.65) * (1 - k);
    }
  }

  destroy(): void {
    // 先销毁精灵再销毁纹理：反过来会让还在引用纹理的 Sprite 悬空
    this.container.destroy({ children: true });
    for (const texture of this.textures) texture.destroy(true);
  }
}
