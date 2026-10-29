'use client';

import { Application, Graphics } from 'pixi.js';
import type { CharacterAppearance } from '@niuma/shared-types';
import { frameForPose, loadAtlas, type Atlas } from './atlas';
import { CharacterSprite } from './character';
import { pixelMetrics, readDpr, sameMetrics, snapCss, type PixelMetrics } from './pixel-scale';

/** 基准放大倍数：DPR 2 时每纹素 12 设备像素，依然能被整除 */
const BASE_CSS_PER_TEXEL = 6;

/**
 * 捏人预览：单角色、整数倍放大，颜色拖动只改 tint，不重建纹理，
 * 因此 60Hz 拖动不会触发 React 重渲染风暴。
 */
export class CreatorPreview {
  private readonly app = new Application();
  private atlas: Atlas | null = null;
  private character: CharacterSprite | null = null;
  private direction = 0;
  private pose = 'idle';
  private elapsed = 0;
  private disposed = false;
  private metrics: PixelMetrics = pixelMetrics(BASE_CSS_PER_TEXEL, 1);
  /** app.init() 是否已完成：ticker / stage 只有在这之后才存在 */
  private booted = false;

  async init(host: HTMLElement, appearance: CharacterAppearance): Promise<void> {
    const dpr = readDpr();
    this.metrics = pixelMetrics(BASE_CSS_PER_TEXEL, dpr);
    await this.app.init({
      preference: 'webgpu',
      backgroundAlpha: 0,
      resizeTo: host,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: dpr,
    });
    this.booted = true;
    if (this.disposed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.host = host;

    this.atlas = await loadAtlas();
    if (this.disposed || !this.atlas) return;

    const platform = new Graphics();
    platform.ellipse(0, 6, 82, 22).fill({ color: 0x1c2520, alpha: 0.95 });
    platform.ellipse(0, 3, 68, 16).fill({ color: 0x24302a, alpha: 0.7 });
    platform.ellipse(0, 1, 52, 11).fill({ color: 0x2f4038, alpha: 0.5 });

    this.character = new CharacterSprite(this.atlas, appearance, this.metrics.cssScale);
    await this.character.build();
    if (this.disposed) return;

    this.app.stage.addChild(platform, this.character.container);
    this.layout(host);
    this.app.ticker.add(this.tick);
    window.addEventListener('resize', this.onResize);
  }

  private host: HTMLElement | null = null;

  private layout(host: HTMLElement): void {
    const { dpr } = this.metrics;
    this.app.stage.position.set(
      snapCss(host.clientWidth / 2, dpr),
      snapCss(host.clientHeight * 0.58, dpr),
    );
  }

  private onResize = (): void => {
    if (!this.host) return;
    const next = pixelMetrics(BASE_CSS_PER_TEXEL, readDpr());
    if (!sameMetrics(next, this.metrics)) {
      this.metrics = next;
      this.character?.setScale(next.cssScale);
      // autoDensity 会按新 resolution 重算 backing store 与 CSS 尺寸
      if (this.app.renderer.resolution !== next.dpr) this.app.renderer.resolution = next.dpr;
    }
    this.layout(this.host);
  };

  private tick = (ticker: { deltaMS: number }): void => {
    this.elapsed += ticker.deltaMS;
    const clip = frameForPose(this.pose, this.elapsed);
    this.character?.setFrame(this.direction * 8 + clip);
  };

  setAppearance(appearance: CharacterAppearance): void {
    this.character?.setAppearance(appearance);
  }

  setPose(pose: string): void {
    this.pose = pose;
    this.elapsed = 0;
  }

  setDirection(direction: number): void {
    this.direction = direction;
  }

  resize(host: HTMLElement): void {
    this.layout(host);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host = null;
    window.removeEventListener('resize', this.onResize);
    // init() 尚未完成（StrictMode 双挂载、快速切换页面）：ticker/stage 还不存在，
    // 这里不做任何清理，交给 init() 在 await 结束后自行销毁。
    if (!this.booted) return;
    this.app.ticker.remove(this.tick);
    this.character?.destroy();
    this.character = null;
    this.app.destroy(true, { children: true });
  }
}
