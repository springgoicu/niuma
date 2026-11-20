/**
 * 护士急救站（现代三床大急诊大厅升级版）：服务区广场东北角的独立站区。
 *
 * 优化亮点：
 * 1. 全站由 248×210 拓宽为 320×250，彻底告别「18px 贴墙挤过柜台」的卡死痛点；
 * 2. 柜台后保留 **38px** 宽敞护士巡检走廊（`CLINIC_NURSE_SPOTS` y+19 两侧各留 ≥10px 余量）；
 * 3. 急诊病床扩容至 **3 张**，搭配东侧独立护理带；
 * 4. 取消健康玩家步行门禁（见 `clinic-gate.ts`），所有人都可以推门进来吹空调、
 *    慰问病友并在急诊咖啡台领取免费「孟婆续命咖啡」。
 */

import type { SolidRect } from './campus';
import type { WorldRect } from './geometry';

/** 站台本体：320×250，柜台在西、三病床在东、救护车双车位在西南敞口 */
export const CLINIC_RECT: WorldRect = { x: 5120, y: 3620, w: 320, h: 250 };

/** 区域名矩形：覆盖无障碍引道 + 站台外扩围栏 */
export const CLINIC_REGION_RECT: WorldRect = { x: 5040, y: 3600, w: 410, h: 290 };

/** 从服务广场接进站内的加宽无障碍铺装（高 68px，对齐西侧人行大门） */
export const CLINIC_ACCESS_PAVING: WorldRect = { x: 5050, y: 3706, w: 70, h: 68 };

/** 急诊导医台：留出柜台正北侧 38px 宽敞护士工作带 */
export const CLINIC_COUNTER: WorldRect = {
  x: CLINIC_RECT.x + 16,
  y: CLINIC_RECT.y + 38,
  w: 112,
  h: 28,
};

/** 急诊孟婆续命咖啡吧台点（柜台前方大厅内，玩家走近按 F 免费清除负面状态） */
export const CLINIC_COFFEE_SPOT = {
  x: CLINIC_RECT.x + 82,
  y: CLINIC_RECT.y + 84,
} as const;

/** 立牌：脚底贴在北侧围挡外沿 */
export const CLINIC_SIGN = { x: CLINIC_RECT.x + 8, y: CLINIC_RECT.y - 44 } as const;

/**
 * 护士站位：柜台正后方 38px 宽敞走廊正中（y + 19）。
 * 上沿 y+0（留 9px+ 半径净空）与下沿 y+38 柜台（留 9px+ 净空），移动零卡顿。
 */
export const CLINIC_NURSE_SPOTS = [
  { x: CLINIC_RECT.x + 48, y: CLINIC_RECT.y + 19 },
  { x: CLINIC_RECT.x + 98, y: CLINIC_RECT.y + 19 },
] as const;

/** 3 张现代急诊病床：北区并排 2 张 + 东区南侧 1 张 */
export const CLINIC_BEDS = [
  { x: CLINIC_RECT.x + 160, y: CLINIC_RECT.y + 38, w: 64, h: 46 },
  { x: CLINIC_RECT.x + 244, y: CLINIC_RECT.y + 38, w: 64, h: 46 },
  { x: CLINIC_RECT.x + 244, y: CLINIC_RECT.y + 110, w: 64, h: 46 },
] as const;

/** 救护车停靠位（车体中心），站内双专用车位 */
export const CLINIC_AMBULANCE_SPOTS = [
  { x: CLINIC_RECT.x + 58, y: CLINIC_RECT.y + 216 },
  { x: CLINIC_RECT.x + 138, y: CLINIC_RECT.y + 216 },
] as const;

/** 救护车抵达后把伤员放下的站内大厅落点 */
export const CLINIC_DROP = { x: CLINIC_RECT.x + 42, y: CLINIC_RECT.y + 148 } as const;

/** 幽灵超时未获救时的站外门口复活落点（西门无障碍铺装正中，绝不压碰撞） */
export const CLINIC_RESPAWN_POINT = {
  x: CLINIC_ACCESS_PAVING.x + 36,
  y: CLINIC_ACCESS_PAVING.y + Math.floor(CLINIC_ACCESS_PAVING.h / 2),
} as const;

/**
 * 护士巡检纵通道：柜台东沿（+128）与 1 号床头实心（+156）之间净宽 28px，取正中 +142。
 */
export const CLINIC_NURSE_LANE_X = CLINIC_RECT.x + 142;

/** 巡检横通道：位于前排病床以南 18px（y+102）或落点行（y+148） */
export const CLINIC_NURSE_LANE_Y = CLINIC_DROP.y;

/** 床侧站位：前两张床站南侧（y+102），三号床站西侧（x+224） */
export function clinicBedSide(index: number): { x: number; y: number } {
  const bed = CLINIC_BEDS[index];
  if (!bed) return CLINIC_NURSE_SPOTS[0];
  if (index === 2) {
    return { x: bed.x - 20, y: bed.y + bed.h / 2 };
  }
  return { x: bed.x + bed.w / 2, y: bed.y + bed.h + 18 };
}

/** 南侧救护车通道口东沿：双车位以东留出 188px 超宽敞开通道 */
const CLINIC_VEHICLE_GAP_RIGHT = CLINIC_RECT.x + 188;

/** 救护车进站航点：通道口正南（完全清出南广场） */
export const CLINIC_VEHICLE_ENTRY = { x: CLINIC_RECT.x + 98, y: CLINIC_RECT.y + 286 } as const;

/**
 * 护士站围挡：北、东、西三面栏杆 + 西侧 68px 开放人行大门 + 南侧 188px 救护车敞开通道。
 */
export const CLINIC_FENCE_SOLIDS: ReadonlyArray<SolidRect> = (() => {
  const thickness = 10;
  const { x, y, w, h } = CLINIC_RECT;
  const right = x + w;
  const bottom = y + h;
  const gateTop = CLINIC_ACCESS_PAVING.y;
  const gateBottom = gateTop + CLINIC_ACCESS_PAVING.h;
  return [
    // 北面：整段封闭
    { kind: 'wall' as const, x: x - thickness, y: y - thickness, w: w + thickness * 2, h: thickness },
    // 东面：整段封闭
    { kind: 'wall' as const, x: right, y, w: thickness, h },
    // 西面：人行门洞上下两段
    { kind: 'wall' as const, x: x - thickness, y, w: thickness, h: gateTop - y },
    { kind: 'wall' as const, x: x - thickness, y: gateBottom, w: thickness, h: bottom - gateBottom },
    // 南面：只封东南角（病房3下方），西侧 188px 整段敞开作救护车双向通道
    {
      kind: 'wall' as const,
      x: CLINIC_VEHICLE_GAP_RIGHT,
      y: bottom,
      w: right - CLINIC_VEHICLE_GAP_RIGHT,
      h: thickness,
    },
  ];
})();
