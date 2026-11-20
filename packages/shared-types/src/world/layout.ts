/**
 * 静态世界布局：服务端碰撞、客户端渲染、小地图三方共用的唯一真相。
 *
 * 本轮地图空间与生态重构：
 * 1) 有机多半岛岛界在 `island.ts`（29 顶点多边形），彻底告别四角直边大矩形；
 * 2) 9 大树种、6 棵地标百年古树、22 处多阵型主题树丛与 10 片四色花海在 `botany.ts`；
 * 3) 本文件负责总装三湖、14 条放射+环岛道路、铺装、沿街设施与全量 `WORLD_LAYOUT`；
 * 4) 全程严禁 Math.random / Math.sin / Math.cos，保障双端逐像素一致，零 Pixi/DOM/Node 依赖。
 */

import { DIRECTION } from '../constants';
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
  ISLAND,
  ISLAND_POINTS,
  ISLAND_SAFE_RECT,
  ISLAND_SAND,
  WORLD_BOUNDS,
  isOnLand,
  type IslandShape,
} from './island';
import {
  BAMBOO_SHOOT_ZONES,
  BAMBOO_ZONES,
  FLOWER_FIELDS,
  GROVE_MIN_GAP,
  HERO_TREE_SPECS,
  HERO_TREE_TRUNK_RADIUS,
  TREE_MIN_GAP,
  TREE_SPECIES_COUNT,
  TREE_SPECIES_LIST,
  TREE_TRUNK_RADIUS,
  buildBotanicalLayout,
  type FlowerPatch,
  type GroveTheme,
  type TreeCluster,
  type TreeInstance,
  type TreeSpecies,
} from './botany';
import {
  AREA_LOGOS,
  BENCH_SEAT_OFFSET,
  CAMPUS_BUILDINGS,
  CAMPUS_RECT,
  CAMPUS_SEATS,
  CAMPUS_SOLIDS,
  COMPANY_CORRIDOR,
  DOOR_PAVING,
  HOME_THEATER,
  JAIL,
  JAIL_ANCHOR,
  JAIL_ANCHORS,
  JAIL_DOOR_PAVING,
  LIVING_PROPS,
  LOUNGE,
  LOUNGE_COUCH_SECOND,
  LOUNGE_PROPS,
  LOUNGE_SEATS,
  MEETING_PROPS,
  MEETING_ROOM,
  RESTROOM,
  RESTROOM_PROPS,
  ROOM_H,
  ROOM_W,
  SHRINE_ALTAR,
  SHRINE_ALTAR_SOLID,
  TEA_STATION,
  TEA_STATION_SOLID,
  THEATER_SEATS,
  VENT_ROOM,
  WORK_PROPS,
  WORKROOM,
  WORKSTATIONS,
  deskFootprint,
  propSolids,
  type BuildingSpec,
  type DeskInstance,
  type PropInstance,
  type SeatInstance,
  type SolidRect,
} from './campus';
import {
  AMUSEMENT_PARK,
  PARK_ATTRACTION_SOLIDS,
  PARK_BUILDING,
  PARK_GATE_PAVING,
  PARK_PROPS,
  PARK_RIDE_SOLIDS,
  PARK_SOUTH_GATE,
} from './park';
import { BOSS_ARENA, BOSS_SOLID } from './boss';
import { VILLA_SPECS, VILLA_WALL_SOLIDS, type PropertyKind, type PropertyNavId } from './villas';
import { APARTMENT_GARDEN, APARTMENT_SPECS, APARTMENT_WALL_SOLIDS } from './apartment';
import {
  CLINIC_ACCESS_PAVING,
  CLINIC_BEDS,
  CLINIC_COUNTER,
  CLINIC_FENCE_SOLIDS,
  CLINIC_RECT,
} from './clinic';
import {
  DISTRICTS,
  NAV_ARRIVALS,
  NAV_TARGETS,
  PLAZA_HOME,
  PLAZA_REGION_NAME,
  VENUES,
  districtAt,
  navName,
  venueAt,
  type DistrictId,
  type DistrictSpec,
  type NavTarget,
  type NavTargetId,
  type SceneKind,
  type VenueSpec,
} from './districts';

export {
  BENCH_SEAT_OFFSET,
  CHAIR_GAP,
  DESK_H,
  DESK_W,
  HOME_THEATER,
  JAIL,
  JAIL_ANCHOR,
  JAIL_ANCHORS,
  JAIL_DOOR,
  JAIL_DOOR_PAVING,
  COMPANY_CORRIDOR,
  MEETING_ROOM,
  RESTROOM_STALLS,
  SHRINE_ALTAR,
  SHRINE_ALTAR_SOLID,
  TEA_STATION,
  TEA_STATION_SOLID,
  THEATER_SCREEN,
  THEATER_SEATS,
  THEATER_SPEAKERS,
  VENT_ROOM,
  chairOffset,
  deskDepthOffset,
  deskFootprint,
  isSelfSolidProp,
  propSolid,
  propSolids,
  seatPose,
  workstation,
} from './campus';
export type { BuildingSpec, DeskInstance, PropInstance, RestroomStall, SeatInstance, SolidRect, SolidKind, PropKind, SeatKind, Workstation } from './campus';

export {
  CLINIC_ACCESS_PAVING,
  CLINIC_BEDS,
  CLINIC_COUNTER,
  CLINIC_FENCE_SOLIDS,
  CLINIC_RECT,
  CLINIC_REGION_RECT,
  CLINIC_SIGN,
  CLINIC_NURSE_SPOTS,
  CLINIC_AMBULANCE_SPOTS,
  CLINIC_DROP,
  CLINIC_VEHICLE_ENTRY,
} from './clinic';

export {
  DISTRICTS,
  NAV_ARRIVALS,
  NAV_TARGETS,
  PLAZA_HOME,
  PLAZA_REGION_NAME,
  VENUES,
  districtAt,
  navName,
  venueAt,
};
export type { DistrictId, DistrictSpec, NavTarget, NavTargetId, SceneKind, VenueSpec };

export { ISLAND, ISLAND_POINTS, ISLAND_SAFE_RECT, ISLAND_SAND, WORLD_BOUNDS, isOnLand };
export type { IslandShape };

export {
  BAMBOO_SHOOT_ZONES,
  BAMBOO_ZONES,
  FLOWER_FIELDS,
  GROVE_MIN_GAP,
  HERO_TREE_SPECS,
  HERO_TREE_TRUNK_RADIUS,
  TREE_MIN_GAP,
  TREE_SPECIES_COUNT,
  TREE_SPECIES_LIST,
  TREE_TRUNK_RADIUS,
};
export type { FlowerPatch, GroveTheme, TreeCluster, TreeInstance, TreeSpecies };

export interface LakeShape {
  points: Point[];
  /** 包围盒，供网格索引与纹理裁切使用 */
  rect: WorldRect;
}

export interface RegionSpec {
  name: string;
  rect: WorldRect;
}

export interface PlanterInstance {
  x: number;
  y: number;
}

/** 带状土路 / 柏油路：中心线 + 半宽展开出的闭合多边形（几何算法见 ribbon.ts） */
export interface PathShape extends RibbonShape {
  /** 半路宽：材质判定、种树留白与贴花排除共用 */
  readonly halfWidth: number;
}

export interface WorldLayout {
  /** 石砖圆庭的包围盒（圆本身用 isOnPlaza 判定） */
  plaza: WorldRect;
  plazaRadius: number;
  /** 企业楼：只用于区域名与撒树留白，本身不产生碰撞 */
  office: WorldRect;
  paths: PathShape[];
  lakes: LakeShape[];
  /** 散布全岛的生态树丛：每簇 2–5 棵，参与碰撞 */
  groves: TreeCluster[];
  /** 地标古树、林荫道与草甸散树：与树丛一样参与碰撞 */
  looseTrees: TreeInstance[];
  /** 四色调花海：纯装饰，不阻挡行走 */
  flowerFields: FlowerPatch[];
  planters: PlanterInstance[];
  /** 29 顶点有机陆地边界：服务端碰撞、客户端渲染与小地图共用的唯一陆地边界 */
  island: IslandShape;
  /** 按优先级排列，先命中者胜 */
  regions: RegionSpec[];
  /** 五个大区：小地图区色块、导览分组与区门位置都读它 */
  districts: ReadonlyArray<DistrictSpec>;
  /** 工位桌（中心点）：桌面碰撞见 solids */
  desks: DeskInstance[];
  /** 可入座的座位（工位椅、会议椅、马桶、床、沙发、凳子），id 从 1 开始 */
  seats: SeatInstance[];
  /** 装饰与小设施 */
  props: PropInstance[];
  /** 轴对齐碰撞矩形 */
  solids: SolidRect[];
  /** 室内空间与无墙场馆 */
  buildings: BuildingSpec[];
  /** 铺装地面：贴花层不进入 */
  paved: WorldRect[];
}

export const WORLD_CENTER = { x: 4096, y: 4096 } as const;

/** 中央迎宾广场：直径 720px 的石砖圆庭，五向路网的起点 */
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

/** 中央迎宾地标：拱门、园区导览牌与牛马榜公告栏 */
export const WELCOME_LANDMARKS = {
  arch: { x: PLAZA_CENTER.x, y: 4408, width: 320, height: 112 },
  directory: { x: 4310, y: 4460, width: 96, height: 120 },
  rankBoard: { x: 3960, y: 3832, width: 128, height: 96 },
} as const;

/** 牛马放假告示板：中央广场北缘东侧 */
export const BULLETIN_BOARD = { x: 4232, y: 3832, width: 80, height: 48 } as const;

/** 贴地碰撞：只挡下方 80×20 的底座 */
export const BULLETIN_BOARD_SOLID: WorldRect = {
  x: BULLETIN_BOARD.x - BULLETIN_BOARD.width / 2,
  y: BULLETIN_BOARD.y - 20,
  w: BULLETIN_BOARD.width,
  h: 20,
};

/* ------------------------------------------------------------------ *
 * 翠竹林与太湖石
 * ------------------------------------------------------------------ */

function bambooProps(): PropInstance[] {
  const out: PropInstance[] = [];
  BAMBOO_ZONES.forEach((zone, zoneIndex) => {
    const rows = Math.max(1, Math.floor(zone.h / 56));
    const cols = Math.max(1, Math.floor(zone.w / 56));
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = zone.x + 28 + col * 56 + (row % 2) * 28;
        const y = zone.y + 40 + row * 56;
        if (x > zone.x + zone.w - 16) continue;
        out.push({ kind: 'bamboo', x, y, variant: (zoneIndex * 2 + row + col) % 4 });
      }
    }
  });
  return out;
}

const BAMBOO_PROPS: PropInstance[] = bambooProps();

/** 太湖石盆景：迎宾广场东北、西北对角 */
export const TAIHU_ROCKS: ReadonlyArray<{ x: number; y: number; variant: number }> = [
  { x: PLAZA_CENTER.x + 438, y: 3960, variant: 0 },
  { x: PLAZA_CENTER.x - 438, y: 3960, variant: 1 },
];

const TAIHU_PROPS: PropInstance[] = TAIHU_ROCKS.map((rock) => ({
  kind: 'taihu',
  x: rock.x,
  y: rock.y,
  variant: rock.variant,
}));

/* ------------------------------------------------------------------ *
 * 红色宫灯挂点
 * ------------------------------------------------------------------ */

export interface LanternPost {
  readonly x: number;
  readonly hangTop: number;
  readonly depthY: number;
}

export const ARCH_LANTERN_POSTS: ReadonlyArray<LanternPost> = [
  {
    x: WELCOME_LANDMARKS.arch.x - WELCOME_LANDMARKS.arch.width / 2 + 6,
    hangTop: WELCOME_LANDMARKS.arch.y - WELCOME_LANDMARKS.arch.height + 24,
    depthY: WELCOME_LANDMARKS.arch.y,
  },
  {
    x: WELCOME_LANDMARKS.arch.x + WELCOME_LANDMARKS.arch.width / 2 - 6,
    hangTop: WELCOME_LANDMARKS.arch.y - WELCOME_LANDMARKS.arch.height + 24,
    depthY: WELCOME_LANDMARKS.arch.y,
  },
];

export const DOOR_LANTERN_POSTS: ReadonlyArray<LanternPost> = [
  { x: MEETING_ROOM.x + 390, hangTop: MEETING_ROOM.y + ROOM_H - 58, depthY: MEETING_ROOM.y + ROOM_H },
  { x: LOUNGE.x + 260, hangTop: LOUNGE.y - 58, depthY: LOUNGE.y },
  { x: RESTROOM.x + 214, hangTop: RESTROOM.y - 58, depthY: RESTROOM.y },
];

export interface DoorPlaque {
  readonly id: Exclude<NavTargetId, PropertyNavId>;
  readonly text: string;
  readonly x: number;
  readonly depthY: number;
}

export const FALLBACK_REGION = '园区野地';

/** 是否站在中央石砖圆庭上 */
export function isOnPlaza(x: number, y: number): boolean {
  const dx = x - PLAZA_CENTER.x;
  const dy = y - PLAZA_CENTER.y;
  return dx * dx + dy * dy <= PLAZA_RADIUS * PLAZA_RADIUS;
}

/** 主路半宽：柏油林荫大道 112px */
export const PATH_MAIN_HALF_WIDTH = 56;
/** 支路半宽：园区漫步土径 96px */
export const PATH_BRANCH_HALF_WIDTH = 48;

function buildPath(stations: ReadonlyArray<Point>, halfWidth: number): PathShape {
  return { ...buildRibbon(stations, halfWidth), halfWidth };
}

/**
 * 14 条五区路网（4 条柏油主干道 + 10 条园区/环湖支路）：
 * - 前 5 条（0..4）均从广场圆庭内部或边缘起笔，保留 5 向迎宾过街斑马线（25 条）；
 * - 主干道半宽 56（柏油），其余支路铺泥沙细径，串联三湖、两片花谷与六座半岛。
 */
const PATHS: PathShape[] = [
  // 0: 北主路 — 广场北 → 游乐园南门
  buildPath(
    [
      [4096, 3736],
      [4096, 3080],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 1: 南主路 — 广场南（穿拱门）→ 生活大街
  buildPath(
    [
      [4096, 4456],
      [4096, 5290],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 2: 西主路 — 广场西 → 景观西岬
  buildPath(
    [
      [3736, 4096],
      [3400, 4096],
      [2960, 4074],
      [2620, 4030],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 3: 东主路 — 广场东 → 穿服务广场
  buildPath(
    [
      [4456, 4096],
      [5140, 4096],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 4: 企业区前庭支路 — 广场西北 → 企业楼走廊东口
  buildPath(
    [
      [3880, 3880],
      [3760, 3780],
      [3680, 3660],
      [3620, 3636],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 5: 生活大街全段（西延伸至公寓影音，东延伸至一号/二号院，减少多余交叉路口）
  buildPath(
    [
      [3140, 5290],
      [4096, 5290],
      [4780, 5290],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 6: 游乐大街 — 霓虹街门前 → 游乐园南门
  buildPath(
    [
      [2760, 2980],
      [3700, 2980],
      [4036, 3020],
      [4096, 3080],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 7: 沉思北岸游步道 — 游乐园南门 → 绕园东侧 → 沉思畔茶院门前
  buildPath(
    [
      [4096, 3080],
      [4690, 3110],
      [4690, 2690],
      [5070, 2690],
    ],
    36,
  ),
  // 8: 影音室门前小路 — 生活大街 → 影厅东门前庭
  buildPath(
    [
      [3720, 5290],
      [3720, 5480],
      [3700, 5540],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 9: 涟漪湖北岸步径 — 西主路 → 翠竹隐士居西侧 → 涟漪湖北岸
  buildPath(
    [
      [2960, 4074],
      [2960, 4340],
      [2860, 4600],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 10: 沉思浅塘南岸径 — 服务广场北 → 塘南岸观景台
  buildPath(
    [
      [5020, 3580],
      [5020, 3380],
      [5060, 3190],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 11: 摸鱼湖钓屋步径 — 东主路末端 → 小黑屋东侧 → 钓屋门前
  buildPath(
    [
      [5140, 4096],
      [5140, 4480],
      [5240, 4880],
      [5340, 4880],
    ],
    24,
  ),
  // 12: 摸鱼湖西岸环景径 — 生活大街东端 → 摸鱼湖西北湖畔草坡
  buildPath(
    [
      [4780, 5290],
      [4830, 5120],
      [4850, 4980],
    ],
    32,
  ),
];

/** 湖岸细沙带宽 */
export const LAKE_SHORE = 22;

/**
 * 三处有机多边内嵌景观湖：包围盒严格与 districts.ts 的 RING/MOPING/CHENSI 对齐。
 * 保持舒展的近心水域，使游鱼有充裕巡游空间。
 */
const MOPING_LAKE_POINTS: Point[] = [
  [5540, 5280],
  [5510, 5400],
  [5430, 5500],
  [5320, 5570],
  [5210, 5600],
  [5090, 5570],
  [4980, 5480],
  [4930, 5350],
  [4920, 5220],
  [4960, 5090],
  [5050, 5000],
  [5180, 4960],
  [5310, 4980],
  [5420, 5050],
  [5500, 5160],
  [5530, 5220],
];

const CHENSI_POND_POINTS: Point[] = [
  [5380, 2960],
  [5350, 3050],
  [5270, 3120],
  [5160, 3160],
  [5040, 3150],
  [4940, 3100],
  [4880, 3020],
  [4860, 2920],
  [4890, 2830],
  [4960, 2770],
  [5070, 2740],
  [5190, 2750],
  [5290, 2800],
  [5350, 2880],
];

const LIANYI_LAKE_POINTS: Point[] = [
  [3040, 4870],
  [3010, 4970],
  [2940, 5040],
  [2840, 5080],
  [2730, 5070],
  [2650, 5010],
  [2600, 4920],
  [2580, 4820],
  [2610, 4720],
  [2680, 4660],
  [2780, 4620],
  [2890, 4630],
  [2970, 4690],
  [3020, 4770],
];

const LAKES: LakeShape[] = [MOPING_LAKE_POINTS, CHENSI_POND_POINTS, LIANYI_LAKE_POINTS].map((points) => ({
  points,
  rect: polygonBounds(points),
}));

/** 导览场所门牌：坐标只从常量派生 */
export const DOOR_PLAQUES: ReadonlyArray<DoorPlaque> = [
  {
    id: 'meeting',
    text: navName('meeting'),
    x: MEETING_ROOM.x + 414,
    depthY: MEETING_ROOM.y + ROOM_H - 24,
  },
  {
    id: 'restroom',
    text: navName('restroom'),
    x: RESTROOM.x + 120,
    depthY: RESTROOM.y - 16,
  },
  {
    id: 'lounge',
    text: navName('lounge'),
    x: LOUNGE.x + 240,
    depthY: LOUNGE.y - 16,
  },
  {
    id: 'shrine',
    text: navName('shrine'),
    x: SHRINE_ALTAR.x - 48,
    depthY: SHRINE_ALTAR.y + 24,
  },
  {
    id: 'park',
    text: navName('park'),
    x: PARK_SOUTH_GATE.x + 90,
    depthY: PARK_SOUTH_GATE.y + 20,
  },
  {
    id: 'bossArena',
    text: navName('bossArena'),
    x: VENT_ROOM.x + 400,
    depthY: VENT_ROOM.y + 30,
  },
  {
    id: 'apartment',
    text: navName('apartment'),
    x: APARTMENT_SPECS[0]!.door.x + 110,
    depthY: APARTMENT_SPECS[0]!.door.y,
  },
  {
    id: 'theater',
    text: navName('theater'),
    x: HOME_THEATER.x + HOME_THEATER.w + 60,
    depthY: HOME_THEATER.y + 160,
  },
  {
    id: 'clinic',
    text: navName('clinic'),
    x: CLINIC_ACCESS_PAVING.x + 6,
    depthY: CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h + 18,
  },
];

/** 点到水域边界的最短距离平方 */
export function distanceSqToWater(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const lake of LAKES) {
    if (pointInPolygon(x, y, lake.points)) return 0;
    const distance = distanceSqToPolygon(x, y, lake.points);
    if (distance < best) best = distance;
  }
  return best;
}

/** 是否踩在水面上（湖面）：包围盒粗筛后判多边形 */
export function isWaterAt(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const lake of LAKES) {
    if (!rectContains(lake.rect, x, y)) continue;
    if (pointInPolygon(x, y, lake.points)) return true;
    if (distanceSqToPolygon(x, y, lake.points) === 0) return true;
  }
  return false;
}

/** 是否正在涉水 */
export function isWadingAt(x: number, y: number): boolean {
  return isWaterAt(x, y);
}

/* ------------------------------------------------------------------ *
 * 五区铺装（街道与广场）
 * ------------------------------------------------------------------ */

export const COMPANY_FORECOURT: WorldRect = { x: 3540, y: 3500, w: 200, h: 200 };
export const AMUSEMENT_STREET: WorldRect = { x: 2680, y: 2990, w: 1360, h: 90 };
export const NEON_STRIP_PLAZA: WorldRect = { x: 2680, y: 2960, w: 860, h: 52 };
export const PARK_GATE_LINK: WorldRect = { x: 4036, y: 3036, w: 120, h: 44 };
export const SERVICE_SQUARE: WorldRect = { x: 4580, y: 3580, w: 890, h: 930 };
export const LIVING_AVENUE: WorldRect = { x: 3140, y: 5240, w: 1520, h: 100 };

const REGIONS: RegionSpec[] = [
  ...VENUES.map((spec) => ({ name: spec.name, rect: spec.rect })),
  { name: PLAZA_REGION_NAME, rect: rectExpanded(PLAZA, 120) },
  ...DISTRICTS.flatMap((spec) => spec.rects.map((rect) => ({ name: spec.name, rect }))),
];

/* ------------------------------------------------------------------ *
 * 景观花箱、广场陈设与沿路休息角（先摆家具，再种树）
 * ------------------------------------------------------------------ */

export const PLANTER_RADIUS = 12;

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
  { kind: 'bulletin', x: BULLETIN_BOARD.x, y: BULLETIN_BOARD.y },
];

/**
 * 沿路休息角与四对主路节庆双灯柱：
 * - 四条主路外侧各保持 1 对 `232px` 节庆双灯柱；其余路灯成单或间隔 >= 340px，不误触发节日串灯配对；
 * - 游乐街南长椅落在 `AMUSEMENT_PARK` 内缘 (3700, 3050)，避开路面与景点拍照位。
 */
const ROAD_PROPS: PropInstance[] = [
  // 北主路 / 游乐区街口（232px 节日双灯柱）
  { kind: 'lamp', x: 3980, y: 3400 },
  { kind: 'lamp', x: 4212, y: 3400 },
  { kind: 'sign', x: 4290, y: 3380 },
  { kind: 'bin', x: 3900, y: 3380 },
  // 霓虹娱乐街（两灯相距 610px，不构串灯对）
  { kind: 'lamp', x: 2950, y: 2930 },
  { kind: 'lamp', x: 3560, y: 2930 },
  { kind: 'bench', x: 3700, y: 3050 },
  // 南主路 / 生活区街口（232px 节日双灯柱）
  { kind: 'lamp', x: 3980, y: 4800 },
  { kind: 'lamp', x: 4212, y: 4800 },
  { kind: 'bin', x: 3960, y: 5270 },
  // 西主路（232px 节日双灯柱，北灯位于企业楼南墙下 20px）
  { kind: 'lamp', x: 3300, y: 4016 },
  { kind: 'lamp', x: 3300, y: 4248 },
  { kind: 'lamp', x: 2880, y: 4000 },
  { kind: 'bench', x: 2880, y: 4196 },
  // 东主路 / 服务广场（232px 节日双灯柱）
  { kind: 'lamp', x: 5000, y: 3980 },
  { kind: 'lamp', x: 5000, y: 4212 },
  { kind: 'bench', x: 4920, y: 4540 },
  // 东北支路 / 沉思浅塘
  { kind: 'lamp', x: 4700, y: 2660 },
  { kind: 'bench', x: 5260, y: 3260 },
  // 摸鱼湖（北岸 + 南岸）
  { kind: 'lamp', x: 5000, y: 4880 },
  { kind: 'bench', x: 5140, y: 4900 },
  { kind: 'bin', x: 5300, y: 4880 },
  { kind: 'lamp', x: 5060, y: 5660 },
  { kind: 'table', x: 5260, y: 5660 },
  // 涟漪湖（北岸 + 南岸）
  { kind: 'lamp', x: 2780, y: 4560 },
  { kind: 'bench', x: 2940, y: 4560 },
  { kind: 'table', x: 2800, y: 5140 },
];

const DESKS: DeskInstance[] = WORKSTATIONS.map((station) => station.desk);

const DESK_SOLIDS: SolidRect[] = DESKS.map((desk) => {
  const { w, h } = deskFootprint(desk.facing);
  return { kind: 'desk', x: desk.x - w / 2, y: desk.y - h / 2, w, h };
});

const SEAT_DRAFTS: Array<Omit<SeatInstance, 'id'>> = [
  ...WORKSTATIONS.map((station, index) => ({ ...station.seat, kind: 'chair' as const, desk: index })),
  ...CAMPUS_SEATS.map((seat) => ({ ...seat, desk: -1 })),
  ...LOUNGE_SEATS.map((seat) => ({ ...seat, desk: -1 })),
  { ...LOUNGE_COUCH_SECOND, desk: -1 },
  ...THEATER_SEATS.map((seat) => ({ ...seat, desk: -1 })),
];

export const SIT_RANGE = 90;

export function seatById(id: number): SeatInstance | undefined {
  if (!Number.isInteger(id) || id < 1 || id > SEATS.length) return undefined;
  return SEATS[id - 1];
}

export const WORK_DESK_SEAT_IDS: ReadonlyArray<number> = WORKSTATIONS.map((_, index) => index + 1);

export function isWorkDeskSeat(seatId: number): boolean {
  return Number.isInteger(seatId) && seatId >= 1 && seatId <= WORKSTATIONS.length;
}

export function workDeskIndexOfSeat(seatId: number): number {
  return isWorkDeskSeat(seatId) ? seatId - 1 : -1;
}

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

const HUB_SOLIDS: SolidRect[] = [
  {
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
  {
    kind: 'prop',
    x: WELCOME_LANDMARKS.rankBoard.x - 60,
    y: WELCOME_LANDMARKS.rankBoard.y - 18,
    w: 120,
    h: 18,
  },
  {
    kind: 'prop',
    x: BULLETIN_BOARD_SOLID.x,
    y: BULLETIN_BOARD_SOLID.y,
    w: BULLETIN_BOARD_SOLID.w,
    h: BULLETIN_BOARD_SOLID.h,
  },
];

const PROPS: PropInstance[] = [
  ...HUB_PROPS,
  ...ROAD_PROPS,
  ...LIVING_PROPS,
  ...MEETING_PROPS,
  ...RESTROOM_PROPS,
  ...WORK_PROPS,
  ...LOUNGE_PROPS,
  ...AREA_LOGOS,
  ...PARK_PROPS,
  ...BAMBOO_PROPS,
  ...TAIHU_PROPS,
];

const BENCH_SEATS: SeatInstance[] = PROPS.filter((prop) => prop.kind === 'bench').map((prop, index) => ({
  id: SEAT_DRAFTS.length + index + 1,
  x: prop.x,
  y: prop.y + BENCH_SEAT_OFFSET,
  facing: DIRECTION.Down,
  kind: 'bench',
  desk: -1,
}));

const CLINIC_SEATS: SeatInstance[] = CLINIC_BEDS.map((bed, index) => ({
  id: SEAT_DRAFTS.length + BENCH_SEATS.length + index + 1,
  x: bed.x + bed.w / 2,
  y: bed.y + bed.h / 2,
  facing: DIRECTION.Right,
  kind: 'bed',
  desk: -1,
}));

export const CLINIC_BED_SEAT_IDS = CLINIC_SEATS.map((seat) => seat.id);

const CLINIC_SOLIDS: SolidRect[] = [
  { kind: 'desk', x: CLINIC_COUNTER.x, y: CLINIC_COUNTER.y, w: CLINIC_COUNTER.w, h: CLINIC_COUNTER.h },
  ...CLINIC_BEDS.flatMap((bed) => [
    { kind: 'fixture' as const, x: bed.x - 4, y: bed.y, w: 10, h: bed.h },
    { kind: 'fixture' as const, x: bed.x + bed.w - 6, y: bed.y, w: 10, h: bed.h },
  ]),
];

const SEATS: SeatInstance[] = [
  ...SEAT_DRAFTS.map((seat, index) => ({ id: index + 1, ...seat })),
  ...BENCH_SEATS,
  ...CLINIC_SEATS,
];

function propertyFloor(kind: PropertyKind) {
  switch (kind) {
    case 'club':
      return 'cinema' as const;
    case 'garage':
      return 'concrete' as const;
    case 'stall':
      return 'plaster' as const;
    case 'lodge':
      return 'wood' as const;
    default:
      return 'walnut' as const;
  }
}

/** 种树留白规则：确保树干与树冠不压沙滩、广场、道路、建筑、竹林、花海或设施 */
function isPlantable(x: number, y: number): boolean {
  if (!isOnLand(x, y, ISLAND_SAND + 38)) return false;
  const plazaDx = x - PLAZA_CENTER.x;
  const plazaDy = y - PLAZA_CENTER.y;
  if (plazaDx * plazaDx + plazaDy * plazaDy < (PLAZA_RADIUS + 60) * (PLAZA_RADIUS + 60)) return false;
  if (rectContains(rectExpanded(CAMPUS_RECT, 70), x, y)) return false;
  for (const building of CAMPUS_BUILDINGS) {
    if (rectContains(rectExpanded(building.rect, 40), x, y)) return false;
  }
  if (rectContains(rectExpanded(AMUSEMENT_PARK, 40), x, y)) return false;
  if (rectContains(rectExpanded(CLINIC_RECT, 60), x, y)) return false;
  if (rectContains(rectExpanded(CLINIC_ACCESS_PAVING, 40), x, y)) return false;
  for (const paving of [
    AMUSEMENT_STREET,
    NEON_STRIP_PLAZA,
    PARK_GATE_LINK,
    SERVICE_SQUARE,
    LIVING_AVENUE,
    COMPANY_FORECOURT,
  ]) {
    if (rectContains(rectExpanded(paving, 30), x, y)) return false;
  }
  for (const spec of VILLA_SPECS) if (rectContains(rectExpanded(spec.rect, 36), x, y)) return false;
  for (const spec of APARTMENT_SPECS) if (rectContains(rectExpanded(spec.rect, 60), x, y)) return false;
  if (rectContains(rectExpanded(APARTMENT_GARDEN, 12), x, y)) return false;
  for (const zone of BAMBOO_ZONES) if (rectContains(rectExpanded(zone, 24), x, y)) return false;
  if (rectContains(rectExpanded(BOSS_ARENA, 8), x, y)) return false;
  for (const paving of DOOR_PAVING) if (rectContains(rectExpanded(paving, 40), x, y)) return false;
  for (const path of PATHS) {
    if (pointInPolygon(x, y, path.polygon)) return false;
    if (distanceSqToPolygon(x, y, path.polygon) < 55 * 55) return false;
  }
  for (const field of FLOWER_FIELDS) if (rectContains(rectExpanded(field.rect, 40), x, y)) return false;
  for (const planter of PLANTERS) {
    const dx = planter.x - x;
    const dy = planter.y - y;
    if (dx * dx + dy * dy < (PLANTER_RADIUS + 30) * (PLANTER_RADIUS + 30)) return false;
  }
  for (const prop of PROPS) {
    if (Math.abs(prop.x - x) < 32 && Math.abs(prop.y - y) < 32) return false;
  }
  if (distanceSqToWater(x, y) < 95 * 95) return false;
  return true;
}

/** 地标百年古树额外留白：树冠更大，需多留岸线与水域余量 */
function isHeroPlantable(x: number, y: number): boolean {
  if (!isPlantable(x, y)) return false;
  if (!isOnLand(x, y, ISLAND_SAND + 52)) return false;
  return distanceSqToWater(x, y) >= 100 * 100;
}

const BOTANICAL = buildBotanicalLayout({
  island: ISLAND,
  paths: PATHS,
  lakes: LAKES,
  isPlantable,
  isHeroPlantable,
});

const GROVES: TreeCluster[] = BOTANICAL.groves;
const ALL_LOOSE_TREES: TreeInstance[] = BOTANICAL.looseTrees;

/** 校验指标：林荫道树数量与 6 棵地标古树数量 */
export const AVENUE_TREE_COUNT = BOTANICAL.avenueTreeCount;
export const HERO_TREE_COUNT = BOTANICAL.heroTreeCount;

const PROP_SOLIDS: SolidRect[] = propSolids(PROPS);

export const WORLD_LAYOUT: WorldLayout = {
  plaza: PLAZA,
  plazaRadius: PLAZA_RADIUS,
  office: CAMPUS_RECT,
  paths: PATHS,
  lakes: LAKES,
  groves: GROVES,
  looseTrees: ALL_LOOSE_TREES,
  flowerFields: [...FLOWER_FIELDS],
  planters: PLANTERS,
  island: ISLAND,
  regions: REGIONS,
  districts: DISTRICTS,
  desks: DESKS,
  seats: SEATS,
  props: PROPS,
  solids: [
    ...DESK_SOLIDS,
    ...PROP_SOLIDS,
    ...HUB_SOLIDS,
    ...CAMPUS_SOLIDS,
    { kind: 'prop', ...SHRINE_ALTAR_SOLID },
    { kind: 'prop', ...TEA_STATION_SOLID },
    ...PARK_RIDE_SOLIDS,
    ...PARK_ATTRACTION_SOLIDS,
    { kind: 'prop', ...BOSS_SOLID },
    ...CLINIC_SOLIDS,
    ...CLINIC_FENCE_SOLIDS,
    ...VILLA_WALL_SOLIDS,
    ...APARTMENT_WALL_SOLIDS,
  ],
  buildings: [
    ...CAMPUS_BUILDINGS,
    PARK_BUILDING,
    ...VILLA_SPECS.map((spec) => ({ name: spec.name, rect: spec.house, floor: propertyFloor(spec.kind) })),
    ...APARTMENT_SPECS.map((spec) => ({ name: '牛马公寓', rect: spec.rect, floor: 'plaster' as const })),
  ],
  paved: [
    COMPANY_FORECOURT,
    AMUSEMENT_STREET,
    NEON_STRIP_PLAZA,
    PARK_GATE_LINK,
    SERVICE_SQUARE,
    LIVING_AVENUE,
    PARK_GATE_PAVING,
    CLINIC_RECT,
    CLINIC_ACCESS_PAVING,
    ...VILLA_SPECS.map((spec) => spec.rect),
    ...APARTMENT_SPECS.map((spec) => spec.rect),
    ...DOOR_PAVING,
  ],
};

/** 玩家所在区域名 */
export function regionAt(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return FALLBACK_REGION;
  if (isOnPlaza(x, y)) return PLAZA_REGION_NAME;
  const venue = venueAt(x, y);
  if (venue) return venue.name;
  for (const region of REGIONS) {
    if (rectContains(region.rect, x, y)) return region.name;
  }
  return FALLBACK_REGION;
}
