/**
 * 河道几何：把「中心线 + 河宽」展开成左右岸与闭合水面多边形。
 *
 * 三条纪律与 layout.ts 一致：
 * 1) 只用 + - * / 与 Math.sqrt（IEEE-754 正确舍入），禁止 Math.sin / Math.cos / Math.random，
 *    否则 Bun(JSC) 与浏览器(V8) 的末位差异会让双端各画一条河；
 * 2) 所有输出取整到像素栅格，水面宽度靠 miter 偏移守住；
 * 3) 只产出几何，不依赖 Pixi / DOM —— 碰撞、主视图、小地图共用同一份结果。
 */

import { polygonBounds, type Point, type WorldRect } from './geometry';

export interface RiverShape {
  /** 闭合水面多边形：碰撞、水面遮罩与小地图的唯一来源 */
  readonly polygon: Point[];
  /** 顺流方向左侧岸线（开口，不闭合），只用于画沙滩 */
  readonly leftBank: Point[];
  /** 顺流方向右侧岸线（开口，不闭合），只用于画沙滩 */
  readonly rightBank: Point[];
  /** 中心线站点，供取样、测试与后续支流扩展 */
  readonly centerline: Point[];
  /** 包围盒：平铺水面与网格索引 */
  readonly rect: WorldRect;
}

/** 方向向量长度小于它就算原地重复站点，不再求法线 */
const EPSILON = 0.001;
/** 斜接点与两侧法线的最小点积：低于它说明接近折返，退回单侧法线 */
const MIN_MITER_DOT = 0.25;
/** 斜接长度上限（相对半河宽）：弯再急也不让岸线扎出长刺 */
const MAX_MITER_SCALE = 2.4;

function unitVector(dx: number, dy: number): Point {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < EPSILON) return [0, 1];
  return [dx / length, dy / length];
}

/**
 * 顺流方向的左侧法线。
 * 屏幕坐标 y 向下，朝下行进时左手边是 +x（东岸）。
 */
function leftNormal(ux: number, uy: number): Point {
  return [uy, -ux];
}

function pushUnique(points: Point[], x: number, y: number): void {
  const last = points[points.length - 1];
  if (last && last[0] === x && last[1] === y) return;
  points.push([x, y]);
}

/**
 * 用站点中心线与半河宽生成河道。
 *
 * 每个站点取相邻两段法线的角平分线（miter），偏移量按 `halfWidth / dot` 放大：
 * 外弯两侧岸线仍然严丝合缝，内弯不会各自独立偏移后交叉。
 */
export function buildRiver(stations: ReadonlyArray<Point>, halfWidth: number): RiverShape {
  if (stations.length < 2) throw new Error('河道至少需要两个站点');
  if (!(halfWidth > 0)) throw new Error('半河宽必须为正数');

  const count = stations.length;
  const tangents: Point[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const from = stations[i]!;
    const to = stations[i + 1]!;
    tangents.push(unitVector(to[0] - from[0], to[1] - from[1]));
  }

  const leftBank: Point[] = [];
  const rightBank: Point[] = [];

  for (let i = 0; i < count; i += 1) {
    const [cx, cy] = stations[i]!;
    let offsetX: number;
    let offsetY: number;

    if (i === 0 || i === count - 1) {
      // 河口：只认唯一相邻段，端面垂直于水流，出海处是一刀平的切口
      const tangent = tangents[i === 0 ? 0 : count - 2]!;
      const [nx, ny] = leftNormal(tangent[0], tangent[1]);
      offsetX = nx * halfWidth;
      offsetY = ny * halfWidth;
    } else {
      const [ax, ay] = tangents[i - 1]!;
      const [bx, by] = tangents[i]!;
      const [n1x, n1y] = leftNormal(ax, ay);
      const [n2x, n2y] = leftNormal(bx, by);

      let mx = n1x + n2x;
      let my = n1y + n2y;
      const miterLength = Math.sqrt(mx * mx + my * my);

      if (miterLength < EPSILON) {
        offsetX = n1x * halfWidth;
        offsetY = n1y * halfWidth;
      } else {
        mx /= miterLength;
        my /= miterLength;
        const dot = Math.max(mx * n1x + my * n1y, MIN_MITER_DOT);
        const scale = Math.min(halfWidth / dot, halfWidth * MAX_MITER_SCALE);
        offsetX = mx * scale;
        offsetY = my * scale;
      }
    }

    pushUnique(leftBank, Math.round(cx + offsetX), Math.round(cy + offsetY));
    // 右岸单独去重：与左岸的重复点不需要同步，闭合成多边形时再统一处理
    const rightX = Math.round(cx - offsetX);
    const rightY = Math.round(cy - offsetY);
    const lastRight = rightBank[rightBank.length - 1];
    if (!lastRight || lastRight[0] !== rightX || lastRight[1] !== rightY) rightBank.push([rightX, rightY]);
  }

  // 左岸顺流而下，右岸逆流而回，首尾自然收成一个闭合多边形
  const polygon: Point[] = [];
  for (const point of leftBank) pushUnique(polygon, point[0], point[1]);
  for (let i = rightBank.length - 1; i >= 0; i -= 1) {
    const point = rightBank[i]!;
    pushUnique(polygon, point[0], point[1]);
  }
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (polygon.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) polygon.pop();

  return {
    polygon,
    leftBank,
    rightBank,
    centerline: stations.map(([x, y]) => [x, y] as Point),
    rect: polygonBounds(polygon),
  };
}
