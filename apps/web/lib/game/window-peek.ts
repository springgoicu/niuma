'use client';

import { Container, Graphics } from 'pixi.js';
import {
  DIRECTION,
  apartmentWindowAt,
  type ApartmentPeekEntry,
  type CharacterAppearance,
} from '@niuma/shared-types';
import type { Atlas } from './atlas';
import { headTopYOf } from './nameplate';
import { PonyRenderer } from './pony';
import { VENUE_COLORS } from './venue-palette';

/**
 * 牛马公寓的「窗口探头」（ADR-0098）。
 *
 * 探头的人本体已经被隐藏（`EntityView.setPeeked`），这一层负责把他们**只露一颗头**
 * 画到外立面的窗洞里：一个窗口一个头，窗口矩形同时当遮罩，身体全被裁掉。
 *
 * 为什么要单独一层：外立面在 y 排序层里，深度键是楼底，窗口在楼体上半部——
 * 直接把角色放进排序层会被整栋楼盖住。这一层挂在排序层**之后**，天然压在楼面之上。
 */
export class WindowPeekView {
  readonly container = new Container();
  /** 有人探头的窗口点亮：远处一眼能看出哪栋楼「有人在家」 */
  private readonly lit = new Graphics();
  private readonly heads = new Map<number, HeadSlot>();
  private entries: ReadonlyArray<ApartmentPeekEntry> = [];

  constructor(private readonly atlas: Atlas) {
    this.container.addChild(this.lit);
  }

  /**
   * 全量替换占用（快照语义）。
   *
   * `appearanceOf` 由渲染层给：外观走常规实体同步，不在这条包里重复传。
   * 拿不到外观（人还没进 AOI）就先跳过，等 `addEntity` 之后再补一次。
   */
  setEntries(
    entries: ReadonlyArray<ApartmentPeekEntry>,
    appearanceOf: (id: number) => CharacterAppearance | undefined,
  ): void {
    this.entries = entries;
    const alive = new Set<number>();
    for (const entry of entries) {
      const appearance = appearanceOf(entry.id);
      if (!appearance || !apartmentWindowAt(entry.slot, entry.window)) continue;
      alive.add(entry.id);
      let slot = this.heads.get(entry.id);
      if (!slot) {
        slot = this.createSlot(appearance);
        this.heads.set(entry.id, slot);
      } else {
        // 换装 / 换发色：与场上本体同一套外观，不做第二份真相
        slot.pony.setAppearance(appearance);
      }
      this.place(slot, entry);
    }
    for (const [id, slot] of this.heads) {
      if (alive.has(id)) continue;
      slot.pony.container.destroy({ children: true });
      slot.mask.destroy();
      this.heads.delete(id);
    }
    this.drawLit();
  }

  /** 实体离开视野：对应的头也收掉，别让窗口空着还亮灯 */
  drop(id: number): void {
    const slot = this.heads.get(id);
    if (!slot) return;
    slot.pony.container.destroy({ children: true });
    slot.mask.destroy();
    this.heads.delete(id);
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.drawLit();
  }

  destroy(): void {
    for (const slot of this.heads.values()) {
      slot.pony.container.destroy({ children: true });
      slot.mask.destroy();
    }
    this.heads.clear();
    this.entries = [];
    this.lit.destroy();
    this.container.destroy({ children: true });
  }

  private createSlot(appearance: CharacterAppearance): HeadSlot {
    const pony = new PonyRenderer(this.atlas, appearance, 1);
    const mask = new Graphics();
    pony.container.mask = mask;
    this.container.addChild(mask, pony.container);
    // 待机第一帧面朝屋外：窗里的人是在看街上，不是在背对窗户
    void pony
      .build()
      .then(() => pony.setPose(DIRECTION.Down, 0))
      .catch((error: unknown) => {
        console.error('[game] 窗口探头贴图加载失败', error);
      });
    return { pony, mask };
  }

  private place(slot: HeadSlot, entry: ApartmentPeekEntry): void {
    const window = apartmentWindowAt(entry.slot, entry.window);
    if (!window) return;
    // 头顶锚点（负值）→ 头的中心：让那颗头正好落在窗洞中央，身体全在遮罩外
    const headTop = headTopYOf(this.atlas.manifest, slot.pony.appearance.species);
    slot.pony.container.position.set(
      Math.round(window.cx),
      Math.round(window.cy - (headTop + HEAD_HALF_TEXELS)),
    );
    slot.mask
      .clear()
      .rect(Math.round(window.x), Math.round(window.y), window.w, window.h)
      .fill(0xffffff);
  }

  private drawLit(): void {
    const g = this.lit;
    g.clear();
    for (const entry of this.entries) {
      const window = apartmentWindowAt(entry.slot, entry.window);
      if (!window) continue;
      // 只点暖色块、不新增 LightSpec：一栋楼最多 20 扇窗，逐窗注册光源会直接打穿光照预算
      g.rect(window.x, window.y, window.w, window.h).fill({ color: LIT, alpha: 0.32 });
      g.rect(window.x, window.y, window.w, 2).fill({ color: LIT, alpha: 0.62 });
    }
  }
}

/** 头（含帽子）大约十来纹素高：把头中心对到窗口中心即露出一张脸 */
const HEAD_HALF_TEXELS = 7;

/** 亮窗取公寓场所的焦点光色：与门廊壁灯同一个暖色，夜里不跳色 */
const LIT = VENUE_COLORS.apartment.glow;

interface HeadSlot {
  pony: PonyRenderer;
  /** 窗口矩形遮罩：只留窗洞里那颗头 */
  mask: Graphics;
}
