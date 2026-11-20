/**
 * 有机岛屿边界与陆地判定：服务端碰撞、客户端岸线纹理、林缘封边与小地图共用唯一真相。
 *
 * 29 顶点多半岛多海湾顺时针轮廓（屏幕坐标 y 向下）：
 * - 打破旧版「四角直边大矩形」的单调轮廓，形成北游乐岬、东北沉思角、
 *   东急救半岛、东南摸鱼岬、南生活长滩、西南涟漪湾与西岸景观岬；
 * - 相邻转角保持钝角过渡（>=140° 内角），确保海岸沙滩向内等距收缩
 *   `ISLAND_SAND = 26` 时不产生折角自交；
 * - 零 Math.random / Math.sin / Math.cos，保证双端位一致。
 */

import { distanceSqToPolygon, pointInPolygon, polygonBounds, type Point, type WorldRect } from './geometry';

/** 海岸沙滩装饰带宽：从多边形海岸向内铺一条，玩家碰撞内缘正好贴在沙滩线内侧 */
export const ISLAND_SAND = 26;

/**
 * 29 顶点顺时针有机岛屿轮廓：
 * 包围盒 x: 2340..5780 (w=3440), y: 2260..5940 (h=3680)，以 (4096, 4096) 为岛心平衡舒展。
 */
export const ISLAND_POINTS: ReadonlyArray<Point> = [
  [2560, 2620], // 0  西北不夜城北肩
  [2880, 2440], // 1  西北斜岸
  [3260, 2360], // 2  西北湾唇
  [3640, 2300], // 3  北游乐西翼
  [4020, 2260], // 4  北游乐岬顶
  [4440, 2280], // 5  北岬东脊
  [4840, 2320], // 6  东北浅湾口
  [5240, 2380], // 7  东北茶院北坡
  [5580, 2560], // 8  东北沉思角肩
  [5720, 2880], // 9  沉思浅塘东岸
  [5660, 3260], // 10 东岸浅湾凹部
  [5720, 3620], // 11 急救半岛北肩
  [5740, 3960], // 12 急救半岛东端
  [5640, 4340], // 13 东南湾过渡
  [5700, 4740], // 14 摸鱼半岛北缘
  [5780, 5140], // 15 摸鱼角东峰
  [5700, 5560], // 16 摸鱼角南翼
  [5400, 5820], // 17 东南湾南岸
  [4940, 5900], // 18 南湾东曲
  [4460, 5940], // 19 南生活角东峰
  [3960, 5940], // 20 南生活角西峰
  [3460, 5900], // 21 南影音室南岸
  [2980, 5800], // 22 西南生活弯弧
  [2620, 5500], // 23 西南涟漪湾
  [2460, 5020], // 24 涟漪半岛西肩
  [2380, 4520], // 25 西南过渡浅湾
  [2340, 4020], // 26 西岸景观岬尖
  [2380, 3520], // 27 西企业楼西崖
  [2440, 2980], // 28 西北夜店西崖
];

export interface IslandShape {
  readonly points: Point[];
  /** 轴对齐包围盒，供相机夹取、网格尺寸与快速包围筛使用 */
  readonly bounds: WorldRect;
}

const MUTABLE_POINTS: Point[] = ISLAND_POINTS.map(([x, y]) => [x, y]);

export const ISLAND: IslandShape = {
  points: MUTABLE_POINTS,
  bounds: polygonBounds(MUTABLE_POINTS),
};

/** 世界有效陆地包围盒：边界之外是密林外海（视觉环岛森林，逻辑不可通行） */
export const WORLD_BOUNDS: WorldRect = ISLAND.bounds;

/** 完全位于多边形岛屿内部的内接参考安全矩形 */
export const ISLAND_SAFE_RECT: WorldRect = {
  x: 2740,
  y: 2620,
  w: 2680,
  h: 2920,
};

/**
 * 某点（及可选半径净空）是否完全落在有机多边形陆地上：
 * - 先做包围盒 O(1) 快速剪枝（零堆分配）；
 * - 再用射线奇偶判点确认在岛内；
 * - 若 radius > 0，还要求距岛屿岸线至少保持 `radius` 净空。
 */
export function isOnLand(x: number, y: number, radius = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return false;
  const inset = radius > 0 ? radius : 0;
  const { x: bx, y: by, w, h } = WORLD_BOUNDS;
  if (w <= inset * 2 || h <= inset * 2) return false;
  if (x <= bx + inset || x >= bx + w - inset || y <= by + inset || y >= by + h - inset) {
    return false;
  }
  if (!pointInPolygon(x, y, MUTABLE_POINTS)) return false;
  if (inset <= 0) return true;
  return distanceSqToPolygon(x, y, MUTABLE_POINTS) > inset * inset;
}
