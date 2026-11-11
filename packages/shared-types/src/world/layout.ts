/**
 * 静态世界布局：服务端碰撞、客户端渲染、小地图三方共用的唯一真相。
 *
 * 两条纪律：
 * 1) 坐标全部手写，或由 `Math.imul` 派生的 mulberry32 生成；禁止 Math.random / Math.sin / Math.cos，
 *    否则 Bun(JSC) 与浏览器(V8) 可能给出不同结果，双端会各画各的地图。
 * 2) 只描述「世界是什么」，不依赖 Pixi / Bun / DOM。渲染尺寸、贴图与配色由各自的消费方决定。
 *
 * ADR-0028：岛再按 0.7 收缩到 3805×4212（西南湾填成湿地），办公区删除围栏改为开放式软分区，
 * 主河改到岛西侧纵贯、增开东西向的晨会溪，湖收到东南角并补五口水塘与三桥两码头。
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
  CAMPUS_PROPS,
  CAMPUS_RECT,
  CAMPUS_SEATS,
  CAMPUS_SOLIDS,
  CAMPUS_YARD,
  CHAIR_GAP,
  DESK_H,
  DESK_W,
  DOOR_PAVING,
  deskFootprint,
  propSolid,
  propSolids,
  LOUNGE,
  LOUNGE_PROPS,
  LOUNGE_SEATS,
  MEETING_ROOM,
  PLAZA_PROPS,
  RESTROOM,
  WORKSTATIONS,
  WORKROOM,
  WORK_PROPS,
  workstation,
  type BuildingSpec,
  type DeskInstance,
  type PropInstance,
  type SeatInstance,
  type SolidRect,
  type Workstation,
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
  /** 开放式办公区：只用于区域名、工位排布与撒树留白，不参与碰撞（ADR-0028 删除围栏） */
  office: WorldRect;
  paths: WorldRect[];
  lakes: LakeShape[];
  rivers: RiverShape[];
  bridges: WorldRect[];
  /** 码头木栈道：一端接岸、一端伸进水面，与 bridges 共用 isOnBridge（不计涉水） */
  docks: WorldRect[];
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
  /** 可入座的座位（工位椅、会议椅、马桶、床、沙发、凳子），id 从 1 开始，0 表示无座位 */
  seats: SeatInstance[];
  /** 装饰与小设施（灯、长椅、垃圾桶、标识、水槽、售货机、饮水机、咖啡机、树篱等） */
  props: PropInstance[];
  /** 墙体、桌面、隔断、售货机等轴对齐碰撞矩形 */
  solids: SolidRect[];
  /** 室内空间（会议室、卫生间、工作区、休息室）：渲染端按 floor 画地板 */
  buildings: BuildingSpec[];
  /** 铺装地面：贴花层不进入 */
  paved: WorldRect[];
}

export const WORLD_CENTER = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 } as const;

/**
 * 出生中心（ADR-0036）：北门入园口，落在北向土路与门肩的空地上。
 *
 * 旧版以世界中心为出生圈，玩家一进场就站在办公广场正中、四面工位环之间；
 * 现在把入场点挪到门外的迎宾区，第一眼看到的是横幅与指路牌，而不是一堵桌子。
 */
export const SPAWN_CENTER = { x: 4096, y: 3300 } as const;

/**
 * 出生点散布上限，与服务端 config.spawnRadius 默认值一致。
 *
 * 72 让整个出生圆完整落在北门土路与门肩（x 4024–4168 / y 3228–3372）：
 * 再大就会穿过门洞落进工位环，或退到北湾沙滩上。北门口袋没有碰撞道具，
 * 服务端的拒绝采样几乎一次命中，不会触发 `findFreePoint` 的兜底挪位。
 */
export const SPAWN_RADIUS = 72;

/**
 * 园区导览目标（ADR-0036）：北门指路牌、HUD 导览卡与测试共用这一份。
 *
 * 坐标取房间矩形中心；改房间位置时箭头自动跟着转，
 * 不允许在客户端或 HUD 里再写一份同名坐标。
 */
export type NavTargetId = 'workroom' | 'restroom' | 'lounge' | 'meeting';

export interface NavTarget {
  readonly id: NavTargetId;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

function rectCenter(rect: WorldRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

const NAV_SOURCES: ReadonlyArray<{ id: NavTargetId; name: string; rect: WorldRect }> = [
  { id: 'workroom', name: '工作区', rect: WORKROOM },
  { id: 'restroom', name: '卫生间', rect: RESTROOM },
  { id: 'lounge', name: '休息室', rect: LOUNGE },
  { id: 'meeting', name: '会议室', rect: MEETING_ROOM },
];

export const NAV_TARGETS: readonly NavTarget[] = NAV_SOURCES.map(({ id, name, rect }) => ({
  id,
  name,
  ...rectCenter(rect),
}));

/**
 * 北门迎宾地标（ADR-0036）：横幅跨门洞、指路牌立在门东肩。
 * 只描述位置与尺寸，木料、布幡与文字由 apps/web 的 WelcomeView 决定。
 */
export const WELCOME_LANDMARKS = {
  /** 横幅拱门：底边中心落在北门通道（GATE_LANE_X）正中，宽度盖住整个门洞 */
  banner: { x: 4096, y: 3404, width: 292, height: 96 },
  /** 指路牌：门东肩、树篱缺口外侧，脚底中心 */
  signpost: { x: 4280, y: 3396 },
} as const;

/** 树干碰撞半径：>3 才挡得住人，<14 才能从树缝里穿过去 */
export const TREE_TRUNK_RADIUS = 12;

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
 * 与上一版不同的是**西南湾填成陆地**，改成湿地水塘群：
 * 上一版西南角的深湾在新尺寸下会挤掉整片可玩陆地，填平后南段才有空间放研发园与湖。
 *
 * 保留北湾（x 3392–4448，探到 y 3158）、东湾（x 5598–5951 / y 3393–5009）、
 * 南中湾（x 3392–4775 / y 5989–6168）三个海湾；四个海岸段全部轴对齐手写，
 * 与地形一样禁止 Math.random / Math.sin / Math.cos。
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
 * 尺度总则（ADR-0010 / ADR-0022 / ADR-0026 / ADR-0028）：角色站立高 48 texel，
 * 广场/道路/水域按 1.25 放大后，靠 MOVE_SPEED 165px/s 把通行时间拉回来。
 * 坐标一律手写偶数，保持以 (4096,4096) 为中心对称。
 */

/** 办公广场：冷灰绿地砖，出生点全部落在里面；与办公区同以世界中心为心 */
const PLAZA: WorldRect = { x: 3536, y: 3628, w: 1120, h: 936 };

/**
 * 开放式办公区：上一版围栏的包围盒，ADR-0028 删掉栏板只留这个矩形。
 * 工位沿四边排布，树篱与花箱做软分区，四个方向各留一条入口通道。
 */
const OFFICE_RECT: WorldRect = { x: 3216, y: 3404, w: 1760, h: 1384 };

/**
 * 土路：四个方向各一条，外加东侧两条支路把工作区与湖岸串起来。
 * 北向与南向跨水处由 BRIDGES 放行；路宽 128（≈2.7 个角色宽）。
 */
const PATHS: WorldRect[] = [
  // 北入口：北湾南岸 → 办公区北缘
  { x: 4032, y: 3184, w: 128, h: 220 },
  // 北岸横路：休息室南门 → 工作区西侧，沿北湾南岸绕一圈
  { x: 2900, y: 3250, w: 2110, h: 128 },
  // 南向主路：办公区南缘 → 研发园北缘（跨晨会溪）
  { x: 4032, y: 4788, w: 128, h: 312 },
  // 西向：办公区西缘 → 主河西岸（跨周报河）
  { x: 2440, y: 4032, w: 776, h: 128 },
  // 东向：办公区东缘 → 湖路上端
  { x: 4976, y: 4032, w: 374, h: 128 },
  // 东侧支路：东向路 → 晨会溪南岸
  { x: 5140, y: 4160, w: 128, h: 660 },
  // 湖路：晨会溪南岸 → 摸鱼湖北岸
  { x: 5140, y: 5040, w: 128, h: 220 },
];

/**
 * 湖面轮廓：12 点手写，绕 (5450,5575) 做 300×320 的收放，
 * 落在研发园以东、东湾以南的空地上，离两侧海岸至少 200px。
 */
const LAKE_POINTS: Point[] = [
  [5750, 5575],
  [5710, 5735],
  [5600, 5852],
  [5450, 5895],
  [5300, 5852],
  [5190, 5735],
  [5150, 5575],
  [5190, 5415],
  [5300, 5298],
  [5450, 5255],
  [5600, 5298],
  [5710, 5415],
];

/** 岸线宽度：只影响渲染，碰撞边界仍是水面轮廓 */
export const LAKE_SHORE = 22;

/** 半河宽：主河总宽 224，与 520 宽的木桥两侧各留 32px */
export const RIVER_HALF_WIDTH = 112;
/** 支流（晨会溪）半宽：总宽 144，比主河窄一档，读起来是「溪」而不是第二条大河 */
export const CREEK_HALF_WIDTH = 72;
/** 河岸沙带：与湖岸同档，只影响渲染，碰撞边界仍是水面多边形 */
export const RIVER_SHORE = 24;

/**
 * 主河（周报河）中心线：南北两端各探进海里 100px 左右，
 * x 在 2696–2734 之间缓摆（幅度 ≤ 38，远小于半河宽 112），岸线只做微弯。
 * 水面恒定落在 x 2584–2846，西岸留 438px 宽的林地与水塘带。
 */
const RIVER_STATIONS: Point[] = [
  [2700, 1800],
  [2718, 2150],
  [2696, 2500],
  [2712, 2850],
  [2734, 3200],
  [2716, 3550],
  [2730, 3900],
  [2712, 4250],
  [2726, 4600],
  [2708, 4950],
  [2722, 5300],
  [2706, 5650],
  [2718, 6000],
  [2712, 6220],
];

/**
 * 支流（晨会溪）中心线：从主河分出、向东汇进东湾，两端都在水面内。
 * 中心线 y 在 4926–4958 之间缓摆，水面恒定落在 y 4868–5012：
 * 北侧离办公区南缘 80px，南侧离研发园北缘 88px，两侧都留得下走道。
 */
const CREEK_STATIONS: Point[] = [
  [2700, 4940],
  [3050, 4926],
  [3450, 4956],
  [3900, 4938],
  [4350, 4958],
  [4800, 4936],
  [5250, 4954],
  [5620, 4940],
];

const RIVERS: RiverShape[] = [
  buildRiver(RIVER_STATIONS, RIVER_HALF_WIDTH),
  buildRiver(CREEK_STATIONS, CREEK_HALF_WIDTH),
];

/**
 * 木桥：整段盖住河面，是跨水的唯一通行口。
 *
 * - A：西向路跨周报河，东西向通行，宽 208（路 128 + 两侧各 40）；
 * - B：南向主路跨晨会溪，南北向通行；
 * - C：东侧支路跨晨会溪，南北向通行。
 *
 * 放行判定看的是角色中心点，桥面若刚好从水面开始，人会被「离岸 9px」的碰撞半径挡在桥头。
 */
const BRIDGES: WorldRect[] = [
  { x: 2440, y: 3992, w: 520, h: 208 },
  { x: 3980, y: 4820, w: 232, h: 260 },
  { x: 5100, y: 4820, w: 236, h: 260 },
];

/**
 * 码头木栈道：一端踩在岸上、一端伸进水面，与桥共用 `isOnBridge`。
 * 水已可涉水（ADR-0030），`isOnBridge` 现在用于「不算涉水」的表现判定，
 * 而不是碰撞放行；码头仍单独建模——桥要求两端都在陆地，码头只有一端在陆地。
 */
const DOCKS: WorldRect[] = [
  // 摸鱼湖北岸：从岸上往南伸进湖里
  { x: 5376, y: 5240, w: 48, h: 160 },
  // 周报河西岸：从岸上往东伸进河里
  { x: 2500, y: 4600, w: 260, h: 48 },
];

/** 花箱碰撞半径：比视觉尺寸略小（视觉 26×34），擦身而过不会觉得黏 */
export const PLANTER_RADIUS = 12;

/**
 * 景观花箱：广场内外两圈 + 办公区四角 + 桥头与东西两岸。
 * 出生点四周就有「会被挡住」的实物，走两步就能看出 y 排序；
 * 26 个花箱把 1120×936 的广场与 1760×1384 的办公区切成若干可读的小空间。
 */
const PLANTERS: PlanterInstance[] = [
  // 广场中心四角
  { x: 3971, y: 3971 },
  { x: 4221, y: 3971 },
  { x: 3971, y: 4221 },
  { x: 4221, y: 4221 },
  // 广场内侧四条边
  { x: 3671, y: 3971 },
  { x: 3671, y: 4221 },
  { x: 4521, y: 3971 },
  { x: 4521, y: 4221 },
  // 广场外圈：东西各三只，南北各两只（让开四个入口）
  { x: 3470, y: 3760 },
  { x: 3470, y: 4096 },
  { x: 3470, y: 4432 },
  { x: 4722, y: 3760 },
  { x: 4722, y: 4096 },
  { x: 4722, y: 4432 },
  { x: 3760, y: 3540 },
  { x: 4432, y: 3540 },
  { x: 3760, y: 4652 },
  { x: 4432, y: 4652 },
  // 办公区四角
  { x: 3270, y: 3470 },
  { x: 3270, y: 4720 },
  { x: 4930, y: 3470 },
  { x: 4930, y: 4720 },
  // 桥头与两岸
  { x: 3960, y: 4820 },
  { x: 4232, y: 4820 },
  { x: 3320, y: 4850 },
  { x: 4940, y: 4850 },
  { x: 5050, y: 4400 },
];

/**
 * 沿路休息角：北入口、南向桥头、西岸码头、东侧湖路、湖岸与湿地各一组。
 * 每一组都是「灯 + 长椅 + 垃圾桶 / 野餐桌」的固定搭配，走一段就能遇到一处可坐下的地方。
 */
const ROAD_PROPS: PropInstance[] = [
  // 北入口
  { kind: 'lamp', x: 3944, y: 3260 },
  { kind: 'lamp', x: 4240, y: 3260 },
  { kind: 'bench', x: 3860, y: 3300 },
  { kind: 'bin', x: 4290, y: 3300 },
  // 南向桥头
  { kind: 'lamp', x: 3960, y: 4810 },
  { kind: 'lamp', x: 4232, y: 4810 },
  // 西岸码头区
  { kind: 'lamp', x: 2520, y: 4420 },
  { kind: 'table', x: 2500, y: 4500 },
  { kind: 'bench', x: 2520, y: 4580 },
  { kind: 'bin', x: 2560, y: 4430 },
  // 东侧湖路
  { kind: 'lamp', x: 5060, y: 4300 },
  { kind: 'bench', x: 5060, y: 4420 },
  { kind: 'sign', x: 5300, y: 4200 },
  { kind: 'bin', x: 5300, y: 4310 },
  // 湖岸
  { kind: 'lamp', x: 5320, y: 5210 },
  { kind: 'bench', x: 5300, y: 5220 },
  { kind: 'table', x: 5600, y: 5200 },
  // 西岸湿地
  { kind: 'lamp', x: 2540, y: 5700 },
  { kind: 'table', x: 2560, y: 5750 },
  { kind: 'bench', x: 2560, y: 5830 },
];

/**
 * 办公区工位：沿开放式办公区四边排布。北、南两排是横向工位（椅子在桌子外侧），
 * 东、西两列是纵向工位。南北门通道与路口留白，人流不会被桌子堵住。
 * 坐标手写对称（中心 x = 4096）。
 */
const DESK_NORTH_Y = OFFICE_RECT.y + 66;
const DESK_SOUTH_Y = OFFICE_RECT.y + OFFICE_RECT.h - 68;
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

function officeWorkstations(): Workstation[] {
  const out: Workstation[] = [];
  const runX: number[] = [];
  for (let cx = 3420; cx <= 4740; cx += DESK_ROW_PITCH) {
    if (rangesOverlap(cx - DESK_W / 2, cx + DESK_W / 2, GATE_LANE_X[0], GATE_LANE_X[1])) continue;
    runX.push(cx);
  }
  // 椅子由朝向反推：屏幕朝北 → 椅子在桌南；屏幕朝南 → 椅子在桌北；东西两列同理
  for (const cx of runX) out.push(workstation(cx, DESK_NORTH_Y, DIRECTION.Up));
  for (const cx of runX) out.push(workstation(cx, DESK_SOUTH_Y, DIRECTION.Down));
  // 东西朝向的桌子整张转 90°，沿 y 的占地是 DESK_W 而不是 DESK_H
  const columnHalf = DESK_W / 2;
  for (let cy = DESK_COLUMN_START; cy <= 4640; cy += DESK_COLUMN_PITCH) {
    if (rangesOverlap(cy - columnHalf, cy + columnHalf, GATE_LANE_Y[0], GATE_LANE_Y[1])) continue;
    out.push(workstation(DESK_WEST_X, cy, DIRECTION.Left));
    out.push(workstation(DESK_EAST_X, cy, DIRECTION.Right));
  }
  return out;
}

const PLAZA_WORKSTATIONS = officeWorkstations();
const PLAZA_DESKS: DeskInstance[] = PLAZA_WORKSTATIONS.map((station) => station.desk);

/** 工作区的工位桌追加在广场工位之后：椅子的 `desk` 下标按同一顺序续写 */
const WORK_DESKS: DeskInstance[] = WORKSTATIONS.map((station) => station.desk);

const DESKS: DeskInstance[] = [...PLAZA_DESKS, ...WORK_DESKS];

const DESK_SOLIDS: SolidRect[] = DESKS.map((desk) => {
  const { w, h } = deskFootprint(desk.facing);
  return { kind: 'desk', x: desk.x - w / 2, y: desk.y - h / 2, w, h };
});

/**
 * 座位表：办公区工位 → 工作区工位 → 研发园会议椅与马桶 → 休息室床/沙发/凳子；id = 下标 + 1。
 * 床位与凳子的区别只体现在 `kind` 上，入座姿态统一由 `seatPose` 决定。
 */
const SEAT_DRAFTS: Array<Omit<SeatInstance, 'id'>> = [
  ...PLAZA_WORKSTATIONS.map((station, index) => ({ ...station.seat, kind: 'chair' as const, desk: index })),
  ...WORKSTATIONS.map((station, index) => ({
    ...station.seat,
    kind: 'chair' as const,
    desk: PLAZA_DESKS.length + index,
  })),
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
 * 林地：六片合计约 2.9M 平方像素，从北带东西两端一直铺到西岸与东南角。
 * 林地矩形可以跨水塘（撒树用 `isPlantable` 过滤水面），
 * 这样塘边就是一圈自然林间空地，而不是「树绕着塘摆」。
 */
const FOREST_RECTS: WorldRect[] = [
  // 西岸北段（周报河与西海岸之间）
  { x: 2180, y: 2050, w: 380, h: 950 },
  // 北带西段：北湾西侧的整片台地，含 P3 水塘（南缘让开休息室）
  { x: 2900, y: 2050, w: 450, h: 790 },
  // 北带东段：北湾东侧最宽的一片，含 P4 水塘
  { x: 4550, y: 2050, w: 1400, h: 1200 },
  // 西岸中段：北段林地与水塘之间的过渡带
  { x: 2180, y: 3060, w: 300, h: 320 },
  // 西岸中段：码头与石桥之间
  { x: 2200, y: 4350, w: 280, h: 450 },
  // 西岸南段：湿地北缘
  { x: 2200, y: 5450, w: 330, h: 600 },
  // 东南角：摸鱼湖与南中湾之间的窄林带，含 P5 水塘
  { x: 4800, y: 5910, w: 500, h: 220 },
];

/**
 * 花海：四片开阔草甸上的不规则色块，白雏菊 / 金盏 / 暖粉各一片。
 * 全部避开广场、土路、林地、湖与河道，只做视觉分区，不参与碰撞。
 */
const FLOWER_FIELDS: FlowerPatch[] = [
  { rect: { x: 2180, y: 3800, w: 250, h: 180 }, palette: 2 },
  { rect: { x: 5300, y: 4300, w: 250, h: 280 }, palette: 1 },
  { rect: { x: 2950, y: 5980, w: 380, h: 150 }, palette: 0 },
  { rect: { x: 5300, y: 5920, w: 300, h: 200 }, palette: 0 },
];

/**
 * 五口水塘：各 12 个顶点手写，绕中心做不规则收放，读起来像天然积水而不是圆规坑。
 * P1/P2 在西岸林地间，P3 在北带林中，P4 在北带东段林间，
 * P5 贴东南角林带。走 `lakes` 数组就等于自动接入水面碰撞、撒树留白、
 * 芦苇碎石与小地图。
 */
const POND_NORTH_WEST_POINTS: Point[] = [
  [2400, 3500],
  [2387, 3550],
  [2350, 3587],
  [2300, 3600],
  [2250, 3587],
  [2213, 3550],
  [2200, 3500],
  [2213, 3450],
  [2250, 3413],
  [2300, 3400],
  [2350, 3413],
  [2387, 3450],
];

const POND_SOUTH_WEST_POINTS: Point[] = [
  [2410, 5300],
  [2395, 5355],
  [2355, 5395],
  [2300, 5410],
  [2245, 5395],
  [2205, 5355],
  [2190, 5300],
  [2205, 5245],
  [2245, 5205],
  [2300, 5190],
  [2355, 5205],
  [2395, 5245],
];

const POND_NORTH_MID_POINTS: Point[] = [
  [3160, 2620],
  [3145, 2675],
  [3105, 2715],
  [3050, 2730],
  [2995, 2715],
  [2955, 2675],
  [2940, 2620],
  [2955, 2565],
  [2995, 2525],
  [3050, 2510],
  [3105, 2525],
  [3145, 2565],
];

const POND_NORTH_EAST_POINTS: Point[] = [
  [5370, 2620],
  [5354, 2680],
  [5310, 2724],
  [5250, 2740],
  [5190, 2724],
  [5146, 2680],
  [5130, 2620],
  [5146, 2560],
  [5190, 2516],
  [5250, 2500],
  [5310, 2516],
  [5354, 2560],
];

const POND_SOUTH_EAST_POINTS: Point[] = [
  [4990, 5980],
  [4978, 6025],
  [4945, 6058],
  [4900, 6070],
  [4855, 6058],
  [4822, 6025],
  [4810, 5980],
  [4822, 5935],
  [4855, 5902],
  [4900, 5890],
  [4945, 5902],
  [4978, 5935],
];

const LAKE: LakeShape = { points: LAKE_POINTS, rect: polygonBounds(LAKE_POINTS) };
const LAKES: LakeShape[] = [
  LAKE,
  ...[
    POND_NORTH_WEST_POINTS,
    POND_SOUTH_WEST_POINTS,
    POND_NORTH_MID_POINTS,
    POND_NORTH_EAST_POINTS,
    POND_SOUTH_EAST_POINTS,
  ].map((points) => ({ points, rect: polygonBounds(points) })),
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

/**
 * 是否踩在水面上（湖面或河面）。
 *
 * 水面只描述「这里是不是水」，不再表示「能不能走」：湖与河全域可涉水（ADR-0030），
 * 桥面与码头由 `isOnBridge` 单独标识为正常通行面。
 * 先用包围盒粗筛再判多边形：渲染端每帧要对每个可见实体调用一次，河有 48 个顶点。
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
  for (const river of RIVERS) {
    if (!rectContains(river.rect, x, y)) continue;
    if (pointInPolygon(x, y, river.polygon)) return true;
    if (distanceSqToPolygon(x, y, river.polygon) === 0) return true;
  }
  return false;
}

/**
 * 是否正在涉水：站在水面上、且脚下不是桥面或码头。
 *
 * 桥面中心同样满足 `isWaterAt`（水面在桥下），所以必须先排除 `isOnBridge`，
 * 否则桥上行走会错误地出现半身入水与涟漪。海不在此判定内：海是 `isOnLand` 的边界，
 * 玩家无法到达，也就不会触发涉水表现。
 */
export function isWadingAt(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (isOnBridge(x, y)) return false;
  return isWaterAt(x, y);
}

const REGIONS: RegionSpec[] = [
  // 第一片是摸鱼湖，其余是补空的小水塘：区域名只影响状态栏文案，不影响碰撞
  ...LAKES.map((lake, index) => ({
    name: index === 0 ? '摸鱼湖' : '小水塘',
    rect: rectExpanded(lake.rect, 50),
  })),
  ...RIVERS.map((river, index) => ({ name: index === 0 ? '周报河' : '晨会溪', rect: rectExpanded(river.rect, 30) })),
  ...FOREST_RECTS.map((rect) => ({ name: '加班林', rect })),
  // 北门入园口（ADR-0036）：从海滩到办公区北缘的一小段，含横幅与指路牌。
  // 排在办公区之前，压在边界上时优先报「牛马园北门」。
  { name: '牛马园北门', rect: { x: 3824, y: 3184, w: 544, h: 220 } },
  { name: '办公区', rect: OFFICE_RECT },
  { name: '会议室', rect: MEETING_ROOM },
  { name: '卫生间', rect: RESTROOM },
  { name: '研发园', rect: CAMPUS_RECT },
  { name: '工作区', rect: WORKROOM },
  { name: '休息室', rect: LOUNGE },
];

/**
 * 撒树：给每个格心一次投骰，再抖动位置，比纯随机更像自然林。
 * 树冠宽 56–62，格距 100 时相邻树冠交叠近 40 —— 成林，但不至于糊成一片深绿。
 */
const TREE_CELL = 96;
/** 0.7 → 0.92：岛缩到原来的七成，林地数量不降反升，靠密度补回「满」的读感 */
const TREE_CHANCE = 0.92;
const TREE_JITTER = 28;
/** 必须大于 TREE_JITTER，否则抖动会把树推出森林矩形 */
const TREE_MARGIN = 36;
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
 * 树不能长进水里、路上、广场上，也不能贴到办公区、房间与门前铺装上。
 * 留白随地形件一起收紧：漏改这一处，树就会重新长进广场与门口。
 */
function isPlantable(x: number, y: number): boolean {
  if (x < 150 || y < 150 || x > WORLD_WIDTH - 150 || y > WORLD_HEIGHT - 150) return false;
  if (rectContains(rectExpanded(PLAZA, 60), x, y)) return false;
  if (rectContains(rectExpanded(OFFICE_RECT, 70), x, y)) return false;
  if (rectContains(rectExpanded(CAMPUS_RECT, 40), x, y)) return false;
  // 两栋小屋与门前铺装：树不长进屋里，也不堵门
  if (rectContains(rectExpanded(WORKROOM, 60), x, y)) return false;
  if (rectContains(rectExpanded(LOUNGE, 60), x, y)) return false;
  for (const paving of DOOR_PAVING) if (rectContains(rectExpanded(paving, 40), x, y)) return false;
  for (const path of PATHS) if (rectContains(rectExpanded(path, 55), x, y)) return false;
  for (const bridge of BRIDGES) if (rectContains(rectExpanded(bridge, 50), x, y)) return false;
  for (const dock of DOCKS) if (rectContains(rectExpanded(dock, 40), x, y)) return false;
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
 * 格距 + 抖动后相邻格仍可能只隔 40，所以再加一道 150 的最小间距。
 *
 * 岛缩到原来的七成之后，可种树的草地通量同比下降：
 * 130/0.9 → 110/0.95 补回数量，150 的最小间距是两团树冠不糊成一片的下限。
 */
const WILD_TREE_CELL = 88;
const WILD_TREE_CHANCE = 0.99;
const WILD_TREE_JITTER = 72;
const WILD_TREE_MIN_GAP = 112;
/** 出生圈外才开始有孤树，广场四周留出干净的活动面 */
const WILD_TREE_CLEAR = 300;

/**
 * 孤树用一套更宽松的留白：树冠压到路边、塘边、花海外缘都是自然的，
 * 只要脚底不进水、不进建筑、不堵门。林地本身已经密植，只排除矩形内部。
 */
function canPlantWildTree(x: number, y: number): boolean {
  if (x < 150 || y < 150 || x > WORLD_WIDTH - 150 || y > WORLD_HEIGHT - 150) return false;
  // 海岸留白：孤树不站在沙滩与浅滩上
  if (!isOnLand(x, y, 60)) return false;
  if (rectContains(rectExpanded(PLAZA, 40), x, y)) return false;
  if (rectContains(rectExpanded(OFFICE_RECT, 50), x, y)) return false;
  if (rectContains(rectExpanded(CAMPUS_RECT, 24), x, y)) return false;
  if (rectContains(rectExpanded(WORKROOM, 30), x, y)) return false;
  if (rectContains(rectExpanded(LOUNGE, 30), x, y)) return false;
  for (const paving of DOOR_PAVING) if (rectContains(rectExpanded(paving, 20), x, y)) return false;
  for (const path of PATHS) if (rectContains(rectExpanded(path, 30), x, y)) return false;
  for (const bridge of BRIDGES) if (rectContains(rectExpanded(bridge, 30), x, y)) return false;
  for (const dock of DOCKS) if (rectContains(rectExpanded(dock, 20), x, y)) return false;
  for (const field of FLOWER_FIELDS) if (rectContains(rectExpanded(field.rect, 20), x, y)) return false;
  // 树冠 56–62 宽：脚底离水 70 就不会把冠盖压到沙带上
  if (distanceSqToWater(x, y) < 70 * 70) return false;
  for (const rect of FOREST_RECTS) if (rectContains(rect, x, y)) return false;
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

/**
 * 开放式办公区的软边界：沿四边每 64px 一段树篱，四个入口各留 350px 缺口。
 * 树篱是纯装饰（走 props 管线、不产生 blocker），视觉上分区、脚上不封路。
 */
const HEDGE_STEP = 64;
const HEDGE_INSET = 8;
const HEDGE_ENTRY_PAD = 40;

function softEdgeHedges(): PropInstance[] {
  const out: PropInstance[] = [];
  const { x, y, w, h } = OFFICE_RECT;
  const gateX0 = GATE_LANE_X[0] - HEDGE_ENTRY_PAD;
  const gateX1 = GATE_LANE_X[1] + HEDGE_ENTRY_PAD;
  const gateY0 = GATE_LANE_Y[0] - HEDGE_ENTRY_PAD;
  const gateY1 = GATE_LANE_Y[1] + HEDGE_ENTRY_PAD;
  for (const edgeY of [y + HEDGE_INSET, y + h - HEDGE_INSET]) {
    for (let px = x + 40; px <= x + w - 40; px += HEDGE_STEP) {
      if (px > gateX0 && px < gateX1) continue;
      out.push({ kind: 'hedge', x: px, y: edgeY });
    }
  }
  for (const edgeX of [x + HEDGE_INSET, x + w - HEDGE_INSET]) {
    for (let py = y + 40; py <= y + h - 40; py += HEDGE_STEP) {
      if (py > gateY0 && py < gateY1) continue;
      out.push({ kind: 'hedge', x: edgeX, y: py });
    }
  }
  return out;
}

const PROPS: PropInstance[] = [
  ...PLAZA_PROPS,
  ...ROAD_PROPS,
  ...CAMPUS_PROPS,
  ...WORK_PROPS,
  ...LOUNGE_PROPS,
  ...softEdgeHedges(),
];

/** 有占地的装饰（售货机、长椅、野餐桌、单车）统一由 propSolid 生成碰撞盒 */
const PROP_SOLIDS: SolidRect[] = propSolids(PROPS);

export const WORLD_LAYOUT: WorldLayout = {
  plaza: PLAZA,
  office: OFFICE_RECT,
  paths: PATHS,
  lakes: LAKES,
  rivers: RIVERS,
  bridges: BRIDGES,
  docks: DOCKS,
  forests: FORESTS,
  wildTrees: WILD_TREES,
  flowerFields: FLOWER_FIELDS,
  planters: PLANTERS,
  island: ISLAND,
  regions: REGIONS,
  desks: DESKS,
  seats: SEATS,
  props: PROPS,
  solids: [...DESK_SOLIDS, ...PROP_SOLIDS, ...CAMPUS_SOLIDS],
  buildings: CAMPUS_BUILDINGS,
  paved: [CAMPUS_YARD, ...DOOR_PAVING],
};

/** 玩家所在区域名：区域表按优先级排列，未命中则落到野地 */
export function regionAt(x: number, y: number): string {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return FALLBACK_REGION;
  for (const region of REGIONS) {
    if (rectContains(region.rect, x, y)) return region.name;
  }
  return FALLBACK_REGION;
}

/**
 * 桥面与码头：水面上的正常通行面。
 * 水已全域可涉水（ADR-0030），这里不再承担碰撞放行，只用于把涉水表现排除在外。
 */
export function isOnBridge(x: number, y: number): boolean {
  for (const bridge of BRIDGES) {
    if (rectContains(bridge, x, y)) return true;
  }
  for (const dock of DOCKS) {
    if (rectContains(dock, x, y)) return true;
  }
  return false;
}
