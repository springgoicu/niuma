/**
 * 有机多边形环岛三层密林（替代旧版四直边双排林墙）：
 *
 * - 沿顺时针多边形海岸外法线方向排布 3 排错位林墙（near 0 / mid 1 / far 2），
 *   外浅内深、树种按南北东西岸带生态自然过渡；
 * - 全程无 Math.random / Math.sin / Math.cos，不依附 Pixi，便于双端测试校验。
 */

import { pointInPolygon, type Point, type WorldRect } from '@niuma/shared-types';
import { seeded } from './seeded';
import type { TreeSpeciesId } from './vegetation-species';

export interface ForestTree {
  /** 树根坐标（世界像素，精灵锚点 0.5, 1） */
  x: number;
  y: number;
  /** 0 近岸林缘 / 1 中景密林 / 2 远景幽林 */
  depth: 0 | 1 | 2;
  /** 同物种形态变体索引 0..2 */
  variant: number;
  /** 按海岸区位分配的生态树种 */
  species: TreeSpeciesId;
}

/** 29 顶点周长下 3 排密林约 560–720 棵，设上限防参数失控 */
export const FOREST_MAX_TREES = 1200;
export const FOREST_TREE_VARIANTS = 3;

const RING_OFFSETS: ReadonlyArray<{ depth: 0 | 1 | 2; offset: number; spacing: number; phase: number }> = [
  { depth: 0, offset: 24, spacing: 58, phase: 0 },
  { depth: 1, offset: 76, spacing: 64, phase: 0.5 },
  { depth: 2, offset: 138, spacing: 72, phase: 0.25 },
];

const JITTER_ALONG = 12;
const JITTER_OUT = 10;

function coastalSpecies(x: number, y: number, r: number): TreeSpeciesId {
  if (x >= 4750 && y < 3400) {
    return r < 0.55 ? 'pine' : r < 0.85 ? 'cypress' : 'osmanthus';
  }
  if (y < 3250) {
    return r < 0.45 ? 'sakura' : r < 0.78 ? 'maple' : 'pine';
  }
  if (x >= 4750 && y < 4850) {
    return r < 0.4 ? 'jacaranda' : r < 0.75 ? 'osmanthus' : 'cypress';
  }
  if (x >= 4750) {
    return r < 0.45 ? 'willow' : r < 0.8 ? 'osmanthus' : 'pine';
  }
  if (y >= 4850) {
    return r < 0.42 ? 'holly' : r < 0.74 ? 'cypress' : 'ginkgo';
  }
  return r < 0.42 ? 'cypress' : r < 0.76 ? 'ginkgo' : 'maple';
}

function toPolygon(boundsOrPoints: WorldRect | ReadonlyArray<Point>): Point[] {
  if (Array.isArray(boundsOrPoints)) {
    return boundsOrPoints.map(([x, y]) => [x, y]);
  }
  const rect = boundsOrPoints as WorldRect;
  return [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
}

/**
 * 绕多边形外缘（支持任意顺时针岛屿多边形或包围盒）铺设 3 层错落密林。
 * 凹湾处若某抖动点落回陆地内，会被 `pointInPolygon` 自动跳过，决不踩进海岸沙滩。
 */
export function buildBorderForest(boundsOrPoints: WorldRect | ReadonlyArray<Point>): ForestTree[] {
  const random = seeded(0x7f1c3a5d);
  const polygon = toPolygon(boundsOrPoints);
  if (polygon.length < 3) return [];

  const trees: ForestTree[] = [];
  const wobbleAlong = (): number => Math.round((random() - 0.5) * JITTER_ALONG * 2);
  const wobbleOut = (): number => Math.round((random() - 0.5) * JITTER_OUT * 2);
  const pickVariant = (): number => Math.floor(random() * FOREST_TREE_VARIANTS) % FOREST_TREE_VARIANTS;

  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i]!;
    const [bx, by] = polygon[(i + 1) % polygon.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const ux = dx / length;
    const uy = dy / length;
    // 顺时针边（屏幕坐标 y 向下）的外法线 = (uy, -ux)
    const nx = uy;
    const ny = -ux;

    for (const ring of RING_OFFSETS) {
      const steps = Math.max(1, Math.floor(length / ring.spacing));
      for (let s = 0; s < steps; s += 1) {
        const t = (s + ring.phase) / steps;
        if (t < 0 || t >= 1) continue;
        const along = length * t + wobbleAlong();
        const out = ring.offset + wobbleOut();
        const px = Math.round(ax + ux * along + nx * out);
        const py = Math.round(ay + uy * along + ny * out);
        // 凹湾处防误入陆地：一旦在多边形内即放弃该点
        if (pointInPolygon(px, py, polygon)) continue;
        trees.push({
          x: px,
          y: py,
          depth: ring.depth,
          variant: pickVariant(),
          species: coastalSpecies(px, py, random()),
        });
      }
    }
  }

  return trees;
}
