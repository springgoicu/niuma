/**
 * 牛马园四角院落：北门进入后一院四房，南侧另有一片休息庭院。
 *
 * 与 layout.ts 同一条纪律：坐标全部手写，不依赖 Math.random / Math.sin / Math.cos。
 * 本文件只描述「是什么」，渲染材质与贴图由 apps/web 决定。
 *
 * ADR-0044：办公区收窄为 1520×1240 的四角院落，四间房各占一角、门朝中央中庭：
 * - 西北 工作区：唯一不加墙的开放区，两排背靠背工位横向成排；
 * - 东北 会议室：四面墙、南墙开门；
 * - 西南 宿舍区：四面墙、北墙开门，两组上下铺（每铺两张 bed 座位）；
 * - 东南 卫生间：四面墙、北墙开门，男 / 中央洗手池 / 女 三区。
 *
 * 四间房的矩形全部由「院落 + 房间尺寸」推出，改院落尺寸只改上面两行。
 */

import { DIRECTION, POSE, type Direction, type Pose } from '../constants';
import type { WorldRect } from './geometry';

/**
 * 座位种类：
 * - `chair` 工位椅 / 会议椅，`toilet` 马桶，`stool` 凳子，`sofa` 沙发：入座即坐姿；
 * - `bed` 单人床：入座即躺姿（ADR-0020 的「座位上不能躺」在此按种类放开）。
 *
 * 上下铺不新增种类：每个铺位就是一张 `bed` 座位，两层各一张，见下方的 LOUNGE_SEATS。
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
  | 'hedge'
  | 'ladder'
  | 'logo';

/** 纯装饰（或带碰撞的小设施）：渲染端按 kind 选贴图 */
export interface PropInstance {
  kind: PropKind;
  x: number;
  y: number;
  /** 仅 logo 使用：0 工作区 / 1 会议室 / 2 宿舍区 / 3 卫生间 */
  variant?: number;
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
 * 树篱、灯、垃圾桶、绿植、标识、爬梯、logo 等小件不在表里 —— `propSolid` 返回 undefined。
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

/** 房间统一尺寸：四角各一间，贴院落四角 */
export const ROOM_W = 460;
export const ROOM_H = 360;

/**
 * 四角院落（也是 `WORLD_LAYOUT.office`）：北门正对，中心仍是世界中心 (4096,4096)。
 * 1520 = 460 + 600 + 460，1240 = 360 + 520 + 360 —— 中间的 600×520 就是中庭。
 */
export const CAMPUS_RECT: WorldRect = { x: 3336, y: 3476, w: 1520, h: 1240 };

/** 西北：开放工作区（无墙） */
export const WORKROOM: WorldRect = { x: CAMPUS_RECT.x, y: CAMPUS_RECT.y, w: ROOM_W, h: ROOM_H };
/** 东北：会议室 */
export const MEETING_ROOM: WorldRect = {
  x: CAMPUS_RECT.x + CAMPUS_RECT.w - ROOM_W,
  y: CAMPUS_RECT.y,
  w: ROOM_W,
  h: ROOM_H,
};
/** 西南：宿舍区（显示名；标识符沿用 LOUNGE，避免 HUD 与测试大改） */
export const LOUNGE: WorldRect = {
  x: CAMPUS_RECT.x,
  y: CAMPUS_RECT.y + CAMPUS_RECT.h - ROOM_H,
  w: ROOM_W,
  h: ROOM_H,
};
/** 东南：卫生间 */
export const RESTROOM: WorldRect = {
  x: CAMPUS_RECT.x + CAMPUS_RECT.w - ROOM_W,
  y: CAMPUS_RECT.y + CAMPUS_RECT.h - ROOM_H,
  w: ROOM_W,
  h: ROOM_H,
};

/**
 * 南侧休息庭院（原研发园）：会议室与卫生间搬进四角后只留铺装与休憩设施。
 * 北缘 5140 接南向主路，铺装内收 40 留给草缘。
 */
export const SOUTH_YARD: WorldRect = { x: 3336, y: 5140, w: 1520, h: 560 };
export const SOUTH_YARD_PAVING: WorldRect = { x: 3376, y: 5160, w: 1440, h: 520 };

/**
 * 导览目标的到达点（ADR-0040）：进门后的可站立空地。
 *
 * 四个房间的几何中心分别是工位桌、会议桌、上下铺与洗手池，
 * 不能直接当寻路终点；这里按「房间 + 偏移」手写落点，
 * 由 `nav-arrival` 测试断言不撞任何碰撞体。
 */
export const NAV_ARRIVALS = {
  meeting: { x: MEETING_ROOM.x + 360, y: MEETING_ROOM.y + 314 },
  restroom: { x: RESTROOM.x + 230, y: RESTROOM.y + 70 },
  lounge: { x: LOUNGE.x + 230, y: LOUNGE.y + 70 },
  workroom: { x: WORKROOM.x + 230, y: WORKROOM.y + 294 },
} as const;

/** 墙厚：碰撞与视觉共用，玩家半径 9 贴墙时不会穿过 10px 墙体 */
export const WALL_THICKNESS = 10;
/** 门洞区间：会议室朝南（面向中庭），宿舍区与卫生间朝北 */
const MEETING_DOOR: DoorSpec = {
  side: 'south',
  from: MEETING_ROOM.x + 330,
  to: MEETING_ROOM.x + 390,
};
const RESTROOM_DOOR: DoorSpec = {
  side: 'north',
  from: RESTROOM.x + 200,
  to: RESTROOM.x + 260,
};
const LOUNGE_DOOR: DoorSpec = {
  side: 'north',
  from: LOUNGE.x + 200,
  to: LOUNGE.x + 260,
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
 * 工位桌精灵的深度键相对桌心的偏移（ADR-0032）。
 *
 * 深度键 = 桌心 y + 本偏移。南北朝向取占地南边（前景边缘，与 ADR-0029 一致）；
 * 东西朝向的桌心与座位锚点同 y（`workstation()` 只沿 x 让开座位），
 * 若仍取南边（+44）就会把椅子（`seat.y - 1`）与坐着的人（`seat.y`）压到桌下，
 * 因此让到它们之后再两格，形成「人 > 椅子 > 桌子」的显式全序。
 */
export function deskDepthOffset(facing: Direction): number {
  const horizontal = facing === DIRECTION.Left || facing === DIRECTION.Right;
  return horizontal ? -2 : DESK_H / 2;
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
 * 东西向的门与南北门共用同一套拆分逻辑，新房间不必再各写一份。
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

const meetingSolids = roomWalls(MEETING_ROOM, MEETING_DOOR);
const restroomSolids = roomWalls(RESTROOM, RESTROOM_DOOR);
const loungeSolids = roomWalls(LOUNGE, LOUNGE_DOOR);

/**
 * 卫生间三区（自西向东）：男 140 / 洗手池 140 / 女 140。
 * 两道 10px 内隔墙各留一扇 60px 门洞，中央区从北门直进，
 * 两侧要绕过隔墙才能进——这是「男女生分割 + 中间洗手池」的几何。
 */
const RESTROOM_ZONE_W = 140;
const RESTROOM_LANE_W = RESTROOM_ZONE_W + WALL_THICKNESS;
const RESTROOM_DIVIDER_X = [
  RESTROOM.x + WALL_THICKNESS + RESTROOM_ZONE_W,
  RESTROOM.x + WALL_THICKNESS + RESTROOM_LANE_W + RESTROOM_ZONE_W,
] as const;
const RESTROOM_DIVIDER_GAP_FROM = RESTROOM.y + 200;
const RESTROOM_DIVIDER_GAP_TO = RESTROOM.y + 260;

const restroomDividers: SolidRect[] = RESTROOM_DIVIDER_X.flatMap((x) => [
  {
    kind: 'wall' as const,
    x,
    y: RESTROOM.y + WALL_THICKNESS,
    w: WALL_THICKNESS,
    h: RESTROOM_DIVIDER_GAP_FROM - (RESTROOM.y + WALL_THICKNESS),
  },
  {
    kind: 'wall' as const,
    x,
    y: RESTROOM_DIVIDER_GAP_TO,
    w: WALL_THICKNESS,
    h: RESTROOM.y + RESTROOM.h - WALL_THICKNESS - RESTROOM_DIVIDER_GAP_TO,
  },
]);

/** 卫生间每侧两个马桶的横向中心：男 4440/4512、女 4740/4812 */
const TOILET_XS = [
  RESTROOM.x + 44,
  RESTROOM.x + 116,
  RESTROOM.x + 344,
  RESTROOM.x + 416,
] as const;
/** 马桶贴房间北墙：与旧卫生间同一档「水箱离墙 56px」的坐点 */
const TOILET_SEAT_Y = RESTROOM.y + WALL_THICKNESS + 78;

/** 隔间隔断：男、女各一道 6px 短隔断，夹住两个马桶 */
const stallPartitions: SolidRect[] = [
  { kind: 'fixture', x: RESTROOM.x + 77, y: RESTROOM.y + WALL_THICKNESS, w: 6, h: 154 },
  { kind: 'fixture', x: RESTROOM.x + 377, y: RESTROOM.y + WALL_THICKNESS, w: 6, h: 154 },
];

/** 会议桌：200×90，居中偏北，南侧留出走道 */
const MEETING_TABLE: SolidRect = {
  kind: 'fixture',
  x: MEETING_ROOM.x + 140,
  y: MEETING_ROOM.y + 142,
  w: 200,
  h: 90,
};

/** 会议桌两侧的椅子：北侧 3 把朝南，南侧 3 把朝北 */
const MEETING_SEATS: Array<{ x: number; y: number; facing: Direction }> = [
  { x: MEETING_ROOM.x + 184, y: MEETING_ROOM.y + 116, facing: DIRECTION.Down },
  { x: MEETING_ROOM.x + 250, y: MEETING_ROOM.y + 116, facing: DIRECTION.Down },
  { x: MEETING_ROOM.x + 316, y: MEETING_ROOM.y + 116, facing: DIRECTION.Down },
  { x: MEETING_ROOM.x + 184, y: MEETING_ROOM.y + 258, facing: DIRECTION.Up },
  { x: MEETING_ROOM.x + 250, y: MEETING_ROOM.y + 258, facing: DIRECTION.Up },
  { x: MEETING_ROOM.x + 316, y: MEETING_ROOM.y + 258, facing: DIRECTION.Up },
];

/**
 * 会议桌两端的椅子：与南北两侧合起来是一圈 8 把。
 * 桌沿在 x+140 / x+340，端椅中心外扩 16px——既让开 200×90 的桌体，
 * 也满足座位两两距离 > 40 与「不被碰撞体挡住」的既有断言。
 */
const MEETING_END_SEATS: Array<{ x: number; y: number; facing: Direction }> = [
  { x: MEETING_ROOM.x + 124, y: MEETING_ROOM.y + 187, facing: DIRECTION.Right },
  { x: MEETING_ROOM.x + 356, y: MEETING_ROOM.y + 187, facing: DIRECTION.Left },
];

/** 卫生间马桶：水箱在精灵北端，人面朝房间（南）坐下，背靠水箱 */
const TOILET_SEATS = TOILET_XS.map((cx) => ({ x: cx, y: TOILET_SEAT_Y, facing: DIRECTION.Down as Direction }));

/**
 * 工作区的八个工位：两排背靠背、每排 4 张，横向成排。
 *
 * 北排屏幕朝北、椅子在南；南排屏幕朝南、椅子在北，两排椅子在中间背靠背，
 * 列距 104、排距 120，正好落在 460×360 的开放木地板上。
 */
const WORK_DESK_XS = [
  WORKROOM.x + 74,
  WORKROOM.x + 178,
  WORKROOM.x + 282,
  WORKROOM.x + 386,
] as const;
const WORK_DESK_NORTH_Y = WORKROOM.y + 122;
const WORK_DESK_SOUTH_Y = WORKROOM.y + 246;

export const WORKSTATIONS: ReadonlyArray<Workstation> = [
  ...WORK_DESK_XS.map((x) => workstation(x, WORK_DESK_NORTH_Y, DIRECTION.Up)),
  ...WORK_DESK_XS.map((x) => workstation(x, WORK_DESK_SOUTH_Y, DIRECTION.Down)),
];

/**
 * 宿舍区的七个座位：两组上下铺（每组上下两张床，共 4 个铺位）+
 * 一张沙发 + 两张凳子。上下两层相距 44px：既读得出「下铺在更近的前景」，
 * 又满足座位表「两两间距 > 40」的既有断言。
 */
export const LOUNGE_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  { x: LOUNGE.x + 110, y: LOUNGE.y + 140, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 110, y: LOUNGE.y + 184, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 110, y: LOUNGE.y + 254, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 110, y: LOUNGE.y + 298, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 304, y: LOUNGE.y + 74, facing: DIRECTION.Down, kind: 'sofa' },
  { x: LOUNGE.x + 264, y: LOUNGE.y + 174, facing: DIRECTION.Down, kind: 'stool' },
  { x: LOUNGE.x + 344, y: LOUNGE.y + 174, facing: DIRECTION.Down, kind: 'stool' },
];

/** 四区门口的 logo 立牌：variant 与渲染端的四个图标一一对应，不参与碰撞 */
export const AREA_LOGOS: PropInstance[] = [
  { kind: 'logo', variant: 0, x: CAMPUS_RECT.x + 478, y: CAMPUS_RECT.y + 370 },
  { kind: 'logo', variant: 1, x: MEETING_ROOM.x + 344, y: MEETING_ROOM.y + 386 },
  { kind: 'logo', variant: 2, x: LOUNGE.x + 270, y: LOUNGE.y - 16 },
  { kind: 'logo', variant: 3, x: RESTROOM.x + 270, y: RESTROOM.y - 16 },
];

/**
 * 南侧休息庭院：灯柱四面、绿植四角、长椅与野餐桌沿边、单车与指路牌点缀。
 * 原先会议室/卫生间的陈设随房间搬走，这里只保留户外高频家具。
 */
export const SOUTH_YARD_PROPS: PropInstance[] = [
  { kind: 'lamp', x: 3416, y: 5200 },
  { kind: 'lamp', x: 4776, y: 5200 },
  { kind: 'lamp', x: 3416, y: 5620 },
  { kind: 'lamp', x: 4776, y: 5620 },
  { kind: 'plant', x: 3500, y: 5200 },
  { kind: 'plant', x: 4690, y: 5200 },
  { kind: 'plant', x: 3500, y: 5600 },
  { kind: 'plant', x: 4690, y: 5600 },
  { kind: 'bench', x: 3700, y: 5620 },
  { kind: 'bench', x: 4490, y: 5620 },
  { kind: 'bench', x: 4096, y: 5480 },
  { kind: 'table', x: 3800, y: 5320 },
  { kind: 'table', x: 4400, y: 5320 },
  { kind: 'bike', x: 4740, y: 5600 },
  { kind: 'sign', x: 4250, y: 5190 },
  { kind: 'bin', x: 3540, y: 5400 },
];

/**
 * 会议室陈设：西南角绿植、东北角垃圾桶。
 * 北墙超宽投屏与西墙白板立架都是无碰撞贴墙陈设，统一由 `interior-art.ts` 绘制；
 * 旧的白板 prop 会让北墙投屏无处安放，因此这里不再保留。
 */
export const MEETING_PROPS: PropInstance[] = [
  { kind: 'plant', x: MEETING_ROOM.x + 34, y: MEETING_ROOM.y + 334 },
  { kind: 'bin', x: MEETING_ROOM.x + 424, y: MEETING_ROOM.y + 30 },
];

/** 卫生间陈设：中央区南墙两个洗手台，门口一只垃圾桶 */
export const RESTROOM_PROPS: PropInstance[] = [
  { kind: 'sink', x: RESTROOM.x + 194, y: RESTROOM.y + 350 },
  { kind: 'sink', x: RESTROOM.x + 264, y: RESTROOM.y + 350 },
  { kind: 'bin', x: RESTROOM.x + 176, y: RESTROOM.y + 44 },
];

/** 工作区陈设：咖啡机与饮水机靠南缘，绿植与垃圾桶守两角；开放区没有墙可依 */
export const WORK_PROPS: PropInstance[] = [
  { kind: 'coffee', x: WORKROOM.x + 84, y: WORKROOM.y + 330 },
  { kind: 'cooler', x: WORKROOM.x + 164, y: WORKROOM.y + 330 },
  { kind: 'plant', x: WORKROOM.x + 16, y: WORKROOM.y + 24 },
  { kind: 'bin', x: WORKROOM.x + 16, y: WORKROOM.y + 334 },
];

/** 宿舍区陈设：两组上下铺各配一架爬梯，靠东一侧沙发 + 床头几 + 两张凳子 */
export const LOUNGE_PROPS: PropInstance[] = [
  { kind: 'ladder', x: LOUNGE.x + 170, y: LOUNGE.y + 190 },
  { kind: 'ladder', x: LOUNGE.x + 170, y: LOUNGE.y + 304 },
  { kind: 'sideTable', x: LOUNGE.x + 304, y: LOUNGE.y + 214 },
  { kind: 'plant', x: LOUNGE.x + 404, y: LOUNGE.y + 324 },
  { kind: 'bin', x: LOUNGE.x + 404, y: LOUNGE.y + 34 },
];

/** 三个有门房间的门前铺装：把门洞接到草地，贴花不进入 */
export const DOOR_PAVING: WorldRect[] = [
  { x: MEETING_ROOM.x + 326, y: MEETING_ROOM.y + 360, w: 68, h: 36 },
  { x: LOUNGE.x + 196, y: LOUNGE.y - 36, w: 68, h: 36 },
  { x: RESTROOM.x + 196, y: RESTROOM.y - 36, w: 68, h: 36 },
];

export const CAMPUS_BUILDINGS: BuildingSpec[] = [
  { name: '工作区', rect: WORKROOM, floor: 'wood' },
  { name: '会议室', rect: MEETING_ROOM, floor: 'wood' },
  { name: '宿舍区', rect: LOUNGE, floor: 'carpet' },
  { name: '卫生间', rect: RESTROOM, floor: 'tile' },
];

/**
 * 三间有墙房间的墙体，加上卫生间两道内隔墙、两组隔间与会议桌。
 * 工作区按需求不加墙，因此这里没有它的任何碰撞矩形。
 */
export const CAMPUS_SOLIDS: SolidRect[] = [
  ...meetingSolids,
  ...restroomSolids,
  ...loungeSolids,
  ...restroomDividers,
  ...stallPartitions,
  MEETING_TABLE,
];

/**
 * 会议室与卫生间的座位：椅子在前，马桶在后。
 * 两把端椅追加在末尾，既有会议椅与马桶的 id 不会整体后移。
 */
export const CAMPUS_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  ...MEETING_SEATS.map((seat) => ({ ...seat, kind: 'chair' as const })),
  ...TOILET_SEATS.map((seat) => ({ ...seat, kind: 'toilet' as const })),
  ...MEETING_END_SEATS.map((seat) => ({ ...seat, kind: 'chair' as const })),
];
