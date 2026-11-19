/**
 * 静态世界布局：服务端碰撞、客户端渲染、小地图三方共用的唯一真相。
 *
 * 两条纪律：
 * 1) 坐标全部手写，或由 `Math.imul` 派生的 mulberry32 生成；禁止 Math.random / Math.sin / Math.cos，
 *    否则 Bun(JSC) 与浏览器(V8) 可能给出不同结果，双端会各画各的地图。
 * 2) 只描述「世界是什么」，不依赖 Pixi / Bun / DOM。渲染尺寸、贴图与配色由各自的消费方决定。
 *
 * ADR-0097（五区大改）：园区从「一院四房 + 散落设施」改成一座小城。
 * - 中央迎宾广场是市政中心，出生点与迎宾拱门不动；
 * - 企业区在西（企业楼：工作区 / 会议室 / 发泄室），服务区在东（卫生间 / 小黑屋 / 急救站），
 *   游乐区在北（赌场亭 / 八角笼 / 游乐园 / 游乐大街），生活区在南（公寓 / 宿舍 / 影音室 / 小院），
 *   景观区是西侧与东南的水景绿地网络（三湖 + 原亭址草地 + 竹林）；
 * - 分区的唯一真相在 `districts.ts`，本文件只做汇总：路网、铺装、树、道具与 `WORLD_LAYOUT`。
 *
 * ADR-0064：海岸线取消，边界改成同一个包围盒的四条直边（矩形陆地）；
 *   北湾 / 东湾 / 南中湾全部填成陆地，四边由一片不可通行的密林封住。
 * ADR-0047：去掉周报河 / 晨会溪 / 护园溪与全部桥码头，内陆连成整块；
 *   出生点移到岛心 720px 石砖圆庭，四角房之间铺放射状土路；
 *   东南「摸鱼湖」扩大，东北新增「沉思浅塘」，西侧补「涟漪湖」；
 *   大片「加班林」拆成 2–5 棵一簇的树丛与林荫道，全树间隙 ≥80px。
 *   按本轮确认，水域保持可涉水（ADR-0030 继续有效），湖面不注册碰撞体。
 */

import { DIRECTION, WORLD_HEIGHT, WORLD_WIDTH } from '../constants';
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
  /** 企业楼（ADR-0097）：只用于区域名与撒树留白，本身不产生碰撞（房间墙体才挡人） */
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
  /** 矩形陆地边界：服务端碰撞、客户端渲染与小地图共用的唯一陆地边界 */
  island: IslandShape;
  /** 按优先级排列，先命中者胜 */
  regions: RegionSpec[];
  /** 五个大区（ADR-0097）：小地图区色块、导览分组与区门位置都读它 */
  districts: ReadonlyArray<DistrictSpec>;
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
 * 中央迎宾广场（ADR-0047）：直径 720px 的石砖圆庭，五条街的起点。
 * ADR-0097 后它不再被四角院落包住，四周是五个方向的区门与前庭。
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
 * 中央迎宾地标（ADR-0047 / ADR-0049）：拱门跨在南向主路两侧，东侧立四向园区导览牌。
 * 只描述位置与尺寸；木料、霓虹字与像素画法由 apps/web 的 WelcomeView 决定。
 */
export const WELCOME_LANDMARKS = {
  /** 迎宾拱门：底边中心落在广场南缘，宽度 320，立柱让开 112px 的南向主路 */
  arch: { x: PLAZA_CENTER.x, y: 4408, width: 320, height: 112 },
  /**
   * 园区导览牌：拱门东侧、圆庭外缘（避开东南支路）。
   *
   * 画布由 ADR-0049 的 96×92 加高到 96×120（ADR-0089）：园区级目标从 3 处涨到 7 处，
   * 92 高只放得下 5 块 13px 的牌，后两块会被画布裁掉。牌面按底边锚定向上长，
   * 因此底边同时南移 28px（4432 → 4460）：加高后的上沿若停在 4312，
   * 会啃进东南支路的下缘（那条路的南边线在 x 4262–4358 上是 y 4317–4332）。
   *
   * ADR-0097：牌面改为列五座区门，5 块牌仍落在同一张 96×120 画布内。
   */
  directory: { x: 4310, y: 4460, width: 96, height: 120 },
  /**
   * 牛马榜公告栏（ADR-0054）：广场北缘、出生点斜北侧，顶部与广场边界齐平。
   * 刻意偏西 136px：128px 宽横在 112px 的北向主路（含两侧余量 128px 通道）上
   * 会把出口堵死；靠路西侧摆放既保住通道，又让从出生点向北走的人第一眼看到。
   */
  rankBoard: { x: 3960, y: 3832, width: 128, height: 96 },
} as const;

/**
 * 牛马放假告示板（ADR-0059）：中央广场北缘东侧，与西侧牛马榜公告栏左右对称。
 *
 * 底边 y = 3832 与 rankBoard 同高，牌面 80×48 完全落在广场圆内；
 * 牌面横坐标 4192–4272 在 112px 北向主路（4040–4152）东侧 40px 外，
 * 出生点 (4096,4096) 向北抬头就能同时看见两块牌子，通道不被占用。
 *
 * 坐标与碰撞只在这里定义一次：渲染（props.ts / bulletin.ts）、交互（interactions.ts）
 * 与布局测试全部从这一份常量派生，不允许出现第二处手写坐标。
 */
export const BULLETIN_BOARD = { x: 4232, y: 3832, width: 80, height: 48 } as const;

/** 贴地碰撞：只挡下方 80×20 的底座，牌面在头顶，玩家可从左、右、上方贴近 */
export const BULLETIN_BOARD_SOLID: WorldRect = {
  x: BULLETIN_BOARD.x - BULLETIN_BOARD.width / 2,
  y: BULLETIN_BOARD.y - 20,
  w: BULLETIN_BOARD.width,
  h: 20,
};

/* ------------------------------------------------------------------ *
 * 竹林与太湖石（ADR-0061）
 * ------------------------------------------------------------------ */

/**
 * 翠竹林：两片，落在西主路南侧的景观带。
 * `isPlantable` 会排除这两片 —— 「替换部分普通树木」就是这一个排除，
 * 不需要另写一份「删掉哪几棵树」的清单。
 */
export const BAMBOO_ZONES: ReadonlyArray<WorldRect> = [
  // 景观区西带：西主路以南、涟漪湖以北（让开 3300 那对路灯）
  { x: 3050, y: 4180, w: 200, h: 100 },
  { x: 3370, y: 4180, w: 126, h: 228 },
];

/**
 * 竹丛实例：按 56px 网格错列，奇偶行偏移 28 让竹竿不排成方阵。
 * 固定步长而不是随机撒点 —— 本文件禁止 Math.random，两端布局必须逐像素一致。
 */
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

/** 竹林专属地面贴花撒点区：竹笋只长在竹林里，不全岛乱冒 */
export const BAMBOO_SHOOT_ZONES: ReadonlyArray<WorldRect> = BAMBOO_ZONES;

/**
 * 太湖石盆景：迎宾广场东北、西北两处对角拐角（东南角留给拱门与导览牌的引道）。
 * 坐标以广场中心左右对称（±438），并且同时避开花箱（四角 3820/4372）、
 * 八盏复古路灯（≥59）与四条支路的 48px 半宽——三条都是布局测试钉死的。
 */
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
 * 红色宫灯挂点（ADR-0061）
 * ------------------------------------------------------------------ */

export interface LanternPost {
  readonly x: number;
  readonly hangTop: number;
  readonly depthY: number;
}

/** 迎宾拱门横梁两端：贴在立柱外侧，正好夹住中间那块招牌横幅 */
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

/**
 * 各处门柱各一盏，挂在**门柱**上而不是门洞正中：
 * 门洞正中那盏正好垂在玩家脸上，且会挡住从门里走出来的人。
 */
export const DOOR_LANTERN_POSTS: ReadonlyArray<LanternPost> = [
  { x: MEETING_ROOM.x + 390, hangTop: MEETING_ROOM.y + ROOM_H - 58, depthY: MEETING_ROOM.y + ROOM_H },
  { x: LOUNGE.x + 260, hangTop: LOUNGE.y - 58, depthY: LOUNGE.y },
  // 卫生间门洞收窄到 x+150..x+210，宫灯挂在东侧门柱外沿
  { x: RESTROOM.x + 214, hangTop: RESTROOM.y - 58, depthY: RESTROOM.y },
];

/**
 * 场所门牌（ADR-0061 / ADR-0091）。
 *
 * 仓库的墙体是**平铺 10px 色带**（`props.ts` 的 `fillSolidFlat`），没有立面可以挂牌匾，
 * 所以在入口立一块小门牌。匾额文案一律取自导览目标的中文名，不在第二处手写场所名。
 */
export interface DoorPlaque {
  readonly id: Exclude<NavTargetId, PropertyNavId>;
  /** 标准中文名，取自 `NAV_TARGETS` */
  readonly text: string;
  /** 门头中心 x（门牌的对称轴） */
  readonly x: number;
  /** 进 y 排序层的脚底 y（= 门所在的那条线） */
  readonly depthY: number;
}

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

/** 沙滩装饰带宽：从矩形边界向内铺一条，玩家碰撞线正好落在沙滩外沿 */
export const ISLAND_SAND = 26;

/**
 * 陆地边界（顺时针，屏幕坐标 y 向下）。
 *
 * ADR-0077：在 ADR-0064 的矩形岛界上再收紧约 20% ——
 * 3040×3368（x 2560–5600 / y 2412–5780），面积约 −36%。
 */
const ISLAND_POINTS: Point[] = [
  [2560, 2412],
  [5600, 2412],
  [5600, 5780],
  [2560, 5780],
];

export const ISLAND: IslandShape = {
  points: ISLAND_POINTS,
  bounds: polygonBounds(ISLAND_POINTS),
};

/**
 * 世界边界契约：矩形四边即边界，边界外不可达（视觉上是一片密林）。
 * `WORLD_WIDTH/HEIGHT` 只是协议坐标上限；真正挡人的是这四条直边。
 */
export const WORLD_BOUNDS: WorldRect = ISLAND.bounds;

/**
 * 半径内是否完全落在陆地上：`radius` 是离四边的净空，`radius = 0` 时只判边界内。
 */
export function isOnLand(x: number, y: number, radius = 0): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return false;
  const { x: bx, y: by, w, h } = WORLD_BOUNDS;
  const inset = radius > 0 ? radius : 0;
  if (w <= inset * 2 || h <= inset * 2) return false;
  return x > bx + inset && x < bx + w - inset && y > by + inset && y < by + h - inset;
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
/** 支路半宽：路宽 96，接五区门与各处入口 */
export const PATH_BRANCH_HALF_WIDTH = 48;

function buildPath(stations: ReadonlyArray<Point>, halfWidth: number): PathShape {
  return { ...buildRibbon(stations, halfWidth), halfWidth };
}

/**
 * 放射状路网（ADR-0097）：广场五向出街。
 * - 北 → 游乐园南门；南 → 生活大街；西 → 景观区门；东 → 服务广场；
 * - 西北支路 → 企业楼大门（企业区前庭）；
 * - 游乐大街、生活大街、服务广场各自是一条铺装街面，由本文件的 paved 提供。
 */
const PATHS: PathShape[] = [
  // 北主路：广场北 → 游乐园南门
  buildPath(
    [
      [4096, 3736],
      [4096, 3400],
      [4096, 3160],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 南主路：广场南（穿拱门）→ 生活大街
  buildPath(
    [
      [4096, 4456],
      [4096, 4800],
      [4096, 5160],
      [4096, 5340],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 西主路：广场西 → 景观区门（涟漪湖—竹林—花海）
  buildPath(
    [
      [3736, 4096],
      [3400, 4096],
      [3050, 4070],
      [2760, 4010],
      [2700, 3980],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 东主路：广场东 → 穿服务广场（卫生间在北、小黑屋在南）
  buildPath(
    [
      [4456, 4096],
      [4800, 4096],
      [5040, 4096],
    ],
    PATH_MAIN_HALF_WIDTH,
  ),
  // 企业区前庭：广场西北 → 企业楼大门。
  // 末点落在**走廊口的门线**上（`COMPANY_CORRIDOR.y + h`），走廊加宽到 56 后
  // 这条土路也跟着长 16px，否则路会停在门前 16px 的草地上（ADR-0099）
  buildPath(
    [
      [3880, 3880],
      [3760, 3780],
      [3680, 3660],
      [3620, 3616],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 生活大街西延：南主路 → 生活大街
  buildPath(
    [
      [4096, 5340],
      [3600, 5340],
      [3160, 5340],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 游乐大街（霓虹娱乐街）：不夜城夜店门前 → 游乐园南门
  buildPath(
    [
      [2760, 3060],
      [3700, 3060],
      [4036, 3096],
      [4096, 3160],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 沉思北岸小路：北向主路游乐口 → 游乐园东侧草带 → 沉思畔茶院门前
  buildPath(
    [
      [4096, 3200],
      [4690, 3200],
      [4690, 2656],
      [5050, 2656],
    ],
    36,
  ),
  // 影音室门前小路：生活大街 → 影厅东门（夹在影厅与宿舍之间）
  buildPath(
    [
      [3760, 5340],
      [3760, 5480],
      [3720, 5560],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 景观区支路：西主路 → 涟漪湖北岸
  buildPath(
    [
      [2900, 4030],
      [2880, 4300],
      [2860, 4600],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 沉思浅塘支路：服务广场北 → 塘南岸
  buildPath(
    [
      [5000, 3600],
      [5020, 3400],
      [5050, 3180],
    ],
    PATH_BRANCH_HALF_WIDTH,
  ),
  // 摸鱼湖钓屋支路：东主路尽头 → 服务广场南沿 → 摸鱼湖钓屋门前
  buildPath(
    [
      [5040, 4096],
      [5040, 4460],
      [5204, 4932],
      [5350, 4932],
    ],
    24,
  ),
];

/** 岸线宽度：只影响渲染，碰撞边界仍是水面轮廓 */
export const LAKE_SHORE = 22;

/**
 * 三处内嵌景观湖（ADR-0047）：形状与位置全部保持不变（ADR-0097 只改归属）。
 * - 摸鱼湖：东南扩大版，离东岸/南岸都留 250px 以上；
 * - 沉思浅塘：东北台地，藏在会议区以北的林间；
 * - 涟漪湖：西侧小湖，接景观区支路。
 */
const MOPING_LAKE_POINTS: Point[] = [
  [5560, 5340],
  [5540, 5460],
  [5480, 5570],
  [5380, 5650],
  [5250, 5690],
  [5120, 5670],
  [5010, 5600],
  [4930, 5490],
  [4900, 5360],
  [4920, 5230],
  [4980, 5120],
  [5080, 5040],
  [5210, 5000],
  [5340, 5020],
  [5450, 5090],
  [5520, 5200],
];

const CHENSI_POND_POINTS: Point[] = [
  [5340, 2920],
  [5320, 3010],
  [5260, 3080],
  [5170, 3120],
  [5080, 3110],
  [4990, 3080],
  [4900, 3020],
  [4840, 2950],
  [4830, 2860],
  [4890, 2780],
  [4980, 2730],
  [5080, 2700],
  [5180, 2720],
  [5270, 2780],
];

const LIANYI_LAKE_POINTS: Point[] = [
  [3080, 4950],
  [3060, 5040],
  [3000, 5110],
  [2910, 5150],
  [2810, 5140],
  [2730, 5090],
  [2670, 5020],
  [2640, 4930],
  [2640, 4840],
  [2680, 4760],
  [2760, 4710],
  [2850, 4700],
  [2940, 4730],
  [3020, 4800],
];

const LAKE_NAMES = ['摸鱼湖', '沉思浅塘', '涟漪湖'] as const;

const LAKES: LakeShape[] = [MOPING_LAKE_POINTS, CHENSI_POND_POINTS, LIANYI_LAKE_POINTS].map((points) => ({
  points,
  rect: polygonBounds(points),
}));

/**
 * 导览场所的门牌（ADR-0091 / ADR-0097 / ADR-0099）。
 *
 * - 各处在入口立一块 60×30 的小门牌，纯装饰、不登记碰撞；
 * - 两栋小院不在表内：院名直接写在院门牌匾上（`villas-view.ts`）。
 *
 * 所有落点都贴在门的侧前方，不压门洞、不挡导览到达点；坐标只从世界常量派生。
 */
export const DOOR_PLAQUES: ReadonlyArray<DoorPlaque> = [
  {
    // 会议室门在 x+330..x+390，牌匾贴在门东侧、离南墙 24px（玩家半径 9 不压墙）
    id: 'meeting',
    text: navName('meeting'),
    x: MEETING_ROOM.x + 414,
    depthY: MEETING_ROOM.y + ROOM_H - 24,
  },
  {
    // 门洞 4750–4810 的西侧，离开北门柱 20px
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
    // 供案西侧 48px：不压 56 宽的案面，也不挡正前方上香的那一步
    id: 'shrine',
    text: navName('shrine'),
    x: SHRINE_ALTAR.x - 48,
    depthY: SHRINE_ALTAR.y + 24,
  },
  {
    // 南门外东侧草地：离 120 宽的门前铺装 30px，不压围栏缺口
    id: 'park',
    text: navName('park'),
    x: PARK_SOUTH_GATE.x + 90,
    depthY: PARK_SOUTH_GATE.y + 20,
  },
  {
    // 发泄室门内东侧：离北墙 30px，不挡 60px 宽的门口
    id: 'bossArena',
    text: navName('bossArena'),
    x: VENT_ROOM.x + 400,
    depthY: VENT_ROOM.y + 30,
  },
  {
    // 301 栋门口台阶东侧 110px：避开正门热区与立面招牌
    id: 'apartment',
    text: navName('apartment'),
    x: APARTMENT_SPECS[0]!.door.x + 110,
    depthY: APARTMENT_SPECS[0]!.door.y,
  },
  {
    // ADR-0099：影音室东门，牌匾贴在门前铺装的东端，离到达点 120px
    id: 'theater',
    text: navName('theater'),
    x: HOME_THEATER.x + HOME_THEATER.w + 60,
    depthY: HOME_THEATER.y + 160,
  },
  {
    // 急救站：西侧人行门洞外的铺装西南角，避开围挡与立牌
    id: 'clinic',
    text: navName('clinic'),
    x: CLINIC_ACCESS_PAVING.x + 6,
    depthY: CLINIC_ACCESS_PAVING.y + CLINIC_ACCESS_PAVING.h + 18,
  },
];

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

/** 是否踩在水面上（湖面）：先用包围盒粗筛再判多边形。 */
export function isWaterAt(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const lake of LAKES) {
    if (!rectContains(lake.rect, x, y)) continue;
    if (pointInPolygon(x, y, lake.points)) return true;
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

/* ------------------------------------------------------------------ *
 * 五区铺装：街面本身就是区界（ADR-0097）
 * ------------------------------------------------------------------ */

/** 企业楼前庭：从楼门到西主路之间的铺装 */
export const COMPANY_FORECOURT: WorldRect = { x: 3540, y: 3480, w: 200, h: 200 };
/** 游乐大街（霓虹娱乐街）：不夜城夜店 → 游乐园南门，整条街一次铺到底 */
export const AMUSEMENT_STREET: WorldRect = { x: 2600, y: 3020, w: 1440, h: 96 };
/** 霓虹娱乐街门前广场：无缝衔接夜店 / 改车铺 / 拉面摊南门与游乐大街 */
export const NEON_STRIP_PLAZA: WorldRect = { x: 2600, y: 2960, w: 880, h: 60 };
/** 游乐大街到公园南门的接坡 */
export const PARK_GATE_LINK: WorldRect = { x: 4036, y: 3116, w: 120, h: 44 };
/** 服务广场：卫生间 / 小黑屋 / 急救站共用的大院子 */
export const SERVICE_SQUARE: WorldRect = { x: 4520, y: 3600, w: 860, h: 860 };
/** 生活大街：公寓楼群南侧的东西向人行道 */
export const LIVING_AVENUE: WorldRect = { x: 3140, y: 5300, w: 1460, h: 80 };

/**
 * 区域名：场所优先、广场次之、大区兜底、野地收尾。
 * `VENUES` 的顺序在 `districts.ts` 里显式排定（小的 / 室内的 / 具名的先命中）。
 */
const REGIONS: RegionSpec[] = [
  ...VENUES.map((spec) => ({ name: spec.name, rect: spec.rect })),
  // 圆庭外缘 120px 的迎宾带：拱门、四向导览牌与五向路口都算广场
  { name: PLAZA_REGION_NAME, rect: rectExpanded(PLAZA, 120) },
  ...DISTRICTS.flatMap((spec) => spec.rects.map((rect) => ({ name: spec.name, rect }))),
];

/* ------------------------------------------------------------------ *
 * 树丛与树荫：2–5 棵一簇，簇间 220+，全树间隙 ≥86（测试按 80 断言）
 * ------------------------------------------------------------------ */

const TREE_VARIANTS = 4;

/**
 * 树丛中心：手写在岛内的开阔草地上，避开五区建筑、三湖、主路与街面。
 * 每簇从固定 5 点五边形偏移表里取前 2–5 个点，保证簇内最小间距 ≥86。
 */
const GROVE_CENTERS: ReadonlyArray<Point> = [
  // 北缘：游乐区以北的草带
  [2760, 2470],
  [3300, 2470],
  [4400, 2470],
  // 北主路西侧的草带
  [4000, 3400],
  // 游乐园西侧的草带
  [3450, 3350],
  // 东北：沉思浅塘四周
  [5000, 3320],
  [5450, 3400],
  [5470, 3000],
  [5470, 4150],
  [5480, 3700],
  // 西带：企业楼以南、涟漪湖以北
  [2700, 4450],
  [3600, 4350],
  [4400, 3400],
  // 东南：摸鱼湖西岸与南岸
  [3890, 4720],
  [4700, 4700],
  [5050, 4620],
  [2900, 5680],
  // 生活区补林荫
  [4600, 5000],
  [3120, 5560],
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
  // 留白 = 沙带宽 + 树冠半宽：树冠（向两侧各探 36px）不能压到边界沙滩上（ADR-0064）
  if (!isOnLand(x, y, ISLAND_SAND + 36)) return false;
  const plazaDx = x - PLAZA_CENTER.x;
  const plazaDy = y - PLAZA_CENTER.y;
  if (plazaDx * plazaDx + plazaDy * plazaDy < (PLAZA_RADIUS + 60) * (PLAZA_RADIUS + 60)) return false;
  if (rectContains(rectExpanded(CAMPUS_RECT, 70), x, y)) return false;
  // 所有有地板的建筑（企业楼四间 + 宿舍 + 卫生间 + 影音室 + 小黑屋）都留 40px 树带
  for (const building of CAMPUS_BUILDINGS) {
    if (rectContains(rectExpanded(building.rect, 40), x, y)) return false;
  }
  if (rectContains(rectExpanded(AMUSEMENT_PARK, 40), x, y)) return false;
  // 护士急救站：站台 + 进站铺装外扩 60，树冠不能压到救护车出入口
  if (rectContains(rectExpanded(CLINIC_RECT, 60), x, y)) return false;
  if (rectContains(rectExpanded(CLINIC_ACCESS_PAVING, 40), x, y)) return false;
  // 五区街面与门前广场：不种树
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
  // 8 栋房产地标、牛马公寓：门牌与院落内及周边留白 36/60px
  for (const spec of VILLA_SPECS) if (rectContains(rectExpanded(spec.rect, 36), x, y)) return false;
  // 公寓留白 60：门牌与门口台阶在楼体南沿外 24–50px，树不能站在门口
  for (const spec of APARTMENT_SPECS) if (rectContains(rectExpanded(spec.rect, 60), x, y)) return false;
  // 门前口袋花园（ADR-0101）：石板小径与灌木位整片留给装饰，散树不再长进来
  if (rectContains(rectExpanded(APARTMENT_GARDEN, 12), x, y)) return false;
  // 竹林留白：这两片交给竹子，普通树不再混长进来
  for (const zone of BAMBOO_ZONES) if (rectContains(rectExpanded(zone, 24), x, y)) return false;
  // 发泄区地面与老板占地内不长树（发泄室内部，兜底）
  if (rectContains(rectExpanded(BOSS_ARENA, 8), x, y)) return false;
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
 * 全部避开广场、土路、三湖与五区建筑，只做视觉分区，不参与碰撞。
 */
const FLOWER_FIELDS: FlowerPatch[] = [
  { rect: { x: 2690, y: 4180, w: 180, h: 140 }, palette: 2 },
  { rect: { x: 4680, y: 3260, w: 220, h: 150 }, palette: 1 },
  { rect: { x: 5400, y: 4560, w: 140, h: 130 }, palette: 0 },
  { rect: { x: 2680, y: 5340, w: 200, h: 150 }, palette: 1 },
  { rect: { x: 4900, y: 4560, w: 200, h: 150 }, palette: 2 },
  { rect: { x: 2900, y: 5180, w: 160, h: 110 }, palette: 1 },
  // 公寓门前口袋花园里的一畦花圃（ADR-0101）：避开石板小径与楼体
  { rect: { x: 3520, y: 5000, w: 180, h: 140 }, palette: 0 },
];

function buildGroves(): TreeCluster[] {
  const groves: TreeCluster[] = [];
  const planted: TreeInstance[] = [];
  GROVE_CENTERS.forEach(([cx, cy], index) => {
    const random = mulberry32(0x51ed270b + index * 0x9e3779b1);
    const count = 2 + Math.floor(random() * 4);
    const trees: TreeInstance[] = [];
    // 五个偏移点全部走一遍：前几个被留白规则拒掉时用后面的补，避免整簇只剩一棵
    for (let i = 0; i < GROVE_PATTERN.length && trees.length < count; i += 1) {
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

/** 孤树撒点格距：128 → 96（ADR-0077）→ 72（ADR-0095 补回公寓占掉的林荫） */
const LOOSE_TREE_STEP = 72;

/** 草地孤树：比树丛更稀，作为树丛之间的呼吸点 */
function looseTrees(planted: TreeInstance[]): TreeInstance[] {
  const random = mulberry32(0x1f3a5c7d);
  const out: TreeInstance[] = [];
  const { x, y, w, h } = ISLAND.bounds;
  for (let py = y + 180; py < y + h - 180; py += LOOSE_TREE_STEP) {
    for (let px = x + 180; px < x + w - 180; px += LOOSE_TREE_STEP) {
      if (random() > 0.3) continue;
      const tx = px + Math.round((random() - 0.5) * LOOSE_TREE_STEP);
      const ty = py + Math.round((random() - 0.5) * LOOSE_TREE_STEP);
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
  // 放假告示板（ADR-0059）：木牌本体走道具管线，底座碰撞在 HUB_SOLIDS 里单独登记
  { kind: 'bulletin', x: BULLETIN_BOARD.x, y: BULLETIN_BOARD.y },
];

/**
 * 沿路休息角：五区街口与三湖岸边各一组。
 * 每一组都是「灯 + 长椅 / 野餐桌 + 垃圾桶」的固定搭配。
 */
const ROAD_PROPS: PropInstance[] = [
  // 北主路 / 游乐区街口
  { kind: 'lamp', x: 3980, y: 3400 },
  { kind: 'lamp', x: 4212, y: 3400 },
  { kind: 'sign', x: 4290, y: 3380 },
  { kind: 'bin', x: 3900, y: 3380 },
  // 霓虹娱乐街（夜店 / 改车铺 / 拉面摊前）
  { kind: 'lamp', x: 2950, y: 3000 },
  { kind: 'lamp', x: 3600, y: 3000 },
  { kind: 'bench', x: 3700, y: 3130 },
  // 南主路 / 生活区街口
  { kind: 'lamp', x: 3980, y: 4800 },
  { kind: 'lamp', x: 4212, y: 4800 },
  { kind: 'bin', x: 3960, y: 5290 },
  // 西主路 / 企业区与景观区。楼北侧两盏灯跟着企业楼南墙下移 16px（3960 → 3976，ADR-0099）：
  // 原来离墙 20px，走廊加宽后若不跟着挪，灯柱会插进墙里 4px。
  // 这对灯柱是节日彩旗的挂点，两者必须一起下移同样的 16px —— 只挪一根的话
  // 间距会从 232 变成 216，彩旗长度与贴图就都错位了
  { kind: 'lamp', x: 3300, y: 3996 },
  { kind: 'lamp', x: 3300, y: 4228 },
  { kind: 'lamp', x: 2900, y: 3996 },
  { kind: 'bench', x: 2900, y: 4212 },
  // 东主路 / 服务广场：一对 232 间距的灯柱，节日彩旗挂在这一对上
  { kind: 'lamp', x: 5000, y: 3980 },
  { kind: 'lamp', x: 5000, y: 4212 },
  { kind: 'bench', x: 4920, y: 4400 },
  // 东北支路 / 沉思浅塘：灯在北岸小路转角，长椅在塘南岸
  { kind: 'lamp', x: 4740, y: 2690 },
  { kind: 'bench', x: 5240, y: 3300 },
  // 摸鱼湖：北岸一组 + 南岸一组
  { kind: 'lamp', x: 5000, y: 4900 },
  { kind: 'bench', x: 5150, y: 4900 },
  { kind: 'bin', x: 5300, y: 4900 },
  { kind: 'lamp', x: 5050, y: 5740 },
  { kind: 'table', x: 5250, y: 5740 },
  // 涟漪湖：北岸灯与长椅，南岸野餐桌
  { kind: 'lamp', x: 2800, y: 4620 },
  { kind: 'bench', x: 2950, y: 4620 },
  { kind: 'table', x: 2800, y: 5230 },
];

/**
 * 工位只有工作区这一组：四边散布的 45 张桌子全部删除，
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
  // 新增座位一律追加在末尾：本地 `niuma:session:v1` 里存着 seatId，
  // 插在中间会让既有工位 / 床的 id 整体后移。
  { ...LOUNGE_COUCH_SECOND, desk: -1 },
  ...THEATER_SEATS.map((seat) => ({ ...seat, desk: -1 })),
];

/** 入座判定半径：角色中心与座位锚点的距离，超出则不会就座（服务端与客户端共用） */
export const SIT_RANGE = 90;

/** 按 id 取座位；0 与越界 id 返回 undefined */
export function seatById(id: number): SeatInstance | undefined {
  if (!Number.isInteger(id) || id < 1 || id > SEATS.length) return undefined;
  return SEATS[id - 1];
}

/**
 * 工位座位 id 表（ADR-0088）。
 *
 * `SEAT_DRAFTS` 的第一段就是 `WORKSTATIONS`，因此工位椅恒为 `1..WORKSTATIONS.length`；
 * 这段顺序被注释钉死为「新增座位只能追加在末尾」，所以这里可以直接按 id 区间判断。
 */
export const WORK_DESK_SEAT_IDS: ReadonlyArray<number> = WORKSTATIONS.map((_, index) => index + 1);

/** 这张椅子是不是工位椅：坐姿搬砖的服务端校验与客户端提示都读它 */
export function isWorkDeskSeat(seatId: number): boolean {
  return Number.isInteger(seatId) && seatId >= 1 && seatId <= WORKSTATIONS.length;
}

/** 工位椅 → 工位下标（0 起）；不是工位椅返回 -1 */
export function workDeskIndexOfSeat(seatId: number): number {
  return isWorkDeskSeat(seatId) ? seatId - 1 : -1;
}

/**
 * 找最近的可用座位：`isFree` 由调用方提供（服务端查占用表，客户端查本地镜像），
 * `accept` 用来按种类过滤（Z 只找坐位，X 只找床），不传即不过滤。
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
 * 中央地标碰撞：拱门两根立柱、四向导览牌、牛马榜公告栏与放假告示板。
 * 用 `kind: 'prop'` 让 props.ts 的地面层跳过——本体由各自的视图画精灵。
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
  {
    // 只挡底座那一截：牌面在头顶，玩家仍可贴着板面走过
    kind: 'prop',
    x: WELCOME_LANDMARKS.rankBoard.x - 60,
    y: WELCOME_LANDMARKS.rankBoard.y - 18,
    w: 120,
    h: 18,
  },
  {
    // 放假告示板（ADR-0059）：80×20 贴地底座，坐标由 BULLETIN_BOARD 派生
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

/**
 * 长椅座位：外观与 40×16 碰撞仍由道具管线负责，这里只登记坐点。
 *
 * 坐点固定在长椅底座前方 `BENCH_SEAT_OFFSET` 处，避开自身碰撞盒；
 * 长椅统一面朝南（靠背在北侧），与 `drawProp` 的固定画法一致。
 * 必须紧接 `SEAT_DRAFTS` 末尾以保住既有 seatId——`niuma:session:v1` 里存着它。
 */
const BENCH_SEATS: SeatInstance[] = PROPS.filter((prop) => prop.kind === 'bench').map((prop, index) => ({
  id: SEAT_DRAFTS.length + index + 1,
  x: prop.x,
  y: prop.y + BENCH_SEAT_OFFSET,
  facing: DIRECTION.Down,
  kind: 'bench',
  desk: -1,
}));

/** 病床座位：急救站的两张床，接在长椅之后 */
const CLINIC_SEATS: SeatInstance[] = CLINIC_BEDS.map((bed, index) => ({
  id: SEAT_DRAFTS.length + BENCH_SEATS.length + index + 1,
  x: bed.x + bed.w / 2,
  y: bed.y + bed.h / 2,
  // 床品是横向画法（枕头在右端）：所有 bed 统一朝水平方向，躺姿才不会头在被子中间
  facing: DIRECTION.Right,
  kind: 'bed',
  desk: -1,
}));

/** 病床 seatId：给急救管理器直接占用，避免再按距离找床 */
export const CLINIC_BED_SEAT_IDS = CLINIC_SEATS.map((seat) => seat.id);

const CLINIC_SOLIDS: SolidRect[] = [
  // 导医柜台：只挡柜体，柜台后方留给护士站立
  { kind: 'desk', x: CLINIC_COUNTER.x, y: CLINIC_COUNTER.y, w: CLINIC_COUNTER.w, h: CLINIC_COUNTER.h },
  // 两张病床的左右头尾边；床面中段留空，正好容纳躺倒的伤员外沿
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
  districts: DISTRICTS,
  desks: DESKS,
  seats: SEATS,
  props: PROPS,
  solids: [
    ...DESK_SOLIDS,
    ...PROP_SOLIDS,
    ...HUB_SOLIDS,
    ...CAMPUS_SOLIDS,
    // 国风地标（ADR-0061）：供案底座、茶台底座
    { kind: 'prop', ...SHRINE_ALTAR_SOLID },
    { kind: 'prop', ...TEA_STATION_SOLID },
    // 游乐园器械底座（滑梯塔楼 / 秋千 / 跷跷板 / 旋转木马）
    ...PARK_RIDE_SOLIDS,
    // 静态大件底座（摩天轮 / 小火车 / 沙池 / 喷泉）
    ...PARK_ATTRACTION_SOLIDS,
    // 发泄区老板脚底（ADR-0070）：只挡地面那一截
    { kind: 'prop', ...BOSS_SOLID },
    // 护士急救站（ADR-0084）：导医柜台 + 两张病床的头尾边
    ...CLINIC_SOLIDS,
    // 护士站围挡（ADR-0092）：三面栏杆 + 西门人行门洞，南侧留救护车通道
    ...CLINIC_FENCE_SOLIDS,
    // 园区 8 栋房产：四面院墙（南墙留门洞，锁门时另加动态门栅）
    ...VILLA_WALL_SOLIDS,
    // 牛马公寓：唯一一栋，整圈封闭的外墙
    ...APARTMENT_WALL_SOLIDS,
  ],
  buildings: [
    ...CAMPUS_BUILDINGS,
    PARK_BUILDING,
    ...VILLA_SPECS.map((spec) => ({ name: spec.name, rect: spec.house, floor: propertyFloor(spec.kind) })),
    // 唯一一栋单户公寓楼（ADR-0095 / ADR-0101）：区域名与树带都按 rect 展开
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

/**
 * 玩家所在区域名：中央圆庭优先，其次场所名，再按大区兜底，未命中则落到野地。
 * 场所优先保证「站在发泄室里显示发泄区，而不是企业区」。
 */
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
