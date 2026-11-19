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

import { WORK_DESK_RANGE, workDeskHotspotId } from '../work';
import { APARTMENT_SPECS } from './apartment';
import { WORKSTATIONS } from './campus';
import { BULLETIN_BOARD, SHRINE_ALTAR, TEA_STATION, WELCOME_LANDMARKS } from './layout';
import { VILLA_GATE_RANGE, VILLA_SPECS, VILLA_TREE_RANGE, type VillaSpec } from './villas';

/** 服务端距离门的额外余量：包在网络上飞半个 RTT，不能用半径当硬门 */
export const HOTSPOT_SERVER_SLACK = 240;

/** 热区种类：客户端提示优先级与服务端分发都以它为准 */
export type HotspotKind =
  | 'board'
  | 'bulletin'
  | 'shrine'
  | 'tea'
  | 'villaGate'
  | 'villaTree'
  | 'apartmentDoor'
  /** 工位（ADR-0088）：坐着按 F 开始加班搬砖 */
  | 'workDesk';

export interface HotspotDef {
  readonly id: string;
  readonly kind: HotspotKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** 指向 `hint-copy` 的提示 key，客户端据此取文案与按钮描述 */
  readonly label: string;
  /**
   * 座位组：赌桌 / 观战长椅用它与 `SeatInstance.group` 对齐。
   *
   * 声明了就是「入座类玩法」：客户端提示与服务端校验统一走
   * `world/seat-gate.ts` 的 `seatMatchesHotspot`（ADR-0093）。
   */
  readonly seatGroupId?: string;
  /** 工位热区专用：指向 `WORKSTATIONS` 下标，客户端据此判断「我坐的是不是这一桌」 */
  readonly deskIndex?: number;
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
  // ---- 工位（ADR-0088）：8 条由 WORKSTATIONS 生成，坐标不手写 ----
  ...WORKSTATIONS.map(
    (station, index): HotspotDef => ({
      id: workDeskHotspotId(index),
      kind: 'workDesk',
      x: station.desk.x,
      y: station.desk.y,
      radius: WORK_DESK_RANGE,
      label: 'work',
      deskIndex: index,
    }),
  ),
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
  // ---- 园区 8 栋房产：门口与摇钱树 ----
  ...VILLA_SPECS.map(villaGateHotspot),
  ...VILLA_SPECS.map(villaTreeHotspot),
  // ---- 牛马公寓（ADR-0098 / ADR-0101）：唯一一栋一条门热区，进屋只在窗口探头、不再有出口热区 ----
  ...APARTMENT_SPECS.map(
    (spec): HotspotDef => ({
      id: apartmentDoorHotspotId(spec.slot),
      kind: 'apartmentDoor',
      x: spec.door.x,
      y: spec.door.y,
      radius: spec.doorRange,
      label: 'apartment',
    }),
  ),
];

/** 楼栋门口热区 id：客户端提示与服务端校验共用同一份拼法 */
export function apartmentDoorHotspotId(slot: number): string {
  return `apartment-door-${slot}`;
}

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
  'workDesk',
  'villaGate',
  'villaTree',
  'apartmentDoor',
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
  // 半径不是有限数时一律判不在范围内：Infinity 会让整张图都「够得着」，
  // 提示与按键都会退化成「随处可按」
  if (!Number.isFinite(reach)) return false;
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

/**
 * 某一类热区里有没有命中：公寓有六扇门，服务端不再按固定 id 查，
 * 而是「站在任意一栋门口」都算。
 */
export function isWithinAnyHotspotOfKind(
  kind: HotspotKind,
  x: number,
  y: number,
  slack = 0,
): boolean {
  for (const def of WORLD_HOTSPOTS) {
    if (def.kind !== kind) continue;
    if (isWithinHotspot(def, x, y, slack)) return true;
  }
  return false;
}

/**
 * 站在公寓门口：返回最近的门口 slot，离门太远返回 -1。
 *
 * 进屋要按「脚下这扇门」决定探头出现在哪栋楼上（ADR-0101 后只剩 301，
 * slot 恒为 0），所以服务端不能只判「附近有没有任意一栋的门」。
 */
export function apartmentDoorSlotAt(x: number, y: number, slack = 0): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spec of APARTMENT_SPECS) {
    const dx = x - spec.door.x;
    const dy = y - spec.door.y;
    const reach = spec.doorRange + Math.max(0, slack);
    if (!Number.isFinite(reach)) continue;
    const distance = dx * dx + dy * dy;
    if (distance > reach * reach) continue;
    if (distance >= bestDistance) continue;
    best = spec.slot;
    bestDistance = distance;
  }
  return best;
}
