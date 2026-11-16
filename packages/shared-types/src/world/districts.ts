/**
 * 五区 + 场所注册表（ADR-0097）：分区、室内外身份、区域名、导览分组与小地图配色的唯一真相。
 *
 * 两条纪律：
 * 1) **不写第二份坐标**。每个场所的矩形一律从各场所模块（campus / park / dice-hall /
 *    ring / villas / apartment / clinic）的常量取；本文件只描述「归属 + 边界」。
 * 2) **依赖只有一个方向**：districts 只依赖各场所模块，`layout.ts` 再依赖 districts。
 *    因此场所常量不能反过来引用本文件，也不能有任何一处把坐标系住在 layout 里。
 *
 * 区可以有多块地（`rects`）：景观区本就是「一圈水景 + 绿地」的网络，
 * 三湖分散在东北、西、东南，硬搬成一片会连带重做岸线、游鱼与全部留白规则。
 */

import { APARTMENT_SPECS } from './apartment';
import { BOSS_ARENA } from './boss';
import {
  HOME_THEATER,
  JAIL,
  LOUNGE,
  MEETING_ROOM,
  RESTROOM,
  SHRINE_ALTAR,
  TEA_STATION,
  VENT_ROOM,
  WORKROOM,
} from './campus';
import { CLINIC_ACCESS_PAVING, CLINIC_RECT } from './clinic';
import { DICE_HALL } from './dice-hall';
import { rectContains, rectExpanded, type WorldRect } from './geometry';
import { AMUSEMENT_PARK } from './park';
import { RING_ARENA } from './ring';
import { VILLA_SPECS } from './villas';

/** 中央广场：五条街的起点，也是出生点与迎宾拱门所在 */
export const PLAZA_REGION_NAME = '中央迎宾广场';

/** 五个大区。顺序即 `regionAt` 的兜底优先级（先命中者胜），与导览卡分组顺序一致。 */
export type DistrictId = 'corporate' | 'amusement' | 'living' | 'service' | 'scenery';

/** 场景身份：室内 / 室外 / 半开敞（有顶无墙，例如赌场亭） */
export type SceneKind = 'indoor' | 'outdoor' | 'semi';

export interface DistrictSpec {
  readonly id: DistrictId;
  readonly name: string;
  /** 该区的主场景：区内场所以各自 `scene` 为准，这里只用于表现与文案 */
  readonly scene: SceneKind;
  /** 区界：可以有多个地块（景观区是网络状） */
  readonly rects: ReadonlyArray<WorldRect>;
  /** 区门坐标：导览到达点、指路牌与路网节点共用（不立门架） */
  readonly gate: { readonly x: number; readonly y: number };
  /** 小地图区色与铺装收边色（0xRRGGBB） */
  readonly color: number;
}

const RING_LAKE_RECT: WorldRect = {
  x: 2640,
  y: 4700,
  w: 440,
  h: 450,
};
const MOPING_LAKE_RECT: WorldRect = { x: 4900, y: 5000, w: 660, h: 690 };
const CHENSI_POND_RECT: WorldRect = { x: 4830, y: 2700, w: 510, h: 420 };

/** 三湖 + 原亭址草地 + 竹林：景观区的网络地块（不搬湖，只认领） */
const SCENERY_RECTS: ReadonlyArray<WorldRect> = [
  rectExpanded(RING_LAKE_RECT, 60),
  rectExpanded(MOPING_LAKE_RECT, 30),
  rectExpanded(CHENSI_POND_RECT, 30),
  // 摸鱼亭拆除后的原址（ADR-0105）：200×180 的草地仍归景观区，
  // 免得玩家从湖岸走进来横幅闪一下「野地」，小地图出现一块空洞。
  { x: 5250, y: 4710, w: 200, h: 180 },
  // 西主路尽头的区门前庭
  { x: 2680, y: 4010, w: 360, h: 300 },
  // 竹林：西主路以南、涟漪湖以北的绿带
  { x: 3100, y: 4180, w: 400, h: 320 },
];

export const DISTRICTS: ReadonlyArray<DistrictSpec> = [
  {
    id: 'corporate',
    name: '企业区',
    scene: 'indoor',
    // 企业楼 2620–3540 × 3200–3976（走廊加宽后南沿下移 16px）+ 楼前庭 3540–3740
    rects: [{ x: 2600, y: 3170, w: 1130, h: 830 }],
    // 区门坐标在前庭接广场的那条支路上，避开企业楼东门
    gate: { x: 3760, y: 3780 },
    color: 0xc9b38a,
  },
  {
    id: 'amusement',
    name: '游乐区',
    scene: 'outdoor',
    // 赌场亭 + 八角笼 + 游乐园 + 游乐大街
    rects: [{ x: 2580, y: 2520, w: 2100, h: 640 }],
    gate: { x: 4096, y: 3160 },
    color: 0xe28aa0,
  },
  {
    id: 'living',
    name: '生活区',
    scene: 'indoor',
    // 公寓 + 门前花园 + 生活大街 + 宿舍 + 影音室 + 两栋小院
    rects: [{ x: 3140, y: 4640, w: 1680, h: 1120 }],
    gate: { x: 4096, y: 4700 },
    color: 0xb9a78f,
  },
  {
    id: 'service',
    name: '服务区',
    scene: 'indoor',
    // 服务广场：卫生间 / 小黑屋 / 急救站
    rects: [{ x: 4500, y: 3580, w: 900, h: 900 }],
    gate: { x: 4540, y: 4096 },
    color: 0xa8c4cc,
  },
  {
    id: 'scenery',
    name: '景观区',
    scene: 'outdoor',
    rects: SCENERY_RECTS,
    gate: { x: 2760, y: 4020 },
    color: 0x7fb69b,
  },
];

export function districtById(id: DistrictId): DistrictSpec {
  const found = DISTRICTS.find((district) => district.id === id);
  if (!found) throw new Error(`DISTRICTS 缺少分区 ${id}`);
  return found;
}

/** 分区的地块包围盒并集：只用于小地图取景与测试断言，不参与碰撞 */
export function districtBounds(spec: DistrictSpec): WorldRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of spec.rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 点落在哪个区：多块地块逐一命中，未命中返回 undefined */
export function districtAt(x: number, y: number): DistrictSpec | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  for (const spec of DISTRICTS) {
    for (const rect of spec.rects) {
      if (rectContains(rect, x, y)) return spec;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * 场所注册表
 * ------------------------------------------------------------------ */

export type NavTargetId =
  | 'workroom'
  | 'restroom'
  | 'lounge'
  | 'meeting'
  | 'shrine'
  | 'park'
  | 'bossArena'
  | 'ring'
  | 'diceHall'
  | 'villa1'
  | 'villa2'
  | 'apartment'
  // ADR-0099：影音室 / 急救站补进导览（广场不进本表，见 `PLAZA_HOME`）
  | 'theater'
  | 'clinic';

/**
 * 广场不是场所，也不属于任何大区，所以不做成 `NavTarget`（否则会破坏
 * 「导览目标 ↔ 场所 ↔ 大区」一一对应）。导览卡底部另给一条「回中央广场」，
 * 终点就是出生点，用同一个自动寻路状态机走回去。
 */
export const PLAZA_HOME = { id: 'plaza', name: PLAZA_REGION_NAME } as const;

export interface VenueSpec {
  /** 稳定 id：区域名、测试与小地图共用，不进协议 */
  readonly id: string;
  readonly name: string;
  readonly district: DistrictId;
  readonly scene: SceneKind;
  readonly rect: WorldRect;
  /** 对应的导览目标；纯观赏场所不填 */
  readonly navId?: NavTargetId;
}

function venue(
  id: string,
  name: string,
  district: DistrictId,
  scene: SceneKind,
  rect: WorldRect,
  navId?: NavTargetId,
): VenueSpec {
  return { id, name, district, scene, rect, navId };
}

/**
 * 场所表。顺序即 `regionAt` 的优先级：**先小的、先室内的、先具名的**。
 * 例：发泄区（VentRoom）先于企业区命中；卫生间先于服务区命中。
 */
export const VENUES: ReadonlyArray<VenueSpec> = [
  // ---- 服务区 ----
  venue('clinic', '护士急救站', 'service', 'indoor', CLINIC_RECT, 'clinic'),
  venue('restroom', '卫生间', 'service', 'indoor', RESTROOM, 'restroom'),
  venue('jail', '小黑屋', 'service', 'indoor', JAIL),
  // ---- 景观区 ----
  venue('mopingLake', '摸鱼湖', 'scenery', 'outdoor', MOPING_LAKE_RECT),
  venue('chensiPond', '沉思浅塘', 'scenery', 'outdoor', CHENSI_POND_RECT),
  venue('ringLake', '涟漪湖', 'scenery', 'outdoor', RING_LAKE_RECT),
  // ---- 企业区 ----
  venue('ventRoom', '发泄区', 'corporate', 'indoor', VENT_ROOM, 'bossArena'),
  venue('meeting', '会议室', 'corporate', 'indoor', MEETING_ROOM, 'meeting'),
  // 供案与茶台在工作区里：排在 workroom 之前先命中，站在案前显示的是「财神供案」
  venue(
    'shrine',
    '财神供案',
    'corporate',
    'indoor',
    {
      x: SHRINE_ALTAR.x - SHRINE_ALTAR.width / 2,
      y: SHRINE_ALTAR.y - SHRINE_ALTAR.height,
      w: SHRINE_ALTAR.width,
      h: SHRINE_ALTAR.height,
    },
    'shrine',
  ),
  venue('teaStation', '紫砂茶台', 'corporate', 'indoor', {
    x: TEA_STATION.x - TEA_STATION.width / 2,
    y: TEA_STATION.y - TEA_STATION.height,
    w: TEA_STATION.width,
    h: TEA_STATION.height,
  }),
  venue('workroom', '工作区', 'corporate', 'indoor', WORKROOM, 'workroom'),
  // ---- 游乐区 ----
  venue('park', '游乐园', 'amusement', 'outdoor', AMUSEMENT_PARK, 'park'),
  venue('diceHall', '摸鱼骰子馆', 'amusement', 'semi', DICE_HALL, 'diceHall'),
  venue('ring', '绩效八角笼', 'amusement', 'outdoor', RING_ARENA, 'ring'),
  // ---- 生活区 ----
  venue('lounge', '宿舍区', 'living', 'indoor', LOUNGE, 'lounge'),
  venue('theater', '家庭影音室', 'living', 'indoor', HOME_THEATER, 'theater'),
  ...VILLA_SPECS.map((spec) =>
    venue(`villa${spec.id + 1}`, spec.name, 'living', 'indoor', spec.rect, spec.id === 0 ? 'villa1' : 'villa2'),
  ),
  // 唯一一栋公寓（ADR-0101）：区域名「牛马公寓」，小地图按楼填色
  venue('apartment', '牛马公寓', 'living', 'indoor', APARTMENT_SPECS[0]!.rect, 'apartment'),
];

/** 点落在哪个场所：按 `VENUES` 顺序先命中者胜 */
export function venueAt(x: number, y: number): VenueSpec | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  for (const spec of VENUES) {
    if (rectContains(spec.rect, x, y)) return spec;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * 导览目标（ADR-0036 / ADR-0040 / ADR-0097）
 * ------------------------------------------------------------------ */

export interface NavTarget {
  readonly id: NavTargetId;
  readonly name: string;
  /** 所属大区：HUD 导览卡按它分组，不再有「室内 / 园区」两档 */
  readonly district: DistrictId;
  /** 场景身份：行尾徽标与文案都读它 */
  readonly scene: SceneKind;
  /** 区域几何中心：方位、距离与步行秒数都按它算 */
  readonly x: number;
  readonly y: number;
  /** 可站立的到达点（ADR-0040）：自动寻路的真正终点 */
  readonly arrive: { readonly x: number; readonly y: number };
}

function rectCenter(rect: WorldRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * 各目标的落地到达点：房间沿用进门空地，设施类落在「站过去就能互动」的那一步之内。
 */
export const NAV_ARRIVALS: Record<NavTargetId, { readonly x: number; readonly y: number }> = {
  meeting: { x: MEETING_ROOM.x + 360, y: MEETING_ROOM.y + 314 },
  restroom: { x: RESTROOM.x + 170, y: RESTROOM.y + 60 },
  lounge: { x: LOUNGE.x + 230, y: LOUNGE.y + 70 },
  workroom: { x: WORKROOM.x + 230, y: WORKROOM.y + 294 },
  // 财神供案正前方：案面底边外 18px，落地即可按 F 上香，不压案腿
  shrine: { x: SHRINE_ALTAR.x, y: SHRINE_ALTAR.y + 18 },
  // 游乐园南门内侧：进门两步就是喷泉前空地
  park: { x: 4096, y: 3020 },
  // 发泄室垫内左下角：老板左脚外侧，站过去就能出招
  bossArena: { x: BOSS_ARENA.x + 50, y: BOSS_ARENA.y + BOSS_ARENA.h - 20 },
  // 八角笼南门外：围绳外 32px，仍落在报名感应圈里
  ring: { x: RING_ARENA.x + 150, y: RING_ARENA.y + RING_ARENA.h + 32 },
  // 赌场两张桌之间的空地：站过去就同时够得着两张桌的提示
  diceHall: { x: DICE_HALL.x + DICE_HALL.w / 2, y: DICE_HALL.y + 190 },
  // 两栋小院的院门外台阶
  villa1: { x: VILLA_SPECS[0]!.gate.x, y: VILLA_SPECS[0]!.gate.y + 24 },
  villa2: { x: VILLA_SPECS[1]!.gate.x, y: VILLA_SPECS[1]!.gate.y + 24 },
  // 公寓门口台阶：唯一一栋，导览直接送到 301 门口
  apartment: { x: APARTMENT_SPECS[0]!.outside.x, y: APARTMENT_SPECS[0]!.outside.y },
  // 影音室：东门内侧的走道（三排座椅东侧），进门两步就能坐下
  theater: { x: HOME_THEATER.x + HOME_THEATER.w - 60, y: HOME_THEATER.y + 160 },
  // 急救站：西门外的无障碍铺装上（ADR-0107 门禁：站内只收救护车送来的伤员，
  // 导览不能把人送过门线）；仍落在 CLINIC_REGION_RECT 里，区域名还是「护士急救站」
  clinic: { x: CLINIC_ACCESS_PAVING.x + 46, y: CLINIC_ACCESS_PAVING.y + 28 },
};

const NAV_SOURCES: ReadonlyArray<{
  id: NavTargetId;
  name: string;
  district: DistrictId;
  scene: SceneKind;
  x: number;
  y: number;
}> = [
  { id: 'workroom', name: '工作区', district: 'corporate', scene: 'indoor', ...rectCenter(WORKROOM) },
  { id: 'meeting', name: '会议室', district: 'corporate', scene: 'indoor', ...rectCenter(MEETING_ROOM) },
  { id: 'shrine', name: '财神供案', district: 'corporate', scene: 'indoor', x: SHRINE_ALTAR.x, y: SHRINE_ALTAR.y },
  { id: 'bossArena', name: '发泄区', district: 'corporate', scene: 'indoor', ...rectCenter(BOSS_ARENA) },
  { id: 'park', name: '游乐园', district: 'amusement', scene: 'outdoor', ...rectCenter(AMUSEMENT_PARK) },
  { id: 'diceHall', name: '摸鱼骰子馆', district: 'amusement', scene: 'semi', ...rectCenter(DICE_HALL) },
  { id: 'ring', name: '绩效八角笼', district: 'amusement', scene: 'outdoor', ...rectCenter(RING_ARENA) },
  { id: 'apartment', name: '牛马公寓', district: 'living', scene: 'indoor', ...rectCenter(APARTMENT_SPECS[0]!.rect) },
  { id: 'lounge', name: '宿舍区', district: 'living', scene: 'indoor', ...rectCenter(LOUNGE) },
  { id: 'theater', name: '家庭影音室', district: 'living', scene: 'indoor', ...rectCenter(HOME_THEATER) },
  { id: 'villa1', name: VILLA_SPECS[0]!.name, district: 'living', scene: 'indoor', ...rectCenter(VILLA_SPECS[0]!.rect) },
  { id: 'villa2', name: VILLA_SPECS[1]!.name, district: 'living', scene: 'indoor', ...rectCenter(VILLA_SPECS[1]!.rect) },
  { id: 'restroom', name: '卫生间', district: 'service', scene: 'indoor', ...rectCenter(RESTROOM) },
  { id: 'clinic', name: '护士急救站', district: 'service', scene: 'indoor', ...rectCenter(CLINIC_RECT) },
];

export const NAV_TARGETS: readonly NavTarget[] = NAV_SOURCES.map(
  ({ id, name, district, scene, x, y }) => ({ id, name, district, scene, x, y, arrive: NAV_ARRIVALS[id] }),
);

/** 场所门牌的中文名：只从导览目标取，避免第二份手写场所名 */
export function navName(id: NavTargetId): string {
  const target = NAV_TARGETS.find((item) => item.id === id);
  if (!target) throw new Error(`NAV_TARGETS 缺少场所 ${id}`);
  return target.name;
}
