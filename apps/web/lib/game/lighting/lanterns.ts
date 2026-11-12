'use client';

import { Container, Graphics } from 'pixi.js';
import { ARCH_LANTERN_POSTS, DOOR_LANTERN_POSTS, type LanternPost } from '@niuma/shared-types';
import type { LightSpec } from './light-registry';
import type { DepthSink } from '../sort-layer';

/**
 * 红色像素宫灯与夜间暖红光源（ADR-0061）。
 *
 * 三条纪律：
 * 1. **灯只画一次、光源只出一份数据**：宫灯的像素画 `paintLantern()` 与光池
 *    `LANTERN_LIGHT` 都由本模块提供，摸鱼亭与门柱共用同一套，改口径只改这里；
 * 2. **不自己判昼夜**：白昼熄灭是 `lightmap` 的 `localLightGain(tone)` 干的，
 *    这里只登记 `LightSpec`。白天整层 `visible=false`，黄昏淡入、深夜满亮；
 * 3. **半径 48 是需求口径**：灯笼是「向下投一圈暖红」的漫射光源，不是照明灯，
 *    再大就会把冷色夜景吃光，冷暖撞色反而没了。
 */

/** 灯笼像素画用色：与亭子的朱红廊柱同一族，暖红不刺眼 */
export const LANTERN_INK = {
  outline: 0x2a3142,
  body: 0xd8452f,
  bodyLight: 0xf07a5a,
  core: 0xffd9a8,
  cap: 0xe8c46a,
  capDark: 0xb08a34,
} as const;

/**
 * 一盏宫灯的地面光池。
 *
 * `flicker` 取 0.12：灯笼是纸罩烛火，抖一点才像有风；再高会读成坏了。
 */
export const LANTERN_LIGHT: Omit<LightSpec, 'x' | 'y'> = {
  radius: 48,
  color: 0xff5a3c,
  intensity: 0.72,
  flicker: 0.12,
};

/** 宫灯的像素尺寸：提绳 4 + 灯身 14 + 流苏 4，总高 22 */
export const LANTERN_HEIGHT = 22;

/**
 * 在 (x, hangTop) 处画一盏宫灯：提绳 → 上下金盖 → 红纱灯身 → 流苏。
 * 局部坐标由调用方给（`x` 是灯心，`hangTop` 是提绳顶端）。
 */
export function paintLantern(g: Graphics, x: number, hangTop: number): void {
  g.rect(x, hangTop, 1, 4).fill(LANTERN_INK.outline);
  g.rect(x - 3, hangTop + 4, 7, 2).fill(LANTERN_INK.cap);
  g.rect(x - 4, hangTop + 6, 9, 8).fill(LANTERN_INK.body);
  g.rect(x - 2, hangTop + 7, 5, 6).fill(LANTERN_INK.bodyLight);
  g.rect(x - 1, hangTop + 8, 3, 4).fill(LANTERN_INK.core);
  g.rect(x - 3, hangTop + 14, 7, 2).fill(LANTERN_INK.capDark);
  g.rect(x, hangTop + 16, 1, 4).fill(LANTERN_INK.body);
}

/** 一处挂灯位置 → 一圈地面暖红光池（灯在头顶，光落在地上，所以 y 取 depthY - 6） */
export function lanternLights(anchors: readonly LanternPost[]): LightSpec[] {
  return anchors.map((anchor) => ({
    x: anchor.x,
    y: anchor.depthY - 6,
    radius: LANTERN_LIGHT.radius,
    color: LANTERN_LIGHT.color,
    intensity: LANTERN_LIGHT.intensity,
    flicker: LANTERN_LIGHT.flicker,
  }));
}

/** 全部固定宫灯（拱门 2 + 门柱 4）；摸鱼亭四角由 `pavilion.ts` 自己收集 */
export const FIXED_LANTERNS: ReadonlyArray<LanternPost> = [...ARCH_LANTERN_POSTS, ...DOOR_LANTERN_POSTS];

/**
 * 固定宫灯视图：每盏灯一张按脚底 y 归位的贴图，外加一份交给 `LightmapLayer` 的光位表。
 * 灯笼是 9×22 的小件，直接逐盏 Graphics 就够，不需要烘焙图集。
 */
export class LanternView {
  private readonly roots: Container[] = [];
  /** 六盏宫灯的地面光池：renderer 在 `lightmap.register()` 之前一次取走 */
  readonly lights: LightSpec[];

  constructor() {
    this.lights = lanternLights(FIXED_LANTERNS);
    for (const anchor of FIXED_LANTERNS) {
      const g = new Graphics();
      paintLantern(g, 0, 0);
      const root = new Container();
      root.position.set(anchor.x, anchor.hangTop);
      root.addChild(g);
      this.roots.push(root);
    }
  }

  build(depth: DepthSink): void {
    FIXED_LANTERNS.forEach((anchor, index) => {
      const root = this.roots[index];
      if (root) depth.add(anchor.depthY, root);
    });
  }

  destroy(): void {
    for (const root of this.roots) root.destroy({ children: true });
    this.roots.length = 0;
  }
}
