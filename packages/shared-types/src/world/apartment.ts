/**
 * 牛马公寓（APARTMENT）：园区生活区的一栋公寓楼，门牌 301。
 *
 * 这里的公寓只有一件事：门口按 F，人就不在了，改从这栋楼的一个**空闲窗口**探头；
 * 任意时刻再按 F 回到门口台阶。楼内没有可走的空间，所以楼体是一整块实心碰撞，
 * 服务端只记「谁在哪个窗口」，客户端照着窗口表画头与亮窗。
 *
 * 窗口表是唯一真相：`drawFacade` 画窗框、服务端分配窗口、探头定位全部读
 * `APARTMENT_WINDOWS`，改一个数不会三方不一致。
 *
 * ADR-0095 曾定下六栋楼绕广场铺开；ADR-0098 把室内房间与家具撤掉，改成窗口探头；
 * ADR-0101 收敛回唯一一栋，腾出的空地留成门前口袋花园（纯装饰、零碰撞）。
 */

import type { SolidRect } from './campus';
import type { WorldRect } from './geometry';

/** 楼体统一尺寸：外立面按这个尺寸等比排窗 */
export const APARTMENT_W = 300;
export const APARTMENT_H = 240;

/** 门口感应半径（屋外，按下进屋） */
export const APARTMENT_DOOR_RANGE = 64;

/** 门牌号基数：301（唯一一栋门牌） */
export const APARTMENT_DOOR_BASE = 301;

/** 立面窗格：4 层 × 5 列，每栋 20 个窗口，一个窗口只站一个人 */
export const APARTMENT_WINDOW_ROWS = 4;
export const APARTMENT_WINDOW_COLS = 5;
export const APARTMENT_WINDOW_COUNT = APARTMENT_WINDOW_ROWS * APARTMENT_WINDOW_COLS;
/** 窗格高（外立面像素）：头就从这个洞里探出来 */
export const APARTMENT_WINDOW_H = 22;

/** 楼层带高：与门厅招牌（56px）以下的立面等分 */
const FACADE_BAND_STEP = Math.round((APARTMENT_H - 56) / APARTMENT_WINDOW_ROWS);
/** 窗格横向步进：两侧各留 17px 外墙 */
const FACADE_WINDOW_STEP = Math.round((APARTMENT_W - 34) / APARTMENT_WINDOW_COLS);
/** 窗格宽：左右各留 15px 窗柱 */
const FACADE_WINDOW_W = Math.max(16, FACADE_WINDOW_STEP - 30);

/** 一个窗口：外立面上的一个洞，也是一个人探头的位置 */
export interface ApartmentWindow {
  /** 0..19，协议里 `window` 字段就是这个编号；按「从下往上、从左往右」排 */
  readonly index: number;
  readonly floor: number;
  readonly column: number;
  /** 世界坐标矩形：画窗框、亮窗、遮罩、探头锚点共用这一份，别处不许再算一遍 */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 探头锚点：窗口中心（头的落点） */
  readonly cx: number;
  readonly cy: number;
}

export interface ApartmentSpec {
  /** 0（唯一一栋），同时是 `Player.roomId - 1` */
  readonly slot: number;
  /** 门牌号 301 */
  readonly doorNo: number;
  /** 楼体（整块实心） */
  readonly rect: WorldRect;
  /** 门口感应点：南墙外侧 */
  readonly door: { readonly x: number; readonly y: number };
  readonly doorRange: number;
  /** 出门落点：门口台阶 */
  readonly outside: { readonly x: number; readonly y: number };
  /** 该栋的 20 个窗口 */
  readonly windows: ReadonlyArray<ApartmentWindow>;
}

/**
 * 唯一一栋楼的落点：生活区西排，避开四角院落、游乐园、赌场、急救站、两栋小院、
 * 影音室、小黑屋、南院、八角笼、发泄区、三湖、摸鱼亭、主路与各支路（布局测试钉死）。
 * 坐标手写、禁随机：两端必须逐像素一致。
 */
const APARTMENT_RECTS: ReadonlyArray<WorldRect> = [
  // 301 生活区西排
  { x: 3200, y: 4680, w: APARTMENT_W, h: APARTMENT_H },
];

/** 楼栋数：只留 301 一栋，`slot` 恒为 0 */
export const APARTMENT_ROOM_COUNT = APARTMENT_RECTS.length;

/**
 * 门前口袋花园：撤掉五栋后留下的空地，纯装饰、零碰撞（ADR-0101）。
 *
 * 北沿咬住 301 楼体南墙外 16px，南沿停在生活大街路缘上方 8px，
 * 西沿与楼体齐平，东沿离南向主路路缘 20px。石板小径与灌木都落在这块地里。
 */
export const APARTMENT_GARDEN: WorldRect = { x: 3200, y: 4936, w: 820, h: 356 };

/** 花园石板小径：门口台阶 → 生活大街，32px 宽、整数纹素，中线对齐 301 门牌 */
export const APARTMENT_GARDEN_PATH: WorldRect = { x: 3334, y: 4952, w: 32, h: 340 };

/**
 * 世界坐标窗口表：下标 = slot，内层下标 = 窗口编号 0..19。
 *
 * 编号从**底层**开始往上排（0 号是一楼最左边那个窗）：先进屋的人占最靠近门口的
 * 那一排，抬头就能从街上看见谁在家。
 */
function buildWindows(rect: WorldRect): ReadonlyArray<ApartmentWindow> {
  const out: ApartmentWindow[] = [];
  for (let floor = 0; floor < APARTMENT_WINDOW_ROWS; floor += 1) {
    for (let column = 0; column < APARTMENT_WINDOW_COLS; column += 1) {
      const x = rect.x + 18 + column * FACADE_WINDOW_STEP;
      const y = rect.y + 18 + (APARTMENT_WINDOW_ROWS - 1 - floor) * FACADE_BAND_STEP;
      out.push({
        index: out.length,
        floor,
        column,
        x,
        y,
        w: FACADE_WINDOW_W,
        h: APARTMENT_WINDOW_H,
        cx: x + FACADE_WINDOW_W / 2,
        cy: y + APARTMENT_WINDOW_H / 2,
      });
    }
  }
  return out;
}

/** 唯一一栋公寓楼：下标即 slot（恒为 0） */
export const APARTMENT_SPECS: ReadonlyArray<ApartmentSpec> = APARTMENT_RECTS.map((rect, slot) => {
  const doorX = rect.x + rect.w / 2;
  return {
    slot,
    doorNo: APARTMENT_DOOR_BASE + slot,
    rect,
    door: { x: doorX, y: rect.y + rect.h + 24 },
    doorRange: APARTMENT_DOOR_RANGE,
    outside: { x: doorX, y: rect.y + rect.h + 50 },
    windows: buildWindows(rect),
  };
});

/** slot → 该栋 20 个窗口 */
export const APARTMENT_WINDOWS: ReadonlyArray<ReadonlyArray<ApartmentWindow>> = APARTMENT_SPECS.map(
  (spec) => spec.windows,
);

/** 楼体碰撞：整块实心（楼里进不去了，只有窗口探头） */
export const APARTMENT_WALL_SOLIDS: ReadonlyArray<SolidRect> = APARTMENT_SPECS.map((spec) => ({
  kind: 'wall' as const,
  x: spec.rect.x,
  y: spec.rect.y,
  w: spec.rect.w,
  h: spec.rect.h,
}));

export function doorNoOf(slot: number): number {
  return APARTMENT_DOOR_BASE + Math.max(0, Math.min(APARTMENT_ROOM_COUNT - 1, slot));
}

/** slot → 规格；越界夹回 0 */
export function apartmentBySlot(slot: number): ApartmentSpec {
  const index = Number.isFinite(slot)
    ? Math.max(0, Math.min(APARTMENT_ROOM_COUNT - 1, Math.floor(slot)))
    : 0;
  return APARTMENT_SPECS[index] ?? APARTMENT_SPECS[0]!;
}

/** 门牌号 301 → 规格；其余门牌返回 undefined */
export function apartmentByDoorNo(doorNo: number): ApartmentSpec | undefined {
  if (!Number.isFinite(doorNo)) return undefined;
  const slot = Math.floor(doorNo) - APARTMENT_DOOR_BASE;
  if (slot < 0 || slot >= APARTMENT_ROOM_COUNT) return undefined;
  return APARTMENT_SPECS[slot];
}

/** 取某个窗口：越界返回 undefined（协议里的 window 字段不可信） */
export function apartmentWindowAt(slot: number, window: number): ApartmentWindow | undefined {
  if (!Number.isFinite(window)) return undefined;
  const index = Math.floor(window);
  if (index < 0 || index >= APARTMENT_WINDOW_COUNT) return undefined;
  return APARTMENT_WINDOWS[Math.max(0, Math.min(APARTMENT_ROOM_COUNT - 1, slot))]?.[index];
}
