import {
  DISTRICTS,
  MOVE_SPEED,
  NAV_TARGETS,
  PLAZA_HOME,
  SPAWN_CENTER,
  type DistrictSpec,
  type NavTarget,
} from '@niuma/shared-types';

/**
 * 园区导览的纯计算层（ADR-0036 / ADR-0097）：世界指路牌、HUD 导览卡与测试共用。
 *
 * 数据只有一份：场所读数来自 `NAV_TARGETS`，区门读数来自 `DISTRICTS`。
 * 这里只做「从某点到目标」的方位、距离与步行秒数，不碰渲染也不碰 DOM。
 */

/** 八向：0 = 北，顺时针（北 / 东北 / 东 / 东南 / 南 / 西南 / 西 / 西北） */
export type NavOctant = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const OCTANT_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;

export interface NavReading {
  target: NavTarget;
  /** 直线距离（世界像素） */
  distance: number;
  /** 按 MOVE_SPEED 折算的步行秒数，至少 1 秒 */
  seconds: number;
  /** 八向档位，供世界指路牌的像素箭头使用 */
  octant: NavOctant;
  /**
   * 从北起顺时针的方位角（度），可直接拿去旋转一个朝上的箭头。
   * 屏幕坐标 y 向下，所以东是 90°、南是 180°、西是 270°。
   */
  bearingDeg: number;
}

/** 一座区门的读数：世界指路牌只列这五块（ADR-0097） */
export interface DistrictReading {
  district: DistrictSpec;
  distance: number;
  seconds: number;
  octant: NavOctant;
  bearingDeg: number;
}

/** 把屏幕向量收进八向档位；零向量按「北」处理 */
export function octantOf(dx: number, dy: number): NavOctant {
  if (dx === 0 && dy === 0) return 0;
  const angle = Math.atan2(dx, -dy);
  const index = Math.round(angle / (Math.PI / 4));
  return (((index % 8) + 8) % 8) as NavOctant;
}

/** 从北起顺时针的方位角（度） */
export function bearingDegOf(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return angle < 0 ? angle + 360 : angle;
}

function readingOf(x: number, y: number, tx: number, ty: number) {
  const dx = tx - x;
  const dy = ty - y;
  const distance = Math.hypot(dx, dy);
  return {
    distance,
    seconds: Math.max(1, Math.round(distance / MOVE_SPEED)),
    octant: octantOf(dx, dy),
    bearingDeg: bearingDegOf(dx, dy),
  };
}

/** 一次算出所有场所目标的读数，顺序与 `NAV_TARGETS` 一致 */
export function navReadings(x: number, y: number): NavReading[] {
  return NAV_TARGETS.map((target) => ({
    target,
    ...readingOf(x, y, target.x, target.y),
  }));
}

/** 一次算出五座区门的读数，顺序与 `DISTRICTS` 一致 */
export function districtReadings(x: number, y: number): DistrictReading[] {
  return DISTRICTS.map((district) => ({
    district,
    ...readingOf(x, y, district.gate.x, district.gate.y),
  }));
}

/** 最近的目标：并列时按 NAV_TARGETS 的顺序取第一个，结果稳定 */
export function nearestReading(readings: readonly NavReading[]): NavReading | null {
  let best: NavReading | null = null;
  for (const reading of readings) {
    if (!best || reading.distance < best.distance) best = reading;
  }
  return best;
}

/** 「回中央广场」的读数：广场不是场所，所以单独给一条，字段与场所读数一致 */
export interface PlazaReading {
  readonly name: string;
  readonly distance: number;
  readonly seconds: number;
  readonly octant: NavOctant;
  readonly bearingDeg: number;
}

/** 到出生点（广场正中）的方位与步行秒数 */
export function plazaReading(x: number, y: number): PlazaReading {
  return { name: PLAZA_HOME.name, ...readingOf(x, y, SPAWN_CENTER.x, SPAWN_CENTER.y) };
}

/** 场景徽标文案：导览卡与工牌共用一套说法 */
export function sceneLabel(scene: NavTarget['scene']): string {
  return scene === 'indoor' ? '室内' : scene === 'semi' ? '半开敞' : '室外';
}
