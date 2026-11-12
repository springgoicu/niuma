import {
  NAV_TARGETS,
  PLAYER_RADIUS,
  WELCOME_LANDMARKS,
  WORLD_CENTER,
  findFreePoint,
  isBlocked,
  type NavTargetId,
} from '@niuma/shared-types';
import type { Rng } from './rng';

/**
 * NPC 的活动区域与落点采样。
 *
 * 区域只描述「在哪一带活动」，不描述路径：落点用「随机角度 + 面积均匀的距离」采样，
 * 挡住的点重采样，连续失败退回 `findFreePoint`。真正的绕障交给地形求解器与
 * brain 的卡住恢复，不在这里造一套导航网格。
 */
export interface NpcRegionConfig {
  id: string;
  weight: number;
  radius: number;
}

export interface NpcSpot {
  x: number;
  y: number;
}

export interface NpcRegion {
  id: string;
  x: number;
  y: number;
  radius: number;
  weight: number;
  /** 有目的性的停靠点：公告栏、导览牌、工位旁；没有也可以只随机漫游 */
  points: readonly NpcSpot[];
}

function nav(id: NavTargetId): NpcSpot {
  const target = NAV_TARGETS.find((entry) => entry.id === id);
  return target ? { x: target.arrive.x, y: target.arrive.y } : { ...WORLD_CENTER };
}

/**
 * 默认分布：广场权重最高，保证玩家一进场就能看到几位同事；
 * 工作区、庭院次之，宿舍与会议室各有一位常客，主路留两个「在路上的」。
 */
export const NPC_REGIONS: readonly NpcRegion[] = [
  {
    id: 'plaza',
    x: WORLD_CENTER.x,
    y: WORLD_CENTER.y,
    radius: 420,
    weight: 4,
    points: [
      { x: WELCOME_LANDMARKS.rankBoard.x, y: WELCOME_LANDMARKS.rankBoard.y + 100 },
      { x: WELCOME_LANDMARKS.directory.x, y: WELCOME_LANDMARKS.directory.y + 100 },
      { x: WORLD_CENTER.x + 280, y: WORLD_CENTER.y - 200 },
      { x: WORLD_CENTER.x - 280, y: WORLD_CENTER.y + 200 },
    ],
  },
  {
    id: 'workroom',
    ...nav('workroom'),
    radius: 320,
    weight: 2,
    points: [],
  },
  {
    id: 'lounge',
    ...nav('lounge'),
    radius: 300,
    weight: 1.5,
    points: [],
  },
  {
    id: 'meeting',
    ...nav('meeting'),
    radius: 240,
    weight: 1,
    points: [],
  },
  {
    id: 'courtyard',
    x: 4096,
    y: 5160,
    radius: 260,
    weight: 1.5,
    points: [],
  },
  {
    id: 'roadSouth',
    x: 4096,
    y: 4620,
    radius: 220,
    weight: 0.8,
    points: [],
  },
  {
    id: 'roadWest',
    x: 3300,
    y: 4096,
    radius: 240,
    weight: 0.8,
    points: [],
  },
  {
    id: 'roadEast',
    x: 4800,
    y: 4096,
    radius: 240,
    weight: 0.8,
    points: [],
  },
];

/**
 * 把外置配置的 `{ id, weight, radius }` 覆盖到默认区域上。
 *
 * 未知 id 静默忽略（同一份配置可能被旧版本服务端读取）；权重 <= 0 表示停用该区域，
 * 全部停用时退回默认表，避免 NPC 无处可去。
 */
export function resolveRegions(
  overrides: ReadonlyArray<NpcRegionConfig> = [],
  base: ReadonlyArray<NpcRegion> = NPC_REGIONS,
): NpcRegion[] {
  if (overrides.length === 0) return base.map((region) => ({ ...region }));
  const byId = new Map(overrides.map((entry) => [entry.id, entry]));
  const merged = base
    .map((region) => {
      const override = byId.get(region.id);
      if (!override) return { ...region };
      return {
        ...region,
        weight: override.weight,
        // 半径不能把 NPC 送到海里：夹到区域定义的两倍以内
        radius: Math.min(region.radius * 2, Math.max(120, override.radius)),
      };
    })
    .filter((region) => region.weight > 0);
  return merged.length > 0 ? merged : base.map((region) => ({ ...region }));
}

/** 加权抽一个区域；权重全为 0 时退回第一个，保证调用方永远拿得到落点 */
export function pickRegion(rng: Rng, regions: ReadonlyArray<NpcRegion>): NpcRegion {
  let total = 0;
  for (const region of regions) total += Math.max(0, region.weight);
  if (total <= 0) return regions[0]!;
  let roll = rng.next() * total;
  for (const region of regions) {
    roll -= Math.max(0, region.weight);
    if (roll <= 0) return region;
  }
  return regions[regions.length - 1]!;
}

const MIN_WALK_PX = 80;
const RETRY_COUNT = 8;

/**
 * 在区域内采一个可站立点。
 *
 * 距离用 `sqrt(random) * radius`：均匀落在圆面积上，不会挤在圆心。
 * 离当前位置太近的候选前 6 次会被拒绝，避免「走两步就停」；最后两次放宽，
 * 否则小区域（会议室 r=240）可能永远采不到点。
 */
export function pickWaypoint(
  rng: Rng,
  region: NpcRegion,
  from?: NpcSpot,
  minWalkPx = MIN_WALK_PX,
): NpcSpot {
  if (region.points.length > 0 && rng.chance(0.15)) {
    const point = rng.pick(region.points);
    const free = findFreePoint(point.x, point.y, PLAYER_RADIUS, true);
    if (!isBlocked(free.x, free.y, PLAYER_RADIUS)) return { x: free.x, y: free.y };
  }

  for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = Math.sqrt(rng.next()) * region.radius;
    const x = region.x + Math.cos(angle) * distance;
    const y = region.y + Math.sin(angle) * distance;
    if (isBlocked(x, y, PLAYER_RADIUS)) continue;
    if (from && attempt < RETRY_COUNT - 2) {
      const dx = x - from.x;
      const dy = y - from.y;
      if (dx * dx + dy * dy < minWalkPx * minWalkPx) continue;
    }
    return { x, y };
  }

  const fallback = findFreePoint(region.x, region.y, PLAYER_RADIUS, true);
  return { x: fallback.x, y: fallback.y };
}

/** 出生点：优先区域中心附近的空地，避免开局就贴着墙 */
export function pickSpawnPoint(rng: Rng, region: NpcRegion): NpcSpot {
  for (let attempt = 0; attempt < RETRY_COUNT; attempt += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const distance = Math.sqrt(rng.next()) * region.radius * 0.7;
    const x = region.x + Math.cos(angle) * distance;
    const y = region.y + Math.sin(angle) * distance;
    if (!isBlocked(x, y, PLAYER_RADIUS)) return { x, y };
  }
  const fallback = findFreePoint(region.x, region.y, PLAYER_RADIUS, true);
  return { x: fallback.x, y: fallback.y };
}
