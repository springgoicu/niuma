import {
  PLAYER_RADIUS,
  WORLD_BOUNDS,
  dynamicBlockerCount,
  isBlocked,
  isInClinicInterior,
} from '@niuma/shared-types';

/**
 * 共享寻路：保安押送与救护车出警复用同一份导航能力（ADR-0115）。
 *
 * 24px 网格 + 8 邻接（禁止切角）+ 视线简化。地图静态底图按半径与门禁模式缓存；
 * 单次 BFS 复用预分配工作数组（零 GC），并在存在动态门栅时实时叠加动态障碍判定。
 */

export interface NavPoint {
  x: number;
  y: number;
}

export interface FindPathOptions {
  /** 为 true 时把护士站内部视作不可行走（供无法进站的步行 NPC / 保安使用） */
  avoidClinicInterior?: boolean;
}

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

/** 按 (半径 + 是否排除急救站内) 缓存纯静态可走网格：不包含动态门栅 */
const grids = new Map<string, Uint8Array>();

/** 预分配 BFS 工作数组：帧内多次寻路不产生大块 TypedArray 分配 */
const seenStamp = new Uint32Array(CELL_COUNT);
const previous = new Int32Array(CELL_COUNT);
const queue = new Int32Array(CELL_COUNT);
let bfsStamp = 0;

function gridKey(radius: number, avoidClinic: boolean): string {
  return `${radius}:${avoidClinic ? 1 : 0}`;
}

function isPointBlocked(x: number, y: number, radius: number, avoidClinic: boolean): boolean {
  if (isBlocked(x, y, radius, true)) return true;
  return avoidClinic && isInClinicInterior(x, y);
}

function buildGrid(radius: number, avoidClinic: boolean): Uint8Array {
  const cells = new Uint8Array(CELL_COUNT);
  for (let cy = 0; cy < ROWS; cy += 1) {
    for (let cx = 0; cx < COLS; cx += 1) {
      const x = ORIGIN_X + cx * CELL + CELL / 2;
      const y = ORIGIN_Y + cy * CELL + CELL / 2;
      const blocked = isBlocked(x, y, radius, false) || (avoidClinic && isInClinicInterior(x, y));
      cells[cy * COLS + cx] = blocked ? 0 : 1;
    }
  }
  return cells;
}

function ensureGrid(radius: number, avoidClinic = false): Uint8Array {
  const key = gridKey(radius, avoidClinic);
  let cells = grids.get(key);
  if (!cells) {
    cells = buildGrid(radius, avoidClinic);
    grids.set(key, cells);
  }
  return cells;
}

/** 预热：在启动时把 28k 格跑完，避免第一次寻路在一个 Tick 里现算 */
export function warmNavGrid(
  radius: number = PLAYER_RADIUS,
  options?: FindPathOptions,
): void {
  ensureGrid(radius, options?.avoidClinicInterior === true);
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

function isWalkable(
  cx: number,
  cy: number,
  cells: Uint8Array,
  radius: number,
  hasDynamic: boolean,
): boolean {
  if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
  if (cells[indexOf(cx, cy)] !== 1) return false;
  if (hasDynamic && isBlocked(centerX(cx), centerY(cy), radius, true)) return false;
  return true;
}

/**
 * 把任意坐标落到最近的可走格。
 *
 * 起点/终点贴在墙边或落在一个被半径判死的角落时，向外扩张最多 4 格（96px）
 * 找可走格；找不到就返回 null，由调用方放弃任务，绝不把实体塞进墙里。
 */
function nearestCell(
  x: number,
  y: number,
  cells: Uint8Array,
  radius: number,
  hasDynamic: boolean,
): { cx: number; cy: number } | null {
  const baseX = Math.min(COLS - 1, Math.max(0, Math.floor((x - ORIGIN_X) / CELL)));
  const baseY = Math.min(ROWS - 1, Math.max(0, Math.floor((y - ORIGIN_Y) / CELL)));
  if (isWalkable(baseX, baseY, cells, radius, hasDynamic)) return { cx: baseX, cy: baseY };

  for (let ring = 1; ring <= 4; ring += 1) {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestX = -1;
    let bestY = -1;
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        // 只扫外圈，内圈上一轮已经看过
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cx = baseX + dx;
        const cy = baseY + dy;
        if (!isWalkable(cx, cy, cells, radius, hasDynamic)) continue;
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
function lineClear(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  avoidClinic: boolean,
): boolean {
  const distance = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(distance / 4));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (isPointBlocked(ax + (bx - ax) * t, ay + (by - ay) * t, radius, avoidClinic)) return false;
  }
  return true;
}

/**
 * 视线简化：从当前点尽量往后连，保留拐点。
 * 只减点、不改可达性；被墙挡住的捷径会被 `lineClear` 拒绝。
 */
function simplify(points: NavPoint[], radius: number, avoidClinic: boolean): NavPoint[] {
  if (points.length <= 2) return points;
  const out = [points[0]!];
  let index = 0;
  while (index < points.length - 1) {
    let next = points.length - 1;
    while (
      next > index + 1 &&
      !lineClear(points[index]!.x, points[index]!.y, points[next]!.x, points[next]!.y, radius, avoidClinic)
    ) {
      next -= 1;
    }
    out.push(points[next]!);
    index = next;
  }
  return out;
}

/**
 * 求一条从 `from` 到 `to` 的可走路线（含起点与终点）。
 * 无路可走返回 null；调用方据此中止任务，不做「直线穿墙」兜底。
 */
export function findPath(
  from: NavPoint,
  to: NavPoint,
  radius: number = PLAYER_RADIUS,
  options?: FindPathOptions,
): NavPoint[] | null {
  const avoidClinic = options?.avoidClinicInterior === true && !isInClinicInterior(from.x, from.y);
  const hasDynamic = dynamicBlockerCount() > 0;
  const cells = ensureGrid(radius, avoidClinic);
  const start = nearestCell(from.x, from.y, cells, radius, hasDynamic);
  const goal = nearestCell(to.x, to.y, cells, radius, hasDynamic);
  if (!start || !goal) return null;

  const startIndex = indexOf(start.cx, start.cy);
  const goalIndex = indexOf(goal.cx, goal.cy);

  bfsStamp += 1;
  if (bfsStamp >= 0xfffffffe) {
    seenStamp.fill(0);
    bfsStamp = 1;
  }
  const stamp = bfsStamp;

  let head = 0;
  let tail = 0;
  seenStamp[startIndex] = stamp;
  previous[startIndex] = -1;
  queue[tail] = startIndex;
  tail += 1;

  while (head < tail && seenStamp[goalIndex] !== stamp) {
    const current = queue[head]!;
    head += 1;
    const cx = current % COLS;
    const cy = Math.floor(current / COLS);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(nx, ny, cells, radius, hasDynamic)) continue;
      // 斜向不允许切角：两个正邻都必须可走
      if (
        dx !== 0 &&
        dy !== 0 &&
        (!isWalkable(cx + dx, cy, cells, radius, hasDynamic) ||
          !isWalkable(cx, cy + dy, cells, radius, hasDynamic))
      ) {
        continue;
      }
      const next = indexOf(nx, ny);
      if (seenStamp[next] === stamp) continue;
      seenStamp[next] = stamp;
      previous[next] = current;
      queue[tail] = next;
      tail += 1;
      if (next === goalIndex) break;
    }
  }

  if (seenStamp[goalIndex] !== stamp) return null;

  const reversed: NavPoint[] = [];
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
  // 否则最后一段会从墙里穿出来，围观者能看到实体“穿墙”。
  const raw = reversed;
  if (!isPointBlocked(from.x, from.y, radius, avoidClinic)) raw[0] = { x: from.x, y: from.y };
  if (!isPointBlocked(to.x, to.y, radius, avoidClinic)) raw[raw.length - 1] = { x: to.x, y: to.y };
  if (raw.length === 1) raw.push({ x: raw[0]!.x, y: raw[0]!.y });
  return simplify(raw, radius, avoidClinic);
}

/**
 * 就近求一个不在墙里的落点，供卡死脱困兜底。
 * 原点本身合法就原样返回；否则落到最近可走格的中心。整张图都找不到才返回 null。
 */
export function nearestFreePoint(
  x: number,
  y: number,
  radius: number = PLAYER_RADIUS,
): NavPoint | null {
  const hasDynamic = dynamicBlockerCount() > 0;
  const cells = ensureGrid(radius, false);
  if (!isBlocked(x, y, radius, true)) return { x, y };
  const cell = nearestCell(x, y, cells, radius, hasDynamic);
  return cell ? { x: centerX(cell.cx), y: centerY(cell.cy) } : null;
}
