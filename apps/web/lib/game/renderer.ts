'use client';

import {
  Application,
  Container,
  Graphics,
  RendererType,
  Sprite,
  Text,
  type Texture,
} from 'pixi.js';
import type { CharacterAppearance } from '@niuma/shared-types';
import { loadAtlas, type Atlas } from './atlas';
import { CharacterSprite } from './character';
import { GroundFx } from './fx';
import { pixelMetrics, readDpr, sameMetrics, snapCss, snapTexel, type PixelMetrics } from './pixel-scale';
import { TerrainView } from './terrain';

/** 基准缩放：DPR 2 时每个纹素仍然是 6 个设备像素，观感不变 */
const BASE_CSS_PER_TEXEL = 3;

const NAME_STYLE = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 9,
  fill: 0xe6ede6,
  stroke: { color: 0x0b0f0d, width: 4 },
  letterSpacing: 0.4,
};

class EntityView {
  /** 本体与阴影进 y 排序层，会被树冠正确遮挡 */
  readonly root = new Container();
  /** 昵称与气泡单独一层：立绘可以被树挡住，名字不行 */
  readonly labels = new Container();
  readonly body: CharacterSprite;
  private readonly label: Text;
  private readonly bubble = new Container();
  private readonly bubbleText: Text;
  private readonly bubbleBg = new Graphics();
  private bubbleUntil = 0;
  private lastColumn = -1;

  constructor(
    atlas: Atlas,
    name: string,
    appearance: CharacterAppearance,
    devicePxPerTexel: number,
    shadow: Texture,
    private readonly onFootfall: (x: number, y: number) => void,
  ) {
    // 接触阴影先入容器：它永远压在所有角色图层之下
    const shadowSprite = new Sprite(shadow);
    shadowSprite.anchor.set(0.5, 0.5);
    shadowSprite.position.set(0, -1);
    shadowSprite.alpha = 0.85;

    this.body = new CharacterSprite(atlas, appearance, 1);
    this.label = new Text({ text: name, style: NAME_STYLE, resolution: devicePxPerTexel });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, -47);

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
    this.shadow = shadowSprite;
  }

  private readonly shadow: Sprite;

  async init(): Promise<void> {
    await this.body.build();
    this.root.addChild(this.shadow, this.body.container);
    this.labels.addChild(this.label, this.bubble);
  }

  /** DPR 变化时按新的设备纹素重建文字位图，否则文字会被拉伸到 2 倍而发虚 */
  setTextResolution(devicePxPerTexel: number): void {
    if (this.label.resolution === devicePxPerTexel) return;
    this.label.resolution = devicePxPerTexel;
    this.bubbleText.resolution = devicePxPerTexel;
  }

  setPosition(x: number, y: number): void {
    this.root.position.set(x, y);
    this.labels.position.set(x, y);
  }

  /** 换列时顺手判定落脚：跨到接触帧才扬尘，站着不动不会一路冒土 */
  setPose(direction: number, column: number, dustFrames: Set<number>): void {
    this.body.setPose(direction, column);
    if (column !== this.lastColumn && dustFrames.has(column)) {
      this.onFootfall(this.root.position.x, this.root.position.y);
    }
    this.lastColumn = column;
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
    this.bubble.position.set(0, -54 - height);
    this.bubble.visible = true;
    this.bubbleUntil = now + duration;
  }

  tickBubble(now: number): void {
    if (this.bubble.visible && now > this.bubbleUntil) this.bubble.visible = false;
  }

  destroy(): void {
    this.body.destroy();
    this.root.destroy({ children: true });
    this.labels.destroy({ children: true });
  }
}

export class GameRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  /** 树、围栏、角色统一按脚底 y 排序 */
  private readonly sorted = new Container();
  private readonly labels = new Container();
  private readonly views = new Map<number, EntityView>();
  private atlas!: Atlas;
  private terrain?: TerrainView;
  private shadowTexture?: Texture;
  private fx?: GroundFx;
  private dustFrames = new Set<number>();
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
    this.buildLayers();
    this.app.stage.addChild(this.world);
    this.world.scale.set(this.metrics.cssScale);
    this.ready = true;
  }

  /**
   * 图层顺序：地形地面 → 尘土 → y 排序层（树/围栏/角色）→ 标签气泡。
   * 地形纹理全部在这里一次性生成，帧循环里不会再 generateTexture。
   */
  private buildLayers(): void {
    this.sorted.sortableChildren = true;
    this.terrain = new TerrainView(this.app.renderer);
    this.terrain.build(this.sorted);

    this.world.addChild(this.terrain.ground);

    this.shadowTexture = GroundFx.shadowTexture(this.app.renderer);
    this.fx = new GroundFx(this.app.renderer);
    this.world.addChild(this.fx.container);

    this.world.addChild(this.sorted);
    this.world.addChild(this.labels);

    const walk = this.atlas.manifest.clips.walk;
    const frames = walk?.frames ?? [];
    // 接触帧 = 每个步幅的第一帧；六拍走一圈扬两次尘
    this.dustFrames = new Set(frames.length > 0 ? [frames[0]!, frames[Math.floor(frames.length / 2)]!] : []);
  }

  async addEntity(id: number, name: string, appearance: CharacterAppearance): Promise<void> {
    if (!this.ready || this.views.has(id)) return;
    const view = new EntityView(
      this.atlas,
      name,
      appearance,
      this.metrics.devicePxPerTexel,
      this.shadowTexture!,
      (x, y) => this.fx?.spawn(x, y),
    );
    await view.init();
    this.views.set(id, view);
    this.sorted.addChild(view.root);
    this.labels.addChild(view.labels);
  }

  removeEntity(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    view.destroy();
  }

  updateEntity(id: number, x: number, y: number): void {
    const view = this.views.get(id);
    if (!view) return;
    const sx = snapTexel(x);
    const sy = snapTexel(y);
    view.setPosition(sx, sy);
    // 脚底 y 即深度：站在树后会被树冠挡住，站到树前就压回去
    view.root.zIndex = sy;
  }

  setPose(id: number, direction: number, column: number): void {
    this.views.get(id)?.setPose(direction, column, this.dustFrames);
  }

  setAppearance(id: number, appearance: CharacterAppearance): void {
    this.views.get(id)?.body.setAppearance(appearance);
  }

  showBubble(id: number, text: string): void {
    this.views.get(id)?.showBubble(text, performance.now());
  }

  tickBubbles(dtMs: number): void {
    const now = performance.now();
    for (const view of this.views.values()) view.tickBubble(now);
    this.fx?.update(dtMs);
    this.terrain?.update(dtMs);
  }

  updateCamera(x: number, y: number): void {
    this.syncMetrics();
    const screen = this.app.screen;
    const { dpr, cssScale } = this.metrics;
    // 中心点与角色都落在整纹素栅格上：中心 → 设备像素，角色 → 世界像素
    this.world.x = snapCss(screen.width / 2, dpr) - snapTexel(x) * cssScale;
    this.world.y = snapCss(screen.height / 2, dpr) - snapTexel(y) * cssScale;

    // 只画看得见的树：树冠比脚底高 60px，同屏预算压在百级
    const halfW = screen.width / cssScale / 2;
    const halfH = screen.height / cssScale / 2;
    this.terrain?.cull(x - halfW - 48, y - halfH - 96, x + halfW + 48, y + halfH + 48);
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
    this.shadowTexture?.destroy(true);
    this.fx?.destroy();
    this.terrain?.destroy();
    this.app.destroy(true, { children: true });
  }
}
