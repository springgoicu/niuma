/**
 * 研发园与南向园区：办公区之外的南部聚落（会议室、卫生间、工作区、休息室与装饰）。
 *
 * 与 layout.ts 同一条纪律：坐标全部手写，不依赖 Math.random / Math.sin / Math.cos。
 * 本文件只描述「是什么」，渲染材质与贴图由 apps/web 决定。
 */

import { DIRECTION, POSE, type Direction, type Pose } from '../constants';
import type { WorldRect } from './geometry';


/**
 * 座位种类：
 * - `chair` 工位椅 / 会议椅，`toilet` 马桶，`stool` 凳子，`sofa` 沙发：入座即坐姿；
 * - `bed` 单人床：入座即躺姿（ADR-0020 的「座位上不能躺」在此按种类放开）。
 */
export type SeatKind = 'chair' | 'toilet' | 'stool' | 'sofa' | 'bed';

/**
 * 座位锚点：入座后角色的世界坐标。`id` 从 1 开始，0 保留为「无座位」。
 * `facing` 是入座后面朝的方向（工位朝向桌子，马桶朝向墙，床朝床尾）。
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

/**
 * 座位对应的入座姿态：床位躺、其余坐。
 *
 * 服务端占座、客户端预测、提示文案与测试**都只读这一个函数**，
 * 不允许任何一处再写一份 kind → pose 的映射表。
 */
export function seatPose(kind: SeatKind): Pose {
  return kind === 'bed' ? POSE.Lie : POSE.Sit;
}

/** 工位桌（中心点）。桌面本身是碰撞体，见 SolidRect */
export interface DeskInstance {
  x: number;
  y: number;
}

export type PropKind =
  | 'lamp'
  | 'bench'
  | 'bin'
  | 'sign'
  | 'board'
  | 'sink'
  | 'vending'
  | 'bike'
  | 'table'
  | 'plant'
  | 'cooler'
  | 'coffee'
  | 'sideTable';

/** 纯装饰（或带碰撞的小设施）：渲染端按 kind 选贴图 */
export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
}

/** `prop` 是「本体即碰撞体」的道具（售货机、饮水机、咖啡机），地面层不再重复画矩形 */
export type SolidKind = 'wall' | 'desk' | 'fixture' | 'prop';

/** 轴对齐的碰撞矩形：墙、桌、隔断、饮水机之类 */
export interface SolidRect extends WorldRect {
  kind: SolidKind;
}

/**
 * 本体即碰撞体的道具：精灵底座自己承担碰撞，`solids` 里对应的矩形只用于查询。
 * 布局测试与渲染层都读这份判定，避免两处各写一遍 kind 列表。
 */
export function isSelfSolidProp(kind: PropKind): boolean {
  return kind === 'vending' || kind === 'cooler' || kind === 'coffee';
}

/** 房间开门位置：`from` / `to` 是门洞在墙所在轴上的坐标区间 */
export interface DoorSpec {
  side: 'north' | 'south' | 'east' | 'west';
  from: number;
  to: number;
}

export interface BuildingSpec {
  name: string;
  rect: WorldRect;
  floor: 'wood' | 'tile' | 'carpet';
}

/** 研发园整体（会议室、卫生间与庭院位于其内，区域名由 regionAt 按优先级区分） */
export const CAMPUS_RECT: WorldRect = { x: 3000, y: 5900, w: 2100, h: 800 };
/** 铺装庭院：地面与草地分开，贴花不进入 */
export const CAMPUS_YARD: WorldRect = { x: 3100, y: 5920, w: 1900, h: 740 };

export const MEETING_ROOM: WorldRect = { x: 3180, y: 5980, w: 440, h: 280 };
export const RESTROOM: WorldRect = { x: 4380, y: 5980, w: 400, h: 280 };

/**
 * 南向主路两侧的两栋新房间（ADR-0024）：休息室在西、工作区在东，各自开一扇朝路侧的门。
 * 尺寸与研发园的房间同档（460×360 / 450×360），走进去是一间屋，不是一条走廊。
 */
export const LOUNGE: WorldRect = { x: 3470, y: 4990, w: 460, h: 360 };
export const WORKROOM: WorldRect = { x: 4240, y: 4990, w: 450, h: 360 };

/** 墙厚：碰撞与视觉共用，玩家半径 9 贴墙时不会穿过 10px 墙体 */
export const WALL_THICKNESS = 10;
/** 门洞区间：卫生间、会议室朝南；休息室朝东、工作区朝西（都对着主路） */
const RESTROOM_DOOR: DoorSpec = { side: 'south', from: 4550, to: 4610 };
const MEETING_DOOR: DoorSpec = { side: 'south', from: 3370, to: 3430 };
const LOUNGE_DOOR: DoorSpec = { side: 'east', from: 5150, to: 5210 };
const WORKROOM_DOOR: DoorSpec = { side: 'west', from: 5150, to: 5210 };

/** 工位桌尺寸与椅子偏移：椅子锚点离桌边 20px，人坐下时头不压桌面 */
export const DESK_W = 88;
export const DESK_H = 40;
export const CHAIR_GAP = 20;

/** 门两侧的碰撞段：门洞落在墙的哪一段就断开哪一段 */
function splitSpan(start: number, end: number, from: number, to: number): Array<[number, number]> {
  const a = Math.min(Math.max(from, start), end);
  const b = Math.min(Math.max(to, start), end);
  const spans: Array<[number, number]> = [];
  if (a > start) spans.push([start, a]);
  if (b < end) spans.push([b, end]);
  return spans;
}

/**
 * 把一间房的四面墙拆成碰撞矩形，`door` 指定开门的墙与门洞区间。
 * 东西向的门与南门共用同一套拆分逻辑，新房间不必再各写一份。
 */
function roomWalls(rect: WorldRect, door: DoorSpec): SolidRect[] {
  const t = WALL_THICKNESS;
  const { x, y, w, h } = rect;
  const walls: SolidRect[] = [];

  const horizontal = (top: number, side: DoorSpec['side'], start: number, end: number) => {
    const spans = door.side === side ? splitSpan(start, end, door.from, door.to) : [[start, end] as [number, number]];
    for (const [a, b] of spans) {
      if (b > a) walls.push({ kind: 'wall', x: a, y: top, w: b - a, h: t });
    }
  };

  const vertical = (left: number, side: DoorSpec['side'], start: number, end: number) => {
    const spans = door.side === side ? splitSpan(start, end, door.from, door.to) : [[start, end] as [number, number]];
    for (const [a, b] of spans) {
      if (b > a) walls.push({ kind: 'wall', x: left, y: a, w: t, h: b - a });
    }
  };

  horizontal(y, 'north', x, x + w);
  horizontal(y + h - t, 'south', x, x + w);
  vertical(x, 'west', y, y + h);
  vertical(x + w - t, 'east', y, y + h);
  return walls;
}

const restroomSolids = roomWalls(RESTROOM, RESTROOM_DOOR);
const meetingSolids = roomWalls(MEETING_ROOM, MEETING_DOOR);
const loungeSolids = roomWalls(LOUNGE, LOUNGE_DOOR);
const workroomSolids = roomWalls(WORKROOM, WORKROOM_DOOR);

/** 卫生间四个隔间：中心 x 与隔断 x 手写，隔间宽 95 */
const STALL_CENTERS = [4437, 4532, 4627, 4722] as const;
const STALL_SEAT_Y = 6068;

const stallPartitions: SolidRect[] = [4485, 4580, 4675].map((px) => ({
  kind: 'fixture',
  x: px - 3,
  y: 5990,
  w: 6,
  h: 100,
}));

const MEETING_TABLE: SolidRect = { kind: 'fixture', x: 3300, y: 6075, w: 200, h: 90 };

/** 广场与工作区的售货机 / 饮水机 / 咖啡机：本体即碰撞体，底座尺寸与精灵一致 */
export const PLAZA_SOLIDS: SolidRect[] = [
  { kind: 'prop', x: 4596, y: 3690, w: 32, h: 24 },
  { kind: 'prop', x: 4596, y: 4470, w: 32, h: 24 },
];

/** 会议桌两侧的椅子：北侧 3 把朝南，南侧 3 把朝北 */
const MEETING_SEATS: Array<{ x: number; y: number; facing: Direction }> = [
  { x: 3330, y: 6050, facing: DIRECTION.Down },
  { x: 3400, y: 6050, facing: DIRECTION.Down },
  { x: 3470, y: 6050, facing: DIRECTION.Down },
  { x: 3330, y: 6190, facing: DIRECTION.Up },
  { x: 3400, y: 6190, facing: DIRECTION.Up },
  { x: 3470, y: 6190, facing: DIRECTION.Up },
];

/** 卫生间马桶：背靠北墙，人面朝墙坐下 */
const TOILET_SEATS = STALL_CENTERS.map((cx) => ({ x: cx, y: STALL_SEAT_Y, facing: DIRECTION.Up as Direction }));

/**
 * 工作区的六个工位：两列三排，椅子都在桌子南侧、面朝北。
 * 列距 230 / 排距 90 是按 88×40 的桌与 20px 椅距排的，中间留 142px 走道。
 */
const WORK_DESK_XS = [4370, 4600] as const;
const WORK_DESK_YS = [5060, 5150, 5240] as const;

export const WORKSTATIONS: ReadonlyArray<{
  desk: DeskInstance;
  seat: { x: number; y: number; facing: Direction };
}> = WORK_DESK_YS.flatMap((y) =>
  WORK_DESK_XS.map((x) => ({
    desk: { x, y },
    seat: { x, y: y + DESK_H / 2 + CHAIR_GAP, facing: DIRECTION.Up as Direction },
  })),
);

/** 休息室的六个座位：三张床（只能躺）、一张沙发与两张凳子（只能坐） */
export const LOUNGE_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  { x: 3580, y: 5090, facing: DIRECTION.Right, kind: 'bed' },
  { x: 3580, y: 5170, facing: DIRECTION.Right, kind: 'bed' },
  { x: 3580, y: 5250, facing: DIRECTION.Right, kind: 'bed' },
  { x: 3810, y: 5090, facing: DIRECTION.Down, kind: 'sofa' },
  { x: 3720, y: 5230, facing: DIRECTION.Up, kind: 'stool' },
  { x: 3810, y: 5230, facing: DIRECTION.Up, kind: 'stool' },
];

/** 园区装饰：灯、长椅、垃圾桶、标识、饮水/售货、单车棚 */
export const CAMPUS_PROPS: PropInstance[] = [
  { kind: 'lamp', x: 3070, y: 5950 },
  { kind: 'lamp', x: 5030, y: 5950 },
  { kind: 'lamp', x: 3070, y: 6630 },
  { kind: 'plant', x: 3140, y: 6610 },
  { kind: 'plant', x: 5000, y: 6000 },
  { kind: 'lamp', x: 5030, y: 6630 },
  { kind: 'board', x: 3400, y: 5992 },
  { kind: 'sign', x: 4070, y: 5912 },
  { kind: 'bench', x: 3600, y: 6610 },
  { kind: 'bench', x: 4350, y: 6610 },
  { kind: 'bin', x: 4690, y: 6320 },
  { kind: 'bike', x: 4880, y: 6600 },
  { kind: 'table', x: 4000, y: 6280 },
  // 庭院两端各加一张野餐桌：铺装庭院是 1900×740 的大平面，只有一张桌子太旷
  { kind: 'table', x: 3250, y: 6570 },
  { kind: 'table', x: 4900, y: 6520 },
  // 四角绿植把庭院边界「点」出来，站在门口就能看出这里是院子
  { kind: 'plant', x: 3150, y: 5970 },
  { kind: 'plant', x: 4950, y: 5970 },
  { kind: 'plant', x: 3500, y: 6650 },
  { kind: 'plant', x: 4750, y: 6650 },
  { kind: 'sink', x: 4420, y: 6220 },
  { kind: 'sink', x: 4500, y: 6220 },
  { kind: 'sink', x: 4660, y: 6220 },
  { kind: 'sink', x: 4740, y: 6220 },
];

/**
 * 工作区陈设：咖啡机与饮水机靠东墙、绿植与垃圾桶守门侧。
 * 门在西墙 y 5150–5210，门口那一条 76px 走道保持空着。
 */
export const WORK_PROPS: PropInstance[] = [
  { kind: 'coffee', x: 4660, y: 5230 },
  { kind: 'cooler', x: 4660, y: 5130 },
  { kind: 'plant', x: 4270, y: 5040 },
  { kind: 'bin', x: 4270, y: 5320 },
];

/** 休息室陈设：床头小几、落地灯、绿植与垃圾桶，都是不挡路的小件 */
export const LOUNGE_PROPS: PropInstance[] = [
  { kind: 'sideTable', x: 3765, y: 5270 },
  { kind: 'lamp', x: 3895, y: 5320 },
  { kind: 'plant', x: 3510, y: 5320 },
  { kind: 'bin', x: 3895, y: 5020 },
];

/** 饮水机与咖啡机的底座碰撞：与精灵同宽，贴地 24 高 */
export const WORK_SOLIDS: SolidRect[] = [
  { kind: 'prop', x: 4650, y: 5120, w: 20, h: 24 },
  { kind: 'prop', x: 4649, y: 5220, w: 22, h: 24 },
];

/** 两栋房间的门前铺装：把门洞接到南向主路上，贴花不进入 */
export const DOOR_PAVING: WorldRect[] = [
  { x: 3930, y: 5140, w: 102, h: 80 },
  { x: 4160, y: 5140, w: 80, h: 80 },
];

export const CAMPUS_BUILDINGS: BuildingSpec[] = [
  { name: '会议室', rect: MEETING_ROOM, floor: 'wood' },
  { name: '卫生间', rect: RESTROOM, floor: 'tile' },
  { name: '工作区', rect: WORKROOM, floor: 'wood' },
  { name: '休息室', rect: LOUNGE, floor: 'carpet' },
];

/** 卫生间与会议室、工作区与休息室的碰撞，以及园区内的桌台隔断 */
export const CAMPUS_SOLIDS: SolidRect[] = [
  ...meetingSolids,
  ...restroomSolids,
  ...loungeSolids,
  ...workroomSolids,
  ...stallPartitions,
  ...WORK_SOLIDS,
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
