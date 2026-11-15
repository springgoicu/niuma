'use client';

import { Container, Graphics } from 'pixi.js';
import {
  MOPING_PAVILION,
  PAVILION_CENTER,
  PAVILION_COLUMN_OFFSETS,
  PAVILION_TABLE,
} from '@niuma/shared-types';
import { LANTERN_LIGHT, paintLantern } from './lighting/lanterns';
import { TOWN_MATERIALS } from './venue-palette';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';

/**
 * 摸鱼亭（ADR-0096，替代 ADR-0061 的中式重檐凉亭）：木构双坡顶凉亭，蹲在摸鱼湖东北岸的凸角上。
 *
 * 三个必须成立的观感：
 * 1. **木瓦双坡 + 白漆封檐**：下坡宽、上坡窄，两级仍用梯形而不是圆弧——
 *    20px 粒度的像素画里，圆弧只会糊成一团灰；檐口不再上翘，改平直封檐板；
 * 2. **亭子能走进去**：整座亭子拆成「后景」与「前景」两条深度键。
 *    后柱与屋顶压在后沿 y 上，前柱压在前沿 y 上；人站在亭内时后景在身后、
 *    前景在身前，于是既不会被屋顶盖住，也不会「穿」过前柱；
 * 3. **四角挂灯**：挂在四根檐角，光源坐标与绘制同源（`lights` 由这里收集，
 *    renderer 在 `lightmap.register()` 之前一次性取走）。
 *
 * 台基走地面层（与室内地板同一条通路），因为它不该参与 y 排序——
 * 它本来就是「地」，被人踩在脚下。
 */

const C = {
  // 木瓦屋面
  roof: 0x8a6a4e,
  roofDark: 0x6b4f38,
  roofDeep: 0x543d2c,
  roofLight: 0xa8876a,
  roofRidge: 0xc3a684,
  // 白漆柱与封檐、栏杆
  paint: TOWN_MATERIALS.paint,
  paintShade: TOWN_MATERIALS.paintShade,
  // 深木柱头与额枋
  beam: TOWN_MATERIALS.timber,
  beamLight: TOWN_MATERIALS.timberLight,
  beamDark: TOWN_MATERIALS.timberDark,
  // 石桌与台基
  stone: TOWN_MATERIALS.stone,
  stoneDark: TOWN_MATERIALS.stoneDark,
  stoneLight: TOWN_MATERIALS.stoneLight,
  terrace: 0xc2bba8,
  terraceEdge: 0x8f887a,
  terraceLight: 0xdad3c0,
  terraceSeam: 0xa79f8e,
  // 铜球宝顶
  brass: TOWN_MATERIALS.brass,
  brassDark: 0xa07c34,
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

/** 挂灯在檐角下的下垂量：灯身中心落在檐口下方 12px */
const LANTERN_DROP = 12;

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

/** 一级屋面：底面宽、顶面窄的木瓦坡面 + 白漆封檐，读成「屋顶」 */
function eave(g: Graphics, halfBottom: number, halfTop: number, yBottom: number, yTop: number): void {
  g.poly([-halfBottom, yBottom, halfBottom, yBottom, halfTop, yTop, -halfTop, yTop]).fill(C.roofDark);
  g.poly([-halfBottom + 2, yBottom - 2, halfBottom - 2, yBottom - 2, halfTop, yTop, -halfTop, yTop]).fill(C.roof);
  // 封檐板：白漆一条 + 一档暗边，檐口平直不上翘
  rect(g, -halfBottom, yBottom, halfBottom * 2, 2, C.paint);
  rect(g, -halfBottom, yBottom + 2, halfBottom * 2, 1, C.paintShade);
  // 瓦垄：竖向 1px 线，间隔 10px
  for (let x = -halfBottom + 6; x <= halfBottom - 6; x += 10) {
    g.rect(x, yTop, 1, yBottom - yTop - 2).fill(C.roofLight);
  }
  // 檐口两端封头
  rect(g, -halfBottom - 2, yBottom - 2, 2, 5, C.roofDeep);
  rect(g, halfBottom, yBottom - 2, 2, 5, C.roofDeep);
}

/** 一根白漆方柱：暗侧 + 白漆本体 + 深木柱头 + 石柱础 */
function column(g: Graphics, x: number, yTop: number, yBottom: number): void {
  const h = yBottom - yTop;
  rect(g, x - 3, yTop, 6, h, C.paintShade);
  rect(g, x - 2, yTop, 4, h, C.paint);
  // 柱头：柱顶一截深木横木
  rect(g, x - 4, yTop, 8, 3, C.beamDark);
  rect(g, x - 4, yTop, 8, 2, C.beam);
  rect(g, x - 4, yTop, 8, 1, C.beamLight);
  // 柱础
  rect(g, x - 4, yBottom - 4, 8, 4, C.stoneDark);
  rect(g, x - 4, yBottom - 4, 8, 1, C.stone);
}

/** 一盏铁艺挂灯：复用 `lighting/lanterns.ts` 的同一套像素画，亭子与门柱不会画歪 */
function lantern(g: Graphics, x: number, hang: number): void {
  paintLantern(g, x, hang - 4);
}

export class PavilionView {
  private readonly terrace = new Container();
  private readonly rear = new Container();
  private readonly front = new Container();
  /** 四角挂灯的地面光池：半径 48 的暖白漫射（ADR-0096） */
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

  /** 后景：后排四柱 + 白色靠背栏杆 + 石桌 + 两级屋面与铜球宝顶 */
  private drawRear(): void {
    const g = new Graphics();

    // 后排与两侧的后半圈柱（dy < 0）
    for (const [dx, dy] of PAVILION_COLUMN_OFFSETS) {
      if (dy >= 0) continue;
      column(g, dx, -92 + 4, dy + 2);
    }

    // 白色靠背栏杆：只连后排三根柱，给「观湖」一个能凭的边
    rect(g, -82, -38, 164, 2, C.paint);
    rect(g, -82, -38, 164, 1, C.paintShade);
    rect(g, -82, -30, 164, 2, C.paint);
    rect(g, -82, -30, 164, 1, C.paintShade);
    for (let x = -70; x <= 70; x += 14) rect(g, x, -36, 2, 6, C.paint);

    // 石桌：圆形台面 + 鼓形桌腿 + 一圈石沿
    const tableR = PAVILION_TABLE.radius;
    g.circle(0, -26, tableR).fill(C.stoneDark);
    g.circle(0, -28, tableR - 1).fill(C.stone);
    g.circle(0, -29, tableR - 6).fill(C.stoneLight);
    rect(g, -7, -16, 14, 16, C.stoneDark);
    rect(g, -5, -16, 10, 15, C.stone);
    rect(g, -9, -2, 18, 2, C.stoneDark);

    // 下坡屋面
    eave(g, EAVE_LOW, EAVE_MID, LOW_BOTTOM, LOW_TOP);
    // 上坡屋面
    eave(g, EAVE_MID + 8, EAVE_TOP, HIGH_BOTTOM, HIGH_TOP);
    // 宝顶：铜球 + 一截短杆
    rect(g, -2, HIGH_TOP - 12, 4, 12, C.brassDark);
    rect(g, -1, HIGH_TOP - 12, 2, 12, C.brass);
    g.circle(0, HIGH_TOP - 15, 4).fill(C.brassDark);
    g.circle(0, HIGH_TOP - 16, 3).fill(C.brass);

    // 后排两盏挂灯：挂在檐角下
    for (const dx of [-EAVE_LOW + 2, EAVE_LOW - 2]) lantern(g, dx, LOW_BOTTOM + 2 + LANTERN_DROP);

    this.rear.addChild(g);
  }

  /** 前景：前排四柱 + 前檐角挂灯，压在亭内角色身前 */
  private drawFront(): void {
    const g = new Graphics();
    for (const [dx, dy] of PAVILION_COLUMN_OFFSETS) {
      if (dy < 0) continue;
      column(g, dx, -92 + 4, dy + 2);
    }
    // 前排挂灯
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
   * 四盏挂灯的地面光池：坐标与绘制同源，光池中心落在灯正下方的台基地面上。
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
