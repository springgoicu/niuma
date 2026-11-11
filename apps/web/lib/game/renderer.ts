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
import { cameraFocus } from './camera';
import { GroundFx, SHADOW_NORMAL } from './fx';
import { bubbleTopY, headTopYOf, nameBottomY, nameplateText, NAME_STROKE_WIDTH } from './nameplate';
import { PonyRenderer } from './pony';
import type { PonyMotion } from './pony-motion';
import { PropsView } from './props';
import { pixelMetrics, readDpr, sameMetrics, snapCss, snapTexel, type PixelMetrics } from './pixel-scale';
import { SortLayer } from './sort-layer';
import { SPRITE_LAYOUT } from './sprite-layout.generated';
import { TerrainView } from './terrain';

/**
 * 世界倍率：1 纹素画 1.5 个 CSS 像素，角色站立 48 纹素 ≈ 72 CSS 像素（DPR 2）。
 *
 * 缩到 1.5 的前提是「每纹素占整数设备像素」（ADR-0005），而 1.5 × DPR 并不总是整数，
 * 所以各屏的实际高度散落在 64–96 之间，只有 DPR 2 正好是 72：
 *   DPR 1 → 2.0（96px）、1.25 → 1.6（76.8）、1.5 → 1.333（64）、2 → 1.5（72）、3 → 1.667（80）
 * 宁可接受这档差异，也不让纹素落在半像素上——半像素会让 1px 描边在相邻纹素之间轮流糊开。
 */
const DEFAULT_CSS_PER_TEXEL = 1.5;
/**
 * 大厅的纹素下限。DPR 1 的屏幕上 `round(1.5 × 1) = 2`，沿用默认下限 3 会被夹回 3，
 * 等于在 100% 缩放的桌面上「什么都没改」。预览台不走这个值。
 */
const MIN_DEVICE_PX_PER_TEXEL = 2;
/** `?zoom=` 回退开关的合法区间：`?zoom=3` 即退回改动前的倍率 */
const CSS_PER_TEXEL_MIN = 1;
const CSS_PER_TEXEL_MAX = 4;

/**
 * 灰度开关（与 `?flat=1` / `?light=0` 同一写法）：线上观感回归时一键退回旧倍率，
 * 不用回滚整次发布。非法值一律回落到默认倍率。
 */
function readCssPerTexel(): number {
  if (typeof window === 'undefined') return DEFAULT_CSS_PER_TEXEL;
  const raw = new URLSearchParams(window.location.search).get('zoom');
  if (raw === null) return DEFAULT_CSS_PER_TEXEL;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_CSS_PER_TEXEL;
  return Math.min(CSS_PER_TEXEL_MAX, Math.max(CSS_PER_TEXEL_MIN, value));
}

/**
 * 裁剪只关心帧尺寸；「昵称与气泡离头顶多远」交给 nameplate.ts。
 * 那个高度来自 manifest 的头顶锚点，不能再由帧底余量（frame.h - origin.y）反推：
 * 帧底余量是脚底到帧底的 5 纹素，按它摆会把名字画在膝盖上。
 */
const FRAME_H = SPRITE_LAYOUT.frame.h;
/** 裁剪余量：半帧宽 + 一帧高（树冠另算，由地形自己按纹理高度给） */
const CULL_PAD_X = SPRITE_LAYOUT.frame.w;
const CULL_PAD_Y = FRAME_H;

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
  /** 上一次的可见状态：只在翻转时才改 `renderable` */
  private shown = true;
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

  /**
   * 屏外时整棵子树停止绘制：本体与昵称一起关掉。
   * 只在状态翻转时碰 Pixi 的标记位，稳态下零开销。
   */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.root.renderable = shown;
    this.labels.renderable = shown;
  }

  get isShown(): boolean {
    return this.shown;
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
  /**
   * 树、围栏、角色统一按脚底 y 排序。
   * 分桶而不是一个大容器：角色一走动就会改 zIndex，单容器意味着每帧重排整张地图。
   */
  private sortLayer!: SortLayer;
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
  private metrics: PixelMetrics = pixelMetrics(DEFAULT_CSS_PER_TEXEL, 1, MIN_DEVICE_PX_PER_TEXEL);
  /** 本实例实际使用的倍率：默认值或 `?zoom=` 覆盖值 */
  private cssPerTexel = DEFAULT_CSS_PER_TEXEL;
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
  /** 活跃气泡的复用数组：活跃数通常 0–3，原来每帧都要新建数组 + 每个气泡一个对象 */
  private readonly activeBubbles: EntityView[] = [];
  /** 上次重算像素倍率时的屏幕尺寸与 DPR */
  private metricDpr = 0;
  private metricScreenW = -1;
  private metricScreenH = -1;

  async init(host: HTMLElement): Promise<void> {
    const dpr = readDpr();
    this.cssPerTexel = readCssPerTexel();
    this.metrics = pixelMetrics(this.cssPerTexel, dpr, MIN_DEVICE_PX_PER_TEXEL);
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

    // `?bands=0` 退回单容器：与 `?flat=1` / `?light=0` 同一套灰度惯例，
    // 回退走的也是 add/update/remove 这同一条接口，不是一段会腐烂的分支。
    this.sortLayer = new SortLayer({
      originY: ISLAND.bounds.y,
      extentY: ISLAND.bounds.h,
      single: params?.get('bands') === '0',
    });
    this.terrain = new TerrainView(this.app.renderer, {
      flat: params?.get('flat') === '1',
      edge: params?.get('edge') !== '0',
    });
    this.terrain.build(this.sortLayer);

    this.world.addChild(this.terrain.base);
    // 边缘层：草尖 / 外凸圆弧 / 内缘暗边，压在底色之上、贴花之下
    this.world.addChild(this.terrain.edge);
    // 贴花压在地面之上、尘土与角色之下
    this.world.addChild(this.terrain.decals);
    // 室内地板与墙体、园区铺装：与地形同层，压在贴花之上、y 排序层之下
    this.props = new PropsView();
    this.props.build(this.sortLayer, this.app.renderer);
    this.world.addChild(this.props.base);

    this.shadowTextures = GroundFx.shadowTextures(this.app.renderer);
    this.fx = new GroundFx(this.app.renderer);
    this.world.addChild(this.fx.container);

    this.world.addChild(this.sortLayer.container);
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

  /**
   * 加入一个角色。`x/y` 只用于首次归 band：之后每帧由 `updateEntity` 维护，
   * 传进来的目的是避免角色在加入的第一帧被塞进错误的 band 里闪一下。
   */
  async addEntity(id: number, name: string, appearance: CharacterAppearance, x = 0, y = 0): Promise<void> {
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
    // 先把位置摆好再挂进 band：否则首帧会停在 (0,0)，在地图左上角闪一下
    view.setPosition(snapTexel(x), snapTexel(y));
    this.sortLayer.add(y, view.root);
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

  /**
   * 更新远端角色。返回是否可见：屏外时位置、深度与批处理都不必碰，
   * 调用方可以据此跳过整段动画求值（那些结果本来就看不见）。
   *
   * 隐藏在最后一次可见时的位置上，回屏那一帧才重算——它本来是看不见的，
   * 所以不存在「瞬移一帧」的观感问题。
   */
  updateEntity(id: number, x: number, y: number): boolean {
    const view = this.views.get(id);
    if (!view) return false;
    const shown = this.isEntityVisible(x, y);
    view.setShown(shown);
    if (shown) this.place(view, x, y);
    return shown;
  }

  /** 本地角色：永远在画面中心，不做可见性判定 */
  updateLocalEntity(id: number, x: number, y: number): void {
    const view = this.views.get(id);
    if (!view) return;
    view.setShown(true);
    this.place(view, x, y);
  }

  private place(view: EntityView, x: number, y: number): void {
    const sx = snapTexel(x);
    const sy = snapTexel(y);
    view.setPosition(sx, sy);
    // 脚底 y 即深度：站在树后会被树冠挡住，站到树前就压回去
    this.sortLayer.update(view.root, sy);
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

    // 活跃气泡通常 0–3 个，复用一块数组：原来每帧新建数组 + 每个气泡一个
    // `{id, view, bubbleUntil}` 对象 + 一次 sort，哪怕一个气泡都没有。
    const active = this.activeBubbles;
    let count = 0;
    for (const view of this.views.values()) {
      if (!view.bubble.visible) continue;
      if (count < active.length) active[count] = view;
      else active.push(view);
      count += 1;
    }

    // 超过同屏上限时让最早的气泡提前淡出。只有真超限才排序（插入排序，元素极少）。
    if (count > this.MAX_VISIBLE_BUBBLES) {
      for (let i = 1; i < count; i += 1) {
        const view = active[i]!;
        const key = view.bubbleUntil;
        let j = i - 1;
        while (j >= 0 && active[j]!.bubbleUntil > key) {
          active[j + 1] = active[j]!;
          j -= 1;
        }
        active[j + 1] = view;
      }
      for (let i = 0; i < count - this.MAX_VISIBLE_BUBBLES; i += 1) {
        active[i]!.bubbleUntil = now;
      }
    }

    for (let i = 0; i < count; i += 1) active[i]!.tickBubble(now);

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
      // 屏外角色的位置是最后一次可见时的旧值，喂进去只会让某棵树莫名变透明
      if (!view.isShown) continue;
      this.occluders[count * 2] = view.root.position.x;
      this.occluders[count * 2 + 1] = view.root.position.y;
      count += 1;
    }
    this.terrain.occlude(this.occluders, count);
  }

  updateCamera(x: number, y: number): void {
    const screen = this.app.screen;
    this.syncMetrics(screen.width, screen.height);
    // 柔光层跟着视口铺满，并在 30s 粒度上换一次时段色
    this.light?.resize(screen.width, screen.height);
    this.light?.update(performance.now());
    const { dpr, cssScale } = this.metrics;
    const halfW = screen.width / cssScale / 2;
    const halfH = screen.height / cssScale / 2;
    // 相机夹在岛屿包围盒内：贴到海岸时角色不在正中，但画面不会露出世界外的黑
    const bounds = ISLAND.bounds;
    // 相机必须与角色用同一个吸附函数（snapTexel = round）：
    // 相机 floor + 角色 round 会让两者每移动 1 世界像素错开 1 纹素，
    // 表现为角色相对背景约 15Hz 横跳（ADR-0021）。
    const camX = cameraFocus(x, bounds.x, bounds.w, halfW);
    const camY = cameraFocus(y, bounds.y, bounds.h, halfH);

    // 缓存相机可见范围（用于实体筛选）
    this.cameraBounds = {
      minX: camX - halfW,
      maxX: camX + halfW,
      minY: camY - halfH,
      maxY: camY + halfH,
    };

    // 中心点与角色都落在整纹素栅格上：中心 → 设备像素，角色 → 世界像素。
    // camX/camY 已是整数纹素，直接参与世界层位移，不能再二次吸附。
    this.world.x = snapCss(screen.width / 2, dpr) - camX * cssScale;
    this.world.y = snapCss(screen.height / 2, dpr) - camY * cssScale;

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

  /**
   * 拖窗口到另一块屏（DPR 变化）时重建缩放与文字位图。
   *
   * 只在尺寸或 DPR 真变了才重算：原实现每帧都构造一个 metrics 对象再与旧值比较丢弃，
   * 等于每帧一次无谓的分配。
   */
  private syncMetrics(screenWidth: number, screenHeight: number): void {
    const dpr = readDpr();
    if (dpr === this.metricDpr && screenWidth === this.metricScreenW && screenHeight === this.metricScreenH) {
      return;
    }
    this.metricDpr = dpr;
    this.metricScreenW = screenWidth;
    this.metricScreenH = screenHeight;

    const next = pixelMetrics(this.cssPerTexel, dpr, MIN_DEVICE_PX_PER_TEXEL);
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
