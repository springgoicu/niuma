'use client';

import { Graphics, Rectangle } from 'pixi.js';
import { RING_ARENA } from '@niuma/shared-types';

/**
 * 擂台地面与领奖台的像素贴图（ADR-0073）。
 *
 * 全部 1:1 烘焙、nearest 采样，和园区别处同一套纪律：
 * - 只有「本体 + 一档压暗暗边」，没有渐变与纯黑；
 * - 所有线条落在整数纹素上，1px 描边不会被插值糊掉；
 * - 擂台垫的 300×260 尺寸由共享世界规则给定，客户端不另造比例。
 */

/** 深板岩垫底、青灰台面、黄铜描边：和发泄区老板垫的暖橙拉开距离 */
export const RING_COLORS = {
  outer: 0x1a232b,
  frame: 0x24343f,
  mat: 0x2c4452,
  matLight: 0x35515f,
  rope: 0xd8c7a1,
  ropeShade: 0x9c8a68,
  brass: 0xc9a45c,
  brassDark: 0x8a6f3a,
  cream: 0xe8ddc3,
  red: 0xb4463c,
  redDark: 0x7f2f28,
  teal: 0x5f8f92,
  slate: 0x4a5a63,
} as const;

/** 围绳内缩：绳子压在垫子边缘，不让角色踩到线 */
const ROPE_INSET = 22;
/** 入场缺口在围绳东侧正中，宽 60 texel */
const GATE_W = 60;

export function drawRingGround(g: Graphics, w: number, h: number): void {
  // 垫子外沿：一圈深色压边，告诉玩家这是不可跨越的矩形
  g.roundRect(0, 0, w, h, 12).fill(RING_COLORS.outer);
  g.roundRect(3, 3, w - 6, h - 6, 11).fill(RING_COLORS.frame);

  // 台面：横向细纹模拟橡胶垫的压痕，每 18 texel 一道，只比本体亮一档
  g.roundRect(10, 10, w - 20, h - 20, 9).fill(RING_COLORS.mat);
  for (let y = 22; y < h - 16; y += 18) {
    g.rect(14, y, w - 28, 1).fill({ color: RING_COLORS.matLight, alpha: 0.55 });
  }

  // 中心徽记：黄铜圆环 + 对角交叉线，俯视看是「擂台」的抽象标记
  const cx = w / 2;
  const cy = h / 2;
  g.circle(cx, cy, 46).stroke({ color: RING_COLORS.brass, width: 3, alpha: 0.85 });
  g.circle(cx, cy, 38).stroke({ color: RING_COLORS.brassDark, width: 1, alpha: 0.8 });
  g.moveTo(cx - 26, cy - 26).lineTo(cx + 26, cy + 26).stroke({ color: RING_COLORS.brass, width: 2, alpha: 0.55 });
  g.moveTo(cx + 26, cy - 26).lineTo(cx - 26, cy + 26).stroke({ color: RING_COLORS.brass, width: 2, alpha: 0.55 });

  // 四个角柱基座：贴在地面层，柱身在排序层里单独画
  const pad = 40;
  for (const [x, y] of [
    [14, 14],
    [w - pad - 14, 14],
    [14, h - pad - 14],
    [w - pad - 14, h - pad - 14],
  ] as const) {
    g.rect(x, y, pad, pad).fill(RING_COLORS.frame);
    g.rect(x + 3, y + 3, pad - 6, pad - 6).fill(RING_COLORS.slate);
    g.rect(x + 7, y + 7, pad - 14, pad - 14).fill({ color: RING_COLORS.cream, alpha: 0.22 });
  }

  // 围栏：南北正中各留 56px 门洞（与 `RING_FENCE_SOLIDS` 同一份几何），东西整段
  const top = ROPE_INSET;
  const left = ROPE_INSET;
  const right = w - ROPE_INSET;
  const bottom = h - ROPE_INSET;
  const gateLeft = w / 2 - GATE_W / 2;
  const gateRight = w / 2 + GATE_W / 2;

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: RING_COLORS.ropeShade, width: 5 });
    g.moveTo(x1, y1 - 1).lineTo(x2, y2 - 1).stroke({ color: RING_COLORS.rope, width: 2 });
  };

  line(left, top, gateLeft, top);
  line(gateRight, top, right, top);
  line(left, bottom, gateLeft, bottom);
  line(gateRight, bottom, right, bottom);
  line(left, top, left, bottom);
  line(right, top, right, bottom);

  // 南北门洞：黄铜箭头指向场心，报名的人一眼知道从哪进
  g.moveTo(gateLeft, h - 8).lineTo(w / 2, h - 22).lineTo(gateRight, h - 8);
  g.stroke({ color: RING_COLORS.brass, width: 2 });
  g.moveTo(gateLeft, 8).lineTo(w / 2, 22).lineTo(gateRight, 8);
  g.stroke({ color: RING_COLORS.brass, width: 2 });

  // 红蓝两角：起跑位各刷一块色块，观战押注看的就是这两个角
  g.rect(w / 2 - 96, h / 2 - 18, 26, 36).fill({ color: RING_COLORS.red, alpha: 0.55 });
  g.rect(w / 2 + 70, h / 2 - 18, 26, 36).fill({ color: RING_COLORS.teal, alpha: 0.55 });
}

/** 观战长椅：40×16 的木条椅，锚点在底座南沿 */
export function drawRingBench(g: Graphics): void {
  g.rect(0, 0, 40, 4).fill(RING_COLORS.brassDark);
  g.rect(0, 4, 40, 8).fill(RING_COLORS.frame);
  g.rect(2, 3, 36, 3).fill(RING_COLORS.cream);
  g.rect(2, 8, 36, 2).fill({ color: RING_COLORS.brass, alpha: 0.5 });
  g.rect(4, 12, 4, 4).fill(RING_COLORS.slate);
  g.rect(32, 12, 4, 4).fill(RING_COLORS.slate);
}

/** 角柱：18×46，锚点在脚底，进 y 排序层后能挡住站在柱后的角色 */
export function drawRingPost(g: Graphics): void {
  const w = 18;
  const h = 46;
  g.rect(2, 8, w - 4, h - 8).fill(RING_COLORS.slate);
  g.rect(1, 6, w - 2, 6).fill(RING_COLORS.cream);
  g.rect(1, 6, w - 2, 2).fill({ color: 0xffffff, alpha: 0.5 });
  // 顶部红白护套：像素风的护角，只用两档红
  g.rect(3, 2, w - 6, 5).fill(RING_COLORS.red);
  g.rect(3, 4, w - 6, 2).fill(RING_COLORS.redDark);
  g.rect(5, 14, w - 10, 3).fill({ color: RING_COLORS.rope, alpha: 0.75 });
  g.rect(5, 34, w - 10, 2).fill({ color: RING_COLORS.rope, alpha: 0.5 });
}

/** 领奖台阶：顶端是 68×30 的台面，下面按名次递减踏面高度 */
export function drawPodiumStep(g: Graphics, color: number, shade: number, rise: number): void {
  const w = 68;
  const top = 30;
  const h = top + rise;
  g.rect(0, 0, w, top).fill(color);
  g.rect(0, 0, w, 3).fill({ color: 0xffffff, alpha: 0.28 });
  g.rect(2, 2, w - 4, top - 4).stroke({ color: shade, width: 2 });
  // 正面：亮一档的台面 + 暗一档的踏面，纯矩形不透视
  g.rect(0, top, w, rise).fill(shade);
  g.rect(0, top, w, 2).fill({ color, alpha: 0.9 });
  g.rect(4, top + 4, w - 8, 2).fill({ color: 0xffffff, alpha: 0.18 });
  // 名次牌：台面中央一个小方块，颁奖时由 HUD 说明名次
  g.rect(w / 2 - 6, 8, 12, 12).fill({ color: 0xffffff, alpha: 0.35 });
}

/** 奖杯：26×32，锚点在底座中心 */
export function drawTrophy(g: Graphics, fill: number, shade: number): void {
  const w = 26;
  g.rect(6, 26, w - 12, 5).fill(shade);
  g.rect(4, 29, w - 8, 3).fill(0x2c2113);
  g.rect(w / 2 - 2, 19, 4, 8).fill(shade);
  // 杯身：上宽下窄，用两个矩形 + 一条梯形近似，保持像素感
  g.rect(7, 10, 12, 9).fill(fill);
  g.rect(9, 18, 8, 2).fill(shade);
  g.rect(5, 8, 16, 3).fill(fill);
  g.rect(5, 8, 16, 1).fill({ color: 0xffffff, alpha: 0.45 });
  // 两侧把手：两个 2px 的框
  g.rect(2, 11, 3, 7).fill(shade);
  g.rect(w - 5, 11, 3, 7).fill(shade);
  g.rect(4, 12, 2, 5).fill({ color: 0xffffff, alpha: 0.2 });
  g.rect(w - 6, 12, 2, 5).fill({ color: 0xffffff, alpha: 0.2 });
}

/** 擂台地面贴图框：尺寸必须与共享矩形完全一致，否则锚点会整体偏移 */
export const RING_GROUND_FRAME = new Rectangle(0, 0, RING_ARENA.w, RING_ARENA.h);
export const RING_POST_FRAME = new Rectangle(0, 0, 18, 46);
export const RING_TROPHY_FRAME = new Rectangle(0, 0, 26, 32);
export const RING_STEP_FRAME = new Rectangle(0, 0, 68, 60);
/** 观战长椅：40×16，锚点在底座南沿 */
export const RING_BENCH_FRAME = new Rectangle(0, 0, 40, 16);
