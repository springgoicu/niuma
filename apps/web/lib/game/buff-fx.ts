'use client';

import { Container, Graphics } from 'pixi.js';
import { PLAYER_EFFECT } from '@niuma/shared-types';

/**
 * 持续型 Buff 的地面 / 头顶表现（ADR-0085）。
 *
 * 三条取舍：
 * 1. **一个 Graphics 重画全场**：同屏同时挂着 Buff 的人只有个位数，
 *    每帧 `clear()` 再重画几条线，比为每个角色常备 Sprite 更省；
 * 2. **按 (实体, 类型) 存**：护盾被打破时只撤护盾环，不该顺手把冰美式的风线也抹掉；
 * 3. **不建 Text**：贴纸用绿色像素牌 + 三道深色"字迹"代替真文字，
 *    像素风里 8px 的中文只会糊成一团，真正的文案由头顶气泡负责。
 */

/** 只依赖 root 的坐标：不把 EntityView 的类型引进来，避免循环导入 */
export interface BuffAnchor {
  readonly root: { position: { x: number; y: number } };
}

interface BuffEntry {
  id: number;
  /** PLAYER_EFFECT 里的持续型特效码 */
  kind: number;
  /** 消失时刻（performance.now 口径） */
  until: number;
  /** 建立时刻：给「风线」「呼吸」这类循环动画当相位 */
  since: number;
}

const HASTE_ARC_MS = 620;
const SHIELD_BREATH_MS = 1600;
const OUTLINE_COLOR = 0x2a3142;

export class BuffFx {
  readonly container = new Container();
  private readonly gfx = new Graphics();
  /** `${netId}:${kind}` → 当前表现：同一实体可以同时挂着脚底风与护盾环 */
  private readonly entries = new Map<string, BuffEntry>();

  constructor() {
    this.container.addChild(this.gfx);
  }

  set(id: number, kind: number, durationMs: number, now: number): void {
    if (durationMs <= 0) return;
    if (
      kind !== PLAYER_EFFECT.Haste &&
      kind !== PLAYER_EFFECT.Shield &&
      kind !== PLAYER_EFFECT.Poster &&
      kind !== PLAYER_EFFECT.Stealth &&
      kind !== PLAYER_EFFECT.Box &&
      kind !== PLAYER_EFFECT.Pan &&
      kind !== PLAYER_EFFECT.CoffeeHeal
    ) {
      return;
    }
    this.entries.set(`${id}:${kind}`, { id, kind, until: now + durationMs, since: now });
  }

  /** 只撤某一类（护盾被打碎）；不传 kind 时清掉这个人的全部表现 */
  clear(id: number, kind?: number): void {
    if (kind === undefined) {
      for (const [key, entry] of this.entries) if (entry.id === id) this.entries.delete(key);
      return;
    }
    this.entries.delete(`${id}:${kind}`);
  }

  clearAll(): void {
    this.entries.clear();
  }

  update(now: number, views: ReadonlyMap<number, BuffAnchor>): void {
    this.gfx.clear();
    if (this.entries.size === 0) return;
    for (const [key, entry] of this.entries) {
      if (entry.until <= now) {
        this.entries.delete(key);
        continue;
      }
      const view = views.get(entry.id);
      if (!view) continue;
      const x = Math.round(view.root.position.x);
      const y = Math.round(view.root.position.y);
      if (entry.kind === PLAYER_EFFECT.Haste) this.drawHaste(x, y, entry.since, now);
      else if (entry.kind === PLAYER_EFFECT.Shield) this.drawShield(x, y, entry.since, now);
      else if (entry.kind === PLAYER_EFFECT.Poster) this.drawPoster(x, y);
      else if (entry.kind === PLAYER_EFFECT.Stealth) this.drawStealth(x, y, entry.since, now);
      else if (entry.kind === PLAYER_EFFECT.Box) this.drawBox(x, y);
      else if (entry.kind === PLAYER_EFFECT.Pan) this.drawPan(x, y, entry.since, now);
      else if (entry.kind === PLAYER_EFFECT.CoffeeHeal) this.drawCoffeeHeal(x, y, entry.since, now);
    }
  }

  /** 脚底两缕青色风线：错相位上飘，读成「脚下生风」 */
  private drawHaste(x: number, y: number, since: number, now: number): void {
    const phase = (((now - since) % HASTE_ARC_MS) / HASTE_ARC_MS + 1) % 1;
    const rise = Math.round(phase * 10);
    const alpha = 0.55 * (1 - phase * 0.6);
    this.gfx.ellipse(x, y + 1, 13, 4).stroke({ width: 1, color: 0x34d3a6, alpha: alpha * 0.5 });
    for (let i = 0; i < 2; i += 1) {
      const dx = i === 0 ? -8 : 8;
      this.gfx
        .ellipse(x + dx, y - 3 - rise, 4, 2)
        .stroke({ width: 1, color: 0x8ef0d4, alpha: alpha * (i === 0 ? 1 : 0.7) });
    }
  }

  /** 青色护盾环：椭圆描边 + 呼吸式透明度 */
  private drawShield(x: number, y: number, since: number, now: number): void {
    const breath = (Math.sin(((now - since) / SHIELD_BREATH_MS) * Math.PI * 2) + 1) / 2;
    const alpha = 0.35 + breath * 0.35;
    this.gfx.ellipse(x, y - 14, 14, 20).stroke({ width: 1, color: 0x4de3c0, alpha });
    this.gfx.ellipse(x, y - 14, 12, 18).stroke({ width: 1, color: 0xd7fff4, alpha: alpha * 0.45 });
  }

  /** 头顶绿色像素牌：深色描边 + 三道「字迹」，站在人群里一眼能认出来 */
  private drawPoster(x: number, y: number): void {
    const top = y - 58;
    this.gfx.rect(x - 13, top, 26, 12).fill(0x14432f);
    this.gfx.rect(x - 12, top + 1, 24, 10).fill(0x39d353);
    this.gfx.rect(x - 9, top + 3, 6, 2).fill(0x0f2f22);
    this.gfx.rect(x - 9, top + 7, 10, 2).fill(0x0f2f22);
    this.gfx.rect(x + 2, top + 3, 6, 2).fill(0x0f2f22);
    // 小挂绳：让牌子看起来是「挂」在头顶而不是浮着
    this.gfx.rect(x - 1, top - 3, 2, 3).fill(0x0f2f22);
  }

  /** 隐身披风：幽紫半透明潜行轮廓环 */
  private drawStealth(x: number, y: number, since: number, now: number): void {
    const breath = (Math.sin(((now - since) / SHIELD_BREATH_MS) * Math.PI * 2) + 1) / 2;
    const alpha = 0.3 + breath * 0.35;
    this.gfx.ellipse(x, y, 12, 4).stroke({ width: 1, color: 0x9b87f5, alpha });
    this.gfx.ellipse(x, y - 16, 10, 15).stroke({ width: 1, color: OUTLINE_COLOR, alpha: alpha * 0.85 });
  }

  /** 纸箱伪装：牛皮纸箱套住上半身 + 封箱胶带 */
  private drawBox(x: number, y: number): void {
    this.gfx.rect(x - 11, y - 24, 22, 18).fill(OUTLINE_COLOR);
    this.gfx.rect(x - 10, y - 23, 20, 16).fill(0xd6a66a);
    this.gfx.rect(x - 10, y - 16, 20, 2).fill(0xb57f45);
    this.gfx.rect(x - 6, y - 20, 4, 2).fill(OUTLINE_COLOR);
    this.gfx.rect(x + 2, y - 20, 4, 2).fill(OUTLINE_COLOR);
  }

  /** 平底锅反制：角色右侧悬浮一枚金属平底锅图标，准备随时反击保安 */
  private drawPan(x: number, y: number, since: number, now: number): void {
    const bob = Math.round(Math.sin(((now - since) / HASTE_ARC_MS) * Math.PI * 2));
    const px = x + 13;
    const py = y - 20 + bob;
    this.gfx.circle(px, py, 5).fill(OUTLINE_COLOR);
    this.gfx.circle(px, py, 3).fill(0x8c97aa);
    this.gfx.rect(px - 1, py + 4, 2, 6).fill(OUTLINE_COLOR);
    this.gfx.rect(px + 2, py - 2, 2, 2).fill(0xf6c453);
  }

  /** 孟婆特调咖啡：金翠温热环绕上浮粒子 */
  private drawCoffeeHeal(x: number, y: number, since: number, now: number): void {
    const phase = (((now - since) % HASTE_ARC_MS) / HASTE_ARC_MS + 1) % 1;
    const rise = Math.round(phase * 12);
    const alpha = 0.7 * (1 - phase * 0.6);
    this.gfx.ellipse(x, y, 13, 4).stroke({ width: 1, color: 0xf6c453, alpha: alpha * 0.7 });
    this.gfx.rect(x - 6, y - 8 - rise, 3, 3).fill({ color: 0x34d3a6, alpha });
    this.gfx.rect(x + 4, y - 12 - rise, 3, 3).fill({ color: 0xf6c453, alpha });
  }

  destroy(): void {
    this.entries.clear();
    this.container.destroy({ children: true });
  }
}
