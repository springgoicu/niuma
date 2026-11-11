'use client';

import { Container, Sprite, type Application, type Texture } from 'pixi.js';
import { bake } from './terrain-textures';

/**
 * 飘雪：屏幕空间的细雪粒子池（ADR-0046）。
 *
 * 为什么挂在 `stage` 而不是 `world`：雪在镜头前面，不该跟着相机平移与缩放。
 * 若放进 world，相机一移动整片雪会跟着世界平移，读起来像贴在镜头上的白点；
 * 放在屏幕空间，世界在动、雪在落，两层视差才成立。
 *
 * 帧循环纪律（与 `fx.ts` 的尘土/脚印同一套）：
 * 1. 纹理构造期烘焙，帧里不 generateTexture；
 * 2. 精灵数量固定，落到屏幕外只重置坐标，不 new、不 push；
 * 3. 随机数用自带的 LCG 推进，不调 `Math.random`，重置边缘时也不产生对象。
 */

type TextureFactory = Application['renderer'];

/** 雪量上限：再多也只是叠白，先撞到的是填充率而不是批次数 */
const MAX_FLAKES = 200;
/** 每多少平方 CSS 像素放一粒雪：16000 ≈ 1280×720 一屏 58 粒 */
const AREA_PER_FLAKE = 16000;
const MIN_FLAKES = 48;

/** 慢速雪：远处的小点，负责「整片天空在下」的底噪 */
const SLOW_SPEED = [26, 44] as const;
/** 快速雪：近处的大片，负责「雪落在眼前」的层次 */
const FAST_SPEED = [54, 88] as const;

interface Flake {
  sprite: Sprite;
  /** 摆动中心（屏幕 x）：摆动只在它附近进行，整体仍随风吹走 */
  baseX: number;
  /** 横向摆动幅度（px）与相位 */
  amp: number;
  phase: number;
  /** 横向摆动的角速度（rad/s） */
  omega: number;
  /** 下落速度（px/s） */
  vy: number;
  /** 自身横向漂移（px/s），整片雪再加一点统一风向 */
  vx: number;
}

export class SnowField {
  /** 屏幕空间容器：由 `GameRenderer` 挂在 `stage` 上、柔光层之下 */
  readonly container = new Container();
  private readonly flakes: Flake[] = [];
  private readonly dotTexture: Texture;
  private readonly flakeTexture: Texture;
  private width = 0;
  private height = 0;
  /** 自带的线性同余发生器：帧循环里取随机数不产生对象，也不污染 Math.random 的全局序列 */
  private seed = 0x9e3779b9;
  /** 统一风向：所有雪都往同一边偏，读作「有风」而不是「每粒雪各飞各的」 */
  private readonly wind = 7;

  constructor(renderer: TextureFactory) {
    // 两种粒子：1×1 的雪粒与 2×2 缺一角的雪花。
    // 只做两档，靠 alpha 与速度区分远近，不做逐粒纹理切换打断批次
    this.dotTexture = bake(renderer, (g) => {
      g.rect(0, 0, 1, 1).fill(0xffffff);
    });
    this.flakeTexture = bake(renderer, (g) => {
      g.rect(0, 0, 2, 1).fill(0xffffff);
      g.rect(1, 1, 1, 1).fill(0xffffff);
    });
    this.container.label = 'snow';
  }

  /**
   * 视口尺寸变化：按面积重排粒子数量。
   * 已存在的精灵只改坐标，不销毁重建——窗口拖拽时不会看到「雪突然全没了」。
   */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    const target = Math.min(MAX_FLAKES, Math.max(MIN_FLAKES, Math.round((width * height) / AREA_PER_FLAKE)));
    while (this.flakes.length < target) this.flakes.push(this.createFlake());
    while (this.flakes.length > target) this.flakes.pop()?.sprite.destroy();
    for (const flake of this.flakes) {
      // 越界的重新投放：缩窗口时右侧与下侧的雪必须回到视野里
      if (flake.baseX > width) flake.baseX = this.random() * width;
      if (flake.sprite.y > height) flake.sprite.y = this.random() * height;
    }
  }

  /** 帧循环：只改 position 与 alpha，不建对象 */
  update(dtMs: number): void {
    if (this.width <= 0 || this.height <= 0) return;
    const dt = Math.min(64, dtMs) / 1000;
    const wrapX = this.width + 8;
    for (const flake of this.flakes) {
      const sprite = flake.sprite;
      flake.phase += flake.omega * dt;
      flake.baseX += (flake.vx + this.wind) * dt;
      sprite.y += flake.vy * dt;
      sprite.x = flake.baseX + triangle(flake.phase) * flake.amp;

      if (sprite.y > this.height + 2) {
        sprite.y = -2;
        flake.baseX = this.random() * this.width;
      }
      if (flake.baseX > wrapX) flake.baseX -= wrapX;
      if (flake.baseX < -8) flake.baseX += wrapX;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.dotTexture.destroy(true);
    this.flakeTexture.destroy(true);
    this.flakes.length = 0;
  }

  private createFlake(): Flake {
    const near = this.random() > 0.62;
    const sprite = new Sprite(near ? this.flakeTexture : this.dotTexture);
    sprite.anchor.set(0.5, 0.5);
    const baseX = this.random() * Math.max(1, this.width);
    sprite.x = baseX;
    sprite.y = this.random() * Math.max(1, this.height);
    // 近处的雪更实、更白；远处的压到 0.58，才有一层「在天上」的灰白
    sprite.alpha = near ? 0.9 : 0.58;
    sprite.tint = near ? 0xffffff : 0xe8f1fb;
    const [lo, hi] = near ? FAST_SPEED : SLOW_SPEED;
    this.container.addChild(sprite);
    return {
      sprite,
      baseX,
      amp: 4 + this.random() * 12,
      phase: this.random() * Math.PI * 2,
      omega: 0.35 + this.random() * 0.6,
      vy: lo + this.random() * (hi - lo),
      vx: (this.random() - 0.5) * 6,
    };
  }

  /** LCG：常数取自 Numerical Recipes，只用来撒点，不参与任何判定 */
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}

/** 三角波：把相位折成 [-1, 1]，比 sin 便宜且没有精度问题 */
function triangle(phase: number): number {
  const t = phase % (Math.PI * 2);
  return t < Math.PI ? (t / Math.PI) * 2 - 1 : 3 - (t / Math.PI) * 2;
}
