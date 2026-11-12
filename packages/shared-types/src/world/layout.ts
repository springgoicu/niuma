/**
 * 静态世界布局：服务端碰撞、客户端渲染、小地图三方共用的唯一真相。
 *
 * 两条纪律：
 * 1) 坐标全部手写，或由 `Math.imul` 派生的 mulberry32 生成；禁止 Math.random / Math.sin / Math.cos，
 *    否则 Bun(JSC) 与浏览器(V8) 可能给出不同结果，双端会各画各的地图。
 * 2) 只描述「世界是什么」，不依赖 Pixi / Bun / DOM。渲染尺寸、贴图与配色由各自的消费方决定。
 *
 * ADR-0028：岛按 0.7 收缩到 3805×4212，海岸线保持 16 点手写折线。
 * ADR-0044：北门内收成四角院落（一院四房）。
 * ADR-0047：去掉周报河 / 晨会溪 / 护园溪与全部桥码头，内陆连成整块；
 *   出生点移到岛心 720px 石砖圆庭，四角房之间铺放射状土路；
 *   东南「摸鱼湖」扩大，东北新增「沉思浅塘」，西侧补「涟漪湖」；
 *   大片「加班林」拆成 2–5 棵一簇的树丛与林荫道，全树间隙 ≥80px。
 *   按本轮确认，水域保持可涉水（ADR-0030 继续有效），湖面不注册碰撞体。
 */

import { WORLD_HEIGHT, WORLD_WIDTH } from '../constants';
import {
  distanceSqToPolygon,
  pointInPolygon,
  polygonBounds,
  rectContains,
  rectExpanded,
  type Point,
  type WorldRect,
} from './geometry';
import { buildRibbon, type RibbonShape } from './ribbon';
import {
  AREA_LOGOS,
  CAMPUS_BUILDINGS,
  CAMPUS_RECT,
  CAMPUS_SEATS,
  CAMPUS_SOLIDS,
  DOOR_PAVING,
  MEETING_PROPS,
  MEETING_ROOM,
  NAV_ARRIVALS,
  RESTROOM,
  RESTROOM_PROPS,
  ROOM_H,
  ROOM_W,
  SOUTH_YARD,
  SOUTH_YARD_PAVING,
  SOUTH_YARD_PROPS,
  WORK_PROPS,
  WORKROOM,
  WORKSTATIONS,
  LOUNGE,
  LOUNGE_PROPS,
  LOUNGE_SEATS,
  deskFootprint,
  propSolids,
  type BuildingSpec,
  type DeskInstance,
  type PropInstance,
  type SeatInstance,
  type SolidRect,
} from './campus';

export {
  CHAIR_GAP,
  DESK_H,
  DESK_W,
  chairOffset,
  deskDepthOffset,
  deskFootprint,
  isSelfSolidProp,
  propSolid,
  propSolids,
  seatPose,
  workstation,
} from './campus';
export type { BuildingSpec, DeskInstance, PropInstance, SeatInstance, SolidRect, SolidKind, PropKind, SeatKind, Workstation } from './campus';

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

/**
 * 树丛：2–5 棵树的有机小群落，取代旧版大片「加班林」矩形。
 * `radius` 只用于林下地面与小地图的柔和底色，不参与碰撞。
 */
export interface TreeCluster {
  x: number;
  y: number;
  radius: number;
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

/** 带状土路：中心线 + 半宽展开出的闭合多边形（几何算法见 ribbon.ts） */
export interface PathShape extends RibbonShape {
  /** 半路宽：材质判定、种树留白与贴花排除共用 */
  readonly halfWidth: number;
}

export interface WorldLayout {
  /** 石砖圆庭的包围盒（圆本身用 isOnPlaza 判定） */
  plaza: WorldRect;
  plazaRadius: number;
  /** 四角院落（ADR-0044）：只用于区域名与撒树留白，本身不产生碰撞（房间墙体才挡人） */
  office: WorldRect;
  paths: PathShape[];
  lakes: LakeShape[];
  /** 散布全岛的树丛：每簇 2–5 棵，参与碰撞 */
  groves: TreeCluster[];
  /** 草地上的孤树与林荫道散树：与树丛一样参与碰撞 */
  looseTrees: TreeInstance[];
  /** 花海：纯装饰，不阻挡行走 */
  flowerFields: FlowerPatch[];
  planters: PlanterInstance[];
  /** 海岛海岸线：服务端碰撞、客户端渲染与小地图共用的唯一陆地边界 */
  island: IslandShape;
  /** 按优先级排列，先命中者胜 */
  regions: RegionSpec[];
  /** 工位桌（中心点）：桌面碰撞见 solids，显示器点亮由占座状态驱动 */
  desks: DeskInstance[];
  /** 可入座的座位（工位椅、会议椅、马桶、床、沙发、凳子），id 从 1 开始，0 表示无座位 */
  seats: SeatInstance[];
  /** 装饰与小设施（灯、长椅、垃圾桶、标识、水槽、售货机、饮水机、咖啡机、树篱等） */
  props: PropInstance[];
  /** 墙体、桌面、隔断、售货机、中央地标立柱等轴对齐碰撞矩形 */
  solids: SolidRect[];
  /** 室内空间（工作区、会议室、宿舍区、卫生间）：渲染端按 floor 画地板 */
  buildings: BuildingSpec[];
  /** 铺装地面：贴花层不进入 */
  paved: WorldRect[];
}

export const WORLD_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 } as const;

/**
 * 中央迎宾广场（ADR-0047）：直径 720px 的石砖圆庭，正好落在四角房之间的十字空档里。
 * 四角房最近角点距中心约 397px，半径 360 的圆与房间之间留 ~37px 草地。
 */
export const PLAZA_RADIUS = 360;
export const PLAZA_CENTER = WORLD_CENTER;
const PLAZA: WorldRect = {
  x: PLAZA_CENTER.x - PLAZA_RADIUS,
  y: PLAZA_CENTER.y - PLAZA_RADIUS,
  w: PLAZA_RADIUS * 2,
  h: PLAZA_RADIUS * 2,
};

/** 出生点：岛心广场正中，四周 56px 内无碰撞、无水 */
export const SPAWN_CENTER = { x: WORLD_CENTER.x, y: WORLD_CENTER.y } as const;
/** 出生点散布上限，与服务端 config.spawnRadius 默认值一致 */
export const SPAWN_RADIUS = 56;

/**
 * 园区导览目标（ADR-0036）：四角房中心不变，HUD 导览卡与测试共用这一份。
 */
export type NavTargetId = 'workroom' | 'restroom' | 'lounge' | 'meeting';

export interface NavTarget {
  readonly id: NavTargetId;
  readonly name: string;
  /** 房间几何中心：方位、距离与步行秒数都按它算 */
  readonly x: number;
  readonly y: number;
  /** 房间内可站立的到达点（ADR-0040）：自动寻路的真正终点 */
  readonly arrive: { readonly x: number; readonly y: number };
}

function rectCenter(rect: WorldRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

const NAV_SOURCES: ReadonlyArray<{ id: NavTargetId; name: string; rect: WorldRect }> = [
  { id: 'workroom', name: '工作区', rect: WORKROOM },
  { id: 'restroom', name: '卫生间', rect: RESTROOM },
  { id: 'lounge', name: '宿舍区', rect: LOUNGE },
  { id: 'meeting', name: '会议室', rect: MEETING_ROOM },
];

export const NAV_TARGETS: readonly NavTarget[] = NAV_SOURCES.map(({ id, name, rect }) => ({
  id,
  name,
  ...rectCenter(rect),
  arrive: NAV_ARRIVALS[id],
}));

/**
 * 中央迎宾地标（ADR-0047 / ADR-0049）：拱门跨在南向主路两侧，东侧立四向园区导览牌。
 * 只描述位置与尺寸；木料、霓虹字与像素画法由 apps/web 的 WelcomeView 决定。
 */
export const WELCOME_LANDMARKS = {
  /** 迎宾拱门：底边中心落在广场南缘，宽度 320，立柱让开 112px 的南向主路 */
  arch: { x: PLAZA_CENTER.x, y: 4408, width: 320, height: 112 },
  /** 四向园区导览牌：拱门东侧、圆庭外缘（避开东南支路）；96×92 与旧画布一致 */
  directory: { x: 4310, y: 4432, width: 96, height: 92 },
} as const;

/** 树干碰撞半径：>3 才挡得住人，<14 才能从树缝里穿过去 */
export const TREE_TRUNK_RADIUS = 12;

/** 任意两棵树的最小间隙：80px 是树冠（56–62 宽）不糊成墙的下限 */
export const TREE_MIN_GAP = 80;
/** 生成树丛时实际使用的下限，给像素取整与抖动留 6px 余量 */
const TREE_GAP = 86;
/** 树丛中心之间的最小间距 */
export const GROVE_MIN_GAP = 220;
/** 树丛的柔和底色半径（林下地面 / 小地图），不参与碰撞 */
const GROVE_RADIUS = 118;

export const FALLBACK_REGION = '园区野地';

/** 沙滩带宽：一半在水里一半在陆地，玩家碰撞线落在沙滩中线 */
export const ISLAND_SAND = 26;
/** 浅滩带：从海岸线向外延伸的浅水色带宽度 */
export const ISLAND_SHALLOW = 72;

/**
 * 海岸线（顺时针，屏幕坐标 y 向下）。
 *
 * ADR-0028：以世界中心为原点对上一版（5436×6018）再乘 0.7，
 * 岛收到 3805×4212（x 2146–5951 / y 1956–6168，面积约 −48%）。
 * 西南湾填成陆地；保留北湾（x 3392–4448，探到 y 3158）、
 * 东湾（x 5598–5951 / y 3393–5009）、南中湾（x 3392–4775 / y 5989–6168）。
 * ADR-0047 不再改海岸线：外海边界与地图总尺寸原样保留。
 */
const ISLAND_POINTS: Point[] = [
  [2146, 1956],
  [3392, 1956],
  [3392, 3158],
  [4448, 3158],
  [4448, 1956],
  [5951, 1956],
  [5951, 3393],
  [5598, 3393],
  [5598, 5009],
  [5951, 5009],
  [5951, 6168],
  [4775, 6168],
  [4775, 5989],
  [3392, 5989],
  [3392, 6168],
  [2146, 6168],
];

export const ISLAND: IslandShape = {
  points: ISLAND_POINTS,
  bounds: polygonBounds(ISLAND_POINTS),
};

/**
 * 世界边界契约：海即边界，岛外不可达。
 * `WORLD_WIDTH/HEIGHT` 只是协议坐标上限；真正挡人的是这条海岸线包围盒。
 */
export const WORLD_BOUNDS: WorldRect = ISLAND.bounds;

/**
 * 半径内是否完全落在陆地上。
 * 先过包围盒，再判内外，最后量到海岸线的距离；`radius = 0` 时只判内外。
 */
export function isOnLand(x: number, y: number, radius = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return false;
  const { x: bx, y: by, w, h } = WORLD_BOUNDS;
  if (x <= bx || y <= by || x >= bx + w || y >= by + h) return false;
  if (!pointInPolygon(x, y, ISLAND.points)) return false;
  if (radius <= 0) return true;
  return distanceSqToPolygon(x, y, ISLAND.points) > radius * radius;
}

/** 是否站在中央石砖圆庭上：圆形判定，包围盒只用于小地图与粗筛 */
export function isOnPlaza(x: number, y: number): boolean {
  const dx = x - PLAZA_CENTER.x;
  const dy = y - PLAZA_CENTER.y;
  return dx * dx + dy * dy <= PLAZA_RADIUS * PLAZA_RADIUS;
}

/**
 * 尺度总则（ADR-0010 / ADR-0022 / ADR-0026 / ADR-0028）：角色站立高 48 texel，
 * 广场/道路/水域按 1.25 放大后，靠 MOVE_SPEED 165px/s 把通行时间拉回来。
 * 坐标一律手写偶数，保持以世界中心对称。
 */

/** 主路半宽：路宽 112，约 2.3 个角色宽 */
export const PATH_MAIN_HALF_WIDTH = 56;
/** 支路半宽：路宽 96，接四角房门与两处湖岸 */
export const PATH_BRANCH_HALF_WIDTH = 48;

function buildPath(stations: ReadonlyArray<Point>, halfWidth: number): PathShape {
  return { ...buildRibbon(stations, halfWidth), halfWidth };
}

/**
 * 放射状路网（ADR-0047）：
 * - 四条主路从圆庭边缘向北 / 南 / 西 / 东展开，东西两臂再弯向湖岸；
 * - 四条支路从圆庭四角接向四间房的门（工作区开放，其余三门朝中庭）；
 * - 所有端点都落在陆地上，宽度 112 / 96，转弯处由 miter 收成圆滑的带状。
 */
const PATHS: PathShape[] = [
  // 北入口：圆庭北缘 → 北湾南岸
  buildPath(
    [
      [4096, 3736],
      [4096, 3500],
      [4096, 3230],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 南向主路：穿过迎宾拱门 → 南侧休息庭院
  buildPath(
    [
      [4096, 4456],
      [4096, 4800],
      [4096, 5160],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 西向主路：圆庭西缘 → 西岸，末端略向北弯
  buildPath(
    [
      [3736, 4096],
      [3400, 4096],
      [3050, 4070],
      [2760, 4010],
      [2500, 3970],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 东向主路：圆庭东缘 → 东侧，向东南弯向摸鱼湖
  buildPath(
    [
      [4456, 4096],
      [4800, 4096],
      [5150, 4110],
      [5350, 4300],
      [5400, 4650],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 东北支路：东向主路 → 沉思浅塘南岸
  buildPath(
    [
      [5150, 4110],
      [5160, 3800],
      [5160, 3450],
      [5200, 3180],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 西南支路：西向主路 → 涟漪湖东岸
  buildPath(
    [
      [3050, 4070],
      [2950, 4400],
      [2850, 4800],
      [2780, 5050],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 西北：圆庭 → 工作区东南角（开放区没有门，路在木地板外沿收住）
  buildPath(
    [
      [3880, 3880],
      [3796, 3836],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 东北：圆庭 → 会议室南门（门前铺装接住最后 50px）
  buildPath(
    [
      [4260, 3910],
      [4520, 3896],
      [4756, 3886],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 西南：圆庭 → 宿舍区北门
  buildPath(
    [
      [3920, 4270],
      [3720, 4300],
      [3566, 4290],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 东南：圆庭 → 卫生间北门
  buildPath(
    [
      [4270, 4270],
      [4460, 4300],
      [4626, 4290],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
];

/** 岸线宽度：只影响渲染，碰撞边界仍是水面轮廓 */
export const LAKE_SHORE = 22;

/**
 * 三处内嵌景观湖（ADR-0047）：
 * - 摸鱼湖：东南扩大版，离东岸/南岸都留 250px 以上；
 * - 沉思浅塘：东北台地，藏在会议区以北的林间；
 * - 涟漪湖：西侧小湖，接西南支路。
 * 12–16 点手写，绕中心做不规则收放，读起来像天然积水而不是圆规坑。
 */
const MOPING_LAKE_POINTS: Point[] = [
  [5700, 5560],
  [5680, 5680],
  [5620, 5790],
  [5520, 5870],
  [5390, 5910],
  [5260, 5890],
  [5150, 5820],
  [5070, 5710],
  [5040, 5580],
  [5060, 5450],
  [5120, 5340],
  [5220, 5260],
  [5350, 5220],
  [5480, 5240],
  [5590, 5310],
  [5660, 5420],
];

const CHENSI_POND_POINTS: Point[] = [
  [5490, 2920],
  [5470, 3010],
  [5410, 3080],
  [5320, 3120],
  [5230, 3110],
  [5140, 3080],
  [5050, 3020],
  [4990, 2950],
  [4980, 2860],
  [5040, 2780],
  [5130, 2730],
  [5230, 2700],
  [5330, 2720],
  [5420, 2780],
];

const LIANYI_LAKE_POINTS: Point[] = [
  [2700, 5240],
  [2680, 5330],
  [2620, 5400],
  [2530, 5440],
  [2430, 5430],
  [2350, 5380],
  [2290, 5310],
  [2260, 5220],
  [2260, 5130],
  [2300, 5050],
  [2380, 5000],
  [2470, 4990],
  [2560, 5020],
  [2640, 5090],
];

const LAKE_NAMES = ['摸鱼湖', '沉思浅塘', '涟漪湖'] as const;

const LAKES: LakeShape[] = [MOPING_LAKE_POINTS, CHENSI_POND_POINTS, LIANYI_LAKE_POINTS].map((points) => ({
  points,
  rect: polygonBounds(points),
}));

/**
 * 点到水域边界的最短距离平方：湖面共用一份判定。
 * 落在水面内返回 0，水面外返回离岸距离的平方。
 */
export function distanceSqToWater(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const lake of LAKES) {
    if (pointInPolygon(x, y, lake.points)) return 0;
    const distance = distanceSqToPolygon(x, y, lake.points);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * 是否踩在水面上（湖面）。
 *
 * 水面只描述「这里是不是水」，不再表示「能不能走」：三湖全域可涉水（ADR-0030）。
 * 先用包围盒粗筛再判多边形：渲染端每帧要对每个可见实体调用一次。
 */
export function isWaterAt(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const lake of LAKES) {
    if (!rectContains(lake.rect, x, y)) continue;
    if (pointInPolygon(x, y, lake.points)) return true;
    // 中心线端点可能正好落在多边形边界上：pointInPolygon 对边界点不保证为真，
    // 这里用「到边界的距离为 0」补齐，保持与 distanceSqToWater === 0 的旧语义一致。
    if (distanceSqToPolygon(x, y, lake.points) === 0) return true;
  }
  return false;
}

/**
 * 是否正在涉水：站在湖面上。
 * ADR-0047 删除桥与码头后不再需要排除通行面，语义退化为 isWaterAt。
 */
export function isWadingAt(x: number, y: number): boolean {
  return isWaterAt(x, y);
}

const REGIONS: RegionSpec[] = [
  // 三处景观湖：区域名只影响状态栏文案，不影响碰撞
  ...LAKES.map((lake, index) => ({
    name: LAKE_NAMES[index]!,
    rect: rectExpanded(lake.rect, 50),
  })),
  // 北门入园口：从海滩到院落北缘的一小段，含北向主路
  { name: '牛马园北门', rect: { x: 3824, y: 3184, w: 544, h: 292 } },
  // 四间房在办公区内部，必须先于「办公区」命中（ADR-0044）
  { name: '工作区', rect: WORKROOM },
  { name: '会议室', rect: MEETING_ROOM },
  { name: '宿舍区', rect: LOUNGE },
  { name: '卫生间', rect: RESTROOM },
  // 圆庭外缘 120px 的迎宾带：拱门、四向导览牌与四向路口都算广场
  { name: '中央迎宾广场', rect: rectExpanded(PLAZA, 120) },
  { name: '办公区', rect: CAMPUS_RECT },
  { name: '研发园', rect: SOUTH_YARD },
];

/* ------------------------------------------------------------------ *
 * 树丛与树荫：2–5 棵一簇，簇间 220+，全树间隙 ≥86（测试按 80 断言）
 * ------------------------------------------------------------------ */

const TREE_VARIANTS = 4;

/**
 * 树丛中心：手写在岛内的开阔草地上，避开四角院落、三湖、南庭院与主路。
 * 每簇从固定 5 点五边形偏移表里取前 2–5 个点，保证簇内最小间距 ≥86。
 */
const GROVE_CENTERS: ReadonlyArray<Point> = [
  [2250, 2900],
  [2450, 2300],
  [2900, 2500],
  [2900, 2850],
  [3250, 2250],
  [3330, 2700],
  [4650, 2250],
  [5150, 2250],
  [5600, 2500],
  [5700, 3150],
  [3600, 3320],
  [4550, 3300],
  [5000, 3500],
  [5500, 3800],
  [3100, 3050],
  [2400, 3900],
  [2500, 4700],
  [3000, 4750],
  [5450, 4900],
  [2350, 4900],
  [2350, 5650],
  [3000, 5900],
  [3700, 5750],
  [4300, 5850],
  [4800, 5050],
  [3100, 5400],
];

/** 五边形偏移：前 2 / 3 / 4 个点两两距离都 ≥90，簇半径约 120 */
const GROVE_PATTERN: ReadonlyArray<Point> = [
  [-84, 0],
  [-26, -82],
  [70, -54],
  [78, 44],
  [-20, 86],
];

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

function tooClose(x: number, y: number, trees: ReadonlyArray<TreeInstance>, gap: number): boolean {
  const gapSq = gap * gap;
  for (const tree of trees) {
    const dx = tree.x - x;
    const dy = tree.y - y;
    if (dx * dx + dy * dy < gapSq) return true;
  }
  return false;
}

/**
 * 树不能长进水里、路上、广场上，也不能贴到院落、房间与门前铺装上。
 * 留白随地形件一起收紧：漏改这一处，树就会重新长进广场与门口。
 */
function isPlantable(x: number, y: number): boolean {
  if (!isOnLand(x, y, 30)) return false;
  const plazaDx = x - PLAZA_CENTER.x;
  const plazaDy = y - PLAZA_CENTER.y;
  if (plazaDx * plazaDx + plazaDy * plazaDy < (PLAZA_RADIUS + 60) * (PLAZA_RADIUS + 60)) return false;
  if (rectContains(rectExpanded(CAMPUS_RECT, 70), x, y)) return false;
  if (rectContains(rectExpanded(SOUTH_YARD, 40), x, y)) return false;
  for (const paving of DOOR_PAVING) if (rectContains(rectExpanded(paving, 40), x, y)) return false;
  for (const path of PATHS) {
    if (pointInPolygon(x, y, path.polygon)) return false;
    if (distanceSqToPolygon(x, y, path.polygon) < 55 * 55) return false;
  }
  for (const field of FLOWER_FIELDS) if (rectContains(rectExpanded(field.rect, 40), x, y)) return false;
  // 道具与花箱：树不能长进路灯、长椅、垃圾桶或花箱的占地里
  for (const planter of PLANTERS) {
    const dx = planter.x - x;
    const dy = planter.y - y;
    if (dx * dx + dy * dy < (PLANTER_RADIUS + 30) * (PLANTER_RADIUS + 30)) return false;
  }
  for (const prop of PROPS) {
    if (Math.abs(prop.x - x) < 32 && Math.abs(prop.y - y) < 32) return false;
  }
  // 水面留白 95：湖岸是细沙带，树冠不能压到沙上
  if (distanceSqToWater(x, y) < 95 * 95) return false;
  return true;
}

/**
 * 花海：开阔草甸上的不规则色块，白雏菊 / 金盏 / 暖粉交替。
 * 全部避开广场、土路、三湖与院落，只做视觉分区，不参与碰撞。
 */
const FLOWER_FIELDS: FlowerPatch[] = [
  { rect: { x: 2180, y: 4400, w: 250, h: 170 }, palette: 2 },
  { rect: { x: 5150, y: 4900, w: 200, h: 160 }, palette: 1 },
  { rect: { x: 2950, y: 5980, w: 380, h: 150 }, palette: 0 },
  { rect: { x: 5300, y: 5960, w: 300, h: 160 }, palette: 0 },
  { rect: { x: 2880, y: 3260, w: 240, h: 150 }, palette: 1 },
  { rect: { x: 2180, y: 4550, w: 240, h: 220 }, palette: 2 },
  { rect: { x: 5250, y: 3450, w: 180, h: 140 }, palette: 1 },
  { rect: { x: 3550, y: 4780, w: 220, h: 160 }, palette: 2 },
];

function buildGroves(): TreeCluster[] {
  const groves: TreeCluster[] = [];
  const planted: TreeInstance[] = [];
  GROVE_CENTERS.forEach(([cx, cy], index) => {
    const random = mulberry32(0x51ed270b + index * 0x9e3779b1);
    const count = 2 + Math.floor(random() * 4);
    const trees: TreeInstance[] = [];
    for (let i = 0; i < count; i += 1) {
      const [ox, oy] = GROVE_PATTERN[i]!;
      const x = cx + ox + Math.round((random() - 0.5) * 6);
      const y = cy + oy + Math.round((random() - 0.5) * 6);
      if (!isPlantable(x, y)) continue;
      if (tooClose(x, y, planted, TREE_GAP)) continue;
      const tree: TreeInstance = { x, y, variant: Math.floor(random() * TREE_VARIANTS) % TREE_VARIANTS };
      trees.push(tree);
      planted.push(tree);
    }
    // 只剩一棵的簇读不出「树丛」，直接丢弃；它的树仍留在 planted 里避免被后面的簇重复占用
    if (trees.length >= 2) groves.push({ x: cx, y: cy, radius: GROVE_RADIUS, trees });
  });
  return groves;
}

/** 林荫道：沿四条主路两侧每 200px 错列一棵，路缘留 96px */
function avenueTrees(planted: TreeInstance[]): TreeInstance[] {
  const out: TreeInstance[] = [];
  const avenue = [PATHS[0]!, PATHS[1]!, PATHS[2]!, PATHS[3]!];
  avenue.forEach((path, index) => {
    const random = mulberry32(0x2f6d1b7 + index * 0x85ebca6b);
    for (let i = 0; i < path.centerline.length - 1; i += 1) {
      const [x0, y0] = path.centerline[i]!;
      const [x1, y1] = path.centerline[i + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 1) continue;
      const ux = dx / length;
      const uy = dy / length;
      const steps = Math.max(1, Math.floor(length / 200));
      for (let s = 0; s <= steps; s += 1) {
        const t = (s + 0.5) / (steps + 1);
        const bx = x0 + dx * t;
        const by = y0 + dy * t;
        for (const side of [-1, 1] as const) {
          const jitter = Math.round((random() - 0.5) * 24);
          // 树心离路心 = 半路宽 + 96：先让过路缘，再走 `isPlantable` 的 55px 留白
          const offset = path.halfWidth + 96;
          const x = Math.round(bx + uy * offset * side + ux * jitter);
          const y = Math.round(by - ux * offset * side + uy * jitter);
          if (!isPlantable(x, y)) continue;
          if (tooClose(x, y, planted, TREE_GAP)) continue;
          const tree: TreeInstance = { x, y, variant: Math.floor(random() * TREE_VARIANTS) % TREE_VARIANTS };
          planted.push(tree);
          out.push(tree);
        }
      }
    }
  });
  return out;
}

/** 草地孤树：比树丛更稀，作为树丛之间的呼吸点 */
function looseTrees(planted: TreeInstance[]): TreeInstance[] {
  const random = mulberry32(0x1f3a5c7d);
  const out: TreeInstance[] = [];
  const { x, y, w, h } = ISLAND.bounds;
  for (let py = y + 180; py < y + h - 180; py += 128) {
    for (let px = x + 180; px < x + w - 180; px += 128) {
      if (random() > 0.24) continue;
      const tx = px + Math.round((random() - 0.5) * 96);
      const ty = py + Math.round((random() - 0.5) * 96);
      if (!isPlantable(tx, ty)) continue;
      if (tooClose(tx, ty, planted, TREE_GAP)) continue;
      const tree: TreeInstance = { x: tx, y: ty, variant: Math.floor(random() * TREE_VARIANTS) % TREE_VARIANTS };
      planted.push(tree);
      out.push(tree);
    }
  }
  return out;
}

/** 花箱碰撞半径：比视觉尺寸略小（视觉 26×34），擦身而过不会觉得黏 */
export const PLANTER_RADIUS = 12;

/**
 * 景观花箱：圆庭四角 + 四条主路的路口成对摆放。
 * 只留「出生后走两步就能撞到实物」的尺度参照，不把广场切成小格。
 */
const PLANTERS: PlanterInstance[] = [
  // 圆庭四角
  { x: 3820, y: 3820 },
  { x: 4372, y: 3820 },
  { x: 3820, y: 4372 },
  { x: 4372, y: 4372 },
  // 北 / 南主路的路口
  { x: 3980, y: 3500 },
  { x: 4212, y: 3500 },
  { x: 3980, y: 5000 },
  { x: 4212, y: 5000 },
  // 西 / 东主路的路口
  { x: 3000, y: 3980 },
  { x: 3000, y: 4212 },
  { x: 5200, y: 3980 },
  { x: 5200, y: 4212 },
];

/**
 * 中央广场陈设：售货机、咖啡机与长椅在东西两侧对称摆放，
 * 四盏复古路灯站在圆庭外的四个方向；全部让开 112px 的十字主路。
 */
const HUB_PROPS: PropInstance[] = [
  { kind: 'vending', x: 3788, y: 3960 },
  { kind: 'bench', x: 3900, y: 3960 },
  { kind: 'coffee', x: 4404, y: 3960 },
  { kind: 'bench', x: 4292, y: 3960 },
  { kind: 'coffee', x: 3788, y: 4190 },
  { kind: 'bench', x: 3900, y: 4190 },
  { kind: 'vending', x: 4404, y: 4190 },
  { kind: 'bench', x: 4292, y: 4190 },
  { kind: 'lamp', x: 3980, y: 3714 },
  { kind: 'lamp', x: 4212, y: 3714 },
  { kind: 'lamp', x: 3980, y: 4478 },
  { kind: 'lamp', x: 4212, y: 4478 },
  { kind: 'lamp', x: 3714, y: 3980 },
  { kind: 'lamp', x: 3714, y: 4212 },
  { kind: 'lamp', x: 4478, y: 3980 },
  { kind: 'lamp', x: 4478, y: 4212 },
];

/**
 * 沿路休息角：北入口、南向桥头旧址、三处湖岸与西南支路各一组。
 * 每一组都是「灯 + 长椅 / 野餐桌 + 垃圾桶」的固定搭配。
 */
const ROAD_PROPS: PropInstance[] = [
  // 北入口
  { kind: 'lamp', x: 3980, y: 3350 },
  { kind: 'lamp', x: 4212, y: 3350 },
  { kind: 'sign', x: 4290, y: 3320 },
  { kind: 'bin', x: 3900, y: 3320 },
  // 南向主路
  { kind: 'lamp', x: 3980, y: 4880 },
  { kind: 'lamp', x: 4212, y: 4880 },
  { kind: 'bench', x: 3940, y: 5050 },
  { kind: 'bin', x: 4260, y: 5050 },
  // 西侧主路
  { kind: 'lamp', x: 3300, y: 3980 },
  { kind: 'lamp', x: 3300, y: 4212 },
  { kind: 'lamp', x: 2900, y: 3980 },
  { kind: 'bench', x: 2900, y: 4212 },
  // 东侧主路
  { kind: 'lamp', x: 4800, y: 3980 },
  { kind: 'lamp', x: 4800, y: 4212 },
  { kind: 'lamp', x: 5100, y: 3980 },
  { kind: 'bench', x: 5100, y: 4212 },
  // 东北支路 / 沉思浅塘
  { kind: 'lamp', x: 5080, y: 3300 },
  { kind: 'bench', x: 5240, y: 3300 },
  { kind: 'lamp', x: 5000, y: 2660 },
  { kind: 'lamp', x: 5560, y: 2900 },
  // 摸鱼湖
  { kind: 'lamp', x: 5150, y: 5140 },
  { kind: 'bench', x: 5300, y: 5140 },
  { kind: 'bin', x: 5450, y: 5140 },
  { kind: 'lamp', x: 5760, y: 5600 },
  { kind: 'table', x: 5760, y: 5720 },
  // 涟漪湖
  { kind: 'lamp', x: 2750, y: 5180 },
  { kind: 'bench', x: 2750, y: 5300 },
  { kind: 'table', x: 2220, y: 5250 },
  // 西南支路
  { kind: 'lamp', x: 2800, y: 4600 },
  { kind: 'bench', x: 3000, y: 4600 },
];

/**
 * 工位只有工作区这一组（ADR-0044）：四边散布的 45 张桌子全部删除，
 * 椅子与桌子的相对位置仍由 `workstation()` 从朝向反推，不在这里手写第二份。
 */
const DESKS: DeskInstance[] = WORKSTATIONS.map((station) => station.desk);

const DESK_SOLIDS: SolidRect[] = DESKS.map((desk) => {
  const { w, h } = deskFootprint(desk.facing);
  return { kind: 'desk', x: desk.x - w / 2, y: desk.y - h / 2, w, h };
});

/**
 * 座位表：工作区工位 → 会议室椅与马桶 → 宿舍区上下铺/沙发/凳子；id = 下标 + 1。
 * 床位与凳子的区别只体现在 `kind` 上，入座姿态统一由 `seatPose` 决定。
 */
const SEAT_DRAFTS: Array<Omit<SeatInstance, 'id'>> = [
  ...WORKSTATIONS.map((station, index) => ({ ...station.seat, kind: 'chair' as const, desk: index })),
  ...CAMPUS_SEATS.map((seat) => ({ ...seat, desk: -1 })),
  ...LOUNGE_SEATS.map((seat) => ({ ...seat, desk: -1 })),
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
 * 找最近的可用座位：`isFree` 由调用方提供（服务端查占用表，客户端查本地镜像），
 * `accept` 用来按种类过滤（Z 只找坐位，X 只找床），不传即不过滤。
 * 没有可用座位时返回 undefined，调用方退化为地面坐 / 地面躺。
 */
export function findNearestSeat(
  x: number,
  y: number,
  isFree: (seatId: number) => boolean,
  range: number = SIT_RANGE,
  accept?: (seat: SeatInstance) => boolean,
): SeatInstance | undefined {
  let best: SeatInstance | undefined;
  let bestDistance = range * range;
  for (const seat of SEATS) {
    if (accept && !accept(seat)) continue;
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
 * 中央地标碰撞：拱门两根立柱与四向导览牌。
 * 用 `kind: 'prop'` 让 props.ts 的地面层跳过——本体由 welcome.ts 画精灵。
 */
const HUB_SOLIDS: SolidRect[] = [
  {
    // 与 welcome.ts 的 drawArch 共用同一组立柱坐标：纹理 x 10..28、y 22..108
    kind: 'prop',
    x: WELCOME_LANDMARKS.arch.x - WELCOME_LANDMARKS.arch.width / 2 + 10,
    y: WELCOME_LANDMARKS.arch.y - WELCOME_LANDMARKS.arch.height + 22,
    w: 18,
    h: WELCOME_LANDMARKS.arch.height - 26,
  },
  {
    kind: 'prop',
    x: WELCOME_LANDMARKS.arch.x + WELCOME_LANDMARKS.arch.width / 2 - 28,
    y: WELCOME_LANDMARKS.arch.y - WELCOME_LANDMARKS.arch.height + 22,
    w: 18,
    h: WELCOME_LANDMARKS.arch.height - 26,
  },
  {
    kind: 'prop',
    x: WELCOME_LANDMARKS.directory.x - WELCOME_LANDMARKS.directory.width / 2,
    y: WELCOME_LANDMARKS.directory.y - WELCOME_LANDMARKS.directory.height,
    w: WELCOME_LANDMARKS.directory.width,
    h: WELCOME_LANDMARKS.directory.height,
  },
];

/**
 * 南侧休息庭院的树篱围边：沿庭院四边每 64px 一段，北侧正对南向主路留出入口。
 * 树篱是纯装饰（走 props 管线、不产生 blocker），视觉上围出庭院、脚上不封路。
 */
const HEDGE_STEP = 64;
const HEDGE_INSET = 8;
const HEDGE_GATE_X: readonly [number, number] = [3990, 4200];

function southYardHedges(): PropInstance[] {
  const out: PropInstance[] = [];
  const { x, y, w, h } = SOUTH_YARD;
  for (const edgeY of [y + HEDGE_INSET, y + h - HEDGE_INSET]) {
    for (let px = x + 40; px <= x + w - 40; px += HEDGE_STEP) {
      // 只有北边留门，南边保持完整围合
      if (edgeY === y + HEDGE_INSET && px > HEDGE_GATE_X[0] && px < HEDGE_GATE_X[1]) continue;
      out.push({ kind: 'hedge', x: px, y: edgeY });
    }
  }
  for (const edgeX of [x + HEDGE_INSET, x + w - HEDGE_INSET]) {
    for (let py = y + 40; py <= y + h - 40; py += HEDGE_STEP) {
      out.push({ kind: 'hedge', x: edgeX, y: py });
    }
  }
  return out;
}

const PROPS: PropInstance[] = [
  ...HUB_PROPS,
  ...ROAD_PROPS,
  ...SOUTH_YARD_PROPS,
  ...MEETING_PROPS,
  ...RESTROOM_PROPS,
  ...WORK_PROPS,
  ...LOUNGE_PROPS,
  ...AREA_LOGOS,
  ...southYardHedges(),
];

/**
 * 树丛在道具与花箱之后生成：`isPlantable` 要读到 PROPS / PLANTERS 的占地，
 * 提前生成会让树长进路灯或长椅。这里保持「先摆家具，再种树」的顺序。
 */
const GROVES: TreeCluster[] = buildGroves();
const LOOSE_TREES: TreeInstance[] = looseTrees([...GROVES.flatMap((grove) => grove.trees)]);
const AVENUE_TREES = avenueTrees([...GROVES.flatMap((grove) => grove.trees), ...LOOSE_TREES]);
/** 林荫道与孤树都按「散树」参与碰撞与小地图：树丛严格保持 2–5 棵 */
const ALL_LOOSE_TREES: TreeInstance[] = [...LOOSE_TREES, ...AVENUE_TREES];
/** 林荫道是否真的种出来了：布局测试用它防止「偏移量被留白规则全部拒掉」的静默回归 */
export const AVENUE_TREE_COUNT = AVENUE_TREES.length;

/** 有占地的装饰（售货机、长椅、野餐桌、单车）统一由 propSolid 生成碰撞盒 */
const PROP_SOLIDS: SolidRect[] = propSolids(PROPS);

export const WORLD_LAYOUT: WorldLayout = {
  plaza: PLAZA,
  plazaRadius: PLAZA_RADIUS,
  office: CAMPUS_RECT,
  paths: PATHS,
  lakes: LAKES,
  groves: GROVES,
  looseTrees: ALL_LOOSE_TREES,
  flowerFields: FLOWER_FIELDS,
  planters: PLANTERS,
  island: ISLAND,
  regions: REGIONS,
  desks: DESKS,
  seats: SEATS,
  props: PROPS,
  solids: [...DESK_SOLIDS, ...PROP_SOLIDS, ...HUB_SOLIDS, ...CAMPUS_SOLIDS],
  buildings: CAMPUS_BUILDINGS,
  paved: [SOUTH_YARD_PAVING, ...DOOR_PAVING],
};

/** 玩家所在区域名：中央圆庭优先，其余按区域表顺序命中，未命中则落到野地 */
export function regionAt(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return FALLBACK_REGION;
  if (isOnPlaza(x, y)) return '中央迎宾广场';
  for (const region of REGIONS) {
    if (rectContains(region.rect, x, y)) return region.name;
  }
  return FALLBACK_REGION;
}
