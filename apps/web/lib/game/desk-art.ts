'use client';

import { DIRECTION, type Direction } from '@niuma/shared-types';

/**
 * 工位桌贴图的四向几何（ADR-0027 / ADR-0028）。
 *
 * 桌子是实物，不是贴在屏幕上的平面：屏幕朝东 / 朝西时整张桌子转 90°，人同样坐在长边外侧，
 * 显示器落在背对椅子的远端长边。本模块只提供几何（帧、桌面、前挡板、桌腿、显示器、陈设），
 * 不 import pixi——绘制在 `props.ts`，几何可以单独验算，位图里看不出「贴错边」这种 bug。
 *
 * 帧底永远等于精灵锚点（桌脚占地的南边）：桌子不会陷进地里，也不会浮空。
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 屏幕在显示器机身上的朝向，也就是「人从哪一面看」：
 * front = 朝镜头（南）、back = 背对镜头（北）、west / east = 屏幕朝西 / 朝东。
 */
export type DeskScreenSide = 'front' | 'back' | 'west' | 'east';

export interface DeskArt {
  /** 单帧尺寸：横桌 96×66，侧放桌 48×92 */
  frame: { w: number; h: number };
  /** 桌面本体（顶面），不含前挡板 */
  top: Box;
  /** 前挡板 / 抽屉面板：永远贴着画面南侧的桌沿 */
  front: Box;
  /** 抽屉拉手 */
  handle: Box;
  /** 两条桌腿：贴在前挡板底部 */
  legs: Box[];
  /** 桌下投影 */
  shadow: { cx: number; cy: number; rx: number; ry: number };
  /** 显示器外框（单帧局部坐标），贴在桌子背对椅子的那条长边上 */
  monitor: Box;
  /** 屏幕朝向：永远与 `DeskInstance.facing`（入座者面朝方向）一致 */
  screen: DeskScreenSide;
  /**
   * 桌面陈设的落点：绿植（中心 x + 盆底 y）、马克杯左上角、便签左上角。
   * 侧放桌的显示器占住西 / 东长边，陈设让到靠人的半边。
   */
  details: {
    plant: { cx: number; bottom: number };
    mug: { x: number; y: number };
    note: { x: number; y: number };
  };
}

/** 桌体共用部分：横桌 88×40 占地，桌面 88×24 + 前挡板 12 */
type DeskBody = Pick<DeskArt, 'frame' | 'top' | 'front' | 'handle' | 'legs' | 'shadow'>;

const HORIZONTAL_BODY: DeskBody = {
  frame: { w: 96, h: 66 },
  top: { x: 4, y: 28, w: 88, h: 24 },
  front: { x: 4, y: 52, w: 88, h: 12 },
  handle: { x: 40, y: 56, w: 16, h: 2 },
  legs: [
    { x: 6, y: 60, w: 5, h: 6 },
    { x: 85, y: 60, w: 5, h: 6 },
  ],
  shadow: { cx: 48, cy: 64, rx: 42, ry: 3 },
};

/** 桌体共用部分：竖桌 40×88 占地，桌面 40×72 + 南端前挡板 14 */
const VERTICAL_BODY: DeskBody = {
  frame: { w: 48, h: 92 },
  top: { x: 4, y: 6, w: 40, h: 72 },
  front: { x: 4, y: 78, w: 40, h: 14 },
  handle: { x: 20, y: 82, w: 8, h: 2 },
  legs: [
    { x: 7, y: 86, w: 5, h: 6 },
    { x: 32, y: 86, w: 5, h: 6 },
  ],
  shadow: { cx: 24, cy: 90, rx: 20, ry: 3 },
};

/** 人朝北（椅子在桌南）：显示器在桌子的北侧远边，屏幕朝镜头，与实装前的唯一画法一致 */
const FACING_UP_ART: DeskArt = {
  ...HORIZONTAL_BODY,
  monitor: { x: 32, y: 2, w: 32, h: 22 },
  screen: 'front',
  details: {
    plant: { cx: 14, bottom: 28 },
    mug: { x: 70, y: 19 },
    note: { x: 53, y: 33 },
  },
};

/** 人朝南（椅子在桌北）：显示器在桌子的南侧远边，屏幕朝北，镜头只看到背壳 */
const FACING_DOWN_ART: DeskArt = {
  ...HORIZONTAL_BODY,
  monitor: { x: 32, y: 28, w: 32, h: 20 },
  screen: 'back',
  details: {
    plant: { cx: 14, bottom: 28 },
    mug: { x: 70, y: 19 },
    note: { x: 66, y: 33 },
  },
};

/** 人朝西（椅子在桌东）：桌子转成竖桌，显示器贴西侧长边，屏幕朝东对着人 */
const FACING_LEFT_ART: DeskArt = {
  ...VERTICAL_BODY,
  monitor: { x: 5, y: 34, w: 12, h: 22 },
  screen: 'east',
  details: {
    plant: { cx: 32, bottom: 24 },
    mug: { x: 26, y: 66 },
    note: { x: 26, y: 40 },
  },
};

/** 人朝东（椅子在桌西）：竖桌，显示器贴东侧长边，屏幕朝西对着人 */
const FACING_RIGHT_ART: DeskArt = {
  ...VERTICAL_BODY,
  monitor: { x: 31, y: 34, w: 12, h: 22 },
  screen: 'west',
  details: {
    plant: { cx: 16, bottom: 24 },
    mug: { x: 10, y: 66 },
    note: { x: 13, y: 40 },
  },
};

/**
 * 入座朝向 → 桌子贴图几何。
 *
 * `facing` 是「入座者面朝的方向」，也是 `DeskInstance.facing`：
 * 屏幕永远朝这个人，桌子长边永远垂直于这个方向。
 */
export function deskArtFor(facing: Direction): DeskArt {
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
