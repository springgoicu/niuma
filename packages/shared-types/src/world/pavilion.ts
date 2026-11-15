/**
 * 摸鱼亭（ADR-0061 / ADR-0077）：摸鱼湖北岸的八角重檐凉亭。
 *
 * 从 `layout.ts` 单独拆出来，理由与 `clinic.ts` 相同：`districts.ts` 要读到亭子的
 * 占地矩形，而布局总装又要读 districts；把场所常量留在独立模块，依赖只有一个方向。
 *
 * 坐标只在这里写一次：亭柱、供案、石鼓凳的渲染、碰撞、交互与布局测试全部派生。
 */

import { DIRECTION } from '../constants';
import type { Point, WorldRect } from './geometry';
import type { SeatInstance, SolidRect } from './campus';

/**
 * 亭子整体占地：`x` 是横向中心，`y` 是底座南沿（脚底 y），
 * 宽高是含飞檐外挑的整体包围盒。
 */
export const MOPING_PAVILION = { x: 5350, y: 4890, width: 200, height: 180 } as const;

/** 亭心：汉白玉石桌落在这里，四张石鼓凳绕它一圈 */
export const PAVILION_CENTER = {
  x: MOPING_PAVILION.x,
  y: MOPING_PAVILION.y - MOPING_PAVILION.height / 2,
} as const;

/**
 * 八根朱红廊柱相对亭心的偏移：45° 一圈的整数化坐标，半径约 88。
 * 手写而不是 Math.cos/sin —— 两端浮点结果可能差 1px，地图会各画各的。
 */
export const PAVILION_COLUMN_OFFSETS: ReadonlyArray<Point> = [
  [82, 34],
  [34, 82],
  [-34, 82],
  [-82, 34],
  [-82, -34],
  [-34, -82],
  [34, -82],
  [82, -34],
];

/** 亭柱碰撞：八根 12×10 的柱子；亭心留空，人能走进去坐下 */
export const MOPING_PAVILION_SOLIDS: ReadonlyArray<SolidRect> = PAVILION_COLUMN_OFFSETS.map(
  ([dx, dy]) => ({
    kind: 'prop',
    x: PAVILION_CENTER.x + dx - 6,
    y: PAVILION_CENTER.y + dy - 5,
    w: 12,
    h: 10,
  }),
);

/**
 * 石鼓凳相对亭心的偏移（四个方向各一张，间距 80）。
 * 全部面朝南——湖在亭子南侧，「坐下即观湖沉思」靠朝向而不是另设姿态。
 */
const PAVILION_SEAT_RING = 40;

export const PAVILION_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  {
    x: PAVILION_CENTER.x - PAVILION_SEAT_RING,
    y: PAVILION_CENTER.y,
    facing: DIRECTION.Down,
    kind: 'drum',
  },
  { x: PAVILION_CENTER.x, y: PAVILION_CENTER.y - PAVILION_SEAT_RING, facing: DIRECTION.Down, kind: 'drum' },
  { x: PAVILION_CENTER.x + PAVILION_SEAT_RING, y: PAVILION_CENTER.y, facing: DIRECTION.Down, kind: 'drum' },
  { x: PAVILION_CENTER.x, y: PAVILION_CENTER.y + PAVILION_SEAT_RING, facing: DIRECTION.Down, kind: 'drum' },
];

/** 亭内汉白玉石桌：亭心一张，本体由 `pavilion.ts` 绘制，碰撞在布局层单独登记 */
export const PAVILION_TABLE = { x: PAVILION_CENTER.x, y: PAVILION_CENTER.y, radius: 22 } as const;

/** 亭子的整体占地矩形（y 是底座南沿）：种树留白与区域名共用 */
export const PAVILION_RECT: WorldRect = {
  x: MOPING_PAVILION.x - MOPING_PAVILION.width / 2,
  y: MOPING_PAVILION.y - MOPING_PAVILION.height,
  w: MOPING_PAVILION.width,
  h: MOPING_PAVILION.height,
};

/** 亭内石桌的贴地碰撞：只挡圆桌那一圈 */
export const PAVILION_TABLE_SOLID: SolidRect = {
  kind: 'prop',
  x: PAVILION_TABLE.x - PAVILION_TABLE.radius,
  y: PAVILION_TABLE.y - PAVILION_TABLE.radius / 2,
  w: PAVILION_TABLE.radius * 2,
  h: PAVILION_TABLE.radius,
};
