/**
 * 研发园与园区小屋：办公区之外的南部聚落（会议室、卫生间、工作区、休息室与装饰）。
 *
 * 与 layout.ts 同一条纪律：坐标全部手写，不依赖 Math.random / Math.sin / Math.cos。
 * 本文件只描述「是什么」，渲染材质与贴图由 apps/web 决定。
 *
 * ADR-0028：三个建筑聚簇改成「原点常量 + 内部相对偏移」。
 * 重排聚簇只改原点，桌椅、床位、门洞、铺装自动跟随；
 * 数字仍然全部手写，不引入运行期缩放，也不引入第二套坐标描述。
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

/**
 * 工位桌（中心点）。桌面本身是碰撞体，见 SolidRect。
 * `facing` 是屏幕朝向，也是入座者的面朝方向：椅子永远在屏幕背面一侧，
 * 渲染端按它选四向贴图（ADR-0027）。
 */
export interface DeskInstance {
  x: number;
  y: number;
  facing: Direction;
}

/** 朝向 → 单位向量（屏幕坐标：+x 向右、+y 向下） */
const FACING_VECTOR: Record<Direction, { x: number; y: number }> = {
  [DIRECTION.Down]: { x: 0, y: 1 },
  [DIRECTION.Left]: { x: -1, y: 0 },
  [DIRECTION.Right]: { x: 1, y: 0 },
  [DIRECTION.Up]: { x: 0, y: -1 },
};

/** 一张工位：桌子带屏幕朝向，椅子由朝向反推 */
export interface Workstation {
  desk: DeskInstance;
  seat: Omit<SeatInstance, 'id' | 'desk' | 'kind'>;
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
  | 'sideTable'
  | 'hedge';

/** 纯装饰（或带碰撞的小设施）：渲染端按 kind 选贴图 */
export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
}

/** `prop` 是「本体即碰撞体」的道具（售货机、饮水机、咖啡机、长椅之类），地面层不再重复画矩形 */
export type SolidKind = 'wall' | 'desk' | 'fixture' | 'prop';

/** 轴对齐的碰撞矩形：墙、桌、隔断、饮水机之类 */
export interface SolidRect extends WorldRect {
  kind: SolidKind;
}

/** 是否有自己的占地（本体即碰撞体）：布局测试与道具派生碰撞都读这一处 */
export function isSelfSolidProp(kind: PropKind): boolean {
  return PROP_FOOTPRINT[kind] !== undefined;
}

/** 一批道具的占地：props 与碰撞同源，改坐标不会再漂 */
export function propSolids(props: readonly PropInstance[]): SolidRect[] {
  const out: SolidRect[] = [];
  for (const prop of props) {
    const solid = propSolid(prop);
    if (solid) out.push(solid);
  }
  return out;
}

/**
 * 有占地的装饰：碰撞盒贴在精灵底座上（底边 = 脚底 y，中心 x = 精灵 x）。
 *
 * 尺寸与 apps/web 的 `PROP_SIZE` 对齐，只取「底座」那一截：
 * 长椅与野餐桌是矮家具，碰撞只覆盖椅面 / 桌腿，正面不留隐形墙。
 * 树篱、灯、垃圾桶、绿植、标识等小件不在表里 —— `propSolid` 返回 undefined。
 */
const PROP_FOOTPRINT: Partial<Record<PropKind, { w: number; h: number }>> = {
  vending: { w: 32, h: 24 },
  cooler: { w: 20, h: 24 },
  coffee: { w: 22, h: 24 },
  bench: { w: 40, h: 16 },
  table: { w: 40, h: 28 },
  bike: { w: 38, h: 14 },
};

/**
 * 道具的碰撞盒：没有占地的装饰返回 undefined。
 * `WORLD_LAYOUT.solids` 与布局测试都读这一个函数，避免渲染尺寸与碰撞各写一份。
 */
export function propSolid(prop: PropInstance): SolidRect | undefined {
  const size = PROP_FOOTPRINT[prop.kind];
  if (!size) return undefined;
  return {
    kind: 'prop',
    x: prop.x - size.w / 2,
    y: prop.y - size.h,
    w: size.w,
    h: size.h,
  };
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

/**
 * 三个聚簇的原点。内部坐标一律写成「原点 + 相对偏移」，
 * 这样缩岛重排时只改这三行，五处建筑的全部陈设跟着走。
 */
export const CAMPUS_ORIGIN = { x: 2900, y: 5100 } as const;
export const LOUNGE_ORIGIN = { x: 2900, y: 2880 } as const;
export const WORKROOM_ORIGIN = { x: 5100, y: 3600 } as const;

/** 研发园整体（会议室、卫生间与庭院位于其内，区域名由 regionAt 按优先级区分） */
export const CAMPUS_RECT: WorldRect = { x: CAMPUS_ORIGIN.x, y: CAMPUS_ORIGIN.y, w: 2100, h: 800 };
/** 铺装庭院：地面与草地分开，贴花不进入 */
export const CAMPUS_YARD: WorldRect = { x: CAMPUS_ORIGIN.x + 100, y: CAMPUS_ORIGIN.y + 20, w: 1900, h: 740 };

export const MEETING_ROOM: WorldRect = { x: CAMPUS_ORIGIN.x + 180, y: CAMPUS_ORIGIN.y + 80, w: 440, h: 280 };
export const RESTROOM: WorldRect = { x: CAMPUS_ORIGIN.x + 1380, y: CAMPUS_ORIGIN.y + 80, w: 400, h: 280 };

/**
 * 办公区东西两翼的小屋：休息室在西、工作区在东，各自开一扇朝办公区的门。
 * 尺寸与研发园的房间同档（460×360 / 450×360），走进去是一间屋，不是一条走廊。
 */
export const LOUNGE: WorldRect = { x: LOUNGE_ORIGIN.x, y: LOUNGE_ORIGIN.y, w: 460, h: 360 };
export const WORKROOM: WorldRect = { x: WORKROOM_ORIGIN.x, y: WORKROOM_ORIGIN.y, w: 450, h: 360 };

/** 墙厚：碰撞与视觉共用，玩家半径 9 贴墙时不会穿过 10px 墙体 */
export const WALL_THICKNESS = 10;
/** 门洞区间：卫生间、会议室朝南；休息室朝东、工作区朝西（都对着办公区） */
const RESTROOM_DOOR: DoorSpec = {
  side: 'south',
  from: CAMPUS_ORIGIN.x + 1550,
  to: CAMPUS_ORIGIN.x + 1610,
};
/** 会议室门开在南墙东端：门洞正对一张椅子会「进门先撞座」，改到桌子东侧的走道上 */
const MEETING_DOOR: DoorSpec = {
  side: 'south',
  from: CAMPUS_ORIGIN.x + 530,
  to: CAMPUS_ORIGIN.x + 590,
};
const LOUNGE_DOOR: DoorSpec = {
  side: 'south',
  from: LOUNGE_ORIGIN.x + 230,
  to: LOUNGE_ORIGIN.x + 290,
};
const WORKROOM_DOOR: DoorSpec = {
  side: 'west',
  from: WORKROOM_ORIGIN.y + 160,
  to: WORKROOM_ORIGIN.y + 220,
};

/** 工位桌尺寸与椅子偏移：椅子锚点离短边 20px，人坐下时头不压桌面 */
export const DESK_W = 88;
export const DESK_H = 40;
export const CHAIR_GAP = 20;

/**
 * 工位桌的落地占地（ADR-0027）：南北朝向是 88×40 的横桌，
 * 东西朝向整张桌子转 90° 变 40×88。碰撞盒、深度排序与渲染锚点都读这一个函数。
 */
export function deskFootprint(facing: Direction): { w: number; h: number } {
  const horizontal = facing === DIRECTION.Left || facing === DIRECTION.Right;
  return horizontal ? { w: DESK_H, h: DESK_W } : { w: DESK_W, h: DESK_H };
}

/** 椅子离桌心的距离：永远让开短边的一半，不是端头 */
export function chairOffset(facing: Direction): number {
  const { w, h } = deskFootprint(facing);
  return Math.min(w, h) / 2 + CHAIR_GAP;
}

/**
 * 工位工厂：桌子 + 屏幕朝向，椅子锚点由朝向反推。
 *
 * 「椅子永远在屏幕背面一侧」因此是构造性质，而不是靠布局手写字面量维持——
 * 朝向与椅位两处各写一份，改一次桌子尺寸就会漂一次。
 */
export function workstation(x: number, y: number, facing: Direction): Workstation {
  const dir = FACING_VECTOR[facing];
  const gap = chairOffset(facing);
  return {
    desk: { x, y, facing },
    seat: { x: x - dir.x * gap, y: y - dir.y * gap, facing },
  };
}

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
const STALL_CENTERS = [
  CAMPUS_ORIGIN.x + 1437,
  CAMPUS_ORIGIN.x + 1532,
  CAMPUS_ORIGIN.x + 1627,
  CAMPUS_ORIGIN.x + 1722,
] as const;
const STALL_SEAT_Y = CAMPUS_ORIGIN.y + 168;

const stallPartitions: SolidRect[] = [1485, 1580, 1675].map((offsetX) => ({
  kind: 'fixture',
  x: CAMPUS_ORIGIN.x + offsetX - 3,
  y: CAMPUS_ORIGIN.y + 90,
  w: 6,
  h: 100,
}));

const MEETING_TABLE: SolidRect = {
  kind: 'fixture',
  x: CAMPUS_ORIGIN.x + 300,
  y: CAMPUS_ORIGIN.y + 175,
  w: 200,
  h: 90,
};

/** 会议桌两侧的椅子：北侧 3 把朝南，南侧 3 把朝北 */
const MEETING_SEATS: Array<{ x: number; y: number; facing: Direction }> = [
  { x: CAMPUS_ORIGIN.x + 330, y: CAMPUS_ORIGIN.y + 150, facing: DIRECTION.Down },
  { x: CAMPUS_ORIGIN.x + 400, y: CAMPUS_ORIGIN.y + 150, facing: DIRECTION.Down },
  { x: CAMPUS_ORIGIN.x + 470, y: CAMPUS_ORIGIN.y + 150, facing: DIRECTION.Down },
  { x: CAMPUS_ORIGIN.x + 330, y: CAMPUS_ORIGIN.y + 290, facing: DIRECTION.Up },
  { x: CAMPUS_ORIGIN.x + 400, y: CAMPUS_ORIGIN.y + 290, facing: DIRECTION.Up },
  { x: CAMPUS_ORIGIN.x + 470, y: CAMPUS_ORIGIN.y + 290, facing: DIRECTION.Up },
];

/** 卫生间马桶：水箱在精灵北端，人面朝房间（南）坐下，背靠水箱 */
const TOILET_SEATS = STALL_CENTERS.map((cx) => ({ x: cx, y: STALL_SEAT_Y, facing: DIRECTION.Down as Direction }));

/**
 * 工作区的六个工位：两列三排，椅子都在桌子南侧、面朝北。
 * 列距 230 / 排距 90 是按 88×40 的桌与 20px 椅距排的，中间留 142px 走道。
 */
const WORK_DESK_XS = [WORKROOM_ORIGIN.x + 130, WORKROOM_ORIGIN.x + 360] as const;
const WORK_DESK_YS = [WORKROOM_ORIGIN.y + 70, WORKROOM_ORIGIN.y + 160, WORKROOM_ORIGIN.y + 250] as const;

export const WORKSTATIONS: ReadonlyArray<Workstation> = WORK_DESK_YS.flatMap((y) =>
  WORK_DESK_XS.map((x) => workstation(x, y, DIRECTION.Up)),
);

/**
 * 休息室的六个座位：三张床（只能躺）、一张沙发与两张凳子（只能坐）。
 *
 * 朝向都必须对得上家具：床位朝右躺，头落在 `drawBed` 右端的枕头上；
 * 沙发朝南（`drawSofa` 靠背在北）；两张凳子朝南，正对南侧的 `sideTable` 茶几。
 */
export const LOUNGE_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  { x: LOUNGE_ORIGIN.x + 110, y: LOUNGE_ORIGIN.y + 100, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE_ORIGIN.x + 110, y: LOUNGE_ORIGIN.y + 180, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE_ORIGIN.x + 110, y: LOUNGE_ORIGIN.y + 260, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE_ORIGIN.x + 340, y: LOUNGE_ORIGIN.y + 100, facing: DIRECTION.Down, kind: 'sofa' },
  { x: LOUNGE_ORIGIN.x + 250, y: LOUNGE_ORIGIN.y + 240, facing: DIRECTION.Down, kind: 'stool' },
  { x: LOUNGE_ORIGIN.x + 340, y: LOUNGE_ORIGIN.y + 240, facing: DIRECTION.Down, kind: 'stool' },
];

/**
 * 研发园装饰：灯、长椅、垃圾桶、标识、饮水/售货、单车棚与野餐桌。
 * 庭院加密一档：四角绿植、沿边灯柱与三张野餐桌把 1900×740 的铺装铺满。
 */
export const CAMPUS_PROPS: PropInstance[] = [
  { kind: 'lamp', x: CAMPUS_ORIGIN.x + 70, y: CAMPUS_ORIGIN.y + 50 },
  { kind: 'lamp', x: CAMPUS_ORIGIN.x + 2030, y: CAMPUS_ORIGIN.y + 50 },
  { kind: 'lamp', x: CAMPUS_ORIGIN.x + 70, y: CAMPUS_ORIGIN.y + 730 },
  { kind: 'lamp', x: CAMPUS_ORIGIN.x + 2030, y: CAMPUS_ORIGIN.y + 730 },
  { kind: 'plant', x: CAMPUS_ORIGIN.x + 140, y: CAMPUS_ORIGIN.y + 710 },
  { kind: 'plant', x: CAMPUS_ORIGIN.x + 2000, y: CAMPUS_ORIGIN.y + 100 },
  { kind: 'plant', x: CAMPUS_ORIGIN.x + 150, y: CAMPUS_ORIGIN.y + 70 },
  { kind: 'plant', x: CAMPUS_ORIGIN.x + 1950, y: CAMPUS_ORIGIN.y + 70 },
  { kind: 'plant', x: CAMPUS_ORIGIN.x + 500, y: CAMPUS_ORIGIN.y + 750 },
  { kind: 'plant', x: CAMPUS_ORIGIN.x + 1750, y: CAMPUS_ORIGIN.y + 750 },
  // 白板挂在会议室北墙内侧：底边压到墙内缘 114，34×24 的主体才完整落在屋里
  { kind: 'board', x: CAMPUS_ORIGIN.x + 400, y: CAMPUS_ORIGIN.y + 114 },
  { kind: 'sign', x: CAMPUS_ORIGIN.x + 1070, y: CAMPUS_ORIGIN.y + 12 },
  { kind: 'bench', x: CAMPUS_ORIGIN.x + 600, y: CAMPUS_ORIGIN.y + 710 },
  { kind: 'bench', x: CAMPUS_ORIGIN.x + 1350, y: CAMPUS_ORIGIN.y + 710 },
  { kind: 'bin', x: CAMPUS_ORIGIN.x + 1690, y: CAMPUS_ORIGIN.y + 420 },
  { kind: 'bike', x: CAMPUS_ORIGIN.x + 1880, y: CAMPUS_ORIGIN.y + 700 },
  { kind: 'table', x: CAMPUS_ORIGIN.x + 1000, y: CAMPUS_ORIGIN.y + 380 },
  { kind: 'table', x: CAMPUS_ORIGIN.x + 250, y: CAMPUS_ORIGIN.y + 670 },
  { kind: 'table', x: CAMPUS_ORIGIN.x + 1900, y: CAMPUS_ORIGIN.y + 620 },
  // 洗手台贴南墙（墙内缘 y+350），水龙头朝墙、台盆朝北，人从房间一侧使用；
  // 两组中间让开南墙门洞 x+1550–x+1610，进出不会被台面挡住
  { kind: 'sink', x: CAMPUS_ORIGIN.x + 1420, y: CAMPUS_ORIGIN.y + 350 },
  { kind: 'sink', x: CAMPUS_ORIGIN.x + 1500, y: CAMPUS_ORIGIN.y + 350 },
  { kind: 'sink', x: CAMPUS_ORIGIN.x + 1660, y: CAMPUS_ORIGIN.y + 350 },
  { kind: 'sink', x: CAMPUS_ORIGIN.x + 1740, y: CAMPUS_ORIGIN.y + 350 },
];

/**
 * 工作区陈设：咖啡机与饮水机靠东墙、绿植与垃圾桶守门侧。
 * 门在西墙 y+160–y+220，门口那一条走道保持空着。
 */
export const WORK_PROPS: PropInstance[] = [
  { kind: 'coffee', x: WORKROOM_ORIGIN.x + 420, y: WORKROOM_ORIGIN.y + 240 },
  { kind: 'cooler', x: WORKROOM_ORIGIN.x + 420, y: WORKROOM_ORIGIN.y + 140 },
  { kind: 'plant', x: WORKROOM_ORIGIN.x + 30, y: WORKROOM_ORIGIN.y + 50 },
  { kind: 'bin', x: WORKROOM_ORIGIN.x + 30, y: WORKROOM_ORIGIN.y + 330 },
];

/** 休息室陈设：床头小几、落地灯、绿植与垃圾桶，都是不挡路的小件 */
export const LOUNGE_PROPS: PropInstance[] = [
  { kind: 'sideTable', x: LOUNGE_ORIGIN.x + 295, y: LOUNGE_ORIGIN.y + 280 },
  { kind: 'lamp', x: LOUNGE_ORIGIN.x + 425, y: LOUNGE_ORIGIN.y + 330 },
  { kind: 'plant', x: LOUNGE_ORIGIN.x + 40, y: LOUNGE_ORIGIN.y + 330 },
  { kind: 'bin', x: LOUNGE_ORIGIN.x + 425, y: LOUNGE_ORIGIN.y + 30 },
];

/** 工作区门前的铺装：把门洞接到办公区东缘，贴花不进入。休息室南门直接接北岸横路。 */
export const DOOR_PAVING: WorldRect[] = [
  { x: WORKROOM_ORIGIN.x - 124, y: WORKROOM_ORIGIN.y + 140, w: 124, h: 100 },
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
  MEETING_TABLE,
];

/** 会议室与卫生间的座位：椅子在前，马桶在后 */
export const CAMPUS_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  ...MEETING_SEATS.map((seat) => ({ ...seat, kind: 'chair' as const })),
  ...TOILET_SEATS.map((seat) => ({ ...seat, kind: 'toilet' as const })),
];

/**
 * 办公广场的灯、垃圾桶、长椅、售货机与绿植。
 * 加密到 28 件：四边灯柱 + 沿街长椅 + 内圈花箱旁的咖啡座，把 1120×936 的广场填满。
 */
export const PLAZA_PROPS: PropInstance[] = [
  // 四角灯柱与绿植
  { kind: 'lamp', x: 3560, y: 3652 },
  { kind: 'plant', x: 3612, y: 3640 },
  { kind: 'lamp', x: 4632, y: 3652 },
  { kind: 'plant', x: 4570, y: 3640 },
  { kind: 'lamp', x: 3560, y: 4540 },
  { kind: 'plant', x: 3612, y: 4528 },
  { kind: 'lamp', x: 4632, y: 4540 },
  { kind: 'plant', x: 4570, y: 4528 },
  // 售货机与垃圾桶
  { kind: 'vending', x: 4612, y: 3700 },
  { kind: 'vending', x: 4612, y: 4480 },
  { kind: 'bin', x: 3570, y: 3700 },
  { kind: 'bin', x: 4622, y: 4540 },
  // 沿街长椅
  { kind: 'bench', x: 3700, y: 3600 },
  { kind: 'bench', x: 4430, y: 3600 },
  { kind: 'bench', x: 3700, y: 4596 },
  { kind: 'bench', x: 4430, y: 4596 },
  { kind: 'bench', x: 3580, y: 4000 },
  { kind: 'bench', x: 3580, y: 4200 },
  { kind: 'bench', x: 4620, y: 4000 },
  { kind: 'bench', x: 4620, y: 4200 },
  // 广场中心的咖啡座：四组小桌 + 绿植，出生点四周不再是一张空桌布
  { kind: 'table', x: 3820, y: 3900 },
  { kind: 'table', x: 4370, y: 3900 },
  { kind: 'table', x: 3820, y: 4290 },
  { kind: 'table', x: 4370, y: 4290 },
  { kind: 'plant', x: 3960, y: 3880 },
  { kind: 'plant', x: 4230, y: 3880 },
  { kind: 'plant', x: 3960, y: 4310 },
  { kind: 'plant', x: 4230, y: 4310 },
  // 北入口与南向主路口的指路牌
  { kind: 'sign', x: 3860, y: 3384 },
  { kind: 'sign', x: 4300, y: 4810 },
];
