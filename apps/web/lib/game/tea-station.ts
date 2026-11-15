'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import { TEA_STATION } from '@niuma/shared-types';
import { TOWN_MATERIALS } from './venue-palette';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 木吧台饮品站（ADR-0096，替代 ADR-0061 的紫砂茶台）：
 * 把工作区饮水机旁那一格升级成「不锈钢保温壶 + 两只白瓷马克杯」。
 *
 * 三条取舍：
 * 1. **壶与杯必须能一眼分辨**：不锈钢是冷灰带蓝相、白瓷是暖白，两者在 16px 尺度上只靠
 *    色相区别，所以杯子不加任何花纹，壶身只留一条竖向高光；
 * 2. **蒸汽只用两股**：三股以上在 46px 宽的台面上会糊成一片白雾，反而看不出在冒热气；
 * 3. **交互不在这里**：按 F 的判定在 `interactions.isNearTeaStation`，
 *    气泡与音效在 `session`，本模块只负责「看起来在冒热气」。
 */

const C = {
  // 深木吧台
  timber: TOWN_MATERIALS.timber,
  timberLight: TOWN_MATERIALS.timberLight,
  timberDark: TOWN_MATERIALS.timberDark,
  // 不锈钢保温壶
  steel: 0xc9ccd2,
  steelLight: 0xe8ebef,
  steelDark: 0x8f959e,
  // 白瓷马克杯
  porcelain: 0xf7f4ea,
  porcelainEdge: 0xd3cdbd,
  porcelainShade: 0xe6e0d0,
  // 热气
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

    // 赛博茶水强化站（ADR-0087）：茶台升格为霓虹小亭，只加灯管与价签，不动壶杯
    const neon = new Graphics();
    drawNeon(neon);
    this.root.addChild(neon);

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

/** 饮品台本体：深木吧台 + 不锈钢保温壶 + 两只白瓷马克杯 */
function drawTeaTable(g: Graphics): void {
  g.ellipse(0, -1, 22, 4).fill({ color: 0x1e2846, alpha: 0.22 });

  // 台腿与台面：深木吧台
  rect(g, -20, -16, 4, 16, C.timberDark);
  rect(g, 16, -16, 4, 16, C.timberDark);
  rect(g, -22, -20, 44, 5, C.timberDark);
  rect(g, -21, -20, 42, 3, C.timber);
  rect(g, -21, -21, 42, 1, C.timberLight);
  // 台面木纹
  rect(g, -18, -18, 34, 1, C.timberLight);

  // 保温壶：壶身 + 竖向高光 + 壶盖 + 压杆 + 出水嘴 + 把手
  rect(g, -13, -34, 15, 14, C.steelDark);
  rect(g, -12, -33, 13, 12, C.steel);
  rect(g, -11, -32, 3, 10, C.steelLight);
  rect(g, -10, -37, 9, 4, C.steelDark);
  rect(g, -9, -36, 7, 2, C.steel);
  rect(g, -6, -40, 3, 3, C.steelDark);
  rect(g, 2, -28, 3, 2, C.steelDark);
  rect(g, -17, -30, 2, 1, C.steelDark);
  rect(g, -18, -29, 2, 6, C.steelDark);
  rect(g, -17, -24, 2, 1, C.steelDark);

  // 两只白瓷马克杯：杯口亮、杯身暗一档，杯里一圈深色咖啡
  for (const x of [7, 13]) {
    rect(g, x, -27, 6, 7, C.porcelainShade);
    rect(g, x + 1, -27, 4, 6, C.porcelain);
    rect(g, x, -27, 6, 1, C.porcelain);
    rect(g, x + 1, -28, 4, 1, C.porcelainEdge);
    rect(g, x + 1, -27, 4, 1, C.timberDark);
    // 杯耳
    rect(g, x + 6, -25, 2, 3, C.porcelainEdge);
  }
}

/**
 * 赛博霓虹：台沿一圈青紫灯管 + 头顶价签。
 *
 * 只画两层（管芯 + 外晕），像素风格下比高斯发光更贴；灯管并不参与碰撞，
 * 按 F 的判定仍然是茶台 48px 热区。
 */
function drawNeon(g: Graphics): void {
  const cyan = 0x5eead4;
  const violet = 0x8b5cf6;
  // 外晕
  g.rect(-25, -23, 50, 5).fill({ color: cyan, alpha: 0.18 });
  g.rect(-24, -22, 48, 3).fill({ color: cyan, alpha: 0.45 });
  // 灯管本体
  g.rect(-23, -21, 46, 1).fill(cyan);
  g.rect(-23, -37, 1, 16).fill({ color: violet, alpha: 0.7 });
  g.rect(22, -37, 1, 16).fill({ color: violet, alpha: 0.7 });
  // 价签：一块黑底 + 两条霓虹横线，读成「属性 / 装扮」
  g.rect(-15, -48, 30, 12).fill(0x14181c);
  g.rect(-14, -47, 28, 10).fill(0x1c2228);
  g.rect(-12, -44, 24, 1).fill(cyan);
  g.rect(-12, -41, 16, 1).fill(violet);
}

/** 一股热气：三层半透明白往上收，读成「温热」而不是「烟」 */
function drawSteam(g: Graphics): void {
  g.circle(TEX_W / 2, TEX_H - 2, 3).fill({ color: C.steam, alpha: 0.08 });
  g.circle(TEX_W / 2, TEX_H - 5, 2).fill({ color: C.steam, alpha: 0.14 });
  g.circle(TEX_W / 2, TEX_H - 8, 1).fill({ color: C.steam, alpha: 0.2 });
}
