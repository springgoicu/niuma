/**
 * 牛马公寓（APARTMENT）：西南角的六层水泥楼，门口按 F 进入私有户型空间。
 *
 * 户型空间是服务端的「局部房间」，不是另一套坐标系：
 * 所有房间共用楼内同一个矩形（`APARTMENT_INTERIOR`），靠 `roomId` 分频道——
 * 同频道的玩家互相可见，不同频道与屋外玩家互不可见（见 `sim/view.ts`）。
 * 这样做的好处是移动、AOI、深度排序、相机跟随全部复用既有实现。
 *
 * 户型 0→3 复用经济档案里的 `houseTier`：纸箱 → 隔断 → 一居室 → 大平层，
 * 阶位决定可摆家具数量与地板配色。
 */

import type { SolidRect } from './campus';
import type { WorldRect } from './geometry';

/** 楼体占地：西南角，西离岛界 60、南离岛界 240、北离涟漪湖 90 */
export const APARTMENT: WorldRect = { x: 2620, y: 5240, w: 380, h: 300 };

/** 室内可用矩形：墙体厚 8，门只在南墙正中，且做成「按 F 瞬移进出」而不是门洞 */
export const APARTMENT_INTERIOR: WorldRect = {
  x: APARTMENT.x + 8,
  y: APARTMENT.y + 8,
  w: APARTMENT.w - 16,
  h: APARTMENT.h - 16,
};

/** 楼体四面墙：整圈封闭，进出只走热区 */
export const APARTMENT_WALL_SOLIDS: ReadonlyArray<SolidRect> = (() => {
  const W = 8;
  const { x, y, w, h } = APARTMENT;
  return [
    { kind: 'wall' as const, x, y, w, h: W },
    { kind: 'wall' as const, x, y: y + h - W, w, h: W },
    { kind: 'wall' as const, x, y, w: W, h },
    { kind: 'wall' as const, x: x + w - W, y, w: W, h },
  ];
})();

/** 门口感应点：南墙外侧，站在台阶上就能按 F */
export const APARTMENT_DOOR = { x: APARTMENT.x + APARTMENT.w / 2, y: APARTMENT.y + APARTMENT.h + 24 } as const;
export const APARTMENT_DOOR_RANGE = 64;

/** 室内落点与出口热区：进屋后站在门厅，背对南墙 */
export const APARTMENT_SPAWN = {
  x: APARTMENT.x + APARTMENT.w / 2,
  y: APARTMENT.y + APARTMENT.h - 40,
} as const;
export const APARTMENT_EXIT = {
  x: APARTMENT.x + APARTMENT.w / 2,
  y: APARTMENT.y + APARTMENT.h - 24,
} as const;
export const APARTMENT_EXIT_RANGE = 56;

/** 屋外落点：出门站回台阶 */
export const APARTMENT_OUTSIDE = { x: APARTMENT_DOOR.x, y: APARTMENT_DOOR.y + 26 } as const;

/** 家具网格：8 列 × 6 行，格边 44px，居中铺在室内 */
export const ROOM_GRID_COLS = 8;
export const ROOM_GRID_ROWS = 6;
export const ROOM_CELL = 44;
export const ROOM_GRID_ORIGIN = {
  x: APARTMENT_INTERIOR.x + Math.round((APARTMENT_INTERIOR.w - ROOM_GRID_COLS * ROOM_CELL) / 2),
  y: APARTMENT_INTERIOR.y + 24,
} as const;
export const ROOM_CELL_COUNT = ROOM_GRID_COLS * ROOM_GRID_ROWS;

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

/** 房间频道数：超出后新来的人复用最早空出来的频道 */
export const APARTMENT_ROOM_COUNT = 6;
/** 门牌号基数：301–306，进门后在头顶与门口牌子显示 */
export const APARTMENT_DOOR_BASE = 301;

export function doorNoOf(slot: number): number {
  return APARTMENT_DOOR_BASE + Math.max(0, Math.min(APARTMENT_ROOM_COUNT - 1, slot));
}

/** 格索引 → 世界坐标（格子中心）：服务端校验与客户端摆件共用 */
export function cellCenter(cell: number): { x: number; y: number } {
  const index = Math.max(0, Math.min(ROOM_CELL_COUNT - 1, Math.floor(cell)));
  const col = index % ROOM_GRID_COLS;
  const row = Math.floor(index / ROOM_GRID_COLS);
  return {
    x: ROOM_GRID_ORIGIN.x + col * ROOM_CELL + ROOM_CELL / 2,
    y: ROOM_GRID_ORIGIN.y + row * ROOM_CELL + ROOM_CELL / 2,
  };
}

/** 把脚底夹回室内；预测与服务端共用同一份边界 */
export function clampToRoom(x: number, y: number, padding = 12): { x: number; y: number } {
  const minX = APARTMENT_INTERIOR.x + padding;
  const maxX = APARTMENT_INTERIOR.x + APARTMENT_INTERIOR.w - padding;
  const minY = APARTMENT_INTERIOR.y + padding;
  const maxY = APARTMENT_INTERIOR.y + APARTMENT_INTERIOR.h - padding;
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/** 是否站在门口（屋外） */
export function isNearApartmentDoor(x: number, y: number, range = APARTMENT_DOOR_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = x - APARTMENT_DOOR.x;
  const dy = y - APARTMENT_DOOR.y;
  return dx * dx + dy * dy <= range * range;
}

/** 是否站在室内出口（屋内） */
export function isNearApartmentExit(x: number, y: number, range = APARTMENT_EXIT_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = x - APARTMENT_EXIT.x;
  const dy = y - APARTMENT_EXIT.y;
  return dx * dx + dy * dy <= range * range;
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
