'use client';

import { ISLAND, WORLD_LAYOUT, distanceSqToPolygon, isBlocked, isWaterAt, pointInPolygon } from '@niuma/shared-types';
import { isOutdoorGround } from './ground';
import { seeded } from './seeded';

/**
 * 小动物的撒点：纯函数、只依赖世界布局，不碰 Pixi，便于单测。
 *
 * 三条纪律（与 decals.ts 一致）：
 * 1. **有界重试**：每格最多 12 次、总尝试上限由格子数决定，找不到就跳过，
 *    绝不写 `while (true)`——初始化卡死比少两只兔子严重得多；
 * 2. **落点必须与玩家同源**：`isOutdoorGround` + `isBlocked`，动物不会站在水里、
 *    路上、石砖广场上、墙里；
 * 3. **稀疏**：320px 网格每格最多一只 + 80px 最小间距，避免出生就挤成一堆。
 */

/** 地面小动物人口：72 只撒在 3805×4212 的岛上，视野内通常 2–4 只 */
export const GROUND_POPULATION = 72;
/** 蝴蝶人口：集中在花海周边，同一片花海里能看到 2–4 只 */
export const BUTTERFLY_POPULATION = 18;
/** 小鱼人口：三处景观湖各 6 条（ADR-0047） */
export const FISH_PER_LAKE = 6;
export const FISH_POPULATION = FISH_PER_LAKE * 3;
/** 同一条湖里两条鱼的最小间距：浅塘面积有限，100 是「不挤成鱼群」的下限 */
const FISH_MIN_GAP = 100;
/** 鱼窝离岸的最小距离：鱼身与芦苇都要留出空间 */
const FISH_SHORE_CLEAR = 60;
/** 往返端点离岸的最小距离：转身时不会搁浅 */
const FISH_PATROL_CLEAR = 30;
/** 沿湖面网格采样鱼窝的步长 */
const FISH_STEP = 32;

const CELL = 320;
const MAX_PER_CELL = 1;
/** 两只地面动物的最小间距：小于这个值会读成「一坨」而不是「两只」 */
const MIN_GAP = 80;
const ATTEMPTS_PER_CELL = 12;
/** 撒点用的碰撞半径：比玩家小得多，动物才能钻进树与花箱之间的缝 */
const SPAWN_RADIUS = 6;

export interface GroundSpawn {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  /** 兔子配色：0 奶油白 / 1 燕麦灰 / 2 焦糖棕 */
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
  /** 沿湖面选定的单位向量：鱼沿它往返 */
  dirX: number;
  dirY: number;
  /** 往返半程（px） */
  range: number;
  variant: number;
  speed: number;
  /** 摆尾相位 */
  phase: number;
}

/** 八方向单位向量：手写，避免在撒点里引入 sin/cos 的跨引擎末位差异 */
const FISH_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

/**
 * 小鱼撒点（ADR-0047）：三处景观湖各 6 条，在湖面内按 32px 网格找窝。
 *
 * 三个硬约束：
 * 1. 鱼窝必须在湖里，且离岸 ≥60px；
 * 2. 同一条湖里两两间距 ≥100px；
 * 3. 往返端点与中点都必须在水里、离岸 ≥30px，转身时不会游上岸。
 */
export function planFish(seed: number): FishSpawn[] {
  const random = seeded(seed ^ 0x2f6d1b7);
  const out: FishSpawn[] = [];
  const gapSq = FISH_MIN_GAP * FISH_MIN_GAP;
  const shoreClearSq = FISH_SHORE_CLEAR * FISH_SHORE_CLEAR;
  const patrolClearSq = FISH_PATROL_CLEAR * FISH_PATROL_CLEAR;

  for (const lake of WORLD_LAYOUT.lakes) {
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = lake.rect.y; y <= lake.rect.y + lake.rect.h; y += FISH_STEP) {
      for (let x = lake.rect.x; x <= lake.rect.x + lake.rect.w; x += FISH_STEP) {
        if (!isWaterAt(x, y)) continue;
        if (distanceSqToPolygon(x, y, lake.points) < shoreClearSq) continue;
        candidates.push({ x, y });
      }
    }
    // 洗牌：不同局里鱼的起点不同，但分布仍然均匀
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = candidates[i]!;
      candidates[i] = candidates[j]!;
      candidates[j] = tmp;
    }

    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= FISH_PER_LAKE) break;
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

      let direction: readonly [number, number] | null = null;
      let range = 0;
      for (const [dx, dy] of FISH_DIRECTIONS) {
        for (const tryRange of [120, 90, 60, 40]) {
          let ok = true;
          // 沿整段往返线采样 9 点：只验 4 点会让鱼在凹岸处短暂游过陆地
          for (let step = 0; step <= 8; step += 1) {
            const t = -1 + step / 4;
            const px = candidate.x + dx * tryRange * t;
            const py = candidate.y + dy * tryRange * t;
            if (!isWaterAt(px, py) || distanceSqToPolygon(px, py, lake.points) < patrolClearSq) {
              ok = false;
              break;
            }
          }
          if (ok) {
            direction = [dx, dy];
            range = tryRange;
            break;
          }
        }
        if (direction) break;
      }
      if (!direction) continue;

      out.push({
        x: candidate.x,
        y: candidate.y,
        homeX: candidate.x,
        homeY: candidate.y,
        dirX: direction[0],
        dirY: direction[1],
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
