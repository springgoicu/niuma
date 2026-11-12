'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import { TEA_STATION } from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 老干部紫砂茶台（ADR-0061）：把工作区饮水机旁那一格升级成「红泥紫砂壶 + 白瓷品茗杯」。
 *
 * 三条取舍：
 * 1. **壶与杯必须能一眼分辨**：紫砂是暖褐红、白瓷是冷白，两者在 16px 尺度上只靠
 *    色相区别，所以杯子不加任何花纹，壶身只留一条高光带；
 * 2. **蒸汽只用两股**：三股以上在 46px 宽的台面上会糊成一片白雾，反而看不出是茶；
 * 3. **交互不在这里**：按 F 的判定在 `interactions.isNearTeaStation`，
 *    气泡与音效在 `session`，本模块只负责「看起来在冒热气」。
 */

const C = {
  rosewood: 0x8d4a30,
  rosewoodLight: 0xb5673f,
  rosewoodDark: 0x5f2d1c,
  // 红泥紫砂
  zisha: 0x8a4a34,
  zishaLight: 0xb06a48,
  zishaDark: 0x5e2f22,
  // 白瓷
  porcelain: 0xf7f4ea,
  porcelainEdge: 0xd3cdbd,
  porcelainShade: 0xe6e0d0,
  // 茶汤与热气
  tea: 0xc08a3a,
  steam: 0xfffdf5,
};

const STEAM_COUNT = 2;
const STEAM_LIFE_MS = 2400;
const STEAM_RISE = 26;
const TEX_W = 10;
const TEX_H = 14;

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

export class TeaStationView {
  private readonly root = new Container();
  private readonly steam: Sprite[] = [];
  private steamTexture?: Texture;
  private elapsedMs = 0;

  constructor(renderer: Application['renderer']) {
    this.root.position.set(TEA_STATION.x, TEA_STATION.y);
    const steamTexture = bake(renderer, drawSteam, { frame: new Rectangle(0, 0, TEX_W, TEX_H) });
    this.steamTexture = steamTexture;

    const art = new Graphics();
    drawTeaTable(art);
    this.root.addChild(art);

    for (let i = 0; i < STEAM_COUNT; i += 1) {
      const wisp = new Sprite(steamTexture);
      wisp.anchor.set(0.5, 1);
      wisp.position.set(-6, -32);
      wisp.alpha = 0;
      this.root.addChild(wisp);
      this.steam.push(wisp);
    }
  }

  build(depth: DepthSink): void {
    depth.add(TEA_STATION.y, this.root);
  }

  /** 每帧推进：热气相位只写 position / alpha */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.elapsedMs += dtMs;
    for (let i = 0; i < this.steam.length; i += 1) {
      const wisp = this.steam[i]!;
      const phase = ((this.elapsedMs / STEAM_LIFE_MS + i * 0.5) % 1 + 1) % 1;
      wisp.position.y = -32 - Math.round(phase * STEAM_RISE);
      wisp.position.x = -6 + (Math.round(phase * 4) % 3) - 1;
      const fade = phase < 0.2 ? phase / 0.2 : phase > 0.65 ? (1 - phase) / 0.35 : 1;
      wisp.alpha = Math.max(0, Math.min(1, fade)) * 0.55;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.steamTexture?.destroy(true);
    this.steamTexture = undefined;
  }
}

/** 茶台本体：红木矮台 + 红泥紫砂壶 + 两只白瓷品茗杯 */
function drawTeaTable(g: Graphics): void {
  g.ellipse(0, -1, 22, 4).fill({ color: 0x1e2846, alpha: 0.22 });

  // 台腿与台面
  rect(g, -20, -16, 4, 16, C.rosewoodDark);
  rect(g, 16, -16, 4, 16, C.rosewoodDark);
  rect(g, -22, -20, 44, 5, C.rosewoodDark);
  rect(g, -21, -20, 42, 3, C.rosewood);
  rect(g, -21, -21, 42, 1, C.rosewoodLight);
  // 台面木纹
  rect(g, -18, -18, 34, 1, C.rosewoodLight);

  // 紫砂壶：壶身 + 壶盖 + 壶钮 + 壶嘴 + 壶把
  rect(g, -13, -30, 14, 10, C.zishaDark);
  rect(g, -12, -29, 12, 8, C.zisha);
  rect(g, -11, -28, 9, 1, C.zishaLight);
  rect(g, -10, -32, 8, 2, C.zishaDark);
  rect(g, -9, -33, 6, 1, C.zisha);
  rect(g, -7, -35, 2, 2, C.zishaLight);
  // 壶嘴：向右上挑两格
  rect(g, 1, -28, 3, 2, C.zishaDark);
  rect(g, 3, -30, 2, 2, C.zisha);
  // 壶把：左侧一圈，用三格拼出来
  rect(g, -16, -29, 2, 1, C.zishaDark);
  rect(g, -17, -28, 2, 4, C.zishaDark);
  rect(g, -16, -25, 2, 1, C.zishaDark);

  // 两只白瓷品茗杯：杯口亮、杯身暗一档
  for (const x of [7, 13]) {
    rect(g, x, -26, 5, 6, C.porcelainShade);
    rect(g, x + 1, -26, 3, 5, C.porcelain);
    rect(g, x, -26, 5, 1, C.porcelain);
    rect(g, x + 1, -27, 3, 1, C.porcelainEdge);
    // 茶汤：杯口一圈琥珀色
    rect(g, x + 1, -26, 3, 1, C.tea);
  }
}

/** 一股热气：三层半透明白往上收，读成「温热」而不是「烟」 */
function drawSteam(g: Graphics): void {
  g.circle(TEX_W / 2, TEX_H - 2, 3).fill({ color: C.steam, alpha: 0.08 });
  g.circle(TEX_W / 2, TEX_H - 5, 2).fill({ color: C.steam, alpha: 0.14 });
  g.circle(TEX_W / 2, TEX_H - 8, 1).fill({ color: C.steam, alpha: 0.2 });
}
