'use client';

import {
  AMUSEMENT_STREET,
  COMPANY_FORECOURT,
  DISTRICTS,
  LIVING_AVENUE,
  PLAYER_RADIUS,
  SERVICE_SQUARE,
  SPAWN_CENTER,
  WORLD_LAYOUT,
  isBlocked,
} from '@niuma/shared-types';
import type { PathPoint } from './pathfinding';

/**
 * 园区路网节点图（ADR-0099）：自动导览先走「真正的马路」，再进目标门口。
 *
 * 为什么不是重型 A*：网格 A* 给的是「最短可通行路径」，会贴着墙根切过草地；
 * `Navigator` 逐点直线推进时就容易撞角，触发 700ms 卡死判定。这里只用
 * 50 个左右的固定节点描述「广场 → 五条主街 → 街区路口 → 门口」，
 * Dijkstra 在 20 个节点上跑是微秒级，且天然贴着道路走。
 *
 * 三条纪律：
 * 1. **不写第二份坐标**：节点来自 `WORLD_LAYOUT.paths` 的中心线顶点、`DISTRICTS` 的区门
 *    与街区铺装常量，布局一改图就跟着变；
 * 2. **构图惰性 + 校验**：首次导航才建图，每条边按 8px 采样 `isBlocked`，
 *    走不通的边直接丢掉——布局改成什么样都不会静默生成穿墙路线；
 * 3. **不进帧循环**：只在点击导览与卡死重规划时调用，全部是普通数组，不碰 Pixi。
 */

/** 节点合并半径：中心线顶点与区门重合时的取整误差 */
const NODE_MERGE = 12;
/** T 型接点：节点离既有线段多近才算「落在这条路上」 */
const SPLIT_RADIUS = 8;
/** 边的可通行性采样步长 */
const SAMPLE_STEP = 8;
/** 路线离谱到什么程度就不如直接交给 A*：图上代价 > 直线 × 该倍数 + 余量 */
const DETOUR_FACTOR = 3;
const DETOUR_SLACK = 400;
/** 尾段被墙挡住的固定惩罚：让「门口那个节点」赢过「直线更近的楼背后节点」 */
const TAIL_BLOCK_PENALTY = 600;

/** 街区级铺装：与 `road-dressing` 同一份口径 */
const STREET_AREAS = [COMPANY_FORECOURT, AMUSEMENT_STREET, SERVICE_SQUARE, LIVING_AVENUE];

/** 街区环线离铺装边缘多远：留一个身位，绕着楼走 */
const RING_INSET = 40;

/**
 * 街区广场的一圈节点（八点）：铺装内缩 40px 的方形环。
 *
 * 服务广场里杵着小黑屋，东西主路的中心线正好从屋里穿过——
 * 沿这一圈走就能自然绕开，且全部由铺装矩形推导，不写第二份坐标。
 */
function ringNodes(area: { x: number; y: number; w: number; h: number }): Array<{ x: number; y: number }> {
  const left = area.x + RING_INSET;
  const top = area.y + RING_INSET;
  const right = area.x + area.w - RING_INSET;
  const bottom = area.y + area.h - RING_INSET;
  if (right - left < 40 || bottom - top < 40) return [];
  const midX = Math.round((left + right) / 2);
  const midY = Math.round((top + bottom) / 2);
  return [
    { x: left, y: top },
    { x: midX, y: top },
    { x: right, y: top },
    { x: right, y: midY },
    { x: right, y: bottom },
    { x: midX, y: bottom },
    { x: left, y: bottom },
    { x: left, y: midY },
  ];
}

interface Edge {
  a: number;
  b: number;
  cost: number;
}

interface RoadGraph {
  /** 节点世界坐标：x、y 成对存放，避免每帧/每次查询都访问对象 */
  xs: number[];
  ys: number[];
  edges: Edge[];
  /** 邻接表：nodes[i] = [{ to, cost }] */
  adjacency: Array<Array<{ to: number; cost: number }> | undefined>;
}

/** 是否落在某栋有地板的建筑内部：路网图不往屋里走，进门的最后一步交给 A* */
function isInsideBuilding(x: number, y: number): boolean {
  for (const building of WORLD_LAYOUT.buildings) {
    const r = building.rect;
    if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
  }
  return false;
}

/** 两点之间的直线能不能走过去：8px 采样，玩家半径与碰撞体一致 */
function clearLine(x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;
  const steps = Math.ceil(distance / SAMPLE_STEP);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (isBlocked(x0 + dx * t, y0 + dy * t, PLAYER_RADIUS)) return false;
  }
  return true;
}

/** 点到线段的投影：返回最近点坐标与「落在段内」的插值参数 */
function project(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0) return { x: ax, y: ay, t: 0, distanceSq: (x - ax) * (x - ax) + (y - ay) * (y - ay) };
  const t = ((x - ax) * dx + (y - ay) * dy) / lengthSq;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * clamped;
  const py = ay + dy * clamped;
  const ex = x - px;
  const ey = y - py;
  return { x: px, y: py, t: clamped, distanceSq: ex * ex + ey * ey };
}

/** 候选折线：每条路一条，外加「广场 → 每条街的起点」这一小段 */
function candidatePolylines(): Array<Array<{ x: number; y: number }>> {
  const lines: Array<Array<{ x: number; y: number }>> = [];
  for (const path of WORLD_LAYOUT.paths) {
    const line = path.centerline.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

/** 附加节点：广场心、五座区门、四片街区广场中心 */
function extraNodes(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [SPAWN_CENTER];
  for (const district of DISTRICTS) out.push({ x: district.gate.x, y: district.gate.y });
  for (const area of STREET_AREAS) {
    out.push({ x: Math.round(area.x + area.w / 2), y: Math.round(area.y + area.h / 2) });
  }
  return out;
}

/**
 * 把附加节点插进折线：落在某段 8px 以内、且不在两端 24px 内的点，
 * 按插值位置插入。生活大街西延、影音室支路、景观区支路这几个 T 型口
 * 全靠这一步才真正接进图里。
 */
function insertNode(line: Array<{ x: number; y: number }>, node: { x: number; y: number }): boolean {
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const hit = project(node.x, node.y, a.x, a.y, b.x, b.y);
    if (hit.distanceSq > SPLIT_RADIUS * SPLIT_RADIUS) continue;
    if (hit.t <= 0.06 || hit.t >= 0.94) return false;
    line.splice(i + 1, 0, { x: Math.round(hit.x), y: Math.round(hit.y) });
    return true;
  }
  return false;
}

let graph: RoadGraph | null = null;

/** 绕行探针的横向偏移：从近到远试一遍，第一条走得通的就用来绕开障碍 */
const BRIDGE_OFFSETS: readonly number[] = [28, 48, 72, 96, 132, 172];

function buildGraph(): RoadGraph {
  const xs: number[] = [];
  const ys: number[] = [];

  /**
   * 登记节点：按**实际距离**合并（12px 内算同一个），因此不会因为量化格子
   * 把相距 8px 的两个点判成两个节点。
   *
   * 站不住的点、以及落在**建筑内部**的点直接不入图，返回 -1：
   * 东主路的中心线正好穿过小黑屋，那两个顶点必须被剔掉，改由服务广场的
   * 环形节点绕过去——否则图会把玩家指进屋里。
   */
  const nodeIndex = (x: number, y: number): number => {
    const px = Math.round(x);
    const py = Math.round(y);
    for (let i = 0; i < xs.length; i += 1) {
      if (Math.abs(xs[i]! - px) <= NODE_MERGE && Math.abs(ys[i]! - py) <= NODE_MERGE) return i;
    }
    if (isBlocked(px, py, PLAYER_RADIUS)) return -1;
    if (isInsideBuilding(px, py)) return -1;
    xs.push(px);
    ys.push(py);
    return xs.length - 1;
  };

  // 1. 折线 + T 型插点
  const lines = candidatePolylines();
  for (const node of extraNodes()) insertIntoLines(lines, node);

  // 2. 折线连边；整段被挡时用「垂直探针」绕过去（小黑屋正压在东西主路上）
  const edges: Edge[] = [];
  const pending: Array<{ a: number; b: number }> = [];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const ai = nodeIndex(a.x, a.y);
      const bi = nodeIndex(b.x, b.y);
      if (ai < 0 || bi < 0 || ai === bi) continue;
      pending.push({ a: ai, b: bi });
    }
  }
  for (const edge of pending) {
    if (connect(xs, ys, edges, nodeIndex, edge.a, edge.b)) continue;
    // 直接连不过去就不连：图里宁可少一条边，也不留一条穿墙的边
  }

  // 3. 街区广场的环形节点：一整片铺装里往往还杵着一栋楼（服务广场里就是小黑屋），
  //    中心线穿过那栋楼时只能绕——沿铺装内缩 40px 的一圈走，天然绕开楼体
  for (const area of STREET_AREAS) {
    const ring = ringNodes(area)
      .map((point) => nodeIndex(point.x, point.y))
      .filter((index) => index >= 0);
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      if (a !== b) connect(xs, ys, edges, nodeIndex, a, b);
    }
  }

  // 4. 广场心与每个「街口节点」接线：广场本身是空的，横穿不会撞东西
  const plaza = nodeIndex(SPAWN_CENTER.x, SPAWN_CENTER.y);
  if (plaza >= 0) {
    for (const line of lines) {
      const head = line[0]!;
      const hi = nodeIndex(head.x, head.y);
      if (hi < 0 || hi === plaza) continue;
      const distance = Math.hypot(head.x - SPAWN_CENTER.x, head.y - SPAWN_CENTER.y);
      // 只连「从广场能直接走到」的街口：远处的折线起点（景观区支路等）不直连
      if (distance > 520) continue;
      connect(xs, ys, edges, nodeIndex, plaza, hi);
    }
  }

  // 4. 孤立节点补线：区门往往落在路的延长线上而不是顶点上（景观区门就是），
  //    街区广场中心也可能不在任何一条中心线上。给它们接最近的一个能直连的节点。
  for (const node of extraNodes()) {
    const index = nodeIndex(node.x, node.y);
    if (index < 0) continue;
    if (edges.some((edge) => edge.a === index || edge.b === index)) continue;
    let best = -1;
    let bestDistance = 220;
    for (let i = 0; i < xs.length; i += 1) {
      if (i === index) continue;
      const distance = Math.hypot(xs[i]! - xs[index]!, ys[i]! - ys[index]!);
      if (distance >= bestDistance) continue;
      if (!clearLine(xs[index]!, ys[index]!, xs[i]!, ys[i]!)) continue;
      best = i;
      bestDistance = distance;
    }
    if (best >= 0) connect(xs, ys, edges, nodeIndex, index, best);
  }

  // 5. 收口：把还没接上的连通块并到广场那一块上。
  //    街区环线与主路之间、支路尽头与干道之间，靠这一步各接一条最短的可见边
  if (plaza >= 0) mergeComponents(xs, ys, edges, nodeIndex, plaza);

  const adjacency: RoadGraph['adjacency'] = new Array(xs.length);
  for (const edge of edges) {
    (adjacency[edge.a] ??= []).push({ to: edge.b, cost: edge.cost });
    (adjacency[edge.b] ??= []).push({ to: edge.a, cost: edge.cost });
  }

  return { xs, ys, edges, adjacency };
}

/**
 * 连通块收口：反复找出「不在广场那一块」的节点，用一条最短的可见边并进来。
 *
 * 最多迭代 8 轮（图本来就只有几十个节点），连不上就停——宁可少一条边，
 * 也不编一条穿墙的边出来。
 */
function mergeComponents(
  xs: number[],
  ys: number[],
  edges: Edge[],
  nodeIndex: (x: number, y: number) => number,
  plaza: number,
): void {
  /** 跨块补边的最大距离：太远的「可见」多半是横穿草地，不算马路 */
  const MAX_LINK = 420;

  for (let round = 0; round < 8; round += 1) {
    const component = new Int32Array(xs.length).fill(-1);
    let count = 0;
    for (let i = 0; i < xs.length; i += 1) {
      if (component[i]! >= 0) continue;
      const queue = [i];
      component[i] = count;
      while (queue.length > 0) {
        const current = queue.pop()!;
        for (const edge of edges) {
          const other = edge.a === current ? edge.b : edge.b === current ? edge.a : -1;
          if (other < 0 || component[other]! >= 0) continue;
          component[other] = count;
          queue.push(other);
        }
      }
      count += 1;
    }

    if (count <= 1) return;
    const base = component[plaza]!;
    let merged = false;
    for (let target = 0; target < count; target += 1) {
      if (target === base) continue;
      let bestA = -1;
      let bestB = -1;
      let bestDistance = MAX_LINK;
      for (let i = 0; i < xs.length; i += 1) {
        if (component[i]! !== target) continue;
        for (let j = 0; j < xs.length; j += 1) {
          if (component[j]! === target) continue;
          const distance = Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!);
          if (distance >= bestDistance) continue;
          if (!clearLine(xs[i]!, ys[i]!, xs[j]!, ys[j]!)) continue;
          bestA = i;
          bestB = j;
          bestDistance = distance;
        }
      }
      if (bestA < 0) continue;
      if (connect(xs, ys, edges, nodeIndex, bestA, bestB)) merged = true;
    }
    if (!merged) return;
  }
}

/** 一批附加节点依次插进折线（第一个能插进去的折线胜出） */
function insertIntoLines(lines: Array<Array<{ x: number; y: number }>>, node: { x: number; y: number }): void {
  for (const line of lines) {
    if (insertNode(line, node)) return;
  }
}

/**
 * 连一条边：直连不通时，用「中点 + 垂直偏移」探针找一条折线绕过障碍。
 *
 * 东主路中心线正好穿过小黑屋，这一段就必须从服务广场绕过去；探针从 28px
 * 试到 172px，第一组两条腿都走得通的就采用。找不到就返回 false（不连）。
 */
function connect(
  xs: number[],
  ys: number[],
  edges: Edge[],
  nodeIndex: (x: number, y: number) => number,
  a: number,
  b: number,
): boolean {
  const ax = xs[a]!;
  const ay = ys[a]!;
  const bx = xs[b]!;
  const by = ys[b]!;
  const length = Math.hypot(bx - ax, by - ay);
  if (length < 1) return false;

  if (clearLine(ax, ay, bx, by)) {
    edges.push({ a, b, cost: length });
    return true;
  }

  const nx = -(by - ay) / length;
  const ny = (bx - ax) / length;
  for (const offset of BRIDGE_OFFSETS) {
    for (const side of [1, -1] as const) {
      // 两个折点：1/3 与 2/3 处各偏一段，障碍物比整段短时也能绕开。
      // 先按原始坐标校验，**校验通过才登记节点** —— 否则会留下一堆孤立的探针点，
      // 起手吸附到那种点就会「原地出发、原地到达」
      const p1x = (ax * 2 + bx) / 3 + nx * offset * side;
      const p1y = (ay * 2 + by) / 3 + ny * offset * side;
      const p2x = (ax + bx * 2) / 3 + nx * offset * side;
      const p2y = (ay + by * 2) / 3 + ny * offset * side;
      if (!clearLine(ax, ay, p1x, p1y)) continue;
      if (!clearLine(p1x, p1y, p2x, p2y)) continue;
      if (!clearLine(p2x, p2y, bx, by)) continue;
      const first = nodeIndex(p1x, p1y);
      const second = nodeIndex(p2x, p2y);
      if (first < 0 || second < 0) continue;
      edges.push({ a, b: first, cost: Math.hypot(xs[first]! - ax, ys[first]! - ay) });
      edges.push({ a: first, b: second, cost: Math.hypot(xs[second]! - xs[first]!, ys[second]! - ys[first]!) });
      edges.push({ a: second, b, cost: Math.hypot(bx - xs[second]!, by - ys[second]!) });
      return true;
    }
  }
  return false;
}

function ensureGraph(): RoadGraph {
  graph ??= buildGraph();
  return graph;
}

/** 图规模：测试与调试读数，不参与玩法 */
export function roadGraphSize(): { nodes: number; edges: number } {
  const g = ensureGraph();
  return { nodes: g.xs.length, edges: g.edges.length };
}

/**
 * 最近的、且从 `(x, y)` 能一眼走到（不撞墙）的节点；找不到返回 -1。
 *
 * 孤立节点（没有任何一条边）一律跳过：吸附上去会「原地出发、原地到达」。
 */
function snapNode(g: RoadGraph, x: number, y: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < g.xs.length; i += 1) {
    if (!g.adjacency[i]) continue;
    const distance = Math.hypot(g.xs[i]! - x, g.ys[i]! - y);
    if (distance >= bestDistance) continue;
    if (!clearLine(x, y, g.xs[i]!, g.ys[i]!)) continue;
    best = i;
    bestDistance = distance;
  }
  return best;
}

/**
 * Dijkstra：节点只有几十个，用最朴素的 O(n²) 选点即可，不必上堆。
 *
 * 一次算出「从起点到所有节点」的最短代价，终点由「图上代价 + 到目标的直线」
 * 决出（见 `routeViaRoads`），所以不需要提前知道 goal。
 */
function dijkstra(g: RoadGraph, start: number): { best: Float64Array; previous: Int32Array } {
  const count = g.xs.length;
  const best = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  best[start] = 0;

  for (;;) {
    let current = -1;
    let currentCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i += 1) {
      if (done[i]) continue;
      if (best[i]! >= currentCost) continue;
      current = i;
      currentCost = best[i]!;
    }
    if (current < 0) break;
    done[current] = 1;
    const links = g.adjacency[current];
    if (!links) continue;
    for (const link of links) {
      const next = currentCost + link.cost;
      if (next >= best[link.to]!) continue;
      best[link.to] = next;
      previous[link.to] = current;
    }
  }

  return { best, previous };
}

/** 沿 `previous` 回溯出节点序列（不含起点） */
function reconstruct(g: RoadGraph, start: number, goal: number, previous: Int32Array): number[] | null {
  if (start === goal) return [];
  const path: number[] = [];
  let cursor = goal;
  while (cursor !== start) {
    path.push(cursor);
    const prev = previous[cursor]!;
    if (prev < 0 || !Number.isFinite(prev)) return null;
    cursor = prev;
  }
  path.reverse();
  return path;
}

/**
 * 折线平滑：能直连就跳过中间点。
 *
 * 网格 A* 的锯齿靠这一步消掉，天然得到一个「沿街转弯」的折线；
 * 每跳都重新采样 `isBlocked`，所以平滑不会把路线拉穿墙。
 */
function stringPull(g: RoadGraph, fromX: number, fromY: number, nodes: number[], toX: number, toY: number): PathPoint[] {
  const out: PathPoint[] = [];
  let cursorX = fromX;
  let cursorY = fromY;
  let i = 0;
  while (i < nodes.length) {
    // 从当前点往后找最远的一个「直线可走」的节点
    let pick = i;
    for (let j = nodes.length - 1; j >= i; j -= 1) {
      if (!clearLine(cursorX, cursorY, g.xs[nodes[j]!]!, g.ys[nodes[j]!]!)) continue;
      pick = j;
      break;
    }
    if (pick === i && !clearLine(cursorX, cursorY, g.xs[nodes[i]!]!, g.ys[nodes[i]!]!)) {
      // 连最近的一个都走不到：整段图路线作废，交给调用方回退 A*
      return [];
    }
    const node = nodes[pick]!;
    out.push({ x: g.xs[node]!, y: g.ys[node]! });
    cursorX = g.xs[node]!;
    cursorY = g.ys[node]!;
    i = pick + 1;
  }
  if (clearLine(cursorX, cursorY, toX, toY)) out.push({ x: toX, y: toY });
  return out;
}

/**
 * 求一条「沿马路走」的路径（不含起点，末点一定落在 `(toX, toY)` 或图上的最后一个街口）。
 *
 * 返回 `null` 表示这条路网图帮不上忙（起点被墙围住、终点不可达、绕得太远），
 * 调用方应回退到格子 A*。
 */
export function routeViaRoads(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  approach?: { readonly x: number; readonly y: number },
): PathPoint[] | null {
  const g = ensureGraph();
  if (g.xs.length === 0) return null;

  const start = snapNode(g, fromX, fromY);
  if (start < 0) return null;

  /**
   * 终点不吸附「最近的节点」，而是取 `图上代价 + 到目标的直线` 最小的那个节点。
   *
   * 室内目标的到达点在墙里，任何节点都看不到它；这时最近节点可能是楼背后
   * 隔着一堵墙的那个（企业区目标会被吸到游乐大街上），必须按「走过去的代价」
   * 挑门口，尾段再交给 A*。
   */
  const { best, previous } = dijkstra(g, start);
  let goal = -1;
  let goalCost = Number.POSITIVE_INFINITY;
  for (let i = 0; i < g.xs.length; i += 1) {
    if (!Number.isFinite(best[i]!)) continue;
    const tail = Math.hypot(g.xs[i]! - toX, g.ys[i]! - toY);
    // 尾段看不见目标时加一笔惩罚：否则「直线距离近但隔着一堵墙」的节点
    // （企业区目标会被游乐大街西端抢走）会赢得竞争。
    // 给了 `approach`（目标所在大区的区门）时，惩罚换成「离区门多远」——
    // 进屋本来就得先到门口，这一笔恰好挑出门口那个节点
    const penalty = clearLine(g.xs[i]!, g.ys[i]!, toX, toY)
      ? 0
      : approach
        ? Math.hypot(g.xs[i]! - approach.x, g.ys[i]! - approach.y)
        : TAIL_BLOCK_PENALTY;
    const cost = best[i]! + tail + penalty;
    if (cost >= goalCost) continue;
    goalCost = cost;
    goal = i;
  }
  if (goal < 0) return null;

  const nodes = reconstruct(g, start, goal, previous);
  if (!nodes) return null;

  const points = stringPull(g, fromX, fromY, nodes, toX, toY);
  if (points.length === 0) return null;

  // 绕得太离谱（例如起点在湖对岸、图上要兜一大圈）就不如交给 A*
  const straight = Math.hypot(toX - fromX, toY - fromY);
  let length = Math.hypot(points[0]!.x - fromX, points[0]!.y - fromY);
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  if (length > straight * DETOUR_FACTOR + DETOUR_SLACK) return null;

  return points;
}
