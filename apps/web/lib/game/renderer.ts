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
import { ISLAND, seatById, type CharacterAppearance } from '@niuma/shared-types';
import { AmbientLight } from './ambient-light';
import { loadAtlas, type Atlas } from './atlas';
import { GroundFx, SHADOW_NORMAL } from './fx';
import { bubbleTopY, headTopYOf, nameBottomY, nameplateText, NAME_STROKE_WIDTH } from './nameplate';
import { PonyRenderer } from './pony';
import type { PonyMotion } from './pony-motion';
import { PropsView } from './props';
import { pixelMetrics, readDpr, sameMetrics, snapCss, snapTexel, type PixelMetrics } from './pixel-scale';
import { SPRITE_LAYOUT } from './sprite-layout.generated';
import { TerrainView } from './terrain';

/** 基准缩放：DPR 2 时每个纹素仍然是 6 个设备像素，观感不变 */
const BASE_CSS_PER_TEXEL = 3;

/**
 * 裁剪只关心帧尺寸；「昵称与气泡离头顶多远」交给 nameplate.ts。
 * 那个高度来自 manifest 的头顶锚点，不能再由帧底余量（frame.h - origin.y）反推：
 * 帧底余量是脚底到帧底的 5 纹素，按它摆会把名字画在膝盖上。
 */
const FRAME_H = SPRITE_LAYOUT.frame.h;
/** 裁剪余量：半帧宽 + 一帧高（树冠另算，由地形自己按纹理高度给） */
const CULL_PAD_X = SPRITE_LAYOUT.frame.w;
const CULL_PAD_Y = FRAME_H;

/** 视口比岛屿还宽时居中，否则把相机夹进包围盒；NaN 回落到中心 */
function cameraAxis(value: number, start: number, length: number, half: number): number {
  if (!Number.isFinite(value)) return start + length / 2;
  if (half * 2 >= length) return start + length / 2;
  return value < start + half ? start + half : value > start + length - half ? start + length - half : value;
}

const NAME_STYLE = {
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 9,
  fill: 0xf4ede1,
  // 描边是暖深褐而不是炭黑：暖底画面上纯黑描边会立刻把观感拉回马赛克
  stroke: { color: 0x2b2118, width: NAME_STROKE_WIDTH },
  letterSpacing: 0.4,
};

class EntityView {
  /** 本体与阴影进 y 排序层，会被树冠正确遮挡 */
  readonly root = new Container();
  /** 昵称与气泡单独一层：立绘可以被树挡住，名字不行 */
  readonly labels = new Container();
  readonly body: PonyRenderer;
  private readonly label: Text;
  private readonly bubbleText: Text;
  private readonly bubbleBg = new Graphics();
  private readonly shadows: Texture[];
  private shadowIndex = SHADOW_NORMAL;
  /** 跳跃弧线的抬升纹素（0 或负值）：本体与昵称同步抬高，阴影留在地面 */
  private jumpLift = 0;
  bubbleUntil = 0;
  private lastColumn = -1;
  /** 昵称文字底边（相对脚底）：换装改变头顶高度后重算 */
  private nameBottom: number;
  /** 上次气泡高度：换装重排时直接复用，不必重新测量文字 */
  private bubbleHeight = 0;
  
  // 气泡保护和性能优化字段
  private lastBubbleUpdateTime = 0;
  private readonly BUBBLE_UPDATE_THROTTLE = 300; // ms，300ms 内最多 1 个更新
  private readonly MAX_CHAT_LENGTH = 80; // 最大字符数
  private readonly MAX_LINES = 3; // 最大行数
  private readonly FADE_DURATION = 400; // 淡出持续时间 ms

  readonly bubble = new Container();

  constructor(
    private readonly atlas: Atlas,
    name: string,
    appearance: CharacterAppearance,
    devicePxPerTexel: number,
    shadows: Texture[],
    private readonly onFootfall: (x: number, y: number) => void,
  ) {
    // 接触阴影先入容器：它永远压在所有角色图层之下。
    // 阴影是 root 的直接子节点，角色本体的起伏只作用在 body.container 上，
    // 所以人抬起来时影子不会跟着飞。
    this.shadows = shadows;
    const shadowSprite = new Sprite(shadows[SHADOW_NORMAL]!);
    shadowSprite.anchor.set(0.5, 0.5);

    this.body = new PonyRenderer(atlas, appearance, 1);
    // 昵称底边贴着头顶外侧：头顶高度来自图集锚点，帽檐与犄角再由外观分档让位
    this.nameBottom = nameBottomY(headTopYOf(atlas.manifest, appearance.species), appearance);
    // 头顶只放得下 16 显示宽：再长的昵称换省略号，否则会压到邻座的名字与气泡
    this.label = new Text({ text: nameplateText(name), style: NAME_STYLE, resolution: devicePxPerTexel });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, this.nameBottom);

    this.bubbleText = new Text({
      text: '',
      resolution: devicePxPerTexel,
      style: {
        fontFamily: 'Noto Sans SC, sans-serif',
        fontSize: 8,
        fill: 0x2b2118,
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
    // 昵称与气泡跟着跳跃抬升：不然人跳起来会「穿」过自己的名字
    this.labels.position.set(x, y + this.jumpLift);
  }

  /** 换列时顺手判定落脚：跨到接触帧才扬尘，站着不动不会一路冒土 */
  setPose(direction: number, column: number, dustFrames: Set<number>): void {
    this.body.setPose(direction, column);
    if (column !== this.lastColumn && dustFrames.has(column)) {
      this.onFootfall(this.root.position.x, this.root.position.y);
    }
    this.lastColumn = column;
  }

  /** 微动效：整数纹素起伏 + 阴影形态切换（换 texture，不做浮点缩放） */
  applyMotion(motion: PonyMotion): void {
    this.body.setBob(motion.bobTexels);
    this.setShadow(motion.shadow);
  }

  /**
   * 跳跃弧线：本体与昵称一起抬高，接触阴影留在地面。
   * 抬升量已经是整数纹素，这里不再做任何浮点缩放（ADR-0013）。
   */
  applyJump(liftTexels: number, shadow: number): void {
    const lift = Math.round(liftTexels);
    if (lift !== this.jumpLift) {
      this.jumpLift = lift;
      this.body.setBob(lift);
      this.labels.position.y = this.root.position.y + lift;
    }
    this.setShadow(shadow);
  }

  /** 阴影换纹理而不是缩放：三档形态预烘焙，来回切不会出现亚像素毛边 */
  private setShadow(index: number): void {
    if (index === this.shadowIndex) return;
    this.shadowIndex = index;
    this.shadow.texture = this.shadows[index] ?? this.shadows[SHADOW_NORMAL]!;
  }

  /** 换装会改变头顶高度（帽子 / 发型 / 角）：昵称与气泡立即重新让位，不用重新入场 */
  setAppearance(appearance: CharacterAppearance): void {
    this.body.setAppearance(appearance);
    const nameBottom = nameBottomY(headTopYOf(this.atlas.manifest, appearance.species), appearance);
    if (nameBottom === this.nameBottom) return;
    this.nameBottom = nameBottom;
    this.label.position.y = nameBottom;
    if (this.bubble.visible) this.layoutBubble(this.bubbleHeight);
  }

  /** 气泡整体叠在昵称上沿之外：底边与名字保持固定间隙，不向人物方向回落 */
  private layoutBubble(height: number): void {
    this.bubbleHeight = height;
    this.bubble.position.set(0, Math.round(bubbleTopY(this.nameBottom, this.label.height, height)));
  }

  showBubble(text: string, now: number, duration = 6000): void {
    // 节流：相同实体 300ms 内最多更新一次气泡
    if (now - this.lastBubbleUpdateTime < this.BUBBLE_UPDATE_THROTTLE) {
      return;
    }
    this.lastBubbleUpdateTime = now;

    // 限制字符数
    let sanitized = text.length > this.MAX_CHAT_LENGTH 
      ? text.substring(0, this.MAX_CHAT_LENGTH - 1) + '…'
      : text;
    
    // 限制行数
    const lines = sanitized.split('\n');
    if (lines.length > this.MAX_LINES) {
      sanitized = lines.slice(0, this.MAX_LINES).join('\n') + '…';
    }

    this.bubbleText.text = sanitized;
    const textW = Math.ceil(this.bubbleText.width);
    const textH = Math.ceil(this.bubbleText.height);
    const width = textW + 8;
    const height = textH + 4;
    const left = -Math.round(width / 2);
    const right = left + width;

    this.bubbleBg.clear();
    this.bubbleBg.rect(left, 0, width, height).fill(0xf4ede1);
    // 1px 硬边替代圆角 + 抗锯齿，气泡也跟着像素栅格走
    this.bubbleBg.rect(left, 0, width, 1).fill(0xb9a68c);
    this.bubbleBg.rect(left, height - 1, width, 1).fill(0xb9a68c);
    this.bubbleBg.rect(left, 0, 1, height).fill(0xb9a68c);
    this.bubbleBg.rect(right - 1, 0, 1, height).fill(0xb9a68c);

    this.bubbleText.position.set(-Math.round(textW / 2), 2);
    this.layoutBubble(height);
    this.bubble.visible = true;
    this.bubble.alpha = 1; // 重置透明度
    this.bubbleUntil = now + duration;
  }

  tickBubble(now: number): void {
    if (!this.bubble.visible) return;
    
    if (now > this.bubbleUntil) {
      // 平滑淡出（最后 FADE_DURATION ms）
      const fadeStart = this.bubbleUntil - this.FADE_DURATION;
      if (now > fadeStart) {
        const fadeProgress = (now - fadeStart) / this.FADE_DURATION;
        this.bubble.alpha = Math.max(0, 1 - fadeProgress); // 从 1 淡到 0
      }
      // 淡出完成后隐藏
      if (now > this.bubbleUntil) {
        this.bubble.visible = false;
        this.bubble.alpha = 1; // 重置 alpha 以备下次显示
      }
    }
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
  private props?: PropsView;
  /** 屏幕空间的乘算柔光层；`?light=0` 时整层不建 */
  private light?: AmbientLight;
  private shadowTextures: Texture[] = [];
  private fx?: GroundFx;
  private dustFrames = new Set<number>();
  /** 树冠遮挡的输入缓冲：脚底坐标 (x, y) 成对写入，容量 512 人 */
  private readonly occluders = new Float32Array(1024);
  private lightEnabled = true;
  private metrics: PixelMetrics = pixelMetrics(BASE_CSS_PER_TEXEL, 1);
  backend = 'initializing';
  private ready = false;
  private destroyed = false;
  /** 用于检测异步初始化期间实体是否被销毁或移出会话（generation token 机制） */
  private readonly pendingInit = new Map<number, { generation: number; abort: AbortController }>();
  private initGeneration = 0;
  /** 相机可见范围缓存，用于实体可见性筛选 */
  private cameraBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  
  // 气泡队列管理：限制同屏气泡数量
  private readonly MAX_VISIBLE_BUBBLES = 10;

  async init(host: HTMLElement): Promise<void> {
    const dpr = readDpr();
    this.metrics = pixelMetrics(BASE_CSS_PER_TEXEL, dpr);
    await this.app.init({
      preference: 'webgpu',
      background: 0x14100c,
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
    // 柔光层压在 world 之上、屏幕空间：整张地图画完才覆盖，不随相机缩放
    if (this.lightEnabled) {
      this.light = new AmbientLight();
      this.app.stage.addChild(this.light.sprite);
    }
    this.world.scale.set(this.metrics.cssScale);
    this.ready = true;
  }

  /**
   * 图层顺序：地形地面 → 尘土 → y 排序层（树/围栏/角色）→ 标签气泡。
   * 地形纹理全部在这里一次性生成，帧循环里不会再 generateTexture。
   */
  private buildLayers(): void {
    // 灰度开关：?flat=1 退回矩形平铺，?light=0 关掉柔光层，用于线上快速定位观感回归
    const params = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
    this.lightEnabled = params?.get('light') !== '0';

    this.sorted.sortableChildren = true;
    this.terrain = new TerrainView(this.app.renderer, {
      flat: params?.get('flat') === '1',
      edge: params?.get('edge') !== '0',
    });
    this.terrain.build(this.sorted);

    this.world.addChild(this.terrain.base);
    // 边缘层：草尖 / 外凸圆弧 / 内缘暗边，压在底色之上、贴花之下
    this.world.addChild(this.terrain.edge);
    // 贴花压在地面之上、尘土与角色之下
    this.world.addChild(this.terrain.decals);
    // 室内地板与墙体、园区铺装：与地形同层，压在贴花之上、y 排序层之下
    this.props = new PropsView();
    this.props.build(this.sorted, this.app.renderer);
    this.world.addChild(this.props.base);

    this.shadowTextures = GroundFx.shadowTextures(this.app.renderer);
    this.fx = new GroundFx(this.app.renderer);
    this.world.addChild(this.fx.container);

    this.world.addChild(this.sorted);
    this.world.addChild(this.labels);

    const walk = this.atlas.manifest.clips.walk;
    const frames = walk?.frames ?? [];
    // 接触帧 = 每个步幅的第一帧；六拍走一圈扬两次尘
    this.dustFrames = new Set(frames.length > 0 ? [frames[0]!, frames[Math.floor(frames.length / 2)]!] : []);
    // 跳跃末帧是落地：复用同一条扬尘通路，不另建粒子系统
    const jump = this.atlas.manifest.clips.jump;
    const landing = jump ? jump.frames[jump.frames.length - 1] : undefined;
    if (landing !== undefined) this.dustFrames.add(landing);
  }

  async addEntity(id: number, name: string, appearance: CharacterAppearance): Promise<void> {
    if (!this.ready || this.views.has(id)) return;
    
    // 为本次初始化分配 generation token 和 abort signal
    const generation = ++this.initGeneration;
    const abort = new AbortController();
    this.pendingInit.set(id, { generation, abort });
    
    const view = new EntityView(
      this.atlas,
      name,
      appearance,
      this.metrics.devicePxPerTexel,
      this.shadowTextures,
      (x, y) => this.fx?.spawn(x, y),
    );
    
    try {
      await view.init();
    } catch (e) {
      // 如果初始化被中止，销毁已创建的资源
      if (abort.signal.aborted) {
        view.destroy();
      }
      throw e;
    }
    
    // 初始化完成后再次校验：Renderer 是否销毁、generation 是否一致、实体是否仍在会话
    if (this.destroyed || abort.signal.aborted) {
      view.destroy();
      this.pendingInit.delete(id);
      return;
    }
    
    const pending = this.pendingInit.get(id);
    if (!pending || pending.generation !== generation) {
      // 有更新的初始化请求或实体已被移除，销毁本视图
      view.destroy();
      this.pendingInit.delete(id);
      return;
    }
    
    // 所有检查通过，正式加入渲染系统
    this.views.set(id, view);
    this.sorted.addChild(view.root);
    this.labels.addChild(view.labels);
    this.pendingInit.delete(id);
  }

  removeEntity(id: number): void {
    const view = this.views.get(id);
    if (view) {
      this.views.delete(id);
      view.destroy();
    }
    
    // 如果实体正在初始化，中止异步过程
    const pending = this.pendingInit.get(id);
    if (pending) {
      pending.abort.abort();
      this.pendingInit.delete(id);
    }
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

  /** 待机呼吸 / 行走起伏 / 阴影 squash：全部是整数纹素与纹理切换 */
  setMotion(id: number, motion: PonyMotion): void {
    this.views.get(id)?.applyMotion(motion);
  }

  /** 跳跃弧线：抬升本体与昵称、切换阴影档位；lift 为 0 时即回到地面 */
  setJump(id: number, liftTexels: number, shadow: number): void {
    this.views.get(id)?.applyJump(liftTexels, shadow);
  }

  setAppearance(id: number, appearance: CharacterAppearance): void {
    this.views.get(id)?.setAppearance(appearance);
  }

  showBubble(id: number, text: string): void {
    this.views.get(id)?.showBubble(text, performance.now());
  }

  tickBubbles(dtMs: number): void {
    const now = performance.now();
    
    // 收集所有活跃气泡
    const activeBubbles: Array<{ id: number; view: EntityView; bubbleUntil: number }> = [];
    for (const [id, view] of this.views.entries()) {
      if (view.bubble.visible) {
        activeBubbles.push({ id, view, bubbleUntil: view.bubbleUntil });
      }
    }
    
    // 按气泡过期时间排序（最久的在前）
    activeBubbles.sort((a, b) => a.bubbleUntil - b.bubbleUntil);
    
    // 如果超过限制，让最早的气泡立即淡出
    if (activeBubbles.length > this.MAX_VISIBLE_BUBBLES) {
      for (let i = 0; i < activeBubbles.length - this.MAX_VISIBLE_BUBBLES; i++) {
        // 触发淡出：设置气泡过期时间到现在，使其立即开始淡出
        activeBubbles[i].view.bubbleUntil = now;
      }
    }
    
    // 更新所有气泡的淡出进度
    for (const view of this.views.values()) {
      view.tickBubble(now);
    }
    
    this.fx?.update(dtMs);
    this.terrain?.update(dtMs);
    this.syncOccluders();
  }

  /**
   * 判定实体是否在当前相机可见范围内（包括裁剪余量）
   */
  private isEntityVisible(x: number, y: number): boolean {
    if (!this.cameraBounds) return true;
    const padding = CULL_PAD_X; // 使用相同的裁剪余量
    return (
      x >= this.cameraBounds.minX - padding &&
      x <= this.cameraBounds.maxX + padding &&
      y >= this.cameraBounds.minY - padding &&
      y <= this.cameraBounds.maxY + padding
    );
  }

  /**
   * 把可见角色的脚底坐标喂给地形：树冠透明的唯一输入。
   * 复用一块 Float32Array，帧循环里不分配对象。
   * 只处理相机视口范围内的实体，减少输入数据量。
   */
  private syncOccluders(): void {
    if (!this.terrain) return;
    const capacity = this.occluders.length / 2;
    let count = 0;
    for (const view of this.views.values()) {
      if (count >= capacity) break;
      // 只处理可见实体
      if (this.isEntityVisible(view.root.position.x, view.root.position.y)) {
        this.occluders[count * 2] = view.root.position.x;
        this.occluders[count * 2 + 1] = view.root.position.y;
        count += 1;
      }
    }
    this.terrain.occlude(this.occluders, count);
  }

  updateCamera(x: number, y: number): void {
    this.syncMetrics();
    const screen = this.app.screen;
    // 柔光层跟着视口铺满，并在 30s 粒度上换一次时段色
    this.light?.resize(screen.width, screen.height);
    this.light?.update(performance.now());
    const { dpr, cssScale } = this.metrics;
    const halfW = screen.width / cssScale / 2;
    const halfH = screen.height / cssScale / 2;
    // 相机夹在岛屿包围盒内：贴到海岸时角色不在正中，但画面不会露出世界外的黑
    const bounds = ISLAND.bounds;
    // 相机位移强制向下取整：浮点坐标会让整层画面落在半像素里，
    // nearest 采样也救不回被撕开的像素边（roundPixels 只吸附顶点，不吸附相机原点）
    const camX = Math.floor(cameraAxis(x, bounds.x, bounds.w, halfW));
    const camY = Math.floor(cameraAxis(y, bounds.y, bounds.h, halfH));

    // 缓存相机可见范围（用于实体筛选）
    this.cameraBounds = {
      minX: camX - halfW,
      maxX: camX + halfW,
      minY: camY - halfH,
      maxY: camY + halfH,
    };

    // 中心点与角色都落在整纹素栅格上：中心 → 设备像素，角色 → 世界像素
    this.world.x = snapCss(screen.width / 2, dpr) - snapTexel(camX) * cssScale;
    this.world.y = snapCss(screen.height / 2, dpr) - snapTexel(camY) * cssScale;

    // 只画看得见的树：余量按帧尺寸给，树冠那一截由地形自己补
    this.props?.cull(
      camX - halfW - CULL_PAD_X,
      camY - halfH - CULL_PAD_Y,
      camX + halfW + CULL_PAD_X,
      camY + halfH + CULL_PAD_Y,
    );
    this.terrain?.cull(
      camX - halfW - CULL_PAD_X,
      camY - halfH - CULL_PAD_Y,
      camX + halfW + CULL_PAD_X,
      camY + halfH + CULL_PAD_Y,
    );
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

  /** 座位占用变化：对应工位的显示器随之点亮或熄灭 */
  setSeatOccupied(seatId: number, occupied: boolean): void {
    const seat = seatById(seatId);
    if (seat) this.props?.setSeatOccupied(seat, occupied);
  }

  /**
   * 获取当前相机的可见范围（用于实体筛选）
   */
  getCameraBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    return this.cameraBounds;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    
    // 中止所有待处理的异步初始化
    for (const { abort } of this.pendingInit.values()) {
      abort.abort();
    }
    this.pendingInit.clear();
    
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    for (const texture of this.shadowTextures) texture.destroy(true);
    this.fx?.destroy();
    this.terrain?.destroy();
    this.props?.destroy();
    this.app.destroy(true, { children: true });
  }
}
