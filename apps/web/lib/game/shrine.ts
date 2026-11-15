'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import { SHRINE_ALTAR } from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 石砌祈福龛（ADR-0096，替代 ADR-0061 的赛博财神供案）。
 *
 * 三件事必须成立：
 * 1. **龛体、马蹄铁、蜡烛三者比例对**：56px 的石基座要放下一座拱形龛 + 两支白蜡烛 + 几枚铜币，
 *    拱高只能占 40 上下——再大就把基座挤成一堵墙，再小就只是块灰贴纸；
 * 2. **白雾常驻但不抢戏**：3 缕固定槽位的粒子循环上升 + 淡出，纯池化，
 *    帧循环里只写 `position/alpha`，不建节点、不做纹理；
 * 3. **祈福反馈是「一次性闪光」而不是常亮**：龛内常亮一盏暖白小灯，
 *    按 F 之后再叠一道 500ms 的暖白脉冲，玩家才分得清「拜了」和「没拜」。
 *
 * 光源走 `lights`（构造期一次收集），昼夜开关交给 `lightmap` 的 `localLightGain`。
 */

const C = {
  // 石砌龛体
  stone: 0xcfc7b6,
  stoneLight: 0xf0eadb,
  stoneDark: 0xa79f8e,
  mortise: 0x8c8477,
  // 铜件：马蹄铁、烛台与散落铜币
  brass: 0xc9a14a,
  brassLight: 0xe3c37a,
  brassDark: 0x9a7a2e,
  // 白蜡烛与火苗
  candle: 0xf7f4ea,
  candleShade: 0xd9d3c4,
  flame: 0xffd166,
} as const;

/** 一缕白雾：起始点相对基座、上升距离与生命周期都由这里定 */
const WISP_COUNT = 3;
const WISP_LIFE_MS = 2600;
const WISP_RISE = 34;
/** 每缕错开的相位：三缕同时冒会读成一根烟柱 */
const WISP_OFFSET = [0, 0.34, 0.67] as const;

const TEX_W = 12;
const TEX_H = 16;

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

export class ShrineView {
  private readonly root = new Container();
  private readonly wisps: Sprite[] = [];
  private readonly flashGlow: Sprite;
  private wispTexture?: Texture;
  private glowTexture?: Texture;
  private elapsedMs = 0;
  private flashUntil = 0;
  /** 龛内常亮 + 蜡烛：两盏小光位，半径都不大，夜里只照亮龛前一圈 */
  readonly lights: LightSpec[] = [
    {
      x: SHRINE_ALTAR.x - 13,
      y: SHRINE_ALTAR.y - 6,
      radius: 40,
      color: 0xffe7b8,
      intensity: 0.5,
      flicker: 0.06,
    },
    {
      x: SHRINE_ALTAR.x + 12,
      y: SHRINE_ALTAR.y - 6,
      radius: 34,
      color: 0xffc98a,
      intensity: 0.45,
      flicker: 0.22,
    },
  ];

  constructor(renderer: Application['renderer']) {
    this.root.position.set(SHRINE_ALTAR.x, SHRINE_ALTAR.y);
    const wispTexture = bake(renderer, drawWisp, { frame: new Rectangle(0, 0, TEX_W, TEX_H) });
    const glowTexture = bake(renderer, drawGlow, { frame: new Rectangle(0, 0, 48, 48) });
    this.wispTexture = wispTexture;
    this.glowTexture = glowTexture;

    const art = new Graphics();
    drawAltar(art);
    this.root.addChild(art);

    // 龛内的一次性暖白微光：add 混合，平时 alpha 0
    this.flashGlow = new Sprite(glowTexture);
    this.flashGlow.anchor.set(0.5, 0.5);
    this.flashGlow.position.set(-13, -34);
    this.flashGlow.blendMode = 'add';
    this.flashGlow.alpha = 0;
    this.root.addChild(this.flashGlow);

    // 三缕白雾：构造期一次建好，之后只改属性
    for (let i = 0; i < WISP_COUNT; i += 1) {
      const wisp = new Sprite(wispTexture);
      wisp.anchor.set(0.5, 1);
      wisp.position.set(12, -34);
      wisp.alpha = 0;
      this.root.addChild(wisp);
      this.wisps.push(wisp);
    }
  }

  build(depth: DepthSink): void {
    depth.add(SHRINE_ALTAR.y, this.root);
  }

  /** 按 F 上香：龛内闪一道暖白光（500ms） */
  flash(): void {
    this.flashUntil = this.elapsedMs + 500;
  }

  /** 每帧推进：白雾相位与闪光衰减都只写标量 */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.elapsedMs += dtMs;

    for (let i = 0; i < this.wisps.length; i += 1) {
      const wisp = this.wisps[i]!;
      const phase = ((this.elapsedMs / WISP_LIFE_MS + WISP_OFFSET[i]!) % 1 + 1) % 1;
      wisp.position.y = -34 - Math.round(phase * WISP_RISE);
      // 左右微摆：±1px 的整数偏移，不做浮点缩放，1px 描边不会糊
      wisp.position.x = 12 + (Math.round(phase * 6) % 3) - 1;
      // 起手淡入、末段淡出
      const fade = phase < 0.18 ? phase / 0.18 : phase > 0.7 ? (1 - phase) / 0.3 : 1;
      wisp.alpha = Math.max(0, Math.min(1, fade)) * 0.5;
    }

    const remain = this.flashUntil - this.elapsedMs;
    this.flashGlow.alpha = remain > 0 ? Math.min(1, remain / 500) * 0.85 : 0;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.wispTexture?.destroy(true);
    this.glowTexture?.destroy(true);
    this.wispTexture = undefined;
    this.glowTexture = undefined;
  }
}

/** 龛体本体：石基座 + 拱形龛 + 铜马蹄铁 + 两支白蜡烛 + 散落铜币 */
function drawAltar(g: Graphics): void {
  // 地面投影
  g.ellipse(0, -1, 26, 4).fill({ color: 0x1e2846, alpha: 0.22 });

  // 石基座：两级台阶，前沿压一档亮边
  rect(g, -28, -12, 56, 12, C.stoneDark);
  rect(g, -26, -12, 52, 9, C.stone);
  rect(g, -26, -12, 52, 1, C.stoneLight);
  rect(g, -28, -6, 56, 1, C.mortise);

  // 龛背板：深石外框 + 灰泥内凹
  rect(g, -24, -46, 48, 34, C.stoneDark);
  rect(g, -22, -44, 44, 32, C.stone);
  rect(g, -19, -42, 38, 30, C.mortise);

  // 拱顶：三层错位的石券，像素画里用阶梯代替圆弧
  rect(g, -24, -50, 48, 4, C.stoneDark);
  rect(g, -21, -53, 42, 3, C.stone);
  rect(g, -15, -56, 30, 3, C.stoneLight);

  // 铜马蹄铁：开口朝上的 U 形，龛内最亮的一处
  rect(g, -15, -38, 2, 9, C.brass);
  rect(g, -15, -38, 10, 2, C.brass);
  rect(g, -7, -38, 2, 9, C.brass);
  rect(g, -14, -37, 1, 7, C.brassLight);
  rect(g, -14, -37, 8, 1, C.brassLight);
  rect(g, -15, -30, 3, 2, C.brassDark);
  rect(g, -8, -30, 3, 2, C.brassDark);

  // 龛内两只白蜡烛：烛身 + 烛台 + 火苗
  for (const x of [-18, 14]) {
    rect(g, x, -30, 3, 9, C.candleShade);
    rect(g, x, -30, 2, 9, C.candle);
    rect(g, x - 1, -21, 5, 1, C.brass);
    rect(g, x + 1, -33, 1, 3, C.flame);
  }

  // 基座面上散落几枚铜币
  for (const [x, w] of [
    [-22, 3],
    [8, 3],
    [18, 2],
  ] as const) {
    rect(g, x, -9, w, 1, C.brass);
    rect(g, x + 1, -10, 1, 1, C.brassLight);
  }
}

/** 白雾的一缕：三层低透明圆叠出「柔」的错觉，实际仍是纯像素 */
function drawWisp(g: Graphics): void {
  g.circle(TEX_W / 2, TEX_H - 3, 3).fill({ color: 0xe8e4da, alpha: 0.08 });
  g.circle(TEX_W / 2, TEX_H - 6, 3).fill({ color: 0xf2efe6, alpha: 0.13 });
  g.circle(TEX_W / 2, TEX_H - 9, 2).fill({ color: 0xffffff, alpha: 0.16 });
  g.circle(TEX_W / 2, TEX_H - 12, 1).fill({ color: 0xffffff, alpha: 0.22 });
}

/** 闪光贴图：中心亮、边缘散，配合 add 混合就是「一道暖白微光」 */
function drawGlow(g: Graphics): void {
  g.circle(24, 24, 22).fill({ color: 0xffe7b8, alpha: 0.05 });
  g.circle(24, 24, 15).fill({ color: 0xfff2cc, alpha: 0.09 });
  g.circle(24, 24, 9).fill({ color: 0xfff8e4, alpha: 0.16 });
  g.circle(24, 24, 4).fill({ color: 0xffffff, alpha: 0.26 });
}
