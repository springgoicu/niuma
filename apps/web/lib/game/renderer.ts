'use client';

import {
  Application,
  Container,
  Graphics,
  RendererType,
  Text,
  TilingSprite,
  type Texture,
} from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH, type CharacterAppearance } from '@niuma/shared-types';
import { loadAtlas, type Atlas } from './atlas';
import { CharacterSprite } from './character';
import { pixelMetrics, readDpr, sameMetrics, snapCss, snapTexel, type PixelMetrics } from './pixel-scale';

/** 基准缩放：DPR 2 时每个纹素仍然是 6 个设备像素，观感不变 */
const BASE_CSS_PER_TEXEL = 3;
const GROUND_TILE = 128;

const NAME_STYLE = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 9,
  fill: 0xe6ede6,
  stroke: { color: 0x0b0f0d, width: 4 },
  letterSpacing: 0.4,
};

class EntityView {
  readonly root = new Container();
  readonly body: CharacterSprite;
  private readonly label: Text;
  private readonly bubble = new Container();
  private readonly bubbleText: Text;
  private readonly bubbleBg = new Graphics();
  private bubbleUntil = 0;

  constructor(atlas: Atlas, name: string, appearance: CharacterAppearance, devicePxPerTexel: number) {
    this.body = new CharacterSprite(atlas, appearance, 1);
    this.label = new Text({ text: name, style: NAME_STYLE, resolution: devicePxPerTexel });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, -50);

    this.bubbleText = new Text({
      text: '',
      resolution: devicePxPerTexel,
      style: {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: 8,
        fill: 0x0b0f0d,
        wordWrap: true,
        wordWrapWidth: 110,
        align: 'center',
        padding: 3,
      },
    });
    this.bubble.visible = false;
    this.bubble.addChild(this.bubbleBg, this.bubbleText);
  }

  async init(): Promise<void> {
    await this.body.build();
    this.root.addChild(this.body.container, this.label, this.bubble);
  }

  /** DPR 变化时按新的设备纹素重建文字位图，否则文字会被拉伸到 2 倍而发虚 */
  setTextResolution(devicePxPerTexel: number): void {
    if (this.label.resolution === devicePxPerTexel) return;
    this.label.resolution = devicePxPerTexel;
    this.bubbleText.resolution = devicePxPerTexel;
  }

  setPosition(x: number, y: number): void {
    this.root.position.set(x, y);
  }

  showBubble(text: string, now: number, duration = 6000): void {
    this.bubbleText.text = text;
    const textW = Math.ceil(this.bubbleText.width);
    const textH = Math.ceil(this.bubbleText.height);
    const width = textW + 8;
    const height = textH + 4;
    const left = -Math.round(width / 2);
    const right = left + width;

    this.bubbleBg.clear();
    this.bubbleBg.rect(left, 0, width, height).fill(0xe6ede6);
    // 1px 硬边替代圆角 + 抗锯齿，气泡也跟着像素栅格走
    this.bubbleBg.rect(left, 0, width, 1).fill(0x9fb0a1);
    this.bubbleBg.rect(left, height - 1, width, 1).fill(0x9fb0a1);
    this.bubbleBg.rect(left, 0, 1, height).fill(0x9fb0a1);
    this.bubbleBg.rect(right - 1, 0, 1, height).fill(0x9fb0a1);

    this.bubbleText.position.set(-Math.round(textW / 2), 2);
    this.bubble.position.set(0, -56 - height);
    this.bubble.visible = true;
    this.bubbleUntil = now + duration;
  }

  tickBubble(now: number): void {
    if (this.bubble.visible && now > this.bubbleUntil) this.bubble.visible = false;
  }

  destroy(): void {
    this.body.destroy();
    this.root.destroy({ children: true });
  }
}

export class GameRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly views = new Map<number, EntityView>();
  private atlas!: Atlas;
  private groundTexture?: Texture;
  private metrics: PixelMetrics = pixelMetrics(BASE_CSS_PER_TEXEL, 1);
  backend = 'initializing';
  private ready = false;
  private destroyed = false;

  async init(host: HTMLElement): Promise<void> {
    const dpr = readDpr();
    this.metrics = pixelMetrics(BASE_CSS_PER_TEXEL, dpr);
    await this.app.init({
      preference: 'webgpu',
      background: 0x0b0f0d,
      resizeTo: host,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      // backing store 与设备像素 1:1，避免合成阶段被浏览器重采样
      resolution: dpr,
    });
    this.backend = this.app.renderer.type === RendererType.WEBGPU ? 'webgpu' : 'webgl';
    host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.app.canvas.style.display = 'block';

    this.atlas = await loadAtlas();
    if (this.destroyed) return;
    if (document.fonts?.ready) await document.fonts.ready;
    if (this.destroyed) return;
    this.buildGround();
    this.app.stage.addChild(this.world);
    this.world.scale.set(this.metrics.cssScale);
    this.ready = true;
  }

  private buildGround(): void {
    const g = new Graphics();
    g.rect(0, 0, GROUND_TILE, GROUND_TILE).fill(0x10160f);
    for (let y = 0; y < GROUND_TILE; y += 32) {
      for (let x = 0; x < GROUND_TILE; x += 32) {
        const even = (x / 32 + y / 32) % 2 === 0;
        g.rect(x, y, 32, 32).fill(even ? 0x161f18 : 0x111810);
        g.rect(x, y, 32, 1).fill(0x0c120c);
        g.rect(x, y, 1, 32).fill(0x0c120c);
      }
    }
    for (let i = 0; i < 26; i += 1) {
      const px = (i * 37) % 120;
      const py = (i * 53) % 120;
      g.rect(px, py, 2, 2).fill(i % 3 === 0 ? 0x1f2b1f : 0x0d130d);
    }
    // 地台是整屏面积，必须 1:1 + nearest，否则 1px 网格线会被插值抹成灰带
    this.groundTexture = this.app.renderer.generateTexture({
      target: g,
      resolution: 1,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    g.destroy();
    const ground = new TilingSprite({
      texture: this.groundTexture,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    });
    this.world.addChild(ground);
  }

  async addEntity(id: number, name: string, appearance: CharacterAppearance): Promise<void> {
    if (!this.ready || this.views.has(id)) return;
    const view = new EntityView(this.atlas, name, appearance, this.metrics.devicePxPerTexel);
    await view.init();
    this.views.set(id, view);
    this.world.addChild(view.root);
  }

  removeEntity(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    view.destroy();
  }

  updateEntity(id: number, x: number, y: number): void {
    this.views.get(id)?.setPosition(snapTexel(x), snapTexel(y));
  }

  setFrame(id: number, frameIndex: number): void {
    this.views.get(id)?.body.setFrame(frameIndex);
  }

  setAppearance(id: number, appearance: CharacterAppearance): void {
    this.views.get(id)?.body.setAppearance(appearance);
  }

  showBubble(id: number, text: string): void {
    this.views.get(id)?.showBubble(text, performance.now());
  }

  tickBubbles(): void {
    const now = performance.now();
    for (const view of this.views.values()) view.tickBubble(now);
  }

  updateCamera(x: number, y: number): void {
    this.syncMetrics();
    const screen = this.app.screen;
    const { dpr, cssScale } = this.metrics;
    // 中心点与角色都落在整纹素栅格上：中心 → 设备像素，角色 → 世界像素
    this.world.x = snapCss(screen.width / 2, dpr) - snapTexel(x) * cssScale;
    this.world.y = snapCss(screen.height / 2, dpr) - snapTexel(y) * cssScale;
  }

  /** 拖窗口到另一块屏（DPR 变化）时重建缩放与文字位图 */
  private syncMetrics(): void {
    const next = pixelMetrics(BASE_CSS_PER_TEXEL, readDpr());
    if (sameMetrics(next, this.metrics)) return;
    this.metrics = next;
    this.world.scale.set(next.cssScale);
    if (this.app.renderer.resolution !== next.dpr) this.app.renderer.resolution = next.dpr;
    for (const view of this.views.values()) view.setTextResolution(next.devicePxPerTexel);
  }

  get entityCount(): number {
    return this.views.size;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.groundTexture?.destroy(true);
    this.app.destroy(true, { children: true });
  }
}
