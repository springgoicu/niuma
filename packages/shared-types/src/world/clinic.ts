/**
 * 护士急救站（ADR-0084 / ADR-0092 / ADR-0097）：服务区广场东北角的独立小楼。
 *
 * 从 `layout.ts` 单独拆出来，是为了让 `districts.ts` 能读到它的矩形而不与
 * 布局总装互相引用：区 / 场所注册表只依赖各场所模块，`layout.ts` 只做汇总。
 *
 * 坐标全部由 `CLINIC_RECT` 派生，改原地只改这一个矩形。
 */

import type { SolidRect } from './campus';
import type { WorldRect } from './geometry';

/** 站台本体：柜台在西、病床在东、救护车位在门前南侧 */
export const CLINIC_RECT: WorldRect = { x: 5060, y: 3660, w: 248, h: 210 };

/** 区域名矩形：站台外扩 10px，围栏也算「站在急救站」 */
export const CLINIC_REGION_RECT: WorldRect = { x: 4960, y: 3640, w: 268, h: 250 };

/** 从服务广场接进站内的无障碍铺装（高度与西侧人行门洞等宽，ADR-0092） */
export const CLINIC_ACCESS_PAVING: WorldRect = { x: 4960, y: 3722, w: 100, h: 56 };

export const CLINIC_COUNTER: WorldRect = {
  x: CLINIC_RECT.x + 12,
  y: CLINIC_RECT.y + 18,
  w: 112,
  h: 30,
};

/** 立牌：脚底贴在北侧围挡外沿，不插进栏杆 */
export const CLINIC_SIGN = { x: CLINIC_RECT.x + 6, y: CLINIC_RECT.y - 44 } as const;

export const CLINIC_NURSE_SPOTS = [
  { x: CLINIC_RECT.x + 44, y: CLINIC_RECT.y + 12 },
  { x: CLINIC_RECT.x + 92, y: CLINIC_RECT.y + 12 },
] as const;

export const CLINIC_BEDS = [
  { x: CLINIC_RECT.x + 84, y: CLINIC_RECT.y + 58, w: 68, h: 48 },
  { x: CLINIC_RECT.x + 172, y: CLINIC_RECT.y + 58, w: 68, h: 48 },
] as const;

/** 救护车停靠位（车体中心），站内的两个专用车位 */
export const CLINIC_AMBULANCE_SPOTS = [
  { x: CLINIC_RECT.x + 56, y: CLINIC_RECT.y + 182 },
  { x: CLINIC_RECT.x + 128, y: CLINIC_RECT.y + 182 },
] as const;

/** 救护车抵达后把伤员放下的站内落点 */
export const CLINIC_DROP = { x: CLINIC_RECT.x + 30, y: CLINIC_RECT.y + 120 } as const;

/** 南侧救护车通道口东沿：车位线最东到 x+164、车体最东到 x+160，再留 10px */
const CLINIC_VEHICLE_GAP_RIGHT = CLINIC_RECT.x + 170;

/** 救护车进站航点：通道口正南，站内伤员先到这里再直插站心（ADR-0092） */
export const CLINIC_VEHICLE_ENTRY = { x: CLINIC_RECT.x + 80, y: CLINIC_RECT.y + 242 } as const;

/**
 * 护士站围挡（ADR-0092）：北、东、西三面栏杆 + 西侧 56px 人行门 + 南侧救护车通道。
 *
 * 几何由 `CLINIC_RECT` 向外扩 10px 派生（栏杆站在铺装外沿，不压地砖），
 * 厚度与擂台围栏同口径。人行门洞与 `CLINIC_ACCESS_PAVING` 等高对齐，铺装直接接到门口；
 * 南面 x 5050–5230 敞开，两辆车从车位直奔南侧广场的直线都落在这一段内，
 * 救护车不会被自己的围栏挡住。
 */
export const CLINIC_FENCE_SOLIDS: ReadonlyArray<SolidRect> = (() => {
  const thickness = 10;
  const { x, y, w, h } = CLINIC_RECT;
  const right = x + w;
  const bottom = y + h;
  const gateTop = CLINIC_ACCESS_PAVING.y;
  const gateBottom = gateTop + CLINIC_ACCESS_PAVING.h;
  return [
    // 北面：整段封闭，护士站位与栏杆之间还留 12px
    { kind: 'wall' as const, x: x - thickness, y: y - thickness, w: w + thickness * 2, h: thickness },
    // 东面：整段封闭
    { kind: 'wall' as const, x: right, y, w: thickness, h },
    // 西面：人行门洞上下两段
    { kind: 'wall' as const, x: x - thickness, y, w: thickness, h: gateTop - y },
    { kind: 'wall' as const, x: x - thickness, y: gateBottom, w: thickness, h: bottom - gateBottom },
    // 南面：只封东南角，西侧整段敞开作救护车通道
    {
      kind: 'wall' as const,
      x: CLINIC_VEHICLE_GAP_RIGHT,
      y: bottom,
      w: right - CLINIC_VEHICLE_GAP_RIGHT,
      h: thickness,
    },
  ];
})();
