'use client';

import { Container, Graphics } from 'pixi.js';
import {
  MOPING_PAVILION,
  PAVILION_CENTER,
  PAVILION_COLUMN_OFFSETS,
  PAVILION_TABLE,
} from '@niuma/shared-types';
import { LANTERN_LIGHT, paintLantern } from './lighting/lanterns';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';

/**
 * 摸鱼亭（ADR-0061）：八角重檐凉亭，蹲在摸鱼湖东北岸的凸角上。
 *
 * 三个必须成立的观感：
 * 1. **青瓦重檐 + 飞檐微翘**：下檐宽、上檐窄，两级都用梯形而不是圆弧——
 *    20px 粒度的像素画里，圆弧只会糊成一团灰；
 * 2. **亭子能走进去**：整座亭子拆成「后景」与「前景」两条深度键。
 *    后柱与屋顶压在后沿 y 上，前柱压在前沿 y 上；人站在亭内时后景在身后、
 *    前景在身前，于是既不会被屋顶盖住，也不会「穿」过前柱；
 * 3. **四角宫灯**：挂在四根檐角，光源坐标与绘制同源（`lights` 由这里收集，
 *    renderer 在 `lightmap.register()` 之前一次性取走）。
 *
 * 台基走地面层（与室内地板同一条通路），因为它不该参与 y 排序——
 * 它本来就是「地」，被人踩在脚下。
 */

const C = {
  // 青瓦
  tile: 0x5f7d8c,
  tileDark: 0x3f5866,
  tileDeep: 0x2f4450,
  tileLight: 0x8aa7b4,
  tileRidge: 0xa9c2cc,
  // 朱红廊柱与额枋
  pillar: 0xb33a2a,
  pillarDark: 0x7d2418,
  pillarLight: 0xd9563f,
  beam: 0x8a3a24,
  beamLight: 0xc25a3c,
  // 汉白玉石桌与台基
  stone: 0xe4ded0,
  stoneDark: 0xb0a894,
  stoneLight: 0xf7f3e6,
  terrace: 0xc2bba8,
  terraceEdge: 0x8f887a,
  terraceLight: 0xdad3c0,
  terraceSeam: 0xa79f8e,
  // 金色宝顶
  gold: 0xe8c46a,
  goldDark: 0xb08a34,
} as const;

/** 檐口相对亭心的横向半宽：下檐比上檐宽一圈，重檐才读得出「重」 */
const EAVE_LOW = 98;
const EAVE_MID = 68;
const EAVE_TOP = 44;

/** 下檐底面 / 顶面、上檐底面 / 顶面（相对底座 y 的负值，向上为负） */
const LOW_BOTTOM = -92;
const LOW_TOP = -126;
const HIGH_BOTTOM = -126;
const HIGH_TOP = -158;

/** 宫灯在檐角下的下垂量：灯身中心落在檐口下方 12px */
const LANTERN_DROP = 12;

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

/** 一级屋檐：底面宽、顶面窄的梯形 + 檐下一道压暗，读成瓦口 */
function eave(g: Graphics, halfBottom: number, halfTop: number, yBottom: number, yTop: number): void {
  g.poly([-halfBottom, yBottom, halfBottom, yBottom, halfTop, yTop, -halfTop, yTop]).fill(C.tileDark);
  g.poly([-halfBottom + 2, yBottom - 2, halfBottom - 2, yBottom - 2, halfTop, yTop, -halfTop, yTop]).fill(C.tile);
  // 檐口：一条亮瓦当 + 一条更深的滴水线
  rect(g, -halfBottom, yBottom, halfBottom * 2, 2, C.tileRidge);
  rect(g, -halfBottom, yBottom + 2, halfBottom * 2, 1, C.tileDeep);
  // 瓦垄：竖向 1px 线，间隔 10px
  for (let x = -halfBottom + 6; x <= halfBottom - 6; x += 10) {
    g.rect(x, yTop, 1, yBottom - yTop - 2).fill(C.tileLight);
  }
  // 飞檐微翘：两端各挑一小块向上翘的角
  g.poly([-halfBottom, yBottom, -halfBottom - 10, yBottom - 7, -halfBottom + 2, yBottom - 3]).fill(C.tileRidge);
  g.poly([halfBottom, yBottom, halfBottom + 10, yBottom - 7, halfBottom - 2, yBottom - 3]).fill(C.tileRidge);
}

/** 一根朱红廊柱：亮边 + 本体 + 暗边 + 柱础石 */
function column(g: Graphics, x: number, yTop: number, yBottom: number): void {
  rect(g, x - 3, yTop, 6, yBottom - yTop, C.pillarDark);
  rect(g, x - 2, yTop, 3, yBottom - yTop, C.pillar);
  rect(g, x, yTop, 1, yBottom - yTop, C.pillarLight);
  // 额枋：柱顶一截更深的横木
  rect(g, x - 4, yTop, 8, 3, C.beam);
  rect(g, x - 4, yTop, 8, 1, C.beamLight);
  // 柱础
  rect(g, x - 4, yBottom - 4, 8, 4, C.stoneDark);
  rect(g, x - 4, yBottom - 4, 8, 1, C.stone);
}

/** 一盏宫灯：复用 `lighting/lanterns.ts` 的同一套像素画，亭子与门柱不会画歪 */
function lantern(g: Graphics, x: number, hang: number): void {
  paintLantern(g, x, hang - 4);
}

export class PavilionView {
  private readonly terrace = new Container();
  private readonly rear = new Container();
  private readonly front = new Container();
  /** 四角宫灯的地面光池：半径 48 的暖红漫射（ADR-0061） */
  readonly lights: LightSpec[] = [];

  constructor() {
    this.terrace.position.set(MOPING_PAVILION.x, MOPING_PAVILION.y);
    this.rear.position.set(MOPING_PAVILION.x, MOPING_PAVILION.y);
    this.front.position.set(MOPING_PAVILION.x, MOPING_PAVILION.y);
    this.drawTerrace();
    this.drawRear();
    this.drawFront();
  }

  /** 台基：两级石阶 + 石缝。走地面层，不参与 y 排序 */
  private drawTerrace(): void {
    const g = new Graphics();
    rect(g, -100, -14, 200, 14, C.terraceEdge);
    rect(g, -96, -14, 192, 10, C.terrace);
    rect(g, -96, -4, 192, 4, C.terraceEdge);
    rect(g, -94, -14, 188, 1, C.terraceLight);
    for (let x = -84; x <= 84; x += 24) rect(g, x, -13, 1, 9, C.terraceSeam);
    this.terrace.addChild(g);
  }

  /** 后景：后排四柱 + 靠背栏杆 + 汉白玉石桌 + 两级屋檐与宝顶 */
  private drawRear(): void {
    const g = new Graphics();

    // 后排与两侧的后半圈柱（dy < 0）
    for (const [dx, dy] of PAVILION_COLUMN_OFFSETS) {
      if (dy >= 0) continue;
      column(g, dx, -92 + 4, dy + 2);
    }

    // 靠背栏杆：只连后排三根柱，给「观湖」一个能凭的边
    rect(g, -82, -34, 4, 4, C.pillarDark);
    rect(g, -82, -34, 4, 1, C.pillarLight);
    rect(g, 78, -34, 4, 4, C.pillarDark);
    rect(g, 78, -34, 4, 1, C.pillarLight);
    rect(g, -82, -38, 164, 2, C.beam);
    rect(g, -82, -38, 164, 1, C.beamLight);
    rect(g, -82, -30, 164, 1, C.beam);
    for (let x = -70; x <= 70; x += 14) rect(g, x, -37, 1, 7, C.beam);

    // 汉白玉石桌：圆形台面 + 鼓形桌腿 + 一圈石沿
    const tableR = PAVILION_TABLE.radius;
    g.circle(0, -26, tableR).fill(C.stoneDark);
    g.circle(0, -28, tableR - 1).fill(C.stone);
    g.circle(0, -29, tableR - 6).fill(C.stoneLight);
    rect(g, -7, -16, 14, 16, C.stoneDark);
    rect(g, -5, -16, 10, 15, C.stone);
    rect(g, -9, -2, 18, 2, C.stoneDark);

    // 下檐
    eave(g, EAVE_LOW, EAVE_MID, LOW_BOTTOM, LOW_TOP);
    // 上檐
    eave(g, EAVE_MID + 8, EAVE_TOP, HIGH_BOTTOM, HIGH_TOP);
    // 宝顶：金色珠 + 一截短刹
    rect(g, -2, HIGH_TOP - 12, 4, 12, C.goldDark);
    rect(g, -1, HIGH_TOP - 12, 2, 12, C.gold);
    g.circle(0, HIGH_TOP - 15, 4).fill(C.goldDark);
    g.circle(0, HIGH_TOP - 16, 3).fill(C.gold);

    // 后排两盏宫灯：挂在檐角下
    for (const dx of [-EAVE_LOW + 2, EAVE_LOW - 2]) lantern(g, dx, LOW_BOTTOM + 2 + LANTERN_DROP);

    this.rear.addChild(g);
  }

  /** 前景：前排四柱 + 前檐角宫灯，压在亭内角色身前 */
  private drawFront(): void {
    const g = new Graphics();
    for (const [dx, dy] of PAVILION_COLUMN_OFFSETS) {
      if (dy < 0) continue;
      column(g, dx, -92 + 4, dy + 2);
    }
    // 前排宫灯
    for (const dx of [-EAVE_MID - 6, EAVE_MID + 6]) lantern(g, dx, LOW_BOTTOM + 2 + LANTERN_DROP);
    this.front.addChild(g);
  }

  /** 构造期一次进深度层：后景压后沿，前景压前沿 */
  build(depth: DepthSink, base: Container): void {
    base.addChild(this.terrace);
    depth.add(MOPING_PAVILION.y - MOPING_PAVILION.height + 2, this.rear);
    depth.add(MOPING_PAVILION.y, this.front);
    this.collectLights();
  }

  /**
   * 四盏宫灯的地面光池：坐标与绘制同源，光池中心落在灯正下方的台基地面上。
   * 白天由 `lightmap` 的 `localLightGain` 压到 0，不需要这里判昼夜。
   */
  private collectLights(): void {
    const groundY = MOPING_PAVILION.y - 6;
    for (const dx of [-EAVE_LOW + 2, EAVE_LOW - 2, -EAVE_MID - 6, EAVE_MID + 6]) {
      this.lights.push({ x: PAVILION_CENTER.x + dx, y: groundY, ...LANTERN_LIGHT });
    }
  }

  destroy(): void {
    this.terrace.destroy({ children: true });
    this.rear.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
