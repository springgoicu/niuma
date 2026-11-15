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
 * - `chair` 工位椅 / 会议椅，`toilet` 马桶，`stool` 凳子，`sofa` 单人沙发：入座即坐姿；
 * - `couch` 双人沙发的一侧：左右两半各画一张，两张座位拼成一张 124px 长沙发；
 * - `cinema` 影厅座椅：几何复用椅子的座面契约，只换配色；
 * - `bench` 户外长椅：外观继续走道具管线，座位只提供坐点；
 * - `bed` 单人床：入座即躺姿（ADR-0020 的「座位上不能躺」在此按种类放开）。
 *
 * 上下铺不新增种类：每个铺位就是一张 `bed` 座位，两层各一张，见下方的 LOUNGE_SEATS。
 */
export type SeatKind = 'chair' | 'toilet' | 'stool' | 'sofa' | 'couch' | 'cinema' | 'bench' | 'bed' | 'drum';

/**
 * 长椅坐点相对长椅底座的偏移（像素）：坐点在椅面正前方 12px。
 *
 * 长椅本体保留 40×16 的碰撞，坐点必须落在碰撞盒外（玩家半径 9），
 * 因此不能直接取底座中心；12px 是「贴前沿坐下」与「不压自身碰撞」的折中。
 * `apps/web/lib/game/seat-art.ts` 用同一个偏移推导座面接触高度。
 */
export const BENCH_SEAT_OFFSET = 12;

/**
 * 座位锚点：入座后角色的世界坐标。`id` 从 1 开始，0 保留为「无座位」。
 * `facing` 是入座后面朝的方向（工位朝向桌子，马桶朝向墙，床朝床尾）。
 * `desk` 指向 WORLD_LAYOUT.desks 的下标，没有桌子时为 -1，用于显示屏点亮。
 * `variant` 只给需要左右拼装的家具用（`couch` 0 = 左半、1 = 右半）。
 */
export interface SeatInstance {
  id: number;
  x: number;
  y: number;
  facing: Direction;
  kind: SeatKind;
  desk: number;
  variant?: number;
  /**
   * 座位组（可选）：同一张赌桌、同一排观战长椅共用一个组 id。
   *
   * 热区表用 `seatGroupId` 指向它，赌桌公共局与长椅押注据此判断
   * 「我坐的是哪一桌 / 哪一排」，不必再按像素距离反推。
   */
  group?: string;
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
  /** 客厅茶几：矮桌，只挡桌面下方那一截 */
  | 'coffeeTable'
  | 'hedge'
  | 'ladder'
  | 'logo'
  /**
   * 牛马放假告示板（ADR-0059）：全图只有一块，坐标与底座碰撞由
   * `layout.ts` 的 `BULLETIN_BOARD` / `BULLETIN_BOARD_SOLID` 单点定义。
   * 因此这里不进 `PROP_FOOTPRINT`——碰撞不按道具尺寸推导，避免第二份尺寸表。
   */
  | 'bulletin'
  /** 翠竹（ADR-0061）：一丛 3–5 根，variant 决定疏密与高度，底座很窄，人能从竹间穿过 */
  | 'bamboo'
  /** 太湖石叠石盆景（ADR-0061）：variant 0 带透光孔洞的太湖石，1 青石叠景 */
  | 'taihu';

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
 * `bulletin`（放假告示板）也不在：它的底座尺寸由 `layout.ts` 的 `BULLETIN_BOARD` 派生，
 * 只保留一处真相，不再抄一份 80×20 进来。
 */
const PROP_FOOTPRINT: Partial<Record<PropKind, { w: number; h: number }>> = {
  vending: { w: 32, h: 24 },
  cooler: { w: 20, h: 24 },
  coffee: { w: 22, h: 24 },
  bench: { w: 40, h: 16 },
  table: { w: 40, h: 28 },
  // 客厅茶几：48×24 的矮桌，碰撞只取桌面下方的 44×12
  coffeeTable: { w: 44, h: 12 },
  bike: { w: 38, h: 14 },
  // 竹丛的碰撞只取根部一窄条：竹竿之间有缝，整丛挡人会像一道墙
  bamboo: { w: 22, h: 10 },
  // 太湖石：底座的石座占 26×16，石身悬在上面不挡人
  taihu: { w: 26, h: 16 },
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

/**
 * 地板家族：纯表现枚举，服务端只搬运、不解释。
 *
 * `felt` / `walnut` / `plaster` 是「场所自带场地味」这一轮补的三档：
 * 墨绿绒（赌场）、胡桃拼花（会议室与两栋小院）、暖灰抹面（公寓）。
 * 加一档只影响渲染层的 `fillBuildingFloor` 分派，协议与碰撞都不动。
 */
export type FloorKind =
  | 'wood'
  | 'walnut'
  | 'tile'
  | 'carpet'
  | 'cinema'
  | 'rubber'
  | 'concrete'
  | 'felt'
  | 'plaster';

export interface BuildingSpec {
  name: string;
  rect: WorldRect;
  floor: FloorKind;
}

/** 房间统一尺寸：企业楼上下两排，每排两间 */
export const ROOM_W = 460;
export const ROOM_H = 360;

/**
 * 卫生间单独收小（ADR-0077）：460×360 → 340×300。
 * 净宽 320 = 100（男）+ 10（隔墙）+ 100（洗手池）+ 10（隔墙）+ 100（女），
 * 每侧从 3 格坑位降到 2 格，房间不再是「半座空房」。
 *
 * ADR-0097：卫生间搬出企业楼，独立立在服务区广场北侧，门朝广场。
 */
export const RESTROOM_W = 340;
export const RESTROOM_H = 300;

/**
 * 企业楼（也是 `WORLD_LAYOUT.office`，ADR-0097）：一栋 920×760 的两层小楼，
 * 坐落在中央广场正西的前庭之后。北排两间（工作区 / 会议室），中间一条 40px 走廊，
 * 南排一整间发泄室；走廊东端敞口，就是公司大门。
 *
 * 楼不再像旧四角院落那样围住广场：广场独立成市政中心，五个方向各接一条街。
 */
export const CAMPUS_RECT: WorldRect = { x: 2620, y: 3200, w: 920, h: 760 };

/** 北排西：开放工作区（无墙，两排背靠背工位） */
export const WORKROOM: WorldRect = { x: CAMPUS_RECT.x, y: CAMPUS_RECT.y, w: ROOM_W, h: ROOM_H };
/** 北排东：会议室（南墙开门，朝走廊） */
export const MEETING_ROOM: WorldRect = {
  x: CAMPUS_RECT.x + ROOM_W,
  y: CAMPUS_RECT.y,
  w: ROOM_W,
  h: ROOM_H,
};
/** 楼内走廊：北排与南排之间 40px，东端敞口即大门 */
export const COMPANY_CORRIDOR: WorldRect = {
  x: CAMPUS_RECT.x,
  y: CAMPUS_RECT.y + ROOM_H,
  w: CAMPUS_RECT.w,
  h: 40,
};
/** 南排：发泄室（整排一间 920×360，橡胶地 + 老板） */
export const VENT_ROOM: WorldRect = {
  x: CAMPUS_RECT.x,
  y: CAMPUS_RECT.y + ROOM_H + 40,
  w: CAMPUS_RECT.w,
  h: ROOM_H,
};
/**
 * 生活区宿舍：与企业楼分家，落到生活大街南侧（ADR-0097）。
 * 显示名仍是「宿舍区」，标识符沿用 LOUNGE，避免 HUD 与测试大改。
 */
export const LOUNGE: WorldRect = { x: 3820, y: 5400, w: ROOM_W, h: ROOM_H };
/** 服务区卫生间：独立小楼，门朝北面的服务广场 */
export const RESTROOM: WorldRect = {
  x: 4600,
  y: 3660,
  w: RESTROOM_W,
  h: RESTROOM_H,
};

/* ------------------------------------------------------------------ *
 * 家庭影音室（本轮新增）
 *
 * 落在校园与南侧庭院之间的草地：北缘离 CAMPUS_RECT 南沿 74px，
 * 南缘离 SOUTH_YARD 北沿 30px，东墙外 200px 就是南向主路。
 * 门开在东墙，进门后是东侧走道，三排座椅面朝北墙的大屏幕。
 * ------------------------------------------------------------------ */

export const HOME_THEATER: WorldRect = { x: 3200, y: 5400, w: 460, h: 320 };
/** 东墙门洞：与生活大街接出来的支路同一条 y */
export const HOME_THEATER_DOOR: DoorSpec = {
  side: 'east',
  from: HOME_THEATER.y + 130,
  to: HOME_THEATER.y + 190,
};
/** 门前铺装：从墙外接到生活大街 */
export const HOME_THEATER_DOOR_PAVING: WorldRect = {
  x: HOME_THEATER.x + HOME_THEATER.w,
  y: HOME_THEATER.y + 130,
  w: 120,
  h: 60,
};

/** 北墙大屏幕：260×60，居中压在三排座位上 */
export const THEATER_SCREEN = {
  x: HOME_THEATER.x + 62,
  y: HOME_THEATER.y + 2,
  w: 260,
  h: 60,
} as const;

/**
 * 四只环绕音箱：前左 / 前右 / 后左 / 后右。
 * 只描述挂点（中心），具体像素画由 `interior-art.ts` 决定。
 */
export const THEATER_SPEAKERS: ReadonlyArray<{ x: number; y: number }> = [
  { x: HOME_THEATER.x + 22, y: HOME_THEATER.y + 50 },
  { x: HOME_THEATER.x + 438, y: HOME_THEATER.y + 50 },
  { x: HOME_THEATER.x + 22, y: HOME_THEATER.y + 280 },
  { x: HOME_THEATER.x + 438, y: HOME_THEATER.y + 280 },
];

/** 三排 × 五列影厅座椅：全部面朝北墙屏幕（Up），列距 56、排距 60 */
const THEATER_SEAT_XS = [
  HOME_THEATER.x + 80,
  HOME_THEATER.x + 136,
  HOME_THEATER.x + 192,
  HOME_THEATER.x + 248,
  HOME_THEATER.x + 304,
] as const;
const THEATER_ROW_YS = [HOME_THEATER.y + 110, HOME_THEATER.y + 170, HOME_THEATER.y + 230] as const;

export const THEATER_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = THEATER_ROW_YS.flatMap((y) =>
  THEATER_SEAT_XS.map((x) => ({ x, y, facing: DIRECTION.Up, kind: 'cinema' as const })),
);

/* ------------------------------------------------------------------ *
 * 小黑屋（ADR-0072 / ADR-0077）
 *
 * 与家庭影音室隔南向主路东西对称：北缘离四角院落 74px，南缘离南侧
 * 庭院 110px，西门接一条和影厅支路同高的支路。进门是一间水泥房，
 * 没有座位、没有出口以外的互动，只留一个反省点让被押来的人坐下。
 *
 * ADR-0077 把房间从 460×320 收到 320×240：西墙、门洞、门前铺装与
 * y=4950 的支路全部不动，只把东墙与南墙收进来，三个反省位更紧凑。
 * ------------------------------------------------------------------ */

export const JAIL: WorldRect = { x: 4600, y: 4040, w: 320, h: 240 };
/** 西墙门洞：开向服务广场 */
export const JAIL_DOOR: DoorSpec = {
  side: 'west',
  from: JAIL.y + 130,
  to: JAIL.y + 190,
};
/** 门前铺装：从墙外接到服务广场的 80px */
export const JAIL_DOOR_PAVING: WorldRect = {
  x: JAIL.x - 80,
  y: JAIL.y + 130,
  w: 80,
  h: 60,
};

/** 反省凳锚点：被押送者坐在这里，面朝北墙的警示海报 */
export const JAIL_ANCHOR = { x: JAIL.x + 150, y: JAIL.y + 190 } as const;
/** 同时关 3 人时的左右空位：以反省点为中心各让 48px */
export const JAIL_ANCHORS: ReadonlyArray<{ x: number; y: number }> = [
  { x: JAIL_ANCHOR.x - 48, y: JAIL_ANCHOR.y },
  JAIL_ANCHOR,
  { x: JAIL_ANCHOR.x + 48, y: JAIL_ANCHOR.y },
];

/** 墙厚：碰撞与视觉共用，玩家半径 9 贴墙时不会穿过 10px 墙体 */
export const WALL_THICKNESS = 10;
/** 门洞区间：会议室朝南（面向楼内走廊），发泄室朝北（面向同一条走廊） */
const MEETING_DOOR: DoorSpec = {
  side: 'south',
  from: MEETING_ROOM.x + 330,
  to: MEETING_ROOM.x + 390,
};
const VENT_DOOR: DoorSpec = {
  side: 'north',
  from: VENT_ROOM.x + 300,
  to: VENT_ROOM.x + 360,
};
/** 卫生间朝北（面向服务广场），宿舍区朝北（面向生活大街） */
const RESTROOM_DOOR: DoorSpec = {
  side: 'north',
  from: RESTROOM.x + 150,
  to: RESTROOM.x + 210,
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

/**
 * 工作区：楼体北 / 西两面外墙 + 朝走廊的整段敞口（ADR-0097）。
 * 门洞区间覆盖整条南沿，`roomWalls` 自然把南墙拆成零段——开放区仍然没有内墙。
 */
const workroomSolids = roomWalls(WORKROOM, {
  side: 'south',
  from: WORKROOM.x,
  to: WORKROOM.x + WORKROOM.w,
});
const meetingSolids = roomWalls(MEETING_ROOM, MEETING_DOOR);
const ventSolids = roomWalls(VENT_ROOM, VENT_DOOR);
const restroomSolids = roomWalls(RESTROOM, RESTROOM_DOOR);
const loungeSolids = roomWalls(LOUNGE, LOUNGE_DOOR);
const theaterSolids = roomWalls(HOME_THEATER, HOME_THEATER_DOOR);
const jailSolids = roomWalls(JAIL, JAIL_DOOR);

/**
 * 卫生间三区（自西向东）：男 100 / 洗手池 100 / 女 100。
 * 两道 10px 内隔墙各留一扇 60px 门洞，中央区从北门直进，
 * 两侧要绕过隔墙才能进——这是「男女生分割 + 中间洗手池」的几何。
 *
 * ADR-0077：房间收到 340 宽后，三个分区同比从 140 收到 100，
 * 净宽 320 = 100 × 3 + 10 × 2，两侧各 2 格坑位。
 *
 * 隔墙的视觉由 `interior-art.ts` 按本文件的 solids 反查后绘制（ADR-0053）：
 * 早先它只进碰撞、不进贴图，玩家会在门洞之外撞到一道看不见的墙。
 */
const RESTROOM_ZONE_W = 100;
const RESTROOM_LANE_W = RESTROOM_ZONE_W + WALL_THICKNESS;
const RESTROOM_DIVIDER_X = [
  RESTROOM.x + WALL_THICKNESS + RESTROOM_ZONE_W,
  RESTROOM.x + WALL_THICKNESS + RESTROOM_LANE_W + RESTROOM_ZONE_W,
] as const;

/** 隔断宽 6px、进深 154：28px 高的马桶整只落在格子里，南沿留出进出的空隙 */
const STALL_PARTITION_W = 6;
const STALL_PARTITION_H = 154;

/**
 * 内隔墙的门洞正好落在坑位排的前缘：从北门进来沿中央区走到这里，
 * 侧身就是男 / 女区，不用先绕到房间最南端再折回来。
 */
const RESTROOM_DIVIDER_GAP_FROM = RESTROOM.y + WALL_THICKNESS + STALL_PARTITION_H;
const RESTROOM_DIVIDER_GAP_TO = RESTROOM_DIVIDER_GAP_FROM + 60;

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

/**
 * 卫生间坑位（ADR-0053 / ADR-0077）：每侧两个，净宽 48 / 46 + 6px 隔断。
 *
 * 房间收到 340 宽后，一个分区只剩 100：48 + 6 + 46 = 100，正好铺满。
 * 48 在前、46 在后，让隔间木门与内隔墙之间留出 4px 余量，画起来不贴死。
 * 马桶落在格子中点，相邻两坑相距 53，仍满足座位表「两两间距 > 40」的断言。
 */
const STALL_WIDTHS = [48, 46] as const;

/** 一个坑位：净宽区间 + 进深，以及右邻的隔断（最东一格贴内隔墙，没有隔断） */
export interface RestroomStall {
  x: number;
  y: number;
  w: number;
  h: number;
  partition: SolidRect | null;
}

/** 从起点往东排一组坑位：最后一格抵住内隔墙，不再补隔断 */
function restroomStalls(startX: number): RestroomStall[] {
  const y = RESTROOM.y + WALL_THICKNESS;
  const stalls: RestroomStall[] = [];
  let cursor = startX;
  STALL_WIDTHS.forEach((w, index) => {
    const last = index === STALL_WIDTHS.length - 1;
    const partition: SolidRect | null = last
      ? null
      : { kind: 'fixture', x: cursor + w, y, w: STALL_PARTITION_W, h: STALL_PARTITION_H };
    stalls.push({ x: cursor, y, w, h: STALL_PARTITION_H, partition });
    cursor += w + STALL_PARTITION_W;
  });
  return stalls;
}

/**
 * 卫生间两排坑位：男区从西墙内侧起排，女区从第二道内隔墙内侧起排。
 * 座位、隔断碰撞与隔间渲染都读这一张表——再加减坑位只改 `STALL_WIDTHS`。
 */
export const RESTROOM_STALLS: ReadonlyArray<RestroomStall> = [
  ...restroomStalls(RESTROOM.x + WALL_THICKNESS),
  ...restroomStalls(RESTROOM_DIVIDER_X[1] + WALL_THICKNESS),
];

/** 马桶贴房间北墙：与旧卫生间同一档「水箱离墙 56px」的坐点 */
const TOILET_SEAT_Y = RESTROOM.y + WALL_THICKNESS + 78;

/** 隔间隔断：每侧一片，夹出两格 */
const stallPartitions: SolidRect[] = RESTROOM_STALLS.flatMap((stall) =>
  stall.partition ? [stall.partition] : [],
);

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
const TOILET_SEATS = RESTROOM_STALLS.map((stall) => ({
  x: stall.x + stall.w / 2,
  y: TOILET_SEAT_Y,
  facing: DIRECTION.Down as Direction,
}));

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
 * 宿舍区客厅：两组上下铺（4 个铺位）+ 双人沙发的左半 + 两张面朝茶几的凳子。
 *
 * 双人沙发由两个 62px 的半座拼成（variant 0 = 左半、1 = 右半），
 * 两半的中缝在 x+341 对齐，合起来是一张 124px 的长沙发。
 * 右半单独放在 `LOUNGE_COUCH_SECOND` 里、追加到座位表末尾，
 * 这样既有的工位 / 会议 / 马桶 / 上下铺 / 石鼓凳 id 不会整体后移
 * （浏览器 localStorage 的 `niuma:session:v1` 里存着 seatId）。
 *
 * 上下两层相距 44px：既读得出「下铺在更近的前景」，
 * 又满足座位表「两两间距 > 40」的既有断言。
 */
export const LOUNGE_SEATS: Array<Omit<SeatInstance, 'id' | 'desk'>> = [
  { x: LOUNGE.x + 110, y: LOUNGE.y + 140, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 110, y: LOUNGE.y + 184, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 110, y: LOUNGE.y + 254, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 110, y: LOUNGE.y + 298, facing: DIRECTION.Right, kind: 'bed' },
  { x: LOUNGE.x + 310, y: LOUNGE.y + 64, facing: DIRECTION.Down, kind: 'couch', variant: 0 },
  { x: LOUNGE.x + 310, y: LOUNGE.y + 174, facing: DIRECTION.Up, kind: 'stool' },
  { x: LOUNGE.x + 372, y: LOUNGE.y + 174, facing: DIRECTION.Up, kind: 'stool' },
];

/** 双人沙发的右半：追加到座位表末尾，保持既有座位 id 不漂移 */
export const LOUNGE_COUCH_SECOND: Omit<SeatInstance, 'id' | 'desk'> = {
  x: LOUNGE.x + 372,
  y: LOUNGE.y + 64,
  facing: DIRECTION.Down,
  kind: 'couch',
  variant: 1,
};

/** 各处门口的 logo 立牌：variant 与渲染端的图标一一对应，不参与碰撞 */
export const AREA_LOGOS: PropInstance[] = [
  { kind: 'logo', variant: 0, x: WORKROOM.x + 430, y: WORKROOM.y + 330 },
  { kind: 'logo', variant: 1, x: MEETING_ROOM.x + 400, y: MEETING_ROOM.y + 330 },
  { kind: 'logo', variant: 2, x: VENT_ROOM.x + 80, y: VENT_ROOM.y + 300 },
  { kind: 'logo', variant: 3, x: RESTROOM.x + 240, y: RESTROOM.y - 16 },
  { kind: 'logo', variant: 2, x: LOUNGE.x + 270, y: LOUNGE.y - 16 },
];

/**
 * 生活大街（ADR-0097）：公寓楼群南侧的东西向人行道，也是生活区的公共客厅。
 * 灯柱、绿植、长椅、野餐桌、单车与导览牌沿街摆放，数量与旧南院一致，
 * 长椅顺序不变，`seatId` 不会整体后移。
 */
export const LIVING_PROPS: PropInstance[] = [
  { kind: 'lamp', x: 3160, y: 5290 },
  { kind: 'lamp', x: 3500, y: 5290 },
  { kind: 'lamp', x: 3900, y: 5290 },
  { kind: 'lamp', x: 4420, y: 5290 },
  { kind: 'plant', x: 3240, y: 5290 },
  { kind: 'plant', x: 3620, y: 5290 },
  { kind: 'plant', x: 4100, y: 5290 },
  { kind: 'plant', x: 4560, y: 5290 },
  { kind: 'bench', x: 3340, y: 5320 },
  { kind: 'bench', x: 4060, y: 5320 },
  { kind: 'bench', x: 4520, y: 5320 },
  { kind: 'table', x: 3000, y: 5400 },
  { kind: 'table', x: 4560, y: 5400 },
  { kind: 'bike', x: 3040, y: 5500 },
  { kind: 'sign', x: 4160, y: 4740 },
  { kind: 'bin', x: 3140, y: 5290 },
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

/**
 * 卫生间陈设：中央区南墙两个洗手台，门口一只垃圾桶。
 * ADR-0077 后中央区只剩 100 宽（x+110 .. x+210），两个洗手台收在区内。
 */
export const RESTROOM_PROPS: PropInstance[] = [
  { kind: 'sink', x: RESTROOM.x + 146, y: RESTROOM.y + 290 },
  { kind: 'sink', x: RESTROOM.x + 190, y: RESTROOM.y + 290 },
  { kind: 'bin', x: RESTROOM.x + 134, y: RESTROOM.y + 44 },
];

/** 工作区陈设：咖啡机与饮水机靠南缘，绿植与垃圾桶守两角；开放区没有墙可依 */
export const WORK_PROPS: PropInstance[] = [
  { kind: 'coffee', x: WORKROOM.x + 84, y: WORKROOM.y + 330 },
  { kind: 'cooler', x: WORKROOM.x + 164, y: WORKROOM.y + 330 },
  { kind: 'plant', x: WORKROOM.x + 16, y: WORKROOM.y + 24 },
  { kind: 'bin', x: WORKROOM.x + 16, y: WORKROOM.y + 334 },
];

/** 宿舍区陈设：两组上下铺各配一架爬梯，沙发前一张低茶几，靠东一侧绿植与垃圾桶 */
export const LOUNGE_PROPS: PropInstance[] = [
  { kind: 'ladder', x: LOUNGE.x + 170, y: LOUNGE.y + 190 },
  { kind: 'ladder', x: LOUNGE.x + 170, y: LOUNGE.y + 304 },
  // 茶几落在沙发与凳子之间：北缘离沙发 38px、南缘离凳子 40px，两人并排坐下不顶膝盖
  { kind: 'coffeeTable', x: LOUNGE.x + 341, y: LOUNGE.y + 134 },
  { kind: 'plant', x: LOUNGE.x + 404, y: LOUNGE.y + 324 },
  { kind: 'bin', x: LOUNGE.x + 404, y: LOUNGE.y + 34 },
];

/** 有门房间的门前铺装：把门洞接到草地，贴花不进入 */
export const DOOR_PAVING: WorldRect[] = [
  { x: MEETING_ROOM.x + 326, y: MEETING_ROOM.y + 360, w: 68, h: 36 },
  { x: LOUNGE.x + 196, y: LOUNGE.y - 36, w: 68, h: 36 },
  { x: RESTROOM.x + 146, y: RESTROOM.y - 36, w: 68, h: 36 },
  HOME_THEATER_DOOR_PAVING,
  JAIL_DOOR_PAVING,
];

export const CAMPUS_BUILDINGS: BuildingSpec[] = [
  { name: '工作区', rect: WORKROOM, floor: 'wood' },
  { name: '会议室', rect: MEETING_ROOM, floor: 'walnut' },
  { name: '发泄区', rect: VENT_ROOM, floor: 'rubber' },
  { name: '宿舍区', rect: LOUNGE, floor: 'carpet' },
  { name: '卫生间', rect: RESTROOM, floor: 'tile' },
  { name: '家庭影音室', rect: HOME_THEATER, floor: 'cinema' },
  { name: '小黑屋', rect: JAIL, floor: 'concrete' },
];

/**
 * 财神供案：工作区入口内侧偏西一列，正对开放区的东南入口（ADR-0097 随房间派生）。
 * 底边压在南排工位桌之后（桌脚 y+266），不挡椅子也不挡进楼那条走廊。
 */
export const SHRINE_ALTAR = {
  x: WORKROOM.x + 404,
  y: WORKROOM.y + 324,
  width: 56,
  height: 44,
} as const;

/** 供案贴地碰撞：只挡下方 56×18 的案面+案腿，财神像与香炉在头顶 */
export const SHRINE_ALTAR_SOLID: WorldRect = {
  x: SHRINE_ALTAR.x - SHRINE_ALTAR.width / 2,
  y: SHRINE_ALTAR.y - 18,
  w: SHRINE_ALTAR.width,
  h: 18,
};

/**
 * 老干部紫砂茶台：工作区饮水机（cooler，x = WORKROOM.x + 164）东侧紧邻一格。
 * 底边与饮水机齐平（+334），站过去就能续杯。
 */
export const TEA_STATION = { x: WORKROOM.x + 198, y: WORKROOM.y + 334, width: 46, height: 40 } as const;

/** 茶台贴地碰撞：只挡下方 44×16 的桌面 */
export const TEA_STATION_SOLID: WorldRect = {
  x: TEA_STATION.x - 22,
  y: TEA_STATION.y - 16,
  w: 44,
  h: 16,
};

/**
 * 有墙房间的墙体（含家庭影音室），加上卫生间两道内隔墙、
 * 四片坑位隔断与会议桌。工作区按需求不加墙，因此这里没有它的碰撞矩形。
 */
export const CAMPUS_SOLIDS: SolidRect[] = [
  ...workroomSolids,
  ...meetingSolids,
  ...ventSolids,
  // 走廊西端封口：楼体只留东端一个大门，西侧不能漏出一条缝
  { kind: 'wall', x: CAMPUS_RECT.x, y: COMPANY_CORRIDOR.y, w: WALL_THICKNESS, h: COMPANY_CORRIDOR.h },
  ...restroomSolids,
  ...loungeSolids,
  ...theaterSolids,
  ...jailSolids,
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
