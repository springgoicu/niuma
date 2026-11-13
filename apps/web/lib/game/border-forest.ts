/**
 * 边界外密林的树位（ADR-0064）。
 *
 * 园区边界是一个矩形，四边之外不再有海，而是一片不可通行的密林。
 * 这一层只产出「树根坐标 + 明暗档」，不含任何 Pixi 对象：
 * 渲染侧负责贴图、着色与裁剪，测试侧只校验位置与数量。
 *
 * 纪律：种子固定、只用 `seeded` 的 mulberry32，不碰 Math.random / Math.sin / Math.cos，
 * 每次启动、每台机器长出来的林墙完全一样。
 */

import type { WorldRect } from '@niuma/shared-types';
import { seeded } from './seeded';

/** 一排树影：只画不碰，角色永远走不到这一带 */
export interface ForestTree {
  /** 树根坐标（世界像素，精灵锚点在脚底中央） */
  x: number;
  y: number;
  /** 0 = 近排（贴着沙带外沿）；1 = 远排（压暗一档，负责把地平线堵死） */
  depth: 0 | 1;
  /** 树冠变体索引，由调用方对纹理数量取模 */
  variant: number;
}

/** 树影总量上限：四边两排铺满后仍留余量，超出说明参数被改坏了 */
export const FOREST_MAX_TREES = 640;
/** 树冠变体数量：与 `makeTreeTextures` 的数量一致 */
export const FOREST_TREE_VARIANTS = 4;

/** 近排离矩形边界的距离：站在沙带上就能贴到树干 */
const NEAR_OFFSET = 22;
/** 远排离矩形边界的距离：再往外的深色靠林地底纹接住 */
const FAR_OFFSET = 96;
/** 相邻树影的间距：树冠 58–64 宽，64 的间距正好连成一堵墙 */
const SPACING = 64;
/** 前后左右的抖动幅度：破掉整齐的直线，但不会露出缝隙 */
const JITTER = 14;

type Side = 'top' | 'bottom' | 'left' | 'right';

/** 一条边上两排树的步进位置：远排错开半格，近排从端点起铺 */
const SIDES: ReadonlyArray<Side> = ['top', 'bottom', 'left', 'right'];

/**
 * 生成四边树位。
 *
 * 每条边沿切线方向按 `SPACING` 铺，垂直方向向矩形外侧偏移；
 * 近排与远排错开半格，远排再叠一点抖动，林墙才有厚度而不是印刷网纹。
 */
export function buildBorderForest(bounds: WorldRect): ForestTree[] {
  const random = seeded(0x7f1c3a5d);
  const { x, y, w, h } = bounds;
  const trees: ForestTree[] = [];

  /** 抖动取整数像素：树根落在整数格上，像素边缘才不会发虚 */
  const wobble = (): number => Math.round((random() - 0.5) * JITTER * 2);
  const pick = (): number => Math.floor(random() * FOREST_TREE_VARIANTS) % FOREST_TREE_VARIANTS;

  for (const side of SIDES) {
    const span = side === 'top' || side === 'bottom' ? w : h;
    for (let t = 0; t < span; t += SPACING) {
      // 近排
      const nearAlong = t + wobble();
      const nearOut = NEAR_OFFSET + wobble();
      // 远排：沿切线错开半格
      const farAlong = t + Math.round(SPACING / 2) + wobble();
      const farOut = FAR_OFFSET + wobble();
      trees.push(place(side, nearAlong, nearOut, 0, pick()));
      trees.push(place(side, farAlong, farOut, 1, pick()));
    }
  }

  return trees;

  function place(side: Side, along: number, out: number, depth: 0 | 1, variant: number): ForestTree {
    if (side === 'top') return { x: Math.round(x + along), y: Math.round(y - out), depth, variant };
    if (side === 'bottom') return { x: Math.round(x + along), y: Math.round(y + h + out), depth, variant };
    if (side === 'left') return { x: Math.round(x - out), y: Math.round(y + along), depth, variant };
    return { x: Math.round(x + w + out), y: Math.round(y + along), depth, variant };
  }
}
