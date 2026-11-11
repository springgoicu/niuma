'use client';

import { DIRECTION, type Direction } from '@niuma/shared-types';

/**
 * 工位桌贴图的四向几何（ADR-0027）。
 *
 * 一张桌子只有一块桌面，但广场四面都摆了椅子：屏幕必须朝向坐的人，
 * 于是「显示器贴在哪条边、从哪个角度看」由座位的朝向决定。
 * 本模块只提供几何与陈设位置，不 import pixi——绘制在 `props.ts`，
 * 几何在这里可以单独验算，位图里看不出「贴错边」这种 bug。
 */
export const DESK_ART_SIZE = { w: 96, h: 66 } as const;

/**
 * 屏幕在显示器机身上的朝向，也就是「人从哪一面看」：
 * front = 朝镜头（南）、back = 背对镜头（北）、west / east = 屏幕朝西 / 朝东。
 */
export type DeskScreenSide = 'front' | 'back' | 'west' | 'east';

export interface DeskArt {
  /** 显示器外框（单帧局部坐标），贴在桌子背对椅子的那条边上 */
  monitor: { x: number; y: number; w: number; h: number };
  /** 屏幕朝向：永远与 `DeskInstance.facing`（入座者面朝方向）一致 */
  screen: DeskScreenSide;
  /**
   * 桌面陈设的落点：绿植中心 x、马克杯左上 x、便签左上 x。
   * 左右朝向时显示器会占到桌角，陈设各自让开一格，避免叠在一起。
   */
  details: { plantCx: number; mugX: number; noteX: number };
}

/** 人朝北（椅子在桌南）：显示器在桌子的北边，屏幕朝镜头，与实装前的唯一画法一致 */
const FACING_UP_ART: DeskArt = {
  monitor: { x: 32, y: 2, w: 32, h: 22 },
  screen: 'front',
  details: { plantCx: 14, mugX: 70, noteX: 53 },
};

/** 人朝南（椅子在桌北）：显示器在桌子的南边，屏幕朝北，镜头只看到背壳 */
const FACING_DOWN_ART: DeskArt = {
  monitor: { x: 32, y: 28, w: 32, h: 20 },
  screen: 'back',
  details: { plantCx: 14, mugX: 70, noteX: 66 },
};

/** 人朝西（椅子在桌东）：显示器在桌子的东端，屏幕朝东对着人，镜头看到侧视 */
const FACING_LEFT_ART: DeskArt = {
  monitor: { x: 74, y: 26, w: 12, h: 22 },
  screen: 'east',
  details: { plantCx: 14, mugX: 44, noteX: 53 },
};

/** 人朝东（椅子在桌西）：显示器在桌子的西端，屏幕朝西对着人（绿植让到桌子中段） */
const FACING_RIGHT_ART: DeskArt = {
  monitor: { x: 10, y: 26, w: 12, h: 22 },
  screen: 'west',
  details: { plantCx: 34, mugX: 70, noteX: 53 },
};

/**
 * 入座朝向 → 桌子贴图几何。
 *
 * `facing` 是「入座者面朝的方向」，也是 `DeskInstance.facing`：
 * 屏幕永远朝这个人，所以显示器落在桌子的另一侧。
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
