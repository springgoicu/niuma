/**
 * 静态世界布局：服务端碰撞、客户端渲染、小地图三方共用的唯一真相。
 *
 * 两条纪律：
 * 1) 坐标全部手写，或由 `Math.imul` 派生的 mulberry32 生成；禁止 Math.random / Math.sin / Math.cos，
 *    否则 Bun(JSC) 与浏览器(V8) 可能给出不同结果，双端会各画各的地图。
 * 2) 只描述「世界是什么」，不依赖 Pixi / Bun / DOM。渲染尺寸、贴图与配色由各自的消费方决定。
 */

import { WORLD_HEIGHT, WORLD_WIDTH, DIRECTION } from '../constants';
import {
  distanceSqToPolygon,
  pointInPolygon,
  polygonBounds,
  rectContains,
  rectExpanded,
  type Point,
  type WorldRect,
} from './geometry';
import { buildRiver, type RiverShape } from './river';
import {
  CAMPUS_BUILDINGS,
  CAMPUS_PATH,
  CAMPUS_PROPS,
  CAMPUS_RECT,
  CAMPUS_SEATS,
  CAMPUS_SOLIDS,
  CAMPUS_YARD,
  CHAIR_GAP,
  DESK_H,
  DESK_W,
  MEETING_ROOM,
  PLAZA_PROPS,
  PLAZA_SOLIDS,
  RESTROOM,
  type BuildingSpec,
  type DeskInstance,
  type PropInstance,
  type SeatInstance,
  type SolidRect,
} from './campus';

export { CHAIR_GAP, DESK_H, DESK_W } from './campus';
export type { BuildingSpec, DeskInstance, PropInstance, SeatInstance, SolidRect, SeatKind, PropKind, SolidKind } from './campus';

export interface LakeShape {
  points: Point[];
  /** 包围盒，供网格索引与纹理裁切使用 */
  rect: WorldRect;
}

export interface TreeInstance {
  x: number;
  y: number;
  /** 0..3，对应四套树形 */
  variant: number;
}

export interface ForestPatch {
  rect: WorldRect;
  trees: TreeInstance[];
}

/**
 * 一片花海：矩形只是包围盒，渲染端用有机轮廓切出不规则草甸。
 * 花朵纯装饰，不参与碰撞。
 */
export interface FlowerPatch {
  rect: WorldRect;
  /** 0 白雏菊 / 1 金盏 / 2 暖粉 */
  palette: 0 | 1 | 2;
}

export interface FenceSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  side: 'north' | 'south' | 'east' | 'west';
}

export interface RegionSpec {
  name: string;
  rect: WorldRect;
}

export interface PlanterInstance {
  x: number;
  y: number;
}

export interface IslandShape {
  readonly points: Point[];
  /** 包围盒，供相机夹取与快速排除 */
  readonly bounds: WorldRect;
}

export interface WorldLayout {
  plaza: WorldRect;
  fence: { rect: WorldRect; segments: FenceSegment[] };
  paths: WorldRect[];
  lakes: LakeShape[];
  rivers: RiverShape[];
  bridges: WorldRect[];
  forests: ForestPatch[];
  /** 散布全岛的孤树：与森林里的树一样参与碰撞，但不属于任何林地 */
  wildTrees: TreeInstance[];
  /** 花海：纯装饰，不阻挡行走 */
  flowerFields: FlowerPatch[];
  planters: PlanterInstance[];
  /** 海岛海岸线：服务端碰撞、客户端渲染与小地图共用的唯一陆地边界 */
  island: IslandShape;
  /** 按优先级排列，先命中者胜 */
  regions: RegionSpec[];
  /** 工位桌（中心点）：桌面碰撞见 solids，显示器点亮由占座状态驱动 */
  desks: DeskInstance[];
  /** 可入座的座位（工位椅 + 卫生间马桶），id 从 1 开始，0 表示无座位 */
  seats: SeatInstance[];
  /** 装饰与小设施（灯、长椅、垃圾桶、标识、水槽、售货机等），渲染端按 kind 选贴图 */
  props: PropInstance[];
  /** 墙体、桌面、隔断、售货机等轴对齐碰撞矩形 */
  solids: SolidRect[];
  /** 室内空间（会议室、卫生间）：渲染端画地板 */
  buildings: BuildingSpec[];
  /** 铺装地面：贴花层不进入 */
  paved: WorldRect[];
}

export const WORLD_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 } as const;

/**
 * 出生点散布上限，与服务端 config.spawnRadius 默认值一致。
 * 240 → 300 是随角色从 41 texel 长到 48 texel 一起放的：出生圈太挤会一路互相顶。
 */
export const SPAWN_RADIUS = 300;

/** 门洞宽度：南北门沿 x，东西门沿 y。120 = 三个角色宽，两人对穿不会卡住 */
export const GATE_WIDTH = 120;

/** 树干碰撞半径：>3 才挡得住人，<14 才能从树缝里穿过去 */
export const TREE_TRUNK_RADIUS = 12;

export const FALLBACK_REGION = '园区野地';

/** 沙滩带宽：一半在水里一半在陆地，玩家碰撞线落在沙滩中线 */
export const ISLAND_SAND = 26;
/** 浅滩带：从海岸线向外延伸的浅水色带宽度 */
export const ISLAND_SHALLOW = 72;

/**
 * 海岸线（顺时针，屏幕坐标 y 向下）：陆地收到内容包围盒外 60–80px，
 * 四处海湾切掉没有内容的大片空草地——北湾、东湾、南中湾、西南湾各留一个开口，
 * 保证海湾与外海连通，不会看成四个湖。
 *
 * 与旧版（6900×7780）相比，内容整体向内收了一圈：林地与湖先向内平移，
 * 海岸线再按新的内容包围盒重画，岛缩到 6470×7164（面积约 −12%）。
 * 东湾的深度比旧版更深（2900–5650）：那片草地本来是东侧最大的一块空地。
 *
 * 全部轴对齐手写：与地形一样禁止 Math.random / Math.sin / Math.cos，
 * 否则 Bun(JSC) 与浏览器(V8) 的末位差异会让双端各画一条海岸线。
 */
const ISLAND_POINTS: Point[] = [
  [780, 456],
  [2900, 456],
  [2900, 2500],
  [4700, 2500],
  [4700, 456],
  [7250, 456],
  [7250, 2900],
  [6650, 2900],
  [6650, 5650],
  [7250, 5650],
  [7250, 7620],
  [5250, 7620],
  [5250, 7150],
  [2900, 7150],
  [2900, 7620],
  [2260, 7620],
  [2260, 4400],
  [780, 4400],
];

export const ISLAND: IslandShape = {
  points: ISLAND_POINTS,
  bounds: polygonBounds(ISLAND_POINTS),
};

/**
 * 半径内是否完全落在陆地上。
 * 先过包围盒，再判内外，最后量到海岸线的距离；`radius = 0` 时只判内外。
 */
export function isOnLand(x: number, y: number, radius = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return false;
  const { x: bx, y: by, w, h } = ISLAND.bounds;
  if (x <= bx || y <= by || x >= bx + w || y >= by + h) return false;
  if (!pointInPolygon(x, y, ISLAND.points)) return false;
  if (radius <= 0) return true;
  return distanceSqToPolygon(x, y, ISLAND.points) > radius * radius;
}

/**
 * 尺度总则（ADR-0010）：角色站立高 48 texel，广场/围栏/道路/水域全部按 1.25 放大，
 * 走完整张地图的时长靠 MOVE_SPEED 同比提到 165px/s 拉回来。
 * 坐标一律手写偶数，保持以 (4096,4096) 为中心对称。
 */

/** 办公广场：冷灰绿地砖，出生点全部落在里面；与围栏同以世界中心为心 */
const PLAZA: WorldRect = { x: 3536, y: 3628, w: 1120, h: 936 };

const FENCE_RECT: WorldRect = { x: 3216, y: 3404, w: 1760, h: 1384 };

const GATE_MIN = WORLD_CENTER.x - GATE_WIDTH / 2;
const GATE_MAX = WORLD_CENTER.x + GATE_WIDTH / 2;

function horizontal(label: 'north' | 'south', y: number): FenceSegment[] {
  return [
    { x1: FENCE_RECT.x, y1: y, x2: GATE_MIN, y2: y, side: label },
    { x1: GATE_MAX, y1: y, x2: FENCE_RECT.x + FENCE_RECT.w, y2: y, side: label },
  ];
}

function vertical(label: 'west' | 'east', x: number): FenceSegment[] {
  return [
    { x1: x, y1: FENCE_RECT.y, x2: x, y2: GATE_MIN, side: label },
    { x1: x, y1: GATE_MAX, x2: x, y2: FENCE_RECT.y + FENCE_RECT.h, side: label },
  ];
}

const FENCE_SEGMENTS: FenceSegment[] = [
  ...horizontal('north', FENCE_RECT.y),
  ...horizontal('south', FENCE_RECT.y + FENCE_RECT.h),
  ...vertical('west', FENCE_RECT.x),
  ...vertical('east', FENCE_RECT.x + FENCE_RECT.w),
];

/**
 * 土路：四个门洞向外延伸，路宽 128（≈2.7 个角色宽）。
 * 北、东两条尽头没有目标的支路同比缩短（540→400 / 640→480）：
 * 海岸内收之后它们再长一截就只剩空草地了。
 */
const PATHS: WorldRect[] = [
  { x: 4032, y: 4700, w: 128, h: 1200 },
  { x: 4032, y: 3040, w: 128, h: 400 },
  { x: 4980, y: 4032, w: 480, h: 128 },
  { x: 2640, y: 4032, w: 576, h: 128 },
  CAMPUS_PATH,
];

/**
 * 湖面轮廓：以 (5751, 5601) 为中心、812×525 的椭圆，20 个顶点手写，
 * 保证双端顶点完全一致（用三角函数生成会引入引擎间末位差异）。
 * 相对旧轮廓整体左移 350，把广场东侧与东岸林地之间那块空草地收掉一半。
 */
const LAKE_POINTS: Point[] = [
  [6564, 5601],
  [6524, 5764],
  [6408, 5910],
  [6228, 6026],
  [6002, 6100],
  [5751, 6126],
  [5500, 6100],
  [5274, 6026],
  [5094, 5910],
  [4978, 5764],
  [4938, 5601],
  [4978, 5438],
  [5094, 5292],
  [5274, 5176],
  [5500, 5102],
  [5751, 5076],
  [6002, 5102],
  [6228, 5176],
  [6408, 5292],
  [6524, 5438],
];

/** 岸线宽度：只影响渲染，碰撞边界仍是水面轮廓 */
export const LAKE_SHORE = 22;

/** 半河宽：总宽 224，与 304 宽的木桥两侧各留 40px */
export const RIVER_HALF_WIDTH = 112;
/** 河岸沙带：与湖岸同档，只影响渲染，碰撞边界仍是水面多边形 */
export const RIVER_SHORE = 24;

/**
 * 河道中心线（手写，顺时针自北向南）：南北两端各探进海里 60–70px，
 * 河口不再断在草地中央。中段摆动幅度 ≤ 60px，远小于半个河宽，
 * 岸线只做缓弯，斜接不会扎刺；桥段（y 3920–4300）保持 x=2488 直行，
 * 水面恒定落在 x 2376–2600，现有木桥全程覆盖。
 *
 * 海岸内收后两端跟着缩短：北端 40 → 400（新北岸 y=456），南端 7990 → 7690（新南岸 y=7620）。
 */
const RIVER_STATIONS: Point[] = [
  [2500, 400],
  [2532, 620],
  [2548, 900],
  [2524, 1280],
  [2484, 1660],
  [2460, 2040],
  [2468, 2420],
  [2500, 2800],
  [2504, 3180],
  [2478, 3560],
  [2488, 3920],
  [2488, 4100],
  [2488, 4300],
  [2480, 4560],
  [2460, 4940],
  [2452, 5300],
  [2462, 5680],
  [2482, 6060],
  [2470, 6440],
  [2486, 6820],
  [2488, 7200],
  [2490, 7690],
];

const RIVERS: RiverShape[] = [buildRiver(RIVER_STATIONS, RIVER_HALF_WIDTH)];

/**
 * 木桥：整段盖住河面，是河流唯一的通行口。
 * 两端各比河岸外扩 32px——放行判定看的是角色中心点，
 * 桥面若刚好从水面开始，人会被「离岸 7px」的碰撞半径挡在桥头。
 */
const BRIDGES: WorldRect[] = [{ x: 2336, y: 4006, w: 304, h: 180 }];

/** 花箱碰撞半径：比视觉尺寸略小（视觉 26×34），擦身而过不会觉得黏 */
export const PLANTER_RADIUS = 12;

/**
 * 景观花箱：广场中心四角 + 广场内侧四条边 + 南向长路休息角。
 * 出生点四周就有「会被挡住」的实物，走两步就能看出 y 排序；
 * 外圈四个把广场的空地面切成「中间一片 + 四周一圈」，视口放大后不再是一张空桌布。
 */
const PLANTERS: PlanterInstance[] = [
  { x: 3971, y: 3971 },
  { x: 4221, y: 3971 },
  { x: 3971, y: 4221 },
  { x: 4221, y: 4221 },
  { x: 3671, y: 3971 },
  { x: 3671, y: 4221 },
  { x: 4521, y: 3971 },
  { x: 4521, y: 4221 },
  { x: 3944, y: 5150 },
];

/**
 * 南向长路旁的休息角：两张长椅夹一盏灯，指路牌与垃圾桶收口。
 * 这条 1200 长的路连接办公区与研发园，两侧原本只有草——
 * 视口放大四倍之后，这里会变成全图最长的一段空走廊。
 */
const ROAD_PROPS: PropInstance[] = [
  { kind: 'lamp', x: 3944, y: 5340 },
  { kind: 'bench', x: 3820, y: 5320 },
  { kind: 'bench', x: 3820, y: 5210 },
  { kind: 'sign', x: 3700, y: 5260 },
  { kind: 'bin', x: 3700, y: 5340 },
];

/**
 * 办公区工位：沿围栏内圈排布。北、南两排是横向工位（椅子在桌子外侧），
 * 东、西两列是纵向工位。南北门的通道与路口留白，人流不会被桌子堵住。
 * 坐标手写对称（中心 x = 4096）。
 */
const DESK_NORTH_Y = FENCE_RECT.y + 66;
const DESK_SOUTH_Y = FENCE_RECT.y + FENCE_RECT.h - 68;
const DESK_WEST_X = 3332;
const DESK_EAST_X = 4860;
const DESK_COLUMN_START = 3560;
const DESK_COLUMN_PITCH = 150;
const DESK_ROW_PITCH = 120;
/** 南北门的通道（x）与东西门的通道（y）：工位不压在门前 */
const GATE_LANE_X: readonly [number, number] = [3960, 4232];
const GATE_LANE_Y: readonly [number, number] = [3980, 4212];

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a1 > b0 && a0 < b1;
}

function officeWorkstations(): Array<{ desk: DeskInstance; seat: Omit<SeatInstance, 'id' | 'desk' | 'kind'> }> {
  const out: Array<{ desk: DeskInstance; seat: Omit<SeatInstance, 'id' | 'desk' | 'kind'> }> = [];
  const runX: number[] = [];
  for (let cx = 3420; cx <= 4740; cx += DESK_ROW_PITCH) {
    if (rangesOverlap(cx - DESK_W / 2, cx + DESK_W / 2, GATE_LANE_X[0], GATE_LANE_X[1])) continue;
    runX.push(cx);
  }
  for (const cx of runX) {
    out.push({
      desk: { x: cx, y: DESK_NORTH_Y },
      seat: { x: cx, y: DESK_NORTH_Y + DESK_H / 2 + CHAIR_GAP, facing: DIRECTION.Up },
    });
  }
  for (const cx of runX) {
    out.push({
      desk: { x: cx, y: DESK_SOUTH_Y },
      seat: { x: cx, y: DESK_SOUTH_Y - DESK_H / 2 - CHAIR_GAP, facing: DIRECTION.Down },
    });
  }
  for (let cy = DESK_COLUMN_START; cy <= 4640; cy += DESK_COLUMN_PITCH) {
    if (rangesOverlap(cy - DESK_H / 2, cy + DESK_H / 2, GATE_LANE_Y[0], GATE_LANE_Y[1])) continue;
    out.push({
      desk: { x: DESK_WEST_X, y: cy },
      seat: { x: DESK_WEST_X + DESK_W / 2 + CHAIR_GAP, y: cy, facing: DIRECTION.Left },
    });
    out.push({
      desk: { x: DESK_EAST_X, y: cy },
      seat: { x: DESK_EAST_X - DESK_W / 2 - CHAIR_GAP, y: cy, facing: DIRECTION.Right },
    });
  }
  return out;
}

const WORKSTATIONS = officeWorkstations();

const DESKS: DeskInstance[] = WORKSTATIONS.map((station) => station.desk);

const DESK_SOLIDS: SolidRect[] = DESKS.map((desk) => ({
  kind: 'desk',
  x: desk.x - DESK_W / 2,
  y: desk.y - DESK_H / 2,
  w: DESK_W,
  h: DESK_H,
}));

/** 座位表：先办公区工位，再研发园的会议椅与马桶；id = 下标 + 1 */
const SEAT_DRAFTS: Array<Omit<SeatInstance, 'id'>> = [
  ...WORKSTATIONS.map((station, index) => ({ ...station.seat, kind: 'chair' as const, desk: index })),
  ...CAMPUS_SEATS.map((seat) => ({ ...seat, desk: -1 })),
];

const SEATS: SeatInstance[] = SEAT_DRAFTS.map((seat, index) => ({ id: index + 1, ...seat }));

/** 入座判定半径：角色中心与座位锚点的距离，超出则不会就座（服务端与客户端共用） */
export const SIT_RANGE = 90;

/** 按 id 取座位；0 与越界 id 返回 undefined */
export function seatById(id: number): SeatInstance | undefined {
  if (!Number.isInteger(id) || id < 1 || id > SEATS.length) return undefined;
  return SEATS[id - 1];
}

/**
 * 找最近的可用座位：`isFree` 由调用方提供（服务端查占用表，客户端查本地镜像）。
 * 没有可用座位时返回 undefined，调用方退化为地面坐。
 */
export function findNearestSeat(
  x: number,
  y: number,
  isFree: (seatId: number) => boolean,
  range: number = SIT_RANGE,
): SeatInstance | undefined {
  let best: SeatInstance | undefined;
  let bestDistance = range * range;
  for (const seat of SEATS) {
    const dx = seat.x - x;
    const dy = seat.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > bestDistance) continue;
    if (!isFree(seat.id)) continue;
    best = seat;
    bestDistance = distance;
  }
  return best;
}

/**
 * 三片林地随海岸一起内移：西林只下移（西岸本来就没有空余），
 * 东北林左移 500、东南林左上各 300。东南林的左缘卡在南中湾的东壁上（x = 5250），
 * 再往左就会有一列树长在湾里。
 *
 * 后面四片是补空的小树林：视口面积翻四倍之后，广场—研发园—湖之间的纯草地
 * 在屏幕上会连成一大片空白。四片都不与主林地、土路、花海、水面相交，
 * 落在空地上的树由 `isPlantable` 再过滤一次。
 */
const FOREST_RECTS: WorldRect[] = [
  { x: 852, y: 526, w: 1438, h: 2126 },
  { x: 4726, y: 650, w: 2376, h: 2126 },
  { x: 5250, y: 5676, w: 1926, h: 1872 },
  // 北湾以南、北门通道两侧的两小片
  { x: 2950, y: 2560, w: 860, h: 760 },
  { x: 4260, y: 2850, w: 640, h: 470 },
  // 东湾与湖之间的空地
  { x: 5600, y: 3550, w: 950, h: 1300 },
  // 办公区与研发园之间的林带，把那段长路夹出「林荫道」
  { x: 4260, y: 5000, w: 620, h: 1100 },
];

/**
 * 花海：三片开阔草甸上的不规则色块，白雏菊 / 金盏 / 暖粉各一片。
 * 全部避开广场、土路、林地、湖与河道，只做视觉分区，不参与碰撞。
 */
const FLOWER_FIELDS: FlowerPatch[] = [
  { rect: { x: 1000, y: 2620, w: 980, h: 1320 }, palette: 0 },
  { rect: { x: 5060, y: 2740, w: 900, h: 780 }, palette: 1 },
  { rect: { x: 2900, y: 5000, w: 1000, h: 1200 }, palette: 2 },
  // 白雏菊田与周报河之间的一条花带，把西岸水塘圈进草甸里
  { rect: { x: 1750, y: 3960, w: 560, h: 300 }, palette: 0 },
  // 周报河东岸的窄条：河、土路与南中湾之间的三角空地被它收掉
  { rect: { x: 2700, y: 4300, w: 380, h: 620 }, palette: 1 },
];

/**
 * 两口小水塘：各 11 个顶点手写，绕中心做不规则收放，读起来像天然积水而不是圆规坑。
 * 西塘在白雏菊田与西岸之间的空地，南塘在西侧海岸与南中湾之间的窄带上。
 * 走 `lakes` 数组就等于自动接入水面碰撞、撒树留白、芦苇碎石与小地图。
 */
const POND_WEST_POINTS: Point[] = [
  [1330, 4160],
  [1352, 4258],
  [1412, 4310],
  [1498, 4318],
  [1582, 4292],
  [1642, 4230],
  [1660, 4142],
  [1618, 4062],
  [1530, 4030],
  [1436, 4048],
  [1360, 4094],
];

const POND_SOUTH_POINTS: Point[] = [
  [2430, 6100],
  [2452, 6200],
  [2512, 6258],
  [2600, 6272],
  [2684, 6250],
  [2742, 6190],
  [2760, 6100],
  [2720, 6012],
  [2630, 5980],
  [2540, 5996],
  [2470, 6046],
];

const LAKE: LakeShape = { points: LAKE_POINTS, rect: polygonBounds(LAKE_POINTS) };
const LAKES: LakeShape[] = [
  LAKE,
  ...[POND_WEST_POINTS, POND_SOUTH_POINTS].map((points) => ({ points, rect: polygonBounds(points) })),
];

/**
 * 点到水域边界的最短距离平方：湖面与河面共用一份判定。
 * 落在水面内返回 0，水面外返回离岸距离的平方。
 */
export function distanceSqToWater(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const lake of LAKES) {
    if (pointInPolygon(x, y, lake.points)) return 0;
    const distance = distanceSqToPolygon(x, y, lake.points);
    if (distance < best) best = distance;
  }
  for (const river of RIVERS) {
    if (pointInPolygon(x, y, river.polygon)) return 0;
    const distance = distanceSqToPolygon(x, y, river.polygon);
    if (distance < best) best = distance;
  }
  return best;
}

/** 是否踩在水面上（湖面或河面）。桥面由 isOnBridge 单独放行 */
export function isWaterAt(x: number, y: number): boolean {
  return distanceSqToWater(x, y) === 0;
}

const REGIONS: RegionSpec[] = [
  // 第一片是摸鱼湖，其余是补空的小水塘：区域名只影响状态栏文案，不影响碰撞
  ...LAKES.map((lake, index) => ({
    name: index === 0 ? '摸鱼湖' : '小水塘',
    rect: rectExpanded(lake.rect, 50),
  })),
  ...RIVERS.map((river) => ({ name: '周报河', rect: rectExpanded(river.rect, 30) })),
  ...FOREST_RECTS.map((rect) => ({ name: '加班林', rect })),
  { name: '办公区', rect: FENCE_RECT },
  { name: '会议室', rect: MEETING_ROOM },
  { name: '卫生间', rect: RESTROOM },
  { name: '研发园', rect: CAMPUS_RECT },
];

/**
 * 撒树：给每个格心一次投骰，再抖动位置，比纯随机更像自然林。
 * 树冠宽 56–62，格距 120 时相邻树冠刚好交叠成林，再密就会糊成一片深绿。
 */
const TREE_CELL = 120;
/** 0.6 → 0.7：视口放大后森林要更「满」，否则树间草地会透成一片空绿 */
const TREE_CHANCE = 0.7;
const TREE_JITTER = 32;
/** 必须大于 TREE_JITTER，否则抖动会把树推出森林矩形 */
const TREE_MARGIN = 40;
const TREE_VARIANTS = 4;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 树不能长进水里、路上、广场上，也不能贴到围栏上。
 * 留白随地形件一起 ×1.25：漏改这一处，树就会重新长进广场与门口。
 */
function isPlantable(x: number, y: number): boolean {
  if (x < 150 || y < 150 || x > WORLD_WIDTH - 150 || y > WORLD_HEIGHT - 150) return false;
  if (rectContains(rectExpanded(PLAZA, 60), x, y)) return false;
  if (rectContains(rectExpanded(FENCE_RECT, 70), x, y)) return false;
  if (rectContains(rectExpanded(CAMPUS_RECT, 40), x, y)) return false;
  for (const path of PATHS) if (rectContains(rectExpanded(path, 55), x, y)) return false;
  for (const bridge of BRIDGES) if (rectContains(rectExpanded(bridge, 50), x, y)) return false;
  for (const field of FLOWER_FIELDS) if (rectContains(rectExpanded(field.rect, 40), x, y)) return false;
  // 水面留白 95：湖岸和河岸都是细沙带，树冠不能压到沙上
  if (distanceSqToWater(x, y) < 95 * 95) return false;
  return true;
}

function scatterTrees(rect: WorldRect, seed: number, variantBase: number): TreeInstance[] {
  const random = mulberry32(seed);
  const trees: TreeInstance[] = [];
  for (let y = rect.y + TREE_MARGIN; y < rect.y + rect.h - TREE_MARGIN; y += TREE_CELL) {
    for (let x = rect.x + TREE_MARGIN; x < rect.x + rect.w - TREE_MARGIN; x += TREE_CELL) {
      const roll = random();
      const jitterX = Math.round((random() - 0.5) * 2 * TREE_JITTER);
      const jitterY = Math.round((random() - 0.5) * 2 * TREE_JITTER);
      const px = x + jitterX;
      const py = y + jitterY;
      if (roll > TREE_CHANCE) continue;
      if (!isPlantable(px, py)) continue;
      const variant = (variantBase + (random() * TREE_VARIANTS | 0)) % TREE_VARIANTS;
      trees.push({ x: px, y: py, variant });
    }
  }
  return trees;
}

/**
 * 孤树：草地上的散点地标，密度远低于林地。
 * 格距 240 + 抖动 ±100 后相邻格仍可能只隔 40，所以再加一道 170 的最小间距。
 */
/**
 * 240/0.42 → 160/0.6：海岛上剩下的大块草地都要看得见孤树，否则像荒滩。
 * 林地加密、水塘与花海各自吃掉一块之后，能种孤树的地方少了一半，
 * 格距与命中率要一起抬才补得回来；170 的最小间距不动——那是两团树冠不糊成一片的下限。
 */
const WILD_TREE_CELL = 160;
const WILD_TREE_CHANCE = 0.72;
const WILD_TREE_JITTER = 100;
const WILD_TREE_MIN_GAP = 170;
/** 出生圈外才开始有孤树，广场四周留出干净的活动面 */
const WILD_TREE_CLEAR = 520;

function canPlantWildTree(x: number, y: number): boolean {
  if (!isPlantable(x, y)) return false;
  // 海岸留白：孤树不站在沙滩与浅滩上
  if (!isOnLand(x, y, 90)) return false;
  for (const rect of FOREST_RECTS) if (rectContains(rectExpanded(rect, 40), x, y)) return false;
  const dx = x - WORLD_CENTER.x;
  const dy = y - WORLD_CENTER.y;
  return dx * dx + dy * dy > WILD_TREE_CLEAR * WILD_TREE_CLEAR;
}

function scatterWildTrees(): TreeInstance[] {
  const random = mulberry32(0x1f3a5c7d);
  const trees: TreeInstance[] = [];
  const gapSq = WILD_TREE_MIN_GAP * WILD_TREE_MIN_GAP;
  const { x, y, w, h } = ISLAND.bounds;
  for (let py = y + 150; py < y + h - 150; py += WILD_TREE_CELL) {
    for (let px = x + 150; px < x + w - 150; px += WILD_TREE_CELL) {
      const roll = random();
      const jitterX = Math.round((random() - 0.5) * 2 * WILD_TREE_JITTER);
      const jitterY = Math.round((random() - 0.5) * 2 * WILD_TREE_JITTER);
      if (roll > WILD_TREE_CHANCE) continue;
      const tx = px + jitterX;
      const ty = py + jitterY;
      if (!canPlantWildTree(tx, ty)) continue;
      let tooClose = false;
      for (const tree of trees) {
        const dx = tree.x - tx;
        const dy = tree.y - ty;
        if (dx * dx + dy * dy < gapSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      trees.push({ x: tx, y: ty, variant: (random() * TREE_VARIANTS | 0) % TREE_VARIANTS });
    }
  }
  return trees;
}

const FORESTS: ForestPatch[] = FOREST_RECTS.map((rect, index) => ({
  rect,
  trees: scatterTrees(rect, 0x9e3779 + index * 0x85ebca, index),
}));

const WILD_TREES: TreeInstance[] = scatterWildTrees();

export const WORLD_LAYOUT: WorldLayout = {
  plaza: PLAZA,
  fence: { rect: FENCE_RECT, segments: FENCE_SEGMENTS },
  paths: PATHS,
  lakes: LAKES,
  rivers: RIVERS,
  bridges: BRIDGES,
  forests: FORESTS,
  wildTrees: WILD_TREES,
  flowerFields: FLOWER_FIELDS,
  planters: PLANTERS,
  island: ISLAND,
  regions: REGIONS,
  desks: DESKS,
  seats: SEATS,
  props: [...PLAZA_PROPS, ...CAMPUS_PROPS, ...ROAD_PROPS],
  solids: [...DESK_SOLIDS, ...PLAZA_SOLIDS, ...CAMPUS_SOLIDS],
  buildings: CAMPUS_BUILDINGS,
  paved: [CAMPUS_YARD],
};

/** 玩家所在区域名：区域表按优先级排列，未命中则落到野地 */
export function regionAt(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return FALLBACK_REGION;
  for (const region of REGIONS) {
    if (rectContains(region.rect, x, y)) return region.name;
  }
  return FALLBACK_REGION;
}

/** 桥面：水域在这里放行 */
export function isOnBridge(x: number, y: number): boolean {
  for (const bridge of BRIDGES) {
    if (rectContains(bridge, x, y)) return true;
  }
  return false;
}
