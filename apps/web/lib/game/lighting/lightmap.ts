'use client';

import { Container, RenderTexture, Sprite, type Application, type Texture } from 'pixi.js';
import {
  LightRegistry,
  flickerAlpha,
  type Light,
  type LightSpec,
} from './light-registry';
import { serverHourFraction } from '../server-date';
import { serverNow, serverTzOffsetMin } from '../server-clock';
import { bakeLightTexture } from './light-texture';
import { TONE_SAMPLE_MS, ambientMultiplierOf, lightToneAt, localLightGain, type LightTone } from './tone';

/**
 * 局部动态光影层：一张低清 Lightmap RenderTexture + 两张全屏合成 quad。
 *
 * 每帧只做一次 RT Pass：清屏色 = 当前时段的环境乘子（不透明），
 * 再把视口内所有点光源用共享光斑合批画进去。合成阶段：
 *   multiply：光图直接压暗主场景，灯心处接近纯白 → 保留原亮度与暖色；
 *   screen：同图低 alpha 再叠一次，把暗部抬回来一点，灯心更亮。
 *
 * 为什么环境底和点光源共用一张图：约束里「全部光源一次性合批」比「灯心亮度能超过 1」
 * 更硬。拆成两张 RT 会让同一批光源提交两次，或者多一次 RT 拷贝；
 * 单图的上限是光图本身，靠暗环境底形成冷暖/明暗对比（ADR-0048）。
 *
 * 坐标：光图覆盖当前相机视口（screen / divisor），合成 quad 从屏幕 (0,0) 起、
 * 宽高为「RT 像素 × 分母」，最多越出视口 divisor-1 CSS 像素，由 stage 裁掉。
 * 光源位置 = (world - 视口左上) × (cssScale / divisor)，取整到 RT 像素，避免相机移动时抖动。
 */

/** 默认 1/4 视口；`?lm=2` 可切 1/2 */
export const DEFAULT_LIGHTMAP_DIVISOR = 4;

/** Screen 补光的最大 alpha：只抬暗部，不把夜景洗成白天 */
const SCREEN_ALPHA = 0.18;

export interface LightmapOptions {
  winter?: boolean;
  divisor?: number;
}

export class LightmapLayer {
  /** 合成层：加在 world 与雪层之后，不进入 UI */
  readonly container = new Container();

  private readonly registry = new LightRegistry();
  /** 未挂到 stage 的批处理容器：只渲染进 RT */
  private readonly lightRoot = new Container();
  private readonly pool: Sprite[] = [];
  /** 每帧复用的可见光数组，`collect` 会截断长度 */
  private readonly visible: Light[] = [];
  private readonly rt: RenderTexture;
  private readonly lightTexture: Texture;
  private readonly ambient: Sprite;
  private readonly screen: Sprite;
  private readonly divisor: number;
  private readonly winter: boolean;

  private tone: LightTone | null = null;
  private nextToneAt = 0;
  private viewReady = false;
  /** 画质降档时关掉 screen 抬暗部那一层（默认开，观感与改造前一致） */
  private screenEnabled = true;

  private originX = 0;
  private originY = 0;
  private worldW = 0;
  private worldH = 0;
  /** RT 像素 / 世界纹素 */
  private rtPerWorld = 1;

  /** 调试用：最近一帧提交的光源数 */
  visibleCount = 0;

  constructor(
    private readonly renderer: Application['renderer'],
    options: LightmapOptions = {},
  ) {
    this.divisor = options.divisor === 2 ? 2 : DEFAULT_LIGHTMAP_DIVISOR;
    this.winter = options.winter ?? false;

    this.rt = RenderTexture.create({
      width: 1,
      height: 1,
      dynamic: true,
      resolution: 1,
      antialias: false,
      scaleMode: 'nearest',
      addressMode: 'clamp-to-edge',
    });
    this.lightTexture = bakeLightTexture(renderer);

    this.ambient = new Sprite(this.rt);
    this.ambient.anchor.set(0, 0);
    this.ambient.blendMode = 'multiply';

    this.screen = new Sprite(this.rt);
    this.screen.anchor.set(0, 0);
    this.screen.blendMode = 'screen';
    this.screen.alpha = SCREEN_ALPHA;

    this.container.addChild(this.ambient, this.screen);
    this.container.visible = false;
  }

  get lightCount(): number {
    return this.registry.size;
  }

  /** 注册地标光源；构造期一次，之后只读 */
  register(specs: readonly LightSpec[]): void {
    this.registry.addAll(specs);
  }

  /**
   * 关掉 screen 抬暗部那一层（画质降档用）。
   *
   * 保留 multiply 主合成：夜色压暗的观感基本不变，只失去暗部的提亮。省掉的是一次
   * 全屏混合 quad——傍晚与夜间才有的那份填充率，也正是玩家最集中上线的时段。
   */
  setScreenEnabled(enabled: boolean): void {
    if (enabled === this.screenEnabled) return;
    this.screenEnabled = enabled;
    this.screen.visible = enabled;
  }

  /** 视口尺寸变化时先跟上尺寸；相机参数由下一帧 setView 补齐 */
  resize(screenW: number, screenH: number): void {
    this.resizeBuffers(screenW, screenH);
  }

  private resizeBuffers(screenW: number, screenH: number): void {
    const rtW = Math.max(2, Math.ceil(screenW / this.divisor));
    const rtH = Math.max(2, Math.ceil(screenH / this.divisor));
    if (this.rt.width !== rtW || this.rt.height !== rtH) this.rt.resize(rtW, rtH);

    // 合成 quad 用「RT 像素 × 分母」而不是 screen 尺寸：
    // RT 宽高向上取整，若把 ceil 后的纹理硬拉回 screen 宽，整张光图会有 <0.2% 的缩放，
    // 屏幕边缘的灯心相对灯柱会偏几像素。多出来的一小条落在视口外，被 stage 裁掉。
    const quadW = rtW * this.divisor;
    const quadH = rtH * this.divisor;
    if (this.ambient.width !== quadW || this.ambient.height !== quadH) {
      this.ambient.width = quadW;
      this.ambient.height = quadH;
      this.screen.width = quadW;
      this.screen.height = quadH;
    }
  }

  /**
   * 相机/视口变化时调用：只在尺寸真的变化时 resize RT，帧循环里不建纹理。
   * `camX/camY` 是相机中心（世界纹素），`halfW/halfH` 是半个视口。
   */
  setView(
    screenW: number,
    screenH: number,
    cssScale: number,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
  ): void {
    this.resizeBuffers(screenW, screenH);

    this.originX = camX - halfW;
    this.originY = camY - halfH;
    this.worldW = screenW / cssScale;
    this.worldH = screenH / cssScale;
    this.rtPerWorld = cssScale / this.divisor;
    this.viewReady = true;
  }

  /**
   * 每帧在主场景渲染之前调用一次：
   * 采样时段 → 剔除 → 更新池化 Sprite → 一次 RT Pass → 打开合成层。
   */
  render(nowMs: number): void {
    if (!this.viewReady) return;
    const tone = this.sampleTone(nowMs);
    const depth = tone.ambient;

    // 白昼：环境乘子是纯白，光图是恒等变换，整层零开销跳过
    if (depth < 0.01) {
      this.container.visible = false;
      this.visibleCount = 0;
      return;
    }

    const gain = localLightGain(tone);
    const count = this.registry.collect(
      this.originX,
      this.originY,
      this.originX + this.worldW,
      this.originY + this.worldH,
      this.visible,
    );

    for (let i = 0; i < count; i += 1) {
      const light = this.visible[i]!;
      const sprite = this.pool[i] ?? this.createSprite();
      const size = Math.max(2, Math.round(light.radius * 2 * this.rtPerWorld));
      sprite.position.set(
        Math.round((light.x - this.originX) * this.rtPerWorld),
        Math.round((light.y - this.originY) * this.rtPerWorld),
      );
      sprite.width = size;
      sprite.height = size;
      sprite.tint = light.color;
      sprite.alpha = flickerAlpha(light.intensity, light.flicker, light.seed, nowMs) * gain;
      sprite.visible = sprite.alpha > 0.004;
    }
    for (let i = count; i < this.pool.length; i += 1) this.pool[i]!.visible = false;
    this.visibleCount = count;

    // 同一张光图：乘算压暗 + 少量 screen 抬暗部；深度越深，补光越明显
    this.ambient.alpha = 1;
    this.screen.alpha = SCREEN_ALPHA * Math.min(1, depth * 1.6);
    this.container.visible = true;

    const ambient = ambientMultiplierOf(tone);
    this.renderer.render({
      container: this.lightRoot,
      target: this.rt,
      clear: true,
      // 清屏必须不透明：Multiply 才是纯乘算，不会把主场景 alpha 混进来
      clearColor: [
        ((ambient >> 16) & 0xff) / 255,
        ((ambient >> 8) & 0xff) / 255,
        (ambient & 0xff) / 255,
        1,
      ],
    });
  }

  private sampleTone(nowMs: number): LightTone {
    if (!this.tone || nowMs >= this.nextToneAt) {
      this.nextToneAt = nowMs + TONE_SAMPLE_MS;
      const hour = serverHourFraction(serverNow(), serverTzOffsetMin());
      // 旧 AmbientLight 漏传 winter，冬季锚点从未生效；这里显式传
      this.tone = lightToneAt(hour, this.winter);
    }
    return this.tone;
  }

  private createSprite(): Sprite {
    const sprite = new Sprite(this.lightTexture);
    sprite.anchor.set(0.5, 0.5);
    sprite.blendMode = 'add';
    this.lightRoot.addChild(sprite);
    this.pool.push(sprite);
    return sprite;
  }

  destroy(): void {
    this.registry.clear();
    this.visible.length = 0;
    this.pool.length = 0;
    this.container.destroy({ children: true });
    this.lightRoot.destroy({ children: true });
    this.lightTexture.destroy(true);
    this.rt.destroy(true);
  }
}
