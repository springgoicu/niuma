import { MOVE_SPEED, NAV_TARGETS, type NavTarget } from '@niuma/shared-types';

/**
 * 园区导览的纯计算层（ADR-0036）：世界指路牌、HUD 导览卡与测试共用。
 *
 * 数据只有一份 `NAV_TARGETS`（shared-types 由房间矩形中心派生），
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

/** 一次算出四个目标的读数，顺序与 `NAV_TARGETS` 一致 */
export function navReadings(x: number, y: number): NavReading[] {
  return NAV_TARGETS.map((target) => {
    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);
    return {
      target,
      distance,
      seconds: Math.max(1, Math.round(distance / MOVE_SPEED)),
      octant: octantOf(dx, dy),
      bearingDeg: bearingDegOf(dx, dy),
    };
  });
}

/** 最近的目标：并列时按 NAV_TARGETS 的顺序取第一个，结果稳定 */
export function nearestReading(readings: readonly NavReading[]): NavReading | null {
  let best: NavReading | null = null;
  for (const reading of readings) {
    if (!best || reading.distance < best.distance) best = reading;
  }
  return best;
}
