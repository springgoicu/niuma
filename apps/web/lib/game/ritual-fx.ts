'use client';

import { Container, Graphics, Rectangle, Sprite, Text, type Application, type Texture } from 'pixi.js';
import { bake } from './terrain-textures';

/**
 * 上香 / 续杯的一次性视觉反馈（ADR-0061）。
 *
 * 三块内容，共用同一条「构造期建好、帧里只改属性」的纪律：
 * 1. **头顶金色飘字**：3 个槽位的 `Text` 池。`acquire()` 取最旧的槽位复用，
 *    帧循环里只写 `y / alpha`——改 `text` 会重建纹理，只在触发那一帧做一次；
 * 2. **合十作揖**：下俯量交给 `PonyRenderer.setBow`，本模块只算包络；
 * 3. **当日首香的淡金光晕**：一张 add 混合的光斑，跟着角色脚底跑，
 *    60 秒内缓慢呼吸，到点自动隐藏。
 *
 * 为什么不复用 `EntityView.showBubble`：气泡是「黑底白字」的信息框，
 * 而需求要的是「从头顶升起来的金色字」，两者语义与观感都不该混用。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

const GOLD = 0xffd166;
const INK = 0x2b2118;

/** 飘字槽位：同屏最多三句，连按 F 也不会堆成一片 */
const FLOAT_SLOTS = 3;
const FLOAT_LIFE_MS = 1800;
const FLOAT_RISE = 26;
/** 光晕呼吸周期 */
const AURA_PULSE_MS = 1600;
const AURA_SIZE = 64;

const FLOAT_STYLE = {
  fontFamily: CJK_FONT,
  fontSize: 7,
  fontWeight: '600' as const,
  fill: GOLD,
  stroke: { color: INK, width: 2 },
  letterSpacing: 0.5,
  align: 'center' as const,
};

interface Floater {
  text: Text;
  startedAt: number;
  x: number;
  y: number;
  active: boolean;
}

export class RitualFx {
  /** 世界空间的一层：压在 y 排序层之后，飘字与光晕都不会被树冠吃掉 */
  readonly container = new Container();
  private readonly aura: Sprite;
  private readonly floaters: Floater[] = [];
  private auraTexture?: Texture;
  private auraUntil = 0;
  private cursor = 0;
  private devicePxPerTexel: number;

  constructor(renderer: Application['renderer'], devicePxPerTexel: number) {
    this.devicePxPerTexel = devicePxPerTexel;
    this.auraTexture = bake(renderer, drawAura, { frame: new Rectangle(0, 0, AURA_SIZE, AURA_SIZE) });
    this.aura = new Sprite(this.auraTexture);
    this.aura.anchor.set(0.5, 0.5);
    this.aura.blendMode = 'add';
    this.aura.visible = false;
    this.container.addChild(this.aura);

    for (let i = 0; i < FLOAT_SLOTS; i += 1) {
      const text = new Text({ text: '', style: FLOAT_STYLE, resolution: devicePxPerTexel });
      text.anchor.set(0.5, 1);
      text.visible = false;
      this.container.addChild(text);
      this.floaters.push({ text, startedAt: 0, x: 0, y: 0, active: false });
    }
  }

  /**
   * 头顶升起一句金色字：(x, y) 是脚底坐标，字从头顶往上飘。
   *
   * `size` 只给「字要压在大家伙身上」的场合（老板受击），默认仍是 7 纹素；
   * 改字号会重建这一槽的纹理，所以只在触发那一帧写一次。
   */
  floatText(x: number, y: number, label: string, now: number, size = 7): void {
    const slot = this.floaters[this.cursor] ?? this.floaters[0]!;
    this.cursor = (this.cursor + 1) % this.floaters.length;
    if (slot.text.style.fontSize !== size) slot.text.style.fontSize = size;
    slot.text.text = label;
    slot.startedAt = now;
    slot.x = x;
    slot.y = y;
    slot.active = true;
    slot.text.visible = true;
    slot.text.alpha = 1;
    slot.text.position.set(x, y - 46);
  }

  /** 当日首次上香：给 60 秒淡金光晕 */
  grantAura(now: number, durationMs: number): void {
    this.auraUntil = Math.max(this.auraUntil, now + durationMs);
  }

  /** 光晕跟着角色脚底跑：只有本机角色会调用 */
  followAura(x: number, y: number): void {
    if (!this.aura.visible) return;
    this.aura.position.set(x, y - 4);
  }

  /** 每帧推进：只写 y / alpha，不建节点、不改 text（除上面那次） */
  update(now: number): void {
    for (const slot of this.floaters) {
      if (!slot.active) continue;
      const age = now - slot.startedAt;
      if (age >= FLOAT_LIFE_MS) {
        slot.active = false;
        slot.text.visible = false;
        continue;
      }
      const t = age / FLOAT_LIFE_MS;
      slot.text.y = slot.y - 46 - Math.round(t * FLOAT_RISE);
      // 前 15% 淡入、后 40% 淡出，中间稳定可读
      const alpha = t < 0.15 ? t / 0.15 : t > 0.6 ? (1 - t) / 0.4 : 1;
      slot.text.alpha = Math.max(0, Math.min(1, alpha));
    }

    const remain = this.auraUntil - now;
    if (remain <= 0) {
      if (this.aura.visible) this.aura.visible = false;
      return;
    }
    this.aura.visible = true;
    // 呼吸：0.35–0.6 之间缓慢起伏；最后 3 秒随剩余时间收掉
    const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin((now / AURA_PULSE_MS) * Math.PI * 2));
    const tail = remain < 3000 ? remain / 3000 : 1;
    this.aura.alpha = pulse * tail;
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const slot of this.floaters) {
      if (slot.text.resolution !== devicePxPerTexel) slot.text.resolution = devicePxPerTexel;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.auraTexture?.destroy(true);
    this.auraTexture = undefined;
    this.floaters.length = 0;
  }
}

/** 光晕贴图：四层同心圆，add 混合后就是一团柔金 */
function drawAura(g: Graphics): void {
  const c = AURA_SIZE / 2;
  g.circle(c, c, 30).fill({ color: GOLD, alpha: 0.05 });
  g.circle(c, c, 23).fill({ color: GOLD, alpha: 0.07 });
  g.circle(c, c, 15).fill({ color: 0xfff0c0, alpha: 0.1 });
  g.circle(c, c, 8).fill({ color: 0xfffbe6, alpha: 0.14 });
}
