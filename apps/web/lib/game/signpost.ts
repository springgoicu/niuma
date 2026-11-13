import { navReadings, type NavOctant } from './nav';

/**
 * 世界指路牌的纯计算层（ADR-0036 / ADR-0077）：牌面列哪几块、每块落在哪里。
 *
 * 这里不碰 Pixi，也不持有第二份目的地清单：目的地从 `NAV_TARGETS` 派生，
 * 只保留园区级（`area === 'grounds'`）目标——室内目标交给 HUD 导览卡。
 * 曾经手写的五条 id 清单删掉后，删目标只会少一块牌，不会让箭头静默指北。
 */

/** 单块目的地牌的行高：96×92 画布上 13px 刚好放下箭头与 8px 汉字 */
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
}

/**
 * 第 `index` 块目的地牌的上沿。`count` 块整体在标题牌与底牌之间垂直居中，
 * 3 块不会被顶到标题下面、也不会压住「你在这里」。
 *
 * 超过画布容量（`count * 13 > 可用高度`）时退回顶对齐：宁可让多出来的牌
 * 被画布裁掉，也不把已列的目标挤到看不清。
 */
export function signPlateTop(index: number, count: number, height: number): number {
  const span = Math.max(0, height - PLATE_BOTTOM - PLATE_TOP);
  const used = count * SIGN_PLATE_ROW;
  const offset = used >= span ? 0 : Math.round((span - used) / 2);
  return PLATE_TOP + offset + Math.max(0, index) * SIGN_PLATE_ROW;
}

/** 牌面目的地：园区级目标，顺序与 `NAV_TARGETS` 一致，箭头按真实方位现算 */
export function signPlates(x: number, y: number, height: number): SignPlate[] {
  const grounds = navReadings(x, y).filter((reading) => reading.target.area === 'grounds');
  return grounds.map((reading, index) => ({
    label: reading.target.name,
    octant: reading.octant,
    top: signPlateTop(index, grounds.length, height),
  }));
}
