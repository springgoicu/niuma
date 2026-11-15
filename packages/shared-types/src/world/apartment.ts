/**
 * 牛马公寓（APARTMENT）：园区中心四周的六栋单户公寓楼，门牌 301–306 各一栋。
 *
 * 每栋楼是一间独立的「局部房间」：楼体矩形、四面墙、门口热区、室内落点与
 * 家具网格各自一套，都从 `APARTMENT_SPECS` 派生。`slot`（0..5）同时是
 * `Player.roomId - 1` 的房间频道下标——同频道的玩家互相可见，其余与屋外玩家
 * 互不可见（见 `sim/view.ts`）。移动、AOI、深度排序、相机跟随因此全部复用既有实现。
 *
 * 户型 0→3 复用经济档案里的 `houseTier`：纸箱 → 隔断 → 一居室 → 大平层，
 * 阶位决定可摆家具数量与地板配色。
 *
 * ADR-0095：公寓从「西南角一栋楼装 6 户」改为「六栋楼绕中央广场铺开」，
 * 楼体缩到 300×240（家具网格 6×4），协议与 `roomId` 语义不变。
 */

import type { SolidRect } from './campus';
import type { WorldRect } from './geometry';

/** 家具网格：6 列 × 4 行，格边 44px */
export const ROOM_GRID_COLS = 6;
export const ROOM_GRID_ROWS = 4;
export const ROOM_CELL = 44;
export const ROOM_CELL_COUNT = ROOM_GRID_COLS * ROOM_GRID_ROWS;

/** 墙厚：四面各 8px，室内 = 楼体内缩 8 */
const WALL = 8;

/** 楼体统一尺寸：室内 284×224，正好放下 6×4 的 44px 家具网格 */
export const APARTMENT_W = 300;
export const APARTMENT_H = 240;

/** 门口感应半径（屋外，按下进屋） */
export const APARTMENT_DOOR_RANGE = 64;
/** 屋内出口感应半径 */
export const APARTMENT_EXIT_RANGE = 56;

/** 房间频道数 = 楼栋数：一栋一户 */
export const APARTMENT_ROOM_COUNT = 6;
/** 门牌号基数：301–306 */
export const APARTMENT_DOOR_BASE = 301;

export interface ApartmentSpec {
  /** 0..5，同时是房间频道下标（`roomId - 1`） */
  readonly slot: number;
  /** 门牌号 301–306 */
  readonly doorNo: number;
  /** 楼体（含 8px 墙） */
  readonly rect: WorldRect;
  /** 室内可用矩形 */
  readonly interior: WorldRect;
  /** 四面墙的碰撞 */
  readonly wallSolids: ReadonlyArray<SolidRect>;
  /** 门口感应点：南墙外侧 */
  readonly door: { readonly x: number; readonly y: number };
  readonly doorRange: number;
  /** 室内落点：进屋后站在门厅，背对南墙 */
  readonly spawn: { readonly x: number; readonly y: number };
  /** 屋内出口热区心 */
  readonly exit: { readonly x: number; readonly y: number };
  readonly exitRange: number;
  /** 出门落点：门口台阶 */
  readonly outside: { readonly x: number; readonly y: number };
  /** 家具网格原点（左上格左上角） */
  readonly gridOrigin: { readonly x: number; readonly y: number };
}

/**
 * 六栋楼的落点：绕中央广场四向铺开，楼体之间留出 300px 级草地。
 *
 * 全部避开四角院落、游乐园、赌场、急救站、两栋小院、影音室、小黑屋、
 * 南院、八角笼、发泄区、三湖、摸鱼亭、主路与各支路（布局测试钉死）。
 * 坐标手写、禁随机：两端必须逐像素一致。
 */
const APARTMENT_RECTS: ReadonlyArray<WorldRect> = [
  // 301 生活区西北排
  { x: 3200, y: 4680, w: APARTMENT_W, h: APARTMENT_H },
  // 302 中排（与 301 同一排，中间留 40px 巷子）
  { x: 3540, y: 4680, w: APARTMENT_W, h: APARTMENT_H },
  // 303 东排：南向主路以东
  { x: 4240, y: 4680, w: APARTMENT_W, h: APARTMENT_H },
  // 304 第二排西
  { x: 3200, y: 5040, w: APARTMENT_W, h: APARTMENT_H },
  // 305 第二排中
  { x: 3540, y: 5040, w: APARTMENT_W, h: APARTMENT_H },
  // 306 第二排东
  { x: 4240, y: 5040, w: APARTMENT_W, h: APARTMENT_H },
];

function makeSpec(slot: number, rect: WorldRect): ApartmentSpec {
  const { x, y, w, h } = rect;
  const interior: WorldRect = { x: x + WALL, y: y + WALL, w: w - WALL * 2, h: h - WALL * 2 };
  const doorX = x + w / 2;
  return {
    slot,
    doorNo: APARTMENT_DOOR_BASE + slot,
    rect,
    interior,
    wallSolids: [
      { kind: 'wall' as const, x, y, w, h: WALL },
      { kind: 'wall' as const, x, y: y + h - WALL, w, h: WALL },
      { kind: 'wall' as const, x, y, w: WALL, h },
      { kind: 'wall' as const, x: x + w - WALL, y, w: WALL, h },
    ],
    door: { x: doorX, y: y + h + 24 },
    doorRange: APARTMENT_DOOR_RANGE,
    spawn: { x: doorX, y: y + h - 40 },
    exit: { x: doorX, y: y + h - 24 },
    exitRange: APARTMENT_EXIT_RANGE,
    outside: { x: doorX, y: y + h + 50 },
    gridOrigin: {
      x: interior.x + Math.round((interior.w - ROOM_GRID_COLS * ROOM_CELL) / 2),
      y: interior.y + 24,
    },
  };
}

/** 六栋公寓楼：下标即 slot */
export const APARTMENT_SPECS: ReadonlyArray<ApartmentSpec> = APARTMENT_RECTS.map((rect, slot) =>
  makeSpec(slot, rect),
);

/** 楼栋墙体拼成的静态碰撞表：布局层直接展开进 `WORLD_LAYOUT.solids` */
export const APARTMENT_WALL_SOLIDS: ReadonlyArray<SolidRect> = APARTMENT_SPECS.flatMap(
  (spec) => spec.wallSolids,
);

export function doorNoOf(slot: number): number {
  return APARTMENT_DOOR_BASE + Math.max(0, Math.min(APARTMENT_ROOM_COUNT - 1, slot));
}

/** 频道 / 楼栋下标 → 规格；越界夹回 0..5 */
export function apartmentBySlot(slot: number): ApartmentSpec {
  const index = Number.isFinite(slot)
    ? Math.max(0, Math.min(APARTMENT_ROOM_COUNT - 1, Math.floor(slot)))
    : 0;
  return APARTMENT_SPECS[index] ?? APARTMENT_SPECS[0]!;
}

/** 门牌号 301–306 → 规格；非法门牌返回 undefined */
export function apartmentByDoorNo(doorNo: number): ApartmentSpec | undefined {
  if (!Number.isFinite(doorNo)) return undefined;
  const slot = Math.floor(doorNo) - APARTMENT_DOOR_BASE;
  if (slot < 0 || slot >= APARTMENT_ROOM_COUNT) return undefined;
  return APARTMENT_SPECS[slot];
}

/** 格索引 → 世界坐标（格子中心）：服务端校验与客户端摆件共用 */
export function cellCenter(spec: ApartmentSpec, cell: number): { x: number; y: number } {
  const index = Math.max(0, Math.min(ROOM_CELL_COUNT - 1, Math.floor(cell)));
  const col = index % ROOM_GRID_COLS;
  const row = Math.floor(index / ROOM_GRID_COLS);
  return {
    x: spec.gridOrigin.x + col * ROOM_CELL + ROOM_CELL / 2,
    y: spec.gridOrigin.y + row * ROOM_CELL + ROOM_CELL / 2,
  };
}

/** 户型档位：价格、可摆件数、地板名 */
export interface HouseTierSpec {
  readonly tier: number;
  readonly name: string;
  readonly price: number;
  readonly slots: number;
  readonly floor: string;
}

export const HOUSE_TIERS: ReadonlyArray<HouseTierSpec> = [
  { tier: 0, name: '纸箱', price: 0, slots: 2, floor: '纸箱与地铺' },
  { tier: 1, name: '隔断', price: 300, slots: 6, floor: '灰色隔断与折叠桌' },
  { tier: 2, name: '一居室', price: 900, slots: 12, floor: '暖木地板与一居室家具' },
  { tier: 3, name: '大平层', price: 2200, slots: 20, floor: '冷白大平层与落地窗' },
];

export const MAX_APARTMENT_TIER = HOUSE_TIERS[HOUSE_TIERS.length - 1]!.tier;

export function houseTierSpec(tier: number): HouseTierSpec {
  const index = Number.isFinite(tier)
    ? Math.max(0, Math.min(MAX_APARTMENT_TIER, Math.floor(tier)))
    : 0;
  return HOUSE_TIERS[index] ?? HOUSE_TIERS[0]!;
}

/** 家具目录：id 是线协议 u8，只追加不复用 */
export interface FurnitureSpec {
  readonly id: number;
  readonly name: string;
  readonly price: number;
  /** 占地格数：1 = 1×1，2 = 2×1（横向两格） */
  readonly cells: number;
}

export const FURNITURE_SKUS: ReadonlyArray<FurnitureSpec> = [
  { id: 0, name: '纸箱堆', price: 0, cells: 1 },
  { id: 1, name: '行军床', price: 80, cells: 2 },
  { id: 2, name: '折叠桌', price: 60, cells: 1 },
  { id: 3, name: '布艺沙发', price: 240, cells: 2 },
  { id: 4, name: '落地灯', price: 120, cells: 1 },
  { id: 5, name: '绿萝盆栽', price: 90, cells: 1 },
  { id: 6, name: '羊羔绒地毯', price: 150, cells: 2 },
  { id: 7, name: '大屏电视', price: 600, cells: 1 },
];

export function furnitureById(id: number): FurnitureSpec | undefined {
  return FURNITURE_SKUS.find((sku) => sku.id === id);
}

/** 一件已摆好的家具：格索引 + 家具 id */
export interface FurniturePlacement {
  id: number;
  cell: number;
}

/** 家具布局校验：件数不超档位、格子不越界、不重复、家具 id 合法 */
export function sanitizePlacements(
  raw: ReadonlyArray<FurniturePlacement>,
  tier: number,
): FurniturePlacement[] {
  const limit = houseTierSpec(tier).slots;
  const used = new Set<number>();
  const out: FurniturePlacement[] = [];
  for (const entry of raw) {
    if (out.length >= limit) break;
    if (!entry || !furnitureById(entry.id)) continue;
    const cell = Math.floor(entry.cell);
    if (!Number.isFinite(cell) || cell < 0 || cell >= ROOM_CELL_COUNT) continue;
    if (used.has(cell)) continue;
    used.add(cell);
    out.push({ id: entry.id, cell });
  }
  return out;
}
