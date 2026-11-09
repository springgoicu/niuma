'use client';

import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CharacterAppearance } from '@niuma/shared-types';
import { loadAtlas, type Atlas } from './atlas';
import { BLINK_COLUMN, buildClipTracks, frameAt } from './clip';
import { PonyRenderer } from './pony';
import { ponyMotion, type PonyPoseName } from './pony-motion';
import { GroundFx, SHADOW_NORMAL } from './fx';
import { pixelMetrics, readDpr, type PixelMetrics } from './pixel-scale';
import { BASE_CSS_PER_TEXEL, layoutPreview } from './preview-layout';

/**
 * 捏人预览：单角色、整数倍放大，颜色拖动只改 tint，不重建纹理，
 * 因此 60Hz 拖动不会触发 React 重渲染风暴。
 *
 * 尺寸与位置全部交给 preview-layout 推导：容器一变（地址栏收展、横竖屏、
 * 断点切换）就重排，角色始终在画布正中，不再是写死的 58%。
 */
export class CreatorPreview {
  private readonly app = new Application();
  private readonly tracks = buildClipTracks();
  private atlas: Atlas | null = null;
  private character: PonyRenderer | null = null;
  private platform: Container | null = null;
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
  private host: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private frame = 0;

  async init(host: HTMLElement, appearance: CharacterAppearance): Promise<void> {
    const dpr = readDpr();
    await this.app.init({
      preference: 'webgpu',
      backgroundAlpha: 0,
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

    // 先把画布铺满容器：Application 默认 800×600，等图集就绪再排就来不及了
    this.applyLayout();
    this.observe(host);
    window.addEventListener('resize', this.onViewportChange);

    this.atlas = await loadAtlas();
    if (this.disposed || !this.atlas) return;

    const graphics = new Graphics();
    graphics.ellipse(0, 6, 82, 22).fill({ color: 0xc9b48f, alpha: 0.32 });
    graphics.ellipse(0, 3, 68, 16).fill({ color: 0x8a6f4e, alpha: 0.28 });
    graphics.ellipse(0, 1, 52, 11).fill({ color: 0x5c4128, alpha: 0.3 });
    const platform = new Container();
    platform.addChild(graphics);
    this.platform = platform;

    // 接触阴影和游戏里共用同一组纹理，预览与实机才不会两套观感
    this.shadowTextures = GroundFx.shadowTextures(this.app.renderer);
    this.shadow = new Sprite(this.shadowTextures[SHADOW_NORMAL]!);
    this.shadow.anchor.set(0.5, 0.5);

    this.character = new PonyRenderer(this.atlas, appearance, this.metrics.cssScale);
    await this.character.build();
    if (this.disposed) return;

    this.app.stage.addChild(platform, this.shadow, this.character.container);
    this.applyLayout();
    this.app.ticker.add(this.tick);
  }

  /**
   * 尺寸、倍率、脚底锚点一次性落盘。
   * renderer.resize 必须显式调用：resizeTo 只听 window resize，
   * 容器因布局变化而改尺寸时 canvas 会停在旧尺寸上，画面就偏了。
   */
  private applyLayout(): void {
    const host = this.host;
    if (!host || this.disposed || !this.booted) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 2 || height < 2) return;

    const placement = layoutPreview({ width, height }, BASE_CSS_PER_TEXEL, readDpr());
    this.metrics = placement.metrics;
    this.app.renderer.resize(width, height, placement.metrics.dpr);
    this.app.stage.position.set(placement.footX, placement.footY);
    this.character?.setScale(placement.metrics.cssScale);
    // 台座与接触阴影跟着同一个比例走，角色缩小后地基不会显得过大
    this.platform?.scale.set(placement.scaleRatio);
    this.shadow?.scale.set(placement.scaleRatio);
  }

  private observe(host: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(this.onHostResize);
    this.observer.observe(host);
  }

  private onHostResize = (): void => {
    this.scheduleLayout();
  };

  /** 窗口变化只作为 DPR 兜底：宿主尺寸由 ResizeObserver 负责 */
  private onViewportChange = (): void => {
    this.scheduleLayout();
  };

  /** 地址栏收展时 observer 会连发多次，合并到一帧里只排一次 */
  private scheduleLayout(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.applyLayout();
    });
  }

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

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onViewportChange);
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.host = null;
    // init() 尚未完成（StrictMode 双挂载、快速切换页面）：ticker/stage 还不存在，
    // 这里不做任何清理，交给 init() 在 await 结束后自行销毁。
    if (!this.booted) return;
    this.app.ticker.remove(this.tick);
    this.character?.destroy();
    this.character = null;
    this.shadow?.destroy();
    this.shadow = null;
    // 台座可能还没挂到 stage（图集加载中被卸载），没挂的那个要自己销毁
    if (this.platform && !this.platform.parent) this.platform.destroy({ children: true });
    this.platform = null;
    for (const texture of this.shadowTextures) texture.destroy(true);
    this.shadowTextures = [];
    this.app.destroy(true, { children: true });
  }
}
