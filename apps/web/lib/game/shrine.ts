'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import { SHRINE_ALTAR } from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 赛博财神殿 / 关公香案（ADR-0061）。
 *
 * 三件事必须成立：
 * 1. **案面、财神像、三足香炉三者比例对**：56px 的案面要放下一尊微缩神像 + 一只香炉，
 *    神像只能占 12×18——再大就把案面挤成神龛，再小就只是块金色贴纸；
 * 2. **青烟常驻但不抢戏**：3 缕固定槽位的粒子循环上升 + 淡出，纯池化，
 *    帧循环里只写 `position/alpha`，不建节点、不做纹理；
 * 3. **上香反馈是「一次性闪光」而不是常亮**：财神像本身有微弱常亮光位，
 *    按 F 之后再叠一道 500ms 的金色脉冲，玩家才分得清「拜了」和「没拜」。
 *
 * 光源走 `lights`（构造期一次收集），昼夜开关交给 `lightmap` 的 `localLightGain`。
 */

const C = {
  outline: 0x2a3142,
  // 红木供案
  rosewood: 0x6b2a22,
  rosewoodLight: 0x8f3b2c,
  rosewoodDark: 0x4a1c17,
  brass: 0xd8a33f,
  brassLight: 0xf2c879,
  // 财神像：金身 + 红袍
  gold: 0xe8c46a,
  goldLight: 0xffe8a8,
  goldDark: 0xa8761f,
  robe: 0xc23a2a,
  robeLight: 0xe0603f,
  // 青铜三足香炉
  bronze: 0x6c7a5a,
  bronzeLight: 0x93a37c,
  bronzeDark: 0x44503a,
  ember: 0xff9a4a,
  // 供品
  candle: 0xd8452f,
  flame: 0xffd166,
} as const;

/** 一缕青烟：起始点相对案面、上升距离与生命周期都由这里定 */
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
  /** 财神像常亮 + 香炉余烬：两盏小光位，半径都不大，夜里只照亮案前一圈 */
  readonly lights: LightSpec[] = [
    {
      x: SHRINE_ALTAR.x - 13,
      y: SHRINE_ALTAR.y - 6,
      radius: 40,
      color: 0xffd27a,
      intensity: 0.5,
      flicker: 0.06,
    },
    {
      x: SHRINE_ALTAR.x + 12,
      y: SHRINE_ALTAR.y - 6,
      radius: 34,
      color: 0xff8a4a,
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

    // 财神像的一次性金色微光：add 混合，平时 alpha 0
    this.flashGlow = new Sprite(glowTexture);
    this.flashGlow.anchor.set(0.5, 0.5);
    this.flashGlow.position.set(-13, -34);
    this.flashGlow.blendMode = 'add';
    this.flashGlow.alpha = 0;
    this.root.addChild(this.flashGlow);

    // 三缕青烟：构造期一次建好，之后只改属性
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

  /** 按 F 上香：财神像闪一道金光（500ms） */
  flash(): void {
    this.flashUntil = this.elapsedMs + 500;
  }

  /** 每帧推进：青烟相位与闪光衰减都只写标量 */
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

/** 供案本体：红木案面 + 雕花牙板 + 两条案腿 + 财神像 + 三足香炉 + 一对红烛 */
function drawAltar(g: Graphics): void {
  // 地面投影
  g.ellipse(0, -1, 26, 4).fill({ color: 0x1e2846, alpha: 0.22 });

  // 案腿
  rect(g, -24, -18, 5, 18, C.rosewoodDark);
  rect(g, 19, -18, 5, 18, C.rosewoodDark);
  rect(g, -23, -17, 2, 16, C.rosewood);
  rect(g, 20, -17, 2, 16, C.rosewood);

  // 牙板：雕花靠「雕空的方块」表达，实心雕纹在 56px 宽里会糊成一片深色
  rect(g, -24, -22, 48, 5, C.rosewoodDark);
  for (let x = -20; x <= 16; x += 8) {
    rect(g, x, -21, 4, 3, C.rosewoodLight);
    rect(g, x + 1, -20, 2, 1, C.rosewoodDark);
  }

  // 案面：一层亮边压出厚度
  rect(g, -28, -26, 56, 5, C.rosewoodDark);
  rect(g, -27, -26, 54, 3, C.rosewoodLight);
  rect(g, -27, -27, 54, 1, C.brass);
  for (const x of [-24, 22]) {
    rect(g, x, -26, 2, 2, C.brassLight);
  }

  // 财神像：红袍 + 金身 + 冠
  rect(g, -20, -38, 14, 12, C.robe);
  rect(g, -19, -38, 12, 10, C.robeLight);
  rect(g, -18, -41, 10, 5, C.gold);
  rect(g, -17, -40, 8, 3, C.goldLight);
  rect(g, -15, -32, 4, 6, C.gold);
  rect(g, -17, -46, 8, 5, C.goldDark);
  rect(g, -16, -45, 6, 3, C.gold);
  // 朝笏：一道竖直亮线
  rect(g, -14, -28, 2, 6, C.brassLight);

  // 三足香炉：炉身 + 双耳 + 三足，炉口一点余烬
  rect(g, 6, -32, 13, 8, C.bronzeDark);
  rect(g, 7, -32, 11, 6, C.bronze);
  rect(g, 8, -31, 9, 1, C.bronzeLight);
  rect(g, 4, -33, 2, 4, C.bronzeDark);
  rect(g, 19, -33, 2, 4, C.bronzeDark);
  rect(g, 6, -34, 13, 2, C.bronzeDark);
  rect(g, 8, -34, 9, 1, C.ember);
  rect(g, 8, -24, 2, 3, C.bronzeDark);
  rect(g, 15, -24, 2, 3, C.bronzeDark);
  rect(g, 11, -24, 3, 2, C.bronze);

  // 一对红烛：烛身 + 火苗，压在案面两端
  rect(g, -28, -36, 3, 10, C.candle);
  rect(g, -28, -37, 3, 1, C.brass);
  rect(g, -27, -40, 1, 3, C.flame);
  rect(g, 25, -36, 3, 10, C.candle);
  rect(g, 25, -37, 3, 1, C.brass);
  rect(g, 26, -40, 1, 3, C.flame);
}

/** 青烟的一缕：三层低透明圆叠出「柔」的错觉，实际仍是纯像素 */
function drawWisp(g: Graphics): void {
  g.circle(TEX_W / 2, TEX_H - 3, 3).fill({ color: 0xdff3ff, alpha: 0.08 });
  g.circle(TEX_W / 2, TEX_H - 6, 3).fill({ color: 0xeaf9ff, alpha: 0.13 });
  g.circle(TEX_W / 2, TEX_H - 9, 2).fill({ color: 0xffffff, alpha: 0.18 });
  g.circle(TEX_W / 2, TEX_H - 12, 1).fill({ color: 0xffffff, alpha: 0.24 });
}

/** 闪光贴图：中心亮、边缘散，配合 add 混合就是「一道金光」 */
function drawGlow(g: Graphics): void {
  g.circle(24, 24, 22).fill({ color: 0xffd27a, alpha: 0.05 });
  g.circle(24, 24, 15).fill({ color: 0xffe0a0, alpha: 0.09 });
  g.circle(24, 24, 9).fill({ color: 0xfff2cc, alpha: 0.16 });
  g.circle(24, 24, 4).fill({ color: 0xffffff, alpha: 0.26 });
}
