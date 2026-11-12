import { Container, Text, TextStyle } from 'pixi.js';
import {
  DANMAKU_COLOR_COUNT,
  DANMAKU_MODE,
  normalizeDanmakuColor,
  truncateToDisplayWidth,
  type DanmakuMode,
  type Species,
} from '@niuma/shared-types';
import { danmakuColorAt } from './danmaku-palette';
import type { DanmakuCoverage } from './danmaku-prefs';
import {
  computeTrackLayout,
  pickFixedLane,
  pickScrollLane,
  type ScrollLaneSnapshot,
  type TrackLayout,
} from './danmaku-track';

export * from './danmaku-track';

/**
 * 屏幕空间弹幕轨道引擎（ADR-0056）。
 *
 * 为什么挂在 `stage` 而不是 `world`：弹幕是镜头前的 HUD，不该跟着相机平移缩放。
 * 容器坐标就是 CSS 像素（`app.init` 用了 autoDensity + resolution），
 * 所以轨道高度在任何 DPR 下都读作同样的 CSS 像素。
 *
 * 帧循环纪律（与 `snow-fx.ts` 同一套）：
 * 1. 文本对象在池里复用，帧里不 new；
 * 2. 每帧只改 `x` / `alpha`，不改 `text` 与 `style`；
 * 3. 离屏立即回收，活跃数与池大小都有硬上限。
 */

/** 滚动弹幕的参考时长：配合固定速度使用，实际时长随文本宽度在 8~12s 之间；比 7200ms 放慢，划过时更容易看清 */
export const DANMAKU_SCROLL_DURATION_MS = 9600;
/** 速度推导用的尾部预留：短句也不会比参考时长更快离场 */
const SCROLL_TAIL_PAD = 360;
/** 顶/底固定弹幕的淡入、停留与淡出 */
export const DANMAKU_FIXED_FADE_IN_MS = 300;
export const DANMAKU_FIXED_HOLD_MS = 4000;
export const DANMAKU_FIXED_FADE_MS = 500;
/** 活跃上限与溢出队列：同屏 100 条是验收指标，池再大只是白占纹理 */
export const DANMAKU_MAX_ACTIVE = 100;
const DANMAKU_POOL_MAX = 120;
const DANMAKU_QUEUE_MAX = 100;

/** 昵称与正文的显示宽预算：一条弹幕横跨三轨就破坏了避让算法 */
const NAME_UNITS = 12;
const TEXT_UNITS = 40;

const SPECIES_GLYPH: Record<Species, string> = { horse: '🐴', cow: '🐮' };

export interface DanmakuMessage {
  name: string;
  species?: Species;
  text: string;
  /** 协议里的颜色索引，越界自己会回落到默认白 */
  colorIndex: number;
  danmakuMode: DanmakuMode;
}

interface ScrollItem {
  readonly sprite: Text;
  readonly width: number;
  lane: number;
  x: number;
  speed: number;
}

interface FixedItem {
  readonly sprite: Text;
  readonly mode: DanmakuMode;
  readonly lane: number;
  /** 淡入起点时刻 */
  readonly spawnAt: number;
  /** 淡出起点时刻：淡入完成后再停留 4 秒 */
  until: number;
}

interface QueuedMessage {
  label: string;
  colorIndex: number;
  mode: DanmakuMode;
}

interface LaneState {
  /** 本轨最近一条滚动弹幕：回收时用来清占位 */
  tail: ScrollItem | null;
}

export class DanmakuField {
  readonly container = new Container();
  private readonly flying: ScrollItem[] = [];
  private readonly fixed: FixedItem[] = [];
  private readonly queue: QueuedMessage[] = [];
  private readonly pool: Text[] = [];
  private readonly styles: TextStyle[];
  private readonly lanes: LaneState[] = [];
  private readonly laneSnapshot: ScrollLaneSnapshot[] = [];
  /** 每条轨被固定弹幕占用到的时刻 */
  private readonly fixedFreeUntil: number[] = [];
  /** 固定弹幕选址用的临时数组：滚动弹幕离场时刻与固定占用取最大值 */
  private readonly fixedBusy: number[] = [];
  private layout: TrackLayout;
  private prefs: { enabled: boolean; opacity: number; coverage: DanmakuCoverage };
  private resolution: number;
  private clock = 0;
  private rotateCursor = 0;
  private stressed = false;
  private stressAt = 0;
  private stressSeq = 0;

  constructor(
    prefs: { enabled: boolean; opacity: number; coverage: DanmakuCoverage },
    width: number,
    height: number,
    resolution: number,
    stress = false,
  ) {
    this.prefs = prefs;
    this.resolution = Math.max(1, resolution);
    this.layout = computeTrackLayout(width, height, prefs.coverage);
    this.stressed = stress;
    // 每种颜色一份共享 TextStyle：换色只换引用，不复制样式对象
    this.styles = Array.from({ length: DANMAKU_COLOR_COUNT }, (_, index) => createStyle(index));
    this.container.label = 'danmaku';
    this.container.alpha = prefs.opacity;
    this.container.visible = prefs.enabled;
    this.resetLanes();
  }

  get activeCount(): number {
    return this.flying.length + this.fixed.length;
  }

  /** 总开关关闭时清屏：留着旧文本会在重新打开时「倒带」 */
  setPrefs(prefs: { enabled: boolean; opacity: number; coverage: DanmakuCoverage }): void {
    const coverageChanged = prefs.coverage !== this.prefs.coverage;
    this.prefs = prefs;
    this.container.alpha = prefs.opacity;
    this.container.visible = prefs.enabled;
    if (!prefs.enabled) {
      this.clear();
      return;
    }
    this.layout = computeTrackLayout(this.layout.width, this.layout.height, prefs.coverage);
    // 覆盖区域变了就清屏：旧弹幕可能落在刚被禁用的轨道上
    if (coverageChanged) this.clear();
  }

  resize(width: number, height: number, resolution: number): void {
    const previousTracks = this.layout.trackCount;
    this.layout = computeTrackLayout(width, height, this.prefs.coverage);
    if (resolution !== this.resolution) {
      this.resolution = Math.max(1, resolution);
      for (const sprite of this.pool) sprite.resolution = this.resolution;
      for (const item of this.flying) item.sprite.resolution = this.resolution;
      for (const item of this.fixed) item.sprite.resolution = this.resolution;
    }
    // 轨道数变了就得清屏：飞行中记录的车道下标可能已经越界
    if (this.layout.trackCount !== previousTracks) {
      this.clear();
      return;
    }
    // 已有的滚动弹幕只改轨道 y，不重建：拖窗口时不该整屏消息突然消失
    for (const item of this.flying) {
      item.lane = Math.min(item.lane, this.layout.trackCount - 1);
      item.sprite.y = this.layout.laneY(item.lane);
      // 屏幕变窄时右边缘没变，立刻判定是否已经飞出：交给下一帧的 update 处理
      item.x = Math.min(item.x, width);
      item.sprite.x = item.x;
    }
    for (const item of this.fixed) {
      item.sprite.y =
        item.mode === DANMAKU_MODE.Top ? this.layout.laneY(item.lane) : this.layout.bottomY(item.lane);
      // anchor 是 0.5：固定弹幕的 x 就是屏幕中心
      item.sprite.x = width / 2;
    }
  }

  push(message: DanmakuMessage): void {
    if (!this.prefs.enabled || message.text.trim().length === 0) return;
    const label = buildLabel(message);
    if (label.length === 0) return;
    const colorIndex = normalizeDanmakuColor(message.colorIndex);
    const mode = message.danmakuMode;

    // 总活跃数是硬上限：固定弹幕不走路，不能靠「轨道空」来限流
    if (this.activeCount >= DANMAKU_MAX_ACTIVE) {
      this.enqueue({ label, colorIndex, mode });
      return;
    }

    if (mode === DANMAKU_MODE.Scroll) {
      const lane = this.chooseScrollLane();
      if (lane === null) {
        this.enqueue({ label, colorIndex, mode });
        return;
      }
      this.spawnScroll(label, colorIndex, lane);
      return;
    }
    this.spawnFixed(label, colorIndex, mode);
  }

  /** 队列也有上限：溢出时丢最旧的一条，保证内存与延迟都有界 */
  private enqueue(message: QueuedMessage): void {
    if (this.queue.length >= DANMAKU_QUEUE_MAX) this.queue.shift();
    this.queue.push(message);
  }

  update(dtMs: number): void {
    if (!this.prefs.enabled) return;
    const dt = Math.min(64, Math.max(0, dtMs));
    this.clock += dt;
    if (this.stressed) this.pumpStress();

    // 反向遍历 + swap-pop：删除不搬整段数组
    const flying = this.flying;
    for (let i = flying.length - 1; i >= 0; i -= 1) {
      const item = flying[i]!;
      item.x -= item.speed * dt;
      item.sprite.x = item.x;
      // 完全飞出左缘才回收：文字尾巴还在屏幕里时不能提前销毁
      if (item.x + item.width < 0) {
        this.releaseScroll(item, i);
      }
    }

    const fixed = this.fixed;
    for (let i = fixed.length - 1; i >= 0; i -= 1) {
      const item = fixed[i]!;
      if (this.clock < item.until) {
        // 淡入期 easeOutCubic：起步快收尾缓，出现不再硬切；完全显现后停在 alpha 1
        const since = (this.clock - item.spawnAt) / DANMAKU_FIXED_FADE_IN_MS;
        item.sprite.alpha = since >= 1 ? 1 : easeOutCubic(since);
        continue;
      }
      const progress = (this.clock - item.until) / DANMAKU_FIXED_FADE_MS;
      if (progress >= 1) {
        this.recycle(item.sprite);
        fixed.splice(i, 1);
        continue;
      }
      // 淡出用 smoothstep：首尾减速，比线性淡出更从容
      item.sprite.alpha = 1 - smoothstep(progress);
    }

    this.drainQueue();
  }

  clear(): void {
    for (const item of this.flying) this.recycle(item.sprite);
    this.flying.length = 0;
    for (const item of this.fixed) this.recycle(item.sprite);
    this.fixed.length = 0;
    this.queue.length = 0;
    this.resetLanes();
  }

  destroy(): void {
    this.clear();
    // 先放子对象再放样式：反过来会让仍在引用样式的 Text 销毁时摸到已释放的资源
    this.container.destroy({ children: true });
    for (const style of this.styles) style.destroy();
    this.pool.length = 0;
  }

  private resetLanes(): void {
    this.lanes.length = 0;
    this.laneSnapshot.length = 0;
    this.fixedFreeUntil.length = 0;
    this.fixedBusy.length = 0;
    for (let i = 0; i < this.layout.trackCount; i += 1) {
      this.lanes.push({ tail: null });
      this.laneSnapshot.push({ right: null });
      this.fixedFreeUntil.push(0);
      this.fixedBusy.push(0);
    }
    this.rotateCursor = 0;
  }

  /** 全满时轮替：不必再扫一遍，按游标给出下一条轨，保证「有话说就一定能看到」 */
  private chooseScrollLane(): number | null {
    const lanes = this.laneSnapshot;
    for (let i = 0; i < this.lanes.length; i += 1) {
      const tail = this.lanes[i]!.tail;
      // 被固定弹幕占住的轨视作「上一条永远贴在右缘」：滚动弹幕不许穿过去
      lanes[i]!.right =
        this.fixedFreeUntil[i]! > this.clock ? Number.POSITIVE_INFINITY : tail ? tail.x + tail.width : null;
    }
    const free = pickScrollLane(lanes, this.layout.width);
    if (free !== null) return free;
    const rotated = this.rotateCursor % this.layout.trackCount;
    this.rotateCursor = (this.rotateCursor + 1) % this.layout.trackCount;
    return rotated;
  }

  private spawnScroll(label: string, colorIndex: number, lane: number): void {
    const sprite = this.acquire(label, colorIndex);
    const width = Math.max(1, sprite.width);
    const speed = (this.layout.width + SCROLL_TAIL_PAD) / DANMAKU_SCROLL_DURATION_MS;
    const item: ScrollItem = { sprite, width, lane, x: this.layout.width, speed };
    sprite.anchor.set(0, 0.5);
    sprite.position.set(item.x, this.layout.laneY(lane));
    this.flying.push(item);
    this.lanes[lane]!.tail = item;
  }

  private spawnFixed(label: string, colorIndex: number, mode: DanmakuMode): void {
    // 「空闲」要同时看两种占用：固定弹幕自己的停留，以及本轨滚动弹幕还要多久离场
    for (let i = 0; i < this.fixedFreeUntil.length; i += 1) {
      const tail = this.lanes[i]!.tail;
      const scrollBusyUntil = tail ? this.clock + (tail.x + tail.width) / tail.speed : 0;
      this.fixedBusy[i] = Math.max(this.fixedFreeUntil[i]!, scrollBusyUntil);
    }
    const lane = pickFixedLane(this.fixedBusy, this.clock);
    const sprite = this.acquire(label, colorIndex);
    sprite.anchor.set(0.5, 0.5);
    const y = mode === DANMAKU_MODE.Top ? this.layout.laneY(lane) : this.layout.bottomY(lane);
    sprite.position.set(this.layout.width / 2, y);
    const item: FixedItem = {
      sprite,
      mode,
      lane,
      spawnAt: this.clock,
      until: this.clock + DANMAKU_FIXED_FADE_IN_MS + DANMAKU_FIXED_HOLD_MS,
    };
    this.fixed.push(item);
    // +1：同一帧连发两条固定弹幕时也不能共用同一条轨
    this.fixedFreeUntil[lane] = item.until + DANMAKU_FIXED_FADE_MS + 1;
  }

  private releaseScroll(item: ScrollItem, index: number): void {
    const lane = this.lanes[item.lane];
    if (lane && lane.tail === item) lane.tail = null;
    this.recycle(item.sprite);
    const last = this.flying.pop();
    if (last && index < this.flying.length) this.flying[index] = last;
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.activeCount < DANMAKU_MAX_ACTIVE) {
      const next = this.queue.shift()!;
      if (next.mode === DANMAKU_MODE.Scroll) {
        const lane = this.chooseScrollLane();
        if (lane === null) {
          this.queue.unshift(next);
          return;
        }
        this.spawnScroll(next.label, next.colorIndex, lane);
      } else {
        this.spawnFixed(next.label, next.colorIndex, next.mode);
      }
    }
  }

  private acquire(label: string, colorIndex: number): Text {
    let sprite = this.pool.pop();
    if (!sprite) {
      sprite = new Text({
        text: '',
        style: this.styles[colorIndex] ?? this.styles[0]!,
        resolution: this.resolution,
      });
      sprite.visible = false;
      this.container.addChild(sprite);
    }
    sprite.style = this.styles[colorIndex] ?? this.styles[0]!;
    // 只在激活时写 text：这是一次纹理重建，绝不能在帧里做
    sprite.text = label;
    sprite.alpha = 1;
    sprite.visible = true;
    return sprite;
  }

  private recycle(sprite: Text): void {
    sprite.visible = false;
    if (this.pool.length < DANMAKU_POOL_MAX) {
      this.pool.push(sprite);
      return;
    }
    // 池已满：真销毁而不是留在容器里当不可见的孤儿（活跃上限 + 池上限之后极少发生）
    sprite.destroy();
  }

  /** `?danmaku=stress`：不依赖网络地压到 100 条，用来量帧率与对象池 */
  private pumpStress(): void {
    if (this.clock - this.stressAt < 120) return;
    this.stressAt = this.clock;
    this.stressSeq += 1;
    const modes = [DANMAKU_MODE.Scroll, DANMAKU_MODE.Scroll, DANMAKU_MODE.Scroll, DANMAKU_MODE.Top, DANMAKU_MODE.Bottom];
    this.push({
      name: `压测员${this.stressSeq % 17}`,
      species: this.stressSeq % 2 === 0 ? 'cow' : 'horse',
      text: `第 ${this.stressSeq} 条：带薪摸鱼纯度 +1，今日进度 ${this.stressSeq % 100}%`,
      colorIndex: this.stressSeq % 8,
      danmakuMode: modes[this.stressSeq % modes.length]!,
    });
  }
}

function createStyle(colorIndex: number): TextStyle {
  const preset = danmakuColorAt(colorIndex);
  return new TextStyle({
    fontFamily: ['PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'sans-serif'],
    fontSize: 22,
    fontWeight: '700',
    // 单色实心、无描边无投影：快速划过时边缘干净锐利，不再发糊
    // 少量 padding 防止 🐴/🐮 emoji 前缀溢出字形包围盒被裁
    padding: 2,
    fill: preset.hex,
  });
}

/** `[🐮 昵称]: 正文`：图标让远处也能分辨是牛还是马 */
function buildLabel(message: DanmakuMessage): string {
  const name = truncateToDisplayWidth(message.name.trim(), NAME_UNITS);
  const text = truncateToDisplayWidth(message.text.trim(), TEXT_UNITS);
  if (text.length === 0) return '';
  const glyph = SPECIES_GLYPH[message.species ?? 'cow'];
  return `${glyph} ${name}: ${text}`;
}

/** easeOutCubic：起步快收尾缓，固定弹幕淡入不抢视线 */
function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

/** smoothstep：首尾减速的 S 曲线，固定弹幕淡出比线性更从容 */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
