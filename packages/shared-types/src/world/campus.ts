/**
 * 研发园：办公区之外的南部园区（会议室、卫生间、铺装庭院与装饰）。
 *
 * 与 layout.ts 同一条纪律：坐标全部手写，不依赖 Math.random / Math.sin / Math.cos。
 * 本文件只描述「是什么」，渲染材质与贴图由 apps/web 决定。
 */

import { DIRECTION, type Direction } from '../constants';
import type { WorldRect } from './geometry';


/** 座位种类：椅子用于工位与会议室，马桶用于卫生间隔间 */
export type SeatKind = 'chair' | 'toilet';

/**
 * 座位锚点：入座后角色的世界坐标。`id` 从 1 开始，0 保留为「无座位」。
 * `facing` 是入座后面朝的方向（工位朝向桌子，马桶朝向墙）。
 * `desk` 指向 WORLD_LAYOUT.desks 的下标，没有桌子时为 -1，用于显示屏点亮。
 */
export interface SeatInstance {
  id: number;
  x: number;
  y: number;
  facing: Direction;
  kind: SeatKind;
  desk: number;
}

/** 工位桌（中心点）。桌面本身是碰撞体，见 SolidRect */
export interface DeskInstance {
  x: number;
  y: number;
}

export type PropKind = 'lamp' | 'bench' | 'bin' | 'sign' | 'board' | 'sink' | 'vending' | 'bike' | 'table' | 'plant';

/** 纯装饰（或带碰撞的小设施）：渲染端按 kind 选贴图 */
export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
}

export type SolidKind = 'wall' | 'desk' | 'fixture';

/** 轴对齐的碰撞矩形：墙、桌、隔断、饮水机之类 */
export interface SolidRect extends WorldRect {
  kind: SolidKind;
}

export interface BuildingSpec {
  name: string;
  rect: WorldRect;
  floor: 'wood' | 'tile';
}

/** 研发园整体（会议室与卫生间位于其内，区域名由 regionAt 按优先级区分） */
export const CAMPUS_RECT: WorldRect = { x: 3000, y: 6280, w: 2100, h: 800 };
/** 铺装庭院：地面与草地分开，贴花不进入 */
export const CAMPUS_YARD: WorldRect = { x: 3100, y: 6300, w: 1900, h: 740 };

export const MEETING_ROOM: WorldRect = { x: 3180, y: 6360, w: 440, h: 280 };
export const RESTROOM: WorldRect = { x: 4380, y: 6360, w: 400, h: 280 };

/** 墙厚：碰撞与视觉共用，玩家半径 9 贴墙时不会穿过 10px 墙体 */
export const WALL_THICKNESS = 10;
/** 门洞宽度：卫生间与会议室各开一个南向门 */
const RESTROOM_DOOR: [number, number] = [4550, 4610];
const MEETING_DOOR: [number, number] = [3370, 3430];

/** 工位桌尺寸与椅子偏移：椅子锚点离桌边 20px，人坐下时头不压桌面 */
export const DESK_W = 88;
export const DESK_H = 40;
export const CHAIR_GAP = 20;

/** 把一间房的四面墙拆成碰撞矩形；南墙在门洞处断开 */
function roomWalls(rect: WorldRect, door: [number, number]): SolidRect[] {
  const t = WALL_THICKNESS;
  const { x, y, w, h } = rect;
  return [
    { kind: 'wall', x, y, w, h: t },
    { kind: 'wall', x, y, w: t, h },
    { kind: 'wall', x: x + w - t, y, w: t, h },
    { kind: 'wall', x, y: y + h - t, w: door[0] - x, h: t },
    { kind: 'wall', x: door[1], y: y + h - t, w: x + w - door[1], h: t },
  ];
}

const restroomSolids = roomWalls(RESTROOM, RESTROOM_DOOR);
const meetingSolids = roomWalls(MEETING_ROOM, MEETING_DOOR);

/** 卫生间四个隔间：中心 x 与隔断 x 手写，隔间宽 95 */
const STALL_CENTERS = [4437, 4532, 4627, 4722] as const;
const STALL_Y = 6420;
const STALL_SEAT_Y = 6448;

const stallPartitions: SolidRect[] = [4485, 4580, 4675].map((px) => ({
  kind: 'fixture',
  x: px - 3,
  y: 6370,
  w: 6,
  h: 100,
}));

const MEETING_TABLE: SolidRect = { kind: 'fixture', x: 3300, y: 6455, w: 200, h: 90 };

/** 广场两台售货机的碰撞矩形，与 PLAZA_PROPS 中的 vending 位置一致 */
export const PLAZA_SOLIDS: SolidRect[] = [
  { kind: 'fixture', x: 4592, y: 3686, w: 40, h: 28 },
  { kind: 'fixture', x: 4592, y: 4466, w: 40, h: 28 },
];

/** 会议桌两侧的椅子：北侧 3 把朝南，南侧 3 把朝北 */
const MEETING_SEATS: Array<{ x: number; y: number; facing: Direction }> = [
  { x: 3330, y: 6430, facing: DIRECTION.Down },
  { x: 3400, y: 6430, facing: DIRECTION.Down },
  { x: 3470, y: 6430, facing: DIRECTION.Down },
  { x: 3330, y: 6570, facing: DIRECTION.Up },
  { x: 3400, y: 6570, facing: DIRECTION.Up },
  { x: 3470, y: 6570, facing: DIRECTION.Up },
];

/** 卫生间马桶：背靠北墙，人面朝墙坐下 */
const TOILET_SEATS = STALL_CENTERS.map((cx) => ({ x: cx, y: STALL_SEAT_Y, facing: DIRECTION.Up as Direction }));

/** 园区装饰：灯、长椅、垃圾桶、标识、饮水/售货、单车棚 */
export const CAMPUS_PROPS: PropInstance[] = [
  { kind: 'lamp', x: 3070, y: 6330 },
  { kind: 'lamp', x: 5030, y: 6330 },
  { kind: 'lamp', x: 3070, y: 7010 },
  { kind: 'plant', x: 3140, y: 6990 },
  { kind: 'plant', x: 5000, y: 6380 },
  { kind: 'lamp', x: 5030, y: 7010 },
  { kind: 'board', x: 3400, y: 6372 },
  { kind: 'sign', x: 4070, y: 6292 },
  { kind: 'bench', x: 3600, y: 6990 },
  { kind: 'bench', x: 4350, y: 6990 },
  { kind: 'bin', x: 4690, y: 6700 },
  { kind: 'bike', x: 4880, y: 6980 },
  { kind: 'table', x: 4000, y: 6660 },
  { kind: 'sink', x: 4420, y: 6600 },
  { kind: 'sink', x: 4500, y: 6600 },
  { kind: 'sink', x: 4660, y: 6600 },
  { kind: 'sink', x: 4740, y: 6600 },
];

export const CAMPUS_BUILDINGS: BuildingSpec[] = [
  { name: '会议室', rect: MEETING_ROOM, floor: 'wood' },
  { name: '卫生间', rect: RESTROOM, floor: 'tile' },
];

/** 卫生间与会议室的碰撞、以及园区内的桌台隔断 */
export const CAMPUS_SOLIDS: SolidRect[] = [
  ...meetingSolids,
  ...restroomSolids,
  ...stallPartitions,
  MEETING_TABLE,
];

/** 会议室与卫生间的座位：椅子在前，马桶在后 */
export const CAMPUS_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  ...MEETING_SEATS.map((seat) => ({ ...seat, kind: 'chair' as const })),
  ...TOILET_SEATS.map((seat) => ({ ...seat, kind: 'toilet' as const })),
];

/** 办公广场的灯、垃圾桶、长椅与售货机 */
export const PLAZA_PROPS: PropInstance[] = [
  { kind: 'lamp', x: 3520, y: 3620 },
  { kind: 'plant', x: 3580, y: 3600 },
  { kind: 'plant', x: 4640, y: 4600 },
  { kind: 'lamp', x: 4672, y: 3620 },
  { kind: 'lamp', x: 3520, y: 4572 },
  { kind: 'lamp', x: 4672, y: 4572 },
  { kind: 'vending', x: 4612, y: 3700 },
  { kind: 'vending', x: 4612, y: 4480 },
  { kind: 'bin', x: 3570, y: 3662 },
  { kind: 'bin', x: 4622, y: 4540 },
  { kind: 'bench', x: 3596, y: 4500 },
  { kind: 'bench', x: 4560, y: 3596 },
  { kind: 'sign', x: 4060, y: 3384 },
  { kind: 'lamp', x: 4000, y: 2990 },
  { kind: 'lamp', x: 4192, y: 2990 },
];

/** 园区与办公区之间的土路延长段：北接南门，南至会议室庭院 */
export const CAMPUS_PATH = { x: 4032, y: 5880, w: 128, h: 420 };
