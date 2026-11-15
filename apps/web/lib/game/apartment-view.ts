'use client';

import { Container, Graphics, Text } from 'pixi.js';
import { APARTMENT_SPECS, type ApartmentSpec } from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { WINTER_COLORS } from './terrain-palette';

/**
 * 牛马公寓的美术层（ADR-0087 / ADR-0095 / ADR-0098 / ADR-0101）。
 *
 * 唯一一栋单户公寓楼（门牌 301）：外立面走 y 排序层（一个深度键）。
 * 楼里没有可走的空间，所以这里只剩立面本身——窗格、门厅与门牌号。
 * 窗口里探出的头由 `WindowPeekView` 画在排序层之上，占用窗口的亮灯也在那边。
 */

const CJK_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const C = {
  outline: 0x14181c,
  concrete: 0x5a6169,
  concreteLight: 0x767f88,
  concreteDark: 0x3a4046,
  window: 0x2f4850,
  windowFrame: 0x8fd8e8,
  neon: 0x5eead4,
  neonPink: 0x8b5cf6,
  gold: 0xf2c879,
  /** 屋顶机组：带蓝相的深灰，与水泥墙同族但压一档 */
  roofUnit: 0x4a545c,
  roofUnitLight: 0x6c7780,
  /** 门头雨棚：薄荷条，与门厅霓虹同族 */
  awning: 0x7fd8c4,
} as const;

/** 屋顶积雪：与地面雪同一色阶（不再单写一份 0xf2f7ff，那是比地面更白的另一种雪） */
const SNOW = WINTER_COLORS.snowBase;

export class ApartmentView {
  private readonly roots: Container[] = [];
  private readonly texts: Text[] = [];
  private devicePxPerTexel: number;

  constructor(
    private readonly winter: boolean,
    devicePxPerTexel: number,
  ) {
    this.devicePxPerTexel = devicePxPerTexel;
  }

  build(depth: DepthSink, base: Container): void {
    for (const spec of APARTMENT_SPECS) {
      const ground = new Graphics();
      ground
        .rect(spec.rect.x, spec.rect.y, spec.rect.w, spec.rect.h)
        .fill({ color: C.concreteDark, alpha: 0.4 });
      base.addChild(ground);

      const root = new Container();
      root.position.set(spec.rect.x, spec.rect.y + spec.rect.h);
      root.addChild(this.drawFacade(spec));

      const plaque = new Text({
        text: `${spec.doorNo}`,
        resolution: this.devicePxPerTexel,
        style: { fontFamily: CJK_FONT, fontSize: 9, fontWeight: '700', fill: C.gold },
      });
      plaque.anchor.set(0.5, 1);
      plaque.position.set(spec.rect.w / 2 + 60, -44);
      root.addChild(plaque);
      this.texts.push(plaque);

      depth.add(spec.rect.y + spec.rect.h, root);
      this.roots.push(root);
    }
  }

  setTextResolution(devicePxPerTexel: number): void {
    if (this.devicePxPerTexel === devicePxPerTexel) return;
    this.devicePxPerTexel = devicePxPerTexel;
    for (const text of this.texts) text.resolution = devicePxPerTexel;
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    this.roots.length = 0;
    this.texts.length = 0;
  }

  /**
   * 水泥楼外立面：楼层带、窗格、门厅霓虹与门牌。
   *
   * 窗格位置直接读共享层的 `spec.windows`（世界坐标 → 本地坐标），
   * 保证「画出来的窗」与「服务端分配的窗口」逐像素一致。
   */
  private drawFacade(spec: ApartmentSpec): Graphics {
    const g = new Graphics();
    const w = spec.rect.w;
    const h = spec.rect.h;
    g.rect(0, -h, w, h).fill(C.outline);
    g.rect(2, -h + 2, w - 4, h - 4).fill(C.concrete);

    const bands = new Set<number>();
    for (const window of spec.windows) {
      const x = window.x - spec.rect.x;
      const y = window.y - spec.rect.y - h;
      // 楼层带每层一道：同一层的五个窗共用一个上沿
      if (!bands.has(window.floor)) {
        bands.add(window.floor);
        g.rect(4, y - 10, w - 8, 4).fill(C.concreteLight);
      }
      // 窗洞：底色深，有人探头时由窗口层点亮
      g.rect(x, y, window.w, window.h).fill(C.window);
      g.rect(x, y, window.w, 2).fill(C.windowFrame);
    }

    // 一层门厅 + 霓虹门牌
    g.rect(w / 2 - 30, -46, 60, 46).fill(C.concreteDark);
    g.rect(w / 2 - 26, -42, 52, 42).fill(C.outline);
    g.rect(w / 2 - 24, -40, 48, 38).fill(C.neonPink);
    g.rect(w / 2 - 20, -36, 40, 30).fill(C.outline);
    g.rect(10, -56, 60, 16).fill(C.outline);
    g.rect(12, -54, 56, 12).fill(C.neon);

    // 门头雨棚：门厅正上方一条薄荷棚 + 一道投影，进门那一步有了「屋檐」
    g.rect(w / 2 - 38, -58, 76, 7).fill(C.outline);
    g.rect(w / 2 - 36, -57, 72, 5).fill(C.awning);
    g.rect(w / 2 - 36, -57, 72, 1).fill(0xd8fff4);
    g.rect(w / 2 - 36, -52, 72, 2).fill({ color: C.outline, alpha: 0.45 });

    // 屋顶机组：水箱 + 两台空调外机 + 一根排气管，整栋楼同一套剪影
    const roofY = -h + 8;
    g.rect(12, roofY, 26, 12).fill(C.outline);
    g.rect(13, roofY + 1, 24, 10).fill(C.roofUnit);
    g.rect(13, roofY + 1, 24, 1).fill(C.roofUnitLight);
    g.rect(13, roofY + 6, 24, 1).fill(C.concreteDark);
    g.rect(w - 44, roofY + 2, 16, 9).fill(C.outline);
    g.rect(w - 43, roofY + 3, 14, 7).fill(C.roofUnit);
    g.rect(w - 43, roofY + 3, 14, 1).fill(C.roofUnitLight);
    g.rect(w - 24, roofY + 4, 4, 8).fill(C.concreteDark);
    g.rect(w - 23, roofY + 1, 2, 4).fill(C.roofUnitLight);

    // 冬季：屋顶积雪改用统一色阶，并把雨棚顶也压一道雪
    if (this.winter) {
      g.rect(2, -h + 1, w - 4, 4).fill(SNOW);
      g.rect(w / 2 - 36, -57, 72, 2).fill(SNOW);
    }
    return g;
  }
}
