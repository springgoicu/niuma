import { WORLD_BOUNDS, isBlocked } from '@niuma/shared-types';

/**
 * 押送寻路：只在「保安去抓人 / 拖人去小黑屋」时使用，不做全图漫游（ADR-0061 / 0072）。
 *
 * 24px 网格 + 8 邻接（禁止切角）+ 视线简化。地图是静态的，可行走格只算一次；
 * 单次 BFS 约 2.8 万格，毫秒级，每名保安每秒最多重算 2.5 次。
 */

const CELL = 24;
const ORIGIN_X = WORLD_BOUNDS.x;
const ORIGIN_Y = WORLD_BOUNDS.y;
const COLS = Math.ceil(WORLD_BOUNDS.w / CELL);
const ROWS = Math.ceil(WORLD_BOUNDS.h / CELL);
const CELL_COUNT = COLS * ROWS;

/** 8 邻接：先四正，再四斜；斜向要求两个正邻都可走，避免从墙角挤过去 */
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

let walkable: Uint8Array | null = null;

function buildGrid(): Uint8Array {
  const cells = new Uint8Array(CELL_COUNT);
  for (let cy = 0; cy < ROWS; cy += 1) {
    for (let cx = 0; cx < COLS; cx += 1) {
      const x = ORIGIN_X + cx * CELL + CELL / 2;
      const y = ORIGIN_Y + cy * CELL + CELL / 2;
      cells[cy * COLS + cx] = isBlocked(x, y) ? 0 : 1;
    }
  }
  return cells;
}

function ensureGrid(): Uint8Array {
  if (!walkable) walkable = buildGrid();
  return walkable;
}

/** 预热：在启动时把 28k 格跑完，避免第一次执法在一个 Tick 里现算 */
export function warmEscortGrid(): void {
  ensureGrid();
}

function indexOf(cx: number, cy: number): number {
  return cy * COLS + cx;
}

function centerX(cx: number): number {
  return ORIGIN_X + cx * CELL + CELL / 2;
}

function centerY(cy: number): number {
  return ORIGIN_Y + cy * CELL + CELL / 2;
}

function isWalkable(cx: number, cy: number, cells: Uint8Array): boolean {
  return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS && cells[indexOf(cx, cy)] === 1;
}

/**
 * 把任意坐标落到最近的可走格。
 *
 * 起点/终点贴在墙边或落在一个被半径判死的角落时，向外扩张最多 4 格（96px）
 * 找可走格；找不到就返回 null，由调用方放弃任务，绝不把保安塞进墙里。
 */
function nearestCell(x: number, y: number, cells: Uint8Array): { cx: number; cy: number } | null {
  const baseX = Math.min(COLS - 1, Math.max(0, Math.floor((x - ORIGIN_X) / CELL)));
  const baseY = Math.min(ROWS - 1, Math.max(0, Math.floor((y - ORIGIN_Y) / CELL)));
  if (isWalkable(baseX, baseY, cells)) return { cx: baseX, cy: baseY };

  for (let radius = 1; radius <= 4; radius += 1) {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestX = -1;
    let bestY = -1;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // 只扫外圈，内圈上一轮已经看过
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cx = baseX + dx;
        const cy = baseY + dy;
        if (!isWalkable(cx, cy, cells)) continue;
        const d2 = (centerX(cx) - x) ** 2 + (centerY(cy) - y) ** 2;
        if (d2 < bestDistance) {
          bestDistance = d2;
          bestX = cx;
          bestY = cy;
        }
      }
    }
    if (bestX >= 0) return { cx: bestX, cy: bestY };
  }
  return null;
}

/** 4px 采样视线：平滑后的捷径不能穿墙，也不能擦着墙角过 */
function lineClear(ax: number, ay: number, bx: number, by: number): boolean {
  const distance = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (isBlocked(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

/**
 * 视线简化：从当前点尽量往后连，保留拐点。
 * 只减点、不改可达性；被墙挡住的捷径会被 `lineClear` 拒绝。
 */
function simplify(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;
  const out = [points[0]!];
  let index = 0;
  while (index < points.length - 1) {
    let next = points.length - 1;
    while (next > index + 1 && !lineClear(points[index]!.x, points[index]!.y, points[next]!.x, points[next]!.y)) {
      next -= 1;
    }
    out.push(points[next]!);
    index = next;
  }
  return out;
}

/**
 * 求一条从 `from` 到 `to` 的可走路线（含起点与终点）。
 * 无路可走返回 null；调用方据此中止押送，不做「直线穿墙」的兜底。
 */
export function findEscortPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> | null {
  const cells = ensureGrid();
  const start = nearestCell(from.x, from.y, cells);
  const goal = nearestCell(to.x, to.y, cells);
  if (!start || !goal) return null;

  const startIndex = indexOf(start.cx, start.cy);
  const goalIndex = indexOf(goal.cx, goal.cy);
  const previous = new Int32Array(CELL_COUNT).fill(-2);
  const queue = new Int32Array(CELL_COUNT);
  let head = 0;
  let tail = 0;
  previous[startIndex] = -1;
  queue[tail] = startIndex;
  tail += 1;

  while (head < tail && previous[goalIndex] === -2) {
    const current = queue[head]!;
    head += 1;
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    const cellsNow = cells;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny, cellsNow)) continue;
      // 斜向不允许切角：两个正邻都必须可走
      if (dx !== 0 && dy !== 0 && (!isWalkable(cx + dx, cy, cellsNow) || !isWalkable(cx, cy + dy, cellsNow))) {
        continue;
      }
      const next = indexOf(nx, ny);
      if (previous[next] !== -2) continue;
      previous[next] = current;
      queue[tail] = next;
      tail += 1;
      if (next === goalIndex) break;
    }
  }

  if (previous[goalIndex] === -2) return null;

  const reversed: Array<{ x: number; y: number }> = [];
  let cursor = goalIndex;
  while (cursor !== -1) {
    const cx = cursor % COLS;
    const cy = Math.floor(cursor / COLS);
    reversed.push({ x: centerX(cx), y: centerY(cy) });
    cursor = previous[cursor]!;
  }
  reversed.reverse();

  // 首尾换回精确点，避免落点差半格导致「到了却抓不到」；
  // 但坐标本身在墙里（被挤出 / 目标卡在装饰物上）时保留最近的可行走格，
  // 否则最后一段会从墙里穿出来，围观者能看到保安“穿墙”。
  const raw = reversed;
  if (!isBlocked(from.x, from.y)) raw[0] = { x: from.x, y: from.y };
  if (!isBlocked(to.x, to.y)) raw[raw.length - 1] = { x: to.x, y: to.y };
  if (raw.length === 1) raw.push({ x: raw[0]!.x, y: raw[0]!.y });
  return simplify(raw);
}
