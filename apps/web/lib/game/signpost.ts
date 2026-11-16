import { districtReadings, type NavOctant } from './nav';

/**
 * 世界指路牌的纯计算层（ADR-0036 / ADR-0077 / ADR-0097）：牌面列哪几块、每块落在哪里。
 *
 * 这里不碰 Pixi，也不持有第二份目的地清单：牌面只列**五座区门**（`DISTRICTS`），
 * 区内场所交给 HUD 导览卡。删一座区只会少一块牌，不会让箭头静默指北。
 */

/** 单块目的地牌的行高：96×120 画布上 13px 刚好放下箭头与 8px 汉字（ADR-0089） */
export const SIGN_PLATE_ROW = 13;

/** 标题牌「园区导览」占 0–14，目的地牌从 16 起 */
const PLATE_TOP = 16;
/** 底牌「你在这里」占最下面 10px */
const PLATE_BOTTOM = 10;

export interface SignPlate {
  readonly label: string;
  readonly octant: NavOctant;
  /** 牌面在烘焙画布上的上沿；绘制与文字叠层共用同一份 */
  readonly top: number;
  /** 区色书脊：与 `DISTRICTS` 同一份色，HUD 导览卡的区组标题也用它 */
  readonly color: number;
}

/**
 * 第 `index` 块目的地牌的上沿。`count` 块整体在标题牌与底牌之间垂直居中，
 * 五座区门（5 块）不会被顶到标题下面、也不会压住「你在这里」。
 *
 * 超过画布容量（`count * 13 > 可用高度`，96×120 下是 6 块）时退回顶对齐：
 * 宁可让多出来的牌被画布裁掉，也不把已列的目标挤到看不清。
 */
export function signPlateTop(index: number, count: number, height: number): number {
  const span = Math.max(0, height - PLATE_BOTTOM - PLATE_TOP);
  const used = count * SIGN_PLATE_ROW;
  const offset = used >= span ? 0 : Math.round((span - used) / 2);
  return PLATE_TOP + offset + Math.max(0, index) * SIGN_PLATE_ROW;
}

/**
 * 牌面目的地：五座区门，顺序与 `DISTRICTS` 一致，箭头按真实方位现算。
 * `color` 直接取 `DISTRICTS[].color`，牌面书脊因此与小地图区色、
 * HUD 导览卡组标题是同一种颜色——指路牌不再只有「薄荷绿一种箭头」。
 */
export function signPlates(x: number, y: number, height: number): SignPlate[] {
  const readings = districtReadings(x, y);
  return readings.map((reading, index) => ({
    label: reading.district.name,
    octant: reading.octant,
    top: signPlateTop(index, readings.length, height),
    color: reading.district.color,
  }));
}
