'use client';

import { ISLAND, WORLD_LAYOUT, isBlocked, isWaterAt, type WorldRect } from '@niuma/shared-types';
import { isOutdoorGround } from './ground';
import { seeded } from './seeded';

/**
 * 小动物的撒点：纯函数、只依赖世界布局，不碰 Pixi，便于单测。
 *
 * 三条纪律（与 decals.ts 一致）：
 * 1. **有界重试**：每格最多 12 次、总尝试上限由格子数决定，找不到就跳过，
 *    绝不写 `while (true)`——初始化卡死比少两只兔子严重得多；
 * 2. **落点必须与玩家同源**：`isOutdoorGround` + `isBlocked`，动物不会站在水里、
 *    路上、墙里；
 * 3. **稀疏**：320px 网格每格最多一只 + 80px 最小间距，避免出生就挤成一堆。
 */

/** 地面小动物人口：72 只撒在 3805×4212 的岛上，视野内通常 2–4 只 */
export const GROUND_POPULATION = 72;
/** 蝴蝶人口：集中在四片花海周边，同一片花海里能看到 2–4 只 */
export const BUTTERFLY_POPULATION = 18;
/** 小鱼人口：周报河 / 晨会溪 / 护园溪各 6 条（ADR-0045） */
export const FISH_PER_RIVER = 6;
export const FISH_POPULATION = FISH_PER_RIVER * 3;
/** 鱼窝离桥/码头的最小距离：鱼层在桥面之上，靠撒点避开而不是改图层 */
const FISH_BRIDGE_CLEAR = 110;
/** 同一条河里两条鱼的最小间距 */
const FISH_MIN_GAP = 120;
/** 往返端点离桥的最小距离：转身时也不会游到桥板上 */
const FISH_PATROL_CLEAR = 60;
/** 鱼沿中心线的候选步长 */
const FISH_STEP = 32;

const CELL = 320;
const MAX_PER_CELL = 1;
/** 两只地面动物的最小间距：小于这个值会读成「一坨」而不是「两只」 */
const MIN_GAP = 80;
const ATTEMPTS_PER_CELL = 12;
/** 撒点用的碰撞半径：比玩家小得多，动物才能钻进树与花箱之间的缝 */
const SPAWN_RADIUS = 6;

const NEAR_FLOWER = 240;
const NEAR_FOREST = 180;
const NEAR_ROAD = 200;

export interface GroundSpawn {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  /** 0 兔 / 1 猫 / 2 狗 */
  species: number;
  variant: number;
  dirX: number;
  dirY: number;
}

export interface ButterflySpawn {
  homeX: number;
  homeY: number;
  variant: number;
  /** 轨道初相位（弧度） */
  phase: number;
  radiusX: number;
  radiusY: number;
  /** 角速度，弧度/秒 */
  speed: number;
}

/** 点到矩形的最近距离平方；点在矩形内为 0 */
function rectGapSq(rect: WorldRect, x: number, y: number): number {
  const dx = x < rect.x ? rect.x - x : x > rect.x + rect.w ? x - (rect.x + rect.w) : 0;
  const dy = y < rect.y ? rect.y - y : y > rect.y + rect.h ? y - (rect.y + rect.h) : 0;
  return dx * dx + dy * dy;
}

function nearestGapSq(rects: readonly WorldRect[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const gap = rectGapSq(rect, x, y);
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * 生境权重：兔靠近花海与林地、猫靠近园路与广场、狗留在开阔草地。
 * 权重只影响「这只落在哪个格子里时是谁」，不改变总量。
 */
function pickSpecies(x: number, y: number, random: number): number {
  const nearFlower = nearestGapSq(WORLD_LAYOUT.flowerFields.map((field) => field.rect), x, y);
  const nearForest = nearestGapSq(WORLD_LAYOUT.forests.map((forest) => forest.rect), x, y);
  const nearRoad = Math.min(
    nearestGapSq(WORLD_LAYOUT.paths, x, y),
    rectGapSq(WORLD_LAYOUT.plaza, x, y),
  );
  const rabbit = 1 + (nearFlower < NEAR_FLOWER * NEAR_FLOWER ? 2 : 0) + (nearForest < NEAR_FOREST * NEAR_FOREST ? 1 : 0);
  const cat = 1 + (nearRoad < NEAR_ROAD * NEAR_ROAD ? 2 : 0);
  const dog = 1 + (nearRoad >= NEAR_ROAD * NEAR_ROAD && nearFlower >= NEAR_FLOWER * NEAR_FLOWER ? 1 : 0);
  const total = rabbit + cat + dog;
  const roll = random * total;
  if (roll < rabbit) return 0;
  return roll < rabbit + cat ? 1 : 2;
}

/**
 * 全岛撒点。种子决定一切：同一帧内调两次同一个种子会得到同一批坐标，
 * 便于复现「动物穿墙」这类问题。
 */
export function planGroundCritters(seed: number): GroundSpawn[] {
  const random = seeded(seed);
  const bounds = ISLAND.bounds;
  const cols = Math.ceil(bounds.w / CELL);
  const rows = Math.ceil(bounds.h / CELL);

  // 打乱格子顺序后再按顺序装填：不同局里动物落到的格子不同，但都稀疏
  const cells: number[] = new Array(cols * rows);
  for (let i = 0; i < cells.length; i += 1) cells[i] = i;
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }

  const placed: GroundSpawn[] = [];
  const gapSq = MIN_GAP * MIN_GAP;

  for (const cell of cells) {
    if (placed.length >= GROUND_POPULATION) break;
    const col = cell % cols;
    const row = (cell / cols) | 0;
    let taken = 0;
    for (let attempt = 0; attempt < ATTEMPTS_PER_CELL && taken < MAX_PER_CELL; attempt += 1) {
      const x = bounds.x + col * CELL + random() * CELL;
      const y = bounds.y + row * CELL + random() * CELL;
      if (!isOutdoorGround(x, y)) continue;
      if (isBlocked(x, y, SPAWN_RADIUS)) continue;
      let crowded = false;
      for (const other of placed) {
        const dx = other.x - x;
        const dy = other.y - y;
        if (dx * dx + dy * dy < gapSq) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      const angle = random() * Math.PI * 2;
      placed.push({
        x,
        y,
        homeX: x,
        homeY: y,
        species: pickSpecies(x, y, random()),
        variant: Math.floor(random() * 3),
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
      });
      taken += 1;
    }
  }

  return placed;
}

export interface FishSpawn {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  /** 沿河切向的单位向量：鱼沿它往返 */
  dirX: number;
  dirY: number;
  /** 往返半程（px） */
  range: number;
  variant: number;
  speed: number;
  /** 摆尾相位 */
  phase: number;
}

/** 一只鱼的候选：中心线上的一点与当地切向 */
interface LinePoint {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
}

/** 把中心线按 32px 采样成候选点；每个候选点带所在段的单位切向 */
function sampleCenterline(line: ReadonlyArray<readonly [number, number]>): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < line.length - 1; i += 1) {
    const [x0, y0] = line[i]!;
    const [x1, y1] = line[i + 1]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const dirX = dx / length;
    const dirY = dy / length;
    const steps = Math.max(1, Math.floor(length / FISH_STEP));
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      out.push({ x: x0 + dx * t, y: y0 + dy * t, dirX, dirY });
    }
  }
  return out;
}

/** 离桥/码头矩形的最小距离平方：鱼不能游到桥板上 */
function nearestBridgeGapSq(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const bridge of WORLD_LAYOUT.bridges) {
    const gap = rectGapSq(bridge, x, y);
    if (gap < best) best = gap;
  }
  for (const dock of WORLD_LAYOUT.docks) {
    const gap = rectGapSq(dock, x, y);
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * 小鱼撒点（ADR-0045）：每条河 6 条，沿中心线随机洗牌后取点。
 *
 * 三个硬约束：
 * 1. 鱼窝必须在水里，且离桥/码头 ≥110px（鱼层画在桥面之上，靠撒点避开）；
 * 2. 同一条河里两两间距 ≥120px，18 条鱼不会挤成鱼群；
 * 3. 往返端点与中点都必须在水里、离桥 ≥60px，转身时不会游上岸或游上桥。
 */
export function planFish(seed: number): FishSpawn[] {
  const random = seeded(seed ^ 0x2f6d1b7);
  const out: FishSpawn[] = [];
  const bridgeClearSq = FISH_BRIDGE_CLEAR * FISH_BRIDGE_CLEAR;
  const patrolClearSq = FISH_PATROL_CLEAR * FISH_PATROL_CLEAR;
  const gapSq = FISH_MIN_GAP * FISH_MIN_GAP;

  for (const river of WORLD_LAYOUT.rivers) {
    const candidates = sampleCenterline(river.centerline);
    // 洗牌：不同局里鱼的起点不同，但分布仍然均匀
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = candidates[i]!;
      candidates[i] = candidates[j]!;
      candidates[j] = tmp;
    }

    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= FISH_PER_RIVER) break;
      if (candidate.x < 0 || candidate.y < 0) continue;
      if (!isWaterAt(candidate.x, candidate.y)) continue;
      if (nearestBridgeGapSq(candidate.x, candidate.y) < bridgeClearSq) continue;
      let crowded = false;
      for (const other of out) {
        const dx = other.x - candidate.x;
        const dy = other.y - candidate.y;
        if (dx * dx + dy * dy < gapSq) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      // 往返半程从 120 逐档收缩，直到端点与中点都还在水里且离桥足够远
      let range = 0;
      for (const tryRange of [120, 90, 60, 40]) {
        let ok = true;
        for (const t of [-1, -0.5, 0.5, 1]) {
          const px = candidate.x + candidate.dirX * tryRange * t;
          const py = candidate.y + candidate.dirY * tryRange * t;
          if (!isWaterAt(px, py) || nearestBridgeGapSq(px, py) < patrolClearSq) {
            ok = false;
            break;
          }
        }
        if (ok) {
          range = tryRange;
          break;
        }
      }
      if (range === 0) continue;

      out.push({
        x: candidate.x,
        y: candidate.y,
        homeX: candidate.x,
        homeY: candidate.y,
        dirX: candidate.dirX,
        dirY: candidate.dirY,
        range,
        variant: Math.floor(random() * 3),
        speed: 14 + random() * 10,
        phase: random() * Math.PI * 2,
      });
      placed += 1;
    }
  }

  return out;
}

/** 蝴蝶：七成落在花海内缩 24px 的范围里，三成落在随机草地 */
export function planButterflies(seed: number): ButterflySpawn[] {
  const random = seeded(seed ^ 0x9e3779b9);
  const bounds = ISLAND.bounds;
  const fields = WORLD_LAYOUT.flowerFields;
  const out: ButterflySpawn[] = [];

  for (let i = 0; i < BUTTERFLY_POPULATION; i += 1) {
    let x = Number.NaN;
    let y = Number.NaN;
    const inFlower = fields.length > 0 && random() < 0.7;
    if (inFlower) {
      const field = fields[Math.floor(random() * fields.length)]!.rect;
      x = field.x + 24 + random() * Math.max(1, field.w - 48);
      y = field.y + 24 + random() * Math.max(1, field.h - 48);
    } else {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const cx = bounds.x + random() * bounds.w;
        const cy = bounds.y + random() * bounds.h;
        if (!isOutdoorGround(cx, cy)) continue;
        x = cx;
        y = cy;
        break;
      }
      if (!Number.isFinite(x)) continue;
    }

    out.push({
      homeX: x,
      homeY: y,
      variant: Math.floor(random() * 3),
      phase: random() * Math.PI * 2,
      radiusX: 26 + random() * 38,
      radiusY: 18 + random() * 22,
      speed: 0.32 + random() * 0.34,
    });
  }

  return out;
}
