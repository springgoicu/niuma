'use client';

import { Application, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CharacterAppearance } from '@niuma/shared-types';
import { loadAtlas, type Atlas } from './atlas';
import { BLINK_COLUMN, buildClipTracks, frameAt } from './clip';
import { PonyRenderer } from './pony';
import { ponyMotion, type PonyPoseName } from './pony-motion';
import { GroundFx, SHADOW_NORMAL } from './fx';
import { pixelMetrics, readDpr, sameMetrics, snapCss, type PixelMetrics } from './pixel-scale';

/**
 * 基准放大倍数：DPR 2 时每纹素 10 设备像素，依然能被整除。
 * 48 网格时是 6（角色约 246 CSS px 高），64 网格改成 5 正好还是约 240，
 * 预览台不用改版式就能装下，也不会出现非整数倍缩放。
 */
const BASE_CSS_PER_TEXEL = 5;

/**
 * 捏人预览：单角色、整数倍放大，颜色拖动只改 tint，不重建纹理，
 * 因此 60Hz 拖动不会触发 React 重渲染风暴。
 */
export class CreatorPreview {
  private readonly app = new Application();
  private readonly tracks = buildClipTracks();
  private atlas: Atlas | null = null;
  private character: PonyRenderer | null = null;
  private shadow: Sprite | null = null;
  private shadowTextures: Texture[] = [];
  private direction = 0;
  private pose = 'idle';
  private elapsed = 0;
  private poseSince = 0;
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
    platform.ellipse(0, 6, 82, 22).fill({ color: 0xc9b48f, alpha: 0.32 });
    platform.ellipse(0, 3, 68, 16).fill({ color: 0x8a6f4e, alpha: 0.28 });
    platform.ellipse(0, 1, 52, 11).fill({ color: 0x5c4128, alpha: 0.3 });

    // 接触阴影和游戏里共用同一组纹理，预览与实机才不会两套观感
    this.shadowTextures = GroundFx.shadowTextures(this.app.renderer);
    this.shadow = new Sprite(this.shadowTextures[SHADOW_NORMAL]!);
    this.shadow.anchor.set(0.5, 0.5);
    this.shadow.scale.set(1);

    this.character = new PonyRenderer(this.atlas, appearance, this.metrics.cssScale);
    await this.character.build();
    if (this.disposed) return;

    this.app.stage.addChild(platform, this.shadow, this.character.container);
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
    const since = this.elapsed - this.poseSince;
    // 预览台与游戏内共用同一套动效契约：整数纹素、三档阴影、35s 眨眼
    const motion = ponyMotion(this.pose as PonyPoseName, since, 0);
    const track = this.tracks[this.pose] ?? this.tracks.idle!;
    this.character?.setPose(this.direction, motion.blinking ? BLINK_COLUMN : frameAt(track, since));
    this.character?.setBob(motion.bobTexels);
    if (this.shadow) {
      const texture = this.shadowTextures[motion.shadow] ?? this.shadowTextures[SHADOW_NORMAL]!;
      if (this.shadow.texture !== texture) this.shadow.texture = texture;
    }
  };

  setAppearance(appearance: CharacterAppearance): void {
    this.character?.setAppearance(appearance);
  }

  setPose(pose: string): void {
    if (this.pose === pose) return;
    this.pose = pose;
    // 换动作从第 0 帧开始：坐下才有「落座」的起始帧，而不是随机停在呼吸相
    this.poseSince = this.elapsed;
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
    this.shadow?.destroy();
    this.shadow = null;
    for (const texture of this.shadowTextures) texture.destroy(true);
    this.shadowTextures = [];
    this.app.destroy(true, { children: true });
  }
}
