'use client';

import { DIRECTION, type Direction } from '@niuma/shared-types';

/**
 * 工位椅的四向几何（ADR-0029 / ADR-0032）。
 *
 * 椅子是实物：靠背永远在入座朝向的反侧，空椅才不会「背对桌子」。
 * 四个朝向共用 26×30 的帧与同一个锚点（椅子 sink 见 `seat-art.ts`），
 * 换朝向只换盒子，不改尺寸——否则椅子会在四个方向上来回伸缩。
 *
 * 座面顶面统一在帧内 `y = SEAT_TOP`：同一把椅子转 90° 不会一会儿高一会儿低，
 * 角色坐在椅子上的抬升量（`seat-art.ts`）才能只用一套数值。
 *
 * 本模块不 import pixi：几何可单独单测，绘制留在 `props.ts`。
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChairArt {
  frame: { w: number; h: number };
  /** 座面软垫 */
  seat: Box;
  /** 靠背：贴在入座朝向的反侧 */
  back: Box;
  /** 座垫 / 靠背上的高光条 */
  highlight: Box;
  /** 升降立柱 */
  stem: Box;
  /** 五星脚（俯视压扁成一条） */
  base: Box;
  /** 椅下投影 */
  shadow: { cx: number; cy: number; rx: number; ry: number };
}

const FRAME = { w: 26, h: 30 } as const;

/** 座面顶面在帧内的 y（四向一致）：世界高度 = 座位锚点 + sink - (帧高 - SEAT_TOP) */
export const SEAT_TOP = 13;

/** 人朝南（椅子朝南）：靠背在远侧（北），座面朝镜头；靠背顶到帧顶留出头枕区 */
const FACING_DOWN_ART: ChairArt = {
  frame: FRAME,
  seat: { x: 4, y: SEAT_TOP, w: 18, h: 10 },
  back: { x: 6, y: 0, w: 14, h: 15 },
  highlight: { x: 8, y: 15, w: 10, h: 2 },
  stem: { x: 11, y: 23, w: 4, h: 4 },
  base: { x: 6, y: 26, w: 14, h: 2 },
  shadow: { cx: 13, cy: 29, rx: 10, ry: 2.5 },
};

/** 人朝北（椅子朝北）：镜头看到椅背，靠背落在近侧（南），座面只露一条边 */
const FACING_UP_ART: ChairArt = {
  frame: FRAME,
  seat: { x: 4, y: SEAT_TOP, w: 18, h: 8 },
  back: { x: 6, y: 17, w: 14, h: 13 },
  highlight: { x: 8, y: SEAT_TOP + 2, w: 12, h: 2 },
  stem: { x: 11, y: 25, w: 4, h: 3 },
  base: { x: 6, y: 27, w: 14, h: 2 },
  shadow: { cx: 13, cy: 29, rx: 10, ry: 2.5 },
};

/** 人朝西（椅子朝西）：侧视，靠背直立在东侧，座面向西伸出 */
const FACING_LEFT_ART: ChairArt = {
  frame: FRAME,
  seat: { x: 3, y: SEAT_TOP, w: 15, h: 8 },
  back: { x: 17, y: 2, w: 6, h: 22 },
  highlight: { x: 5, y: SEAT_TOP + 2, w: 11, h: 2 },
  stem: { x: 10, y: 21, w: 4, h: 6 },
  base: { x: 6, y: 26, w: 14, h: 2 },
  shadow: { cx: 13, cy: 29, rx: 12, ry: 2.5 },
};

/** 人朝东（椅子朝东）：侧视镜像，靠背直立在西侧 */
const FACING_RIGHT_ART: ChairArt = {
  frame: FRAME,
  seat: { x: 8, y: SEAT_TOP, w: 15, h: 8 },
  back: { x: 3, y: 2, w: 6, h: 22 },
  highlight: { x: 10, y: SEAT_TOP + 2, w: 11, h: 2 },
  stem: { x: 10, y: 21, w: 4, h: 6 },
  base: { x: 6, y: 26, w: 14, h: 2 },
  shadow: { cx: 13, cy: 29, rx: 12, ry: 2.5 },
};

/** 入座朝向 → 椅子几何。`facing` 是入座者面朝的方向，靠背永远在它反侧。 */
export function chairArtFor(facing: Direction): ChairArt {
  switch (facing) {
    case DIRECTION.Down:
      return FACING_DOWN_ART;
    case DIRECTION.Left:
      return FACING_LEFT_ART;
    case DIRECTION.Right:
      return FACING_RIGHT_ART;
    case DIRECTION.Up:
    default:
      return FACING_UP_ART;
  }
}
