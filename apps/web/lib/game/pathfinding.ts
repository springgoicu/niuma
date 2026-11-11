import { ISLAND, isBlocked, isOnBridge, isWaterAt, resolveMotion } from '@niuma/shared-types';

/**
 * 园区自动寻路（ADR-0040）：在静态碰撞数据上跑 8 向 A*。
 *
 * 网格只覆盖岛屿包围盒，可通行性惰性求值 —— 只对 A* 真正访问到的格子调
 * `isBlocked`，不为一次点击预计算整座岛。碰撞仍以 shared-types 为唯一真相，
 * 这里不复制任何墙体或地形判定。
 */

export interface PathPoint {
  x: number;
  y: number;
}

/** 网格边长（世界像素）：60px 门洞在本网格上仍有 3 格宽 */
export const NAV_CELL = 16;
/** 单次查询最多展开的格子数：超过就当不可达，避免病态查询拖住点击 */
const MAX_EXPANSIONS = 24000;
/** 涉水代价倍数：水可涉，但优先绕桥与土路 */
const WATER_COST = 3;
/** 起点 / 终点被挡时向外找空地的最大半径（格） */
const SNAP_RADIUS = 6;

const BOUNDS = ISLAND.bounds;
const COLS = Math.ceil(BOUNDS.w / NAV_CELL);
const ROWS = Math.ceil(BOUNDS.h / NAV_CELL);
const CELLS = COLS * ROWS;

/** 0 未算 / 1 陆地 / 2 水面 / 3 阻挡 */
const terrain = new Uint8Array(CELLS);
const gScore = new Float32Array(CELLS);
const gStamp = new Uint32Array(CELLS);
const parent = new Int32Array(CELLS);
const closedStamp = new Uint32Array(CELLS);
let stamp = 0;

const heapIndex: number[] = [];
const heapKey: number[] = [];

/** 八向：先正交后对角，保证同代价下路径更直 */
const DIR_X = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const DIR_Y = [0, 0, 1, -1, 1, -1, 1, -1] as const;

function centerOf(index: number): { x: number; y: number } {
  return {
    x: BOUNDS.x + (index % COLS) * NAV_CELL + NAV_CELL / 2,
    y: BOUNDS.y + ((index / COLS) | 0) * NAV_CELL + NAV_CELL / 2,
  };
}

function terrainAt(index: number): number {
  const cached = terrain[index]!;
  if (cached !== 0) return cached;
  const { x, y } = centerOf(index);
  const kind = isBlocked(x, y) ? 3 : isWaterAt(x, y) && !isOnBridge(x, y) ? 2 : 1;
  terrain[index] = kind;
  return kind;
}

/** 从 (gx, gy) 向外找最近可走格：陆地优先，只有整圈都是水时才接受水面 */
function snapCell(gx: number, gy: number): number {
  let water = -1;
  for (let radius = 0; radius <= SNAP_RADIUS; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const index = ny * COLS + nx;
        const kind = terrainAt(index);
        if (kind === 1) return index;
        if (kind === 2 && water < 0) water = index;
      }
    }
  }
  return water;
}

/** 世界坐标 → 可走格下标；网格外返回 -1（不向边缘吸附，避免把海里的目标硬拉上岸） */
function cellFromWorld(x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  const gx = Math.floor((x - BOUNDS.x) / NAV_CELL);
  const gy = Math.floor((y - BOUNDS.y) / NAV_CELL);
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return -1;
  return snapCell(gx, gy);
}

function heuristic(index: number, goalX: number, goalY: number): number {
  const dx = Math.abs((index % COLS) - goalX);
  const dy = Math.abs(((index / COLS) | 0) - goalY);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function heapSwap(a: number, b: number): void {
  const index = heapIndex[a]!;
  heapIndex[a] = heapIndex[b]!;
  heapIndex[b] = index;
  const key = heapKey[a]!;
  heapKey[a] = heapKey[b]!;
  heapKey[b] = key;
}

function heapPush(index: number, key: number): void {
  heapIndex.push(index);
  heapKey.push(key);
  let i = heapIndex.length - 1;
  while (i > 0) {
    const up = (i - 1) >> 1;
    if (heapKey[up]! <= heapKey[i]!) break;
    heapSwap(i, up);
    i = up;
  }
}

function heapPop(): number {
  const top = heapIndex[0]!;
  const lastIndex = heapIndex.pop()!;
  const lastKey = heapKey.pop()!;
  if (heapIndex.length > 0) {
    heapIndex[0] = lastIndex;
    heapKey[0] = lastKey;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      if (left >= heapIndex.length) break;
      const right = left + 1;
      const smaller = right < heapIndex.length && heapKey[right]! < heapKey[left]! ? right : left;
      if (heapKey[i]! <= heapKey[smaller]!) break;
      heapSwap(i, smaller);
      i = smaller;
    }
  }
  return top;
}

/** 从终点沿 parent 回溯成世界坐标点列；末点用精确到达点，避免停在格子中心 */
function buildPath(start: number, goal: number, toX: number, toY: number): PathPoint[] {
  const cells: number[] = [];
  let cursor = goal;
  while (cursor !== start) {
    cells.push(cursor);
    const previous = parent[cursor]!;
    if (previous === cursor) return [];
    cursor = previous;
  }
  cells.reverse();

  const points = cells.map((index) => centerOf(index));
  const last = points[points.length - 1];
  if (last && (last.x !== toX || last.y !== toY)) {
    const exact = resolveMotion(last.x, last.y, toX, toY);
    if (Math.hypot(exact.x - toX, exact.y - toY) < 0.5) points.push({ x: toX, y: toY });
  }
  return points;
}

/**
 * 求从 `(fromX, fromY)` 到 `(toX, toY)` 的路径（不含起点）。
 *
 * 返回 `[]` 表示已经在终点格内，`null` 表示不可达（网格外、被围死或超出展开上限）。
 * 只在点击导览按钮时调用，不进帧循环。
 */
export function findPath(fromX: number, fromY: number, toX: number, toY: number): PathPoint[] | null {
  const start = cellFromWorld(fromX, fromY);
  const goal = cellFromWorld(toX, toY);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [];

  stamp += 1;
  if (stamp === 0 || stamp > 0xfffffffe) {
    closedStamp.fill(0);
    gStamp.fill(0);
    stamp = 1;
  }
  heapIndex.length = 0;
  heapKey.length = 0;

  const goalX = goal % COLS;
  const goalY = (goal / COLS) | 0;

  gStamp[start] = stamp;
  gScore[start] = 0;
  heapPush(start, heuristic(start, goalX, goalY));

  let expanded = 0;
  while (heapIndex.length > 0) {
    const current = heapPop();
    if (closedStamp[current] === stamp) continue;
    closedStamp[current] = stamp;
    if (current === goal) return buildPath(start, goal, toX, toY);

    expanded += 1;
    if (expanded > MAX_EXPANSIONS) return null;

    const cx = current % COLS;
    const cy = (current / COLS) | 0;
    const currentG = gScore[current]!;
    for (let dir = 0; dir < 8; dir += 1) {
      const dx = DIR_X[dir]!;
      const dy = DIR_Y[dir]!;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;

      const next = ny * COLS + nx;
      const kind = terrainAt(next);
      if (kind === 3) continue;

      const diagonal = dx !== 0 && dy !== 0;
      // 禁止切角：对角两翼任一被挡就走不过去，否则会贴着墙角卡住
      if (diagonal && (terrainAt(cy * COLS + nx) === 3 || terrainAt(ny * COLS + cx) === 3)) continue;

      const step = diagonal ? Math.SQRT2 : 1;
      const tentative = currentG + (kind === 2 ? step * WATER_COST : step);
      if (gStamp[next] === stamp && tentative >= gScore[next]!) continue;

      gStamp[next] = stamp;
      gScore[next] = tentative;
      parent[next] = current;
      heapPush(next, tentative + heuristic(next, goalX, goalY));
    }
  }
  return null;
}
