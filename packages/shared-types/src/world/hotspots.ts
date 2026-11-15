/**
 * 统一热区注册表（数据驱动）。
 *
 * 「按 F 能做什么」在改造前散落在客户端的 `isNearXxx` 与服务端各自的距离判定里，
 * 每加一座建筑都要同时改提示条、交互分发与服务端校验三处。现在只有这一张表：
 *
 * - 客户端 `selectContextHint` 按 kind 优先级取最近命中，`GameSession.interact`
 *   按同一个 kind 分发；
 * - 服务端用 `hotspotById` + `isWithinHotspot` 校验交互包（再加 240px 延迟余量），
 *   伪造包在离场后刷请求会被直接丢掉。
 *
 * 坐标全部来自各建筑模块的常量，不许在这里重写一份手写坐标。
 */

import {
  APARTMENT,
  APARTMENT_DOOR,
  APARTMENT_DOOR_RANGE,
  APARTMENT_EXIT,
  APARTMENT_EXIT_RANGE,
} from './apartment';
import { DICE_TABLES } from './dice-hall';
import { BULLETIN_BOARD, SHRINE_ALTAR, TEA_STATION, WELCOME_LANDMARKS } from './layout';
import { RING_BENCHES, RING_SIGNUP, RING_SIGNUP_RANGE } from './ring';
import { VILLA_GATE_RANGE, VILLA_SPECS, VILLA_TREE_RANGE, type VillaSpec } from './villas';

/** 服务端距离门的额外余量：包在网络上飞半个 RTT，不能用半径当硬门 */
export const HOTSPOT_SERVER_SLACK = 240;

/** 热区种类：客户端提示优先级与服务端分发都以它为准 */
export type HotspotKind =
  | 'board'
  | 'bulletin'
  | 'shrine'
  | 'tea'
  | 'ring'
  | 'diceTable'
  | 'arenaSeat'
  | 'villaGate'
  | 'villaTree'
  | 'apartmentDoor'
  | 'apartmentExit';

export interface HotspotDef {
  readonly id: string;
  readonly kind: HotspotKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 指向 `hint-copy` 的提示 key，客户端据此取文案与按钮描述 */
  readonly label: string;
  /** 座位组：赌桌 / 观战长椅用它与 `SeatInstance.group` 对齐 */
  readonly seatGroupId?: string;
}

function villaGateHotspot(spec: VillaSpec): HotspotDef {
  return {
    id: `villa-${spec.id}-gate`,
    kind: 'villaGate',
    x: spec.gate.x,
    y: spec.gate.y,
    radius: VILLA_GATE_RANGE,
    label: 'villa',
  };
}

function villaTreeHotspot(spec: VillaSpec): HotspotDef {
  return {
    id: `villa-${spec.id}-tree`,
    kind: 'villaTree',
    x: spec.tree.x,
    y: spec.tree.y,
    radius: VILLA_TREE_RANGE,
    label: 'villaTree',
  };
}

/**
 * 热区表。顺序只影响「同一位置命中多条时谁先被查到」，
 * 客户端仍会按 `HOTSPOT_PRIORITY` 再排一次序。
 */
export const WORLD_HOTSPOTS: readonly HotspotDef[] = [
  // ---- 既有的四处轻互动：坐标沿用各地标常量 ----
  {
    id: 'rank-board',
    kind: 'board',
    x: WELCOME_LANDMARKS.rankBoard.x,
    y: WELCOME_LANDMARKS.rankBoard.y,
    radius: 96,
    label: 'board',
  },
  {
    id: 'bulletin',
    kind: 'bulletin',
    x: BULLETIN_BOARD.x,
    y: BULLETIN_BOARD.y,
    radius: 64,
    label: 'bulletin',
  },
  {
    id: 'shrine',
    kind: 'shrine',
    x: SHRINE_ALTAR.x,
    y: SHRINE_ALTAR.y,
    radius: 72,
    label: 'shrine',
  },
  {
    id: 'tea-station',
    kind: 'tea',
    x: TEA_STATION.x,
    y: TEA_STATION.y,
    radius: 48,
    label: 'tea',
  },
  // ---- 绩效八角笼 ----
  {
    id: 'arena-signup',
    kind: 'ring',
    x: RING_SIGNUP.x,
    y: RING_SIGNUP.y,
    radius: RING_SIGNUP_RANGE,
    label: 'ring',
  },
  ...RING_BENCHES.map(
    (bench, index): HotspotDef => ({
      id: `arena-bench-${index}`,
      kind: 'arenaSeat',
      x: bench.x,
      y: bench.y + 20,
      radius: 56,
      label: 'arenaBet',
      seatGroupId: 'arena-bench',
    }),
  ),
  // ---- 摸鱼大赌场：两张桌各一条 ----
  ...DICE_TABLES.map(
    (table): HotspotDef => ({
      id: `dice-table-${table.id}`,
      kind: 'diceTable',
      x: table.x,
      y: table.y,
      radius: 96,
      label: 'dice',
      seatGroupId: table.group,
    }),
  ),
  // ---- 豪宅小院：门口与摇钱树 ----
  ...VILLA_SPECS.map(villaGateHotspot),
  ...VILLA_SPECS.map(villaTreeHotspot),
  // ---- 牛马公寓：门外进入 / 屋内离开 ----
  {
    id: 'apartment-door',
    kind: 'apartmentDoor',
    x: APARTMENT_DOOR.x,
    y: APARTMENT_DOOR.y,
    radius: APARTMENT_DOOR_RANGE,
    label: 'apartment',
  },
  {
    id: 'apartment-exit',
    kind: 'apartmentExit',
    x: APARTMENT_EXIT.x,
    y: APARTMENT_EXIT.y,
    radius: APARTMENT_EXIT_RANGE,
    label: 'apartmentExit',
  },
];

/** id → 热区：服务端按包里的 id 查表，不做线性扫描的老式距离判定 */
export const HOTSPOT_INDEX: ReadonlyMap<string, HotspotDef> = new Map(
  WORLD_HOTSPOTS.map((def) => [def.id, def]),
);

/**
 * 客户端提示优先级（与改造前的顺序一致，新建筑插在设施之前）：
 * 告示板 → 牛马榜 → 供案 → 茶台 → 赌桌 → 八角笼 → 长椅 → 豪宅 → 公寓。
 */
export const HOTSPOT_PRIORITY: readonly HotspotKind[] = [
  'bulletin',
  'board',
  'shrine',
  'tea',
  'diceTable',
  'ring',
  'arenaSeat',
  'villaGate',
  'villaTree',
  'apartmentDoor',
  'apartmentExit',
];

export function hotspotById(id: string): HotspotDef | undefined {
  return HOTSPOT_INDEX.get(id);
}

export function hotspotsOfKind(kind: HotspotKind): readonly HotspotDef[] {
  return WORLD_HOTSPOTS.filter((def) => def.kind === kind);
}

/** 距离判定：平方比较，slack 只用于服务端延迟余量 */
export function isWithinHotspot(
  def: HotspotDef,
  x: number,
  y: number,
  slack = 0,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const reach = def.radius + Math.max(0, slack);
  const dx = x - def.x;
  const dy = y - def.y;
  return dx * dx + dy * dy <= reach * reach;
}

/** 最近命中：`accept` 用于「已入场/已拥有」这类状态过滤 */
export function nearestHotspot(
  x: number,
  y: number,
  accept?: (def: HotspotDef) => boolean,
): HotspotDef | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let best: HotspotDef | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const def of WORLD_HOTSPOTS) {
    if (accept && !accept(def)) continue;
    const dx = def.x - x;
    const dy = def.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > def.radius * def.radius) continue;
    if (distance >= bestDistance) continue;
    best = def;
    bestDistance = distance;
  }
  return best;
}

/** 在给定 kind 集合里找最近命中；客户端用它实现「按优先级逐级取」 */
export function nearestHotspotOfKinds(
  x: number,
  y: number,
  kinds: readonly HotspotKind[],
  accept?: (def: HotspotDef) => boolean,
): HotspotDef | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const kind of kinds) {
    const found = nearestHotspot(x, y, (def) => def.kind === kind && (!accept || accept(def)));
    if (found) return found;
  }
  return null;
}

/** 公寓楼体（给区域名与测试直接读，避免各处再 import 一次 apartment.ts） */
export const APARTMENT_RECT = APARTMENT;
