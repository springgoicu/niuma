/**
 * 节日装饰布点（ADR-0063）：纯数据、纯函数，不依赖 Pixi，可直接在 `bun:test` 里断言。
 *
 * 三条纪律：
 * 1. **不写第二份坐标**：跨路彩旗从 `WORLD_LAYOUT.props` 的路灯两两配对派生，
 *    树梢灯笼从 `WORLD_LAYOUT.looseTrees` 与道路中心线派生，门楣彩旗从门柱挂点派生；
 * 2. **确定性**：不使用 `Math.random()`，需要「稀疏一点」的地方用位置哈希取模，
 *    同一份世界布局在任何设备上算出的锚点完全一致；
 * 3. **纯装饰**：不产生碰撞、不进协议、不写 `localStorage`，玩家可以穿过任何一条彩旗。
 *
 * 坐标约定：`x/y` 是装饰的挂点（世界纹素，已取整）；`toX/toY` 只给跨路彩旗，
 * 表示另一个灯头；`depthY` 是进 `SortLayer` 的深度键，与树冠、角色共用遮挡关系。
 */

import {
  DOOR_LANTERN_POSTS,
  PLAZA_CENTER,
  PLAZA_RADIUS,
  WORLD_LAYOUT,
  isOnLand,
  isWaterAt,
  type PropInstance,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import { LANTERN_LIGHT } from './lighting/lanterns';

export type FestivalAnchorKind =
  | 'plaza-bunting'
  | 'road-bunting'
  | 'gate-bunting'
  | 'tree-lantern';

export interface FestivalAnchor {
  readonly kind: FestivalAnchorKind;
  /** 挂点横坐标（世界纹素，整数） */
  readonly x: number;
  /** 挂点纵坐标（世界纹素，整数）；跨路彩旗是左端 / 上端 */
  readonly y: number;
  /** 跨路彩旗的另一端；门楣与树梢灯笼为 undefined */
  readonly toX?: number;
  readonly toY?: number;
  /** 进 y 排序层的深度键 */
  readonly depthY: number;
  /** 配色与飘动相位变体 */
  readonly variant: 0 | 1 | 2;
  /** 是否接入真实光池：全园恰好 6 处，其余只画自发光像素 */
  readonly lit: boolean;
}

/** 一对路灯之间的跨路彩旗长度：全部成对灯柱的间距都是 232，贴图只烘一档 */
export const BUNTING_LAMP_GAP = 232;
/** 灯头相对灯柱脚底的 y 偏移；与 `scene-lights.ts` 的灯头光心同一约定 */
export const BUNTING_HANG_DY = 38;
/** 门楣彩旗挂在门线上方 76px：越过门洞上沿，又不会挡住门牌 */
export const GATE_BUNTING_HANG_DY = 76;
/** 树梢灯笼挂在树冠下三分之一 */
export const TREE_LANTERN_HANG_DY = 44;
/** 全园只点亮 6 条彩旗：4 条广场四向 + 南北入口各 1 条 */
export const FESTIVAL_LIGHT_COUNT = 6;

const LAMP_PAIR_MIN_GAP = 140;
const LAMP_PAIR_MAX_GAP = 300;
const LAMP_ALIGN_TOLERANCE = 8;
/** 成对路灯的中点必须落在道路上：允许离中心线半个路宽再多 30px */
const PAIR_PATH_SLACK = 30;
/** 广场彩旗的判定半径：四向内圈的中点距圆心 382 */
const PLAZA_BUNTING_RADIUS = PLAZA_RADIUS + 80;
/** 树梢灯笼只挑「贴着路边」的散树：林荫道树心固定落在半路宽 + 96 */
const TREE_PATH_MIN = 20;
const TREE_PATH_MAX = 104;
/** 每隔一棵挂一串：林荫道读得出「沿途布置过」，又不至于变成整片灯会 */
const TREE_HIT_MOD = 2;

/**
 * `?festival=0` 关闭整层；`?festival=1` 强制开启（验收用）；非法值一律回落为开启。
 * 与 `?light=0` / `?snow=0` / `?season=off` 同一套灰度惯例。
 */
export function readFestivalEnabled(search: string): boolean {
  const raw = new URLSearchParams(search).get('festival');
  if (raw === null) return true;
  const value = raw.trim().toLowerCase();
  if (value === '0' || value === 'off' || value === 'false' || value === '关') return false;
  return true;
}

/** 位置哈希：只用于「稀疏/配色」这类可重复的决策，不参与可行走区域判定 */
function hash2(x: number, y: number): number {
  return (Math.imul(x, 2654435761) ^ Math.imul(y, 2246822519)) >>> 0;
}

function segmentDistanceSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * clamped;
  const cy = ay + dy * clamped;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** 点到最近一条道路中心线的距离与那条路的半宽 */
function nearestPath(x: number, y: number): { distance: number; halfWidth: number } | undefined {
  let bestSq = Number.POSITIVE_INFINITY;
  let bestHalfWidth = 0;
  for (const path of WORLD_LAYOUT.paths) {
    const points = path.centerline;
    for (let i = 0; i < points.length - 1; i += 1) {
      const from = points[i]!;
      const to = points[i + 1]!;
      const distanceSq = segmentDistanceSq(x, y, from[0], from[1], to[0], to[1]);
      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        bestHalfWidth = path.halfWidth;
      }
    }
  }
  if (!Number.isFinite(bestSq)) return undefined;
  return { distance: Math.sqrt(bestSq), halfWidth: bestHalfWidth };
}

interface LampPair {
  readonly a: PropInstance;
  readonly b: PropInstance;
  readonly horizontal: boolean;
  readonly midX: number;
  readonly midY: number;
}

/**
 * 成对路灯：只认「横平/竖直 + 间距 232 + 中点落在路上」的组合。
 * 南侧庭院的四盏灯间距 420–1360，东/西主路同侧灯柱的 300 间距中点离路心太远，
 * 都会被这三条规则自然排除，不需要再手写一份排除清单。
 */
function lampPairs(): LampPair[] {
  const lamps = WORLD_LAYOUT.props
    .filter((prop) => prop.kind === 'lamp')
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const candidates: LampPair[] = [];
  for (let i = 0; i < lamps.length; i += 1) {
    const a = lamps[i]!;
    for (let j = i + 1; j < lamps.length; j += 1) {
      const b = lamps[j]!;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      let horizontal: boolean;
      if (dy <= LAMP_ALIGN_TOLERANCE && dx >= LAMP_PAIR_MIN_GAP && dx <= LAMP_PAIR_MAX_GAP) {
        horizontal = true;
      } else if (dx <= LAMP_ALIGN_TOLERANCE && dy >= LAMP_PAIR_MIN_GAP && dy <= LAMP_PAIR_MAX_GAP) {
        horizontal = false;
      } else {
        continue;
      }
      const midX = Math.round((a.x + b.x) / 2);
      const midY = Math.round((a.y + b.y) / 2);
      const path = nearestPath(midX, midY);
      if (!path || path.distance > path.halfWidth + PAIR_PATH_SLACK) continue;
      candidates.push({ a, b, horizontal, midX, midY });
    }
  }

  // 先挑最接近 232 的对称配对，再按位置排序：结果与数组遍历顺序无关
  candidates.sort((left, right) => {
    const gapLeft = Math.abs(Math.abs(left.a.x - left.b.x) - BUNTING_LAMP_GAP);
    const gapRight = Math.abs(Math.abs(right.a.x - right.b.x) - BUNTING_LAMP_GAP);
    return gapLeft - gapRight || left.midY - right.midY || left.midX - right.midX;
  });

  const used = new Set<string>();
  const pairs: LampPair[] = [];
  for (const candidate of candidates) {
    const keyA = `${candidate.a.x},${candidate.a.y}`;
    const keyB = `${candidate.b.x},${candidate.b.y}`;
    if (used.has(keyA) || used.has(keyB)) continue;
    used.add(keyA);
    used.add(keyB);
    pairs.push(candidate);
  }
  pairs.sort((left, right) => left.midY - right.midY || left.midX - right.midX);
  return pairs;
}

function pairAnchors(): FestivalAnchor[] {
  const anchors: FestivalAnchor[] = [];
  for (const pair of lampPairs()) {
    const ax = pair.a.x;
    const ay = pair.a.y - BUNTING_HANG_DY;
    const bx = pair.b.x;
    const by = pair.b.y - BUNTING_HANG_DY;
    const dx = pair.midX - PLAZA_CENTER.x;
    const dy = pair.midY - PLAZA_CENTER.y;
    const onPlaza = dx * dx + dy * dy <= PLAZA_BUNTING_RADIUS * PLAZA_BUNTING_RADIUS;
    anchors.push({
      kind: onPlaza ? 'plaza-bunting' : 'road-bunting',
      x: pair.horizontal ? Math.min(ax, bx) : ax,
      y: pair.horizontal ? ay : Math.min(ay, by),
      toX: pair.horizontal ? Math.max(ax, bx) : bx,
      toY: pair.horizontal ? by : Math.max(ay, by),
      depthY: Math.max(pair.a.y, pair.b.y),
      variant: (hash2(pair.midX, pair.midY) >>> 3) % 3 as 0 | 1 | 2,
      lit: false,
    });
  }
  return anchors;
}

/**
 * 门楣彩旗：卫生间没有门架，按门洞中心（= 东侧门柱再向左 30px）
 * 补一条等宽的短彩旗，视觉上仍是「门楣一串彩」。
 *
 * 其余场所入口只有小门牌、没有横梁可挂，不挂门楣彩旗。
 */
function gateAnchors(): FestivalAnchor[] {
  const anchors: FestivalAnchor[] = [];
  const restroom = DOOR_LANTERN_POSTS.at(-1);
  if (restroom) {
    anchors.push({
      kind: 'gate-bunting',
      x: restroom.x - 30,
      y: restroom.depthY - GATE_BUNTING_HANG_DY,
      depthY: restroom.depthY,
      variant: (hash2(restroom.x, restroom.depthY) >>> 4) % 2 as 0 | 1,
      lit: false,
    });
  }
  return anchors;
}

/** 是否落在任何碰撞体里：贴墙树不挂灯笼，避免「红灯长在墙里」 */
function insideSolid(x: number, y: number, pad: number): boolean {
  for (const solid of WORLD_LAYOUT.solids) {
    if (
      x >= solid.x - pad &&
      x <= solid.x + solid.w + pad &&
      y >= solid.y - pad &&
      y <= solid.y + solid.h + pad
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 树梢灯笼：只挑离主路中心线「一个路宽多一点」的散树（林荫道正好落在这个带里），
 * 再按位置哈希隔一棵挂一串，读成「沿途都布置过」，而不是整片灯会。
 */
function treeAnchors(): FestivalAnchor[] {
  const anchors: FestivalAnchor[] = [];
  for (const tree of WORLD_LAYOUT.looseTrees) {
    if (!isOnLand(tree.x, tree.y, 8) || isWaterAt(tree.x, tree.y)) continue;
    const path = nearestPath(tree.x, tree.y);
    if (!path) continue;
    if (path.distance < path.halfWidth + TREE_PATH_MIN || path.distance > path.halfWidth + TREE_PATH_MAX) {
      continue;
    }
    const hash = hash2(tree.x, tree.y);
    if (hash % TREE_HIT_MOD !== 0) continue;
    const y = tree.y - TREE_LANTERN_HANG_DY;
    if (insideSolid(tree.x, y, 6)) continue;
    anchors.push({
      kind: 'tree-lantern',
      x: tree.x,
      y,
      depthY: y,
      variant: ((hash >>> 8) % 2) as 0 | 1,
      lit: false,
    });
  }
  anchors.sort((left, right) => left.y - right.y || left.x - right.x);
  return anchors;
}

/** 广场四向全亮；南北入口各点一条，合计 6 条 —— 正好是光池预算里留给节日的那一份 */
function markLights(anchors: FestivalAnchor[]): FestivalAnchor[] {
  const roads = anchors
    .filter((anchor) => anchor.kind === 'road-bunting')
    .sort((left, right) => left.depthY - right.depthY || left.x - right.x);
  const north = roads[0];
  const south = roads[roads.length - 1];
  return anchors.map((anchor) => {
    if (anchor.kind === 'plaza-bunting') return { ...anchor, lit: true };
    if (anchor === north || anchor === south) return { ...anchor, lit: true };
    return anchor;
  });
}

/** 整座园区的节日装饰计划：顺序稳定，同输入永远得到同一份输出 */
export function festivalDecorPlan(): readonly FestivalAnchor[] {
  return [...markLights(pairAnchors()), ...gateAnchors(), ...treeAnchors()];
}

/**
 * 6 处真实光池：光心落在彩旗中央那串小灯正下方的地面，
 * 半径 / 颜色 / 抖动全部复用 `LANTERN_LIGHT`，与拱门挂灯同一套口径。
 */
export function festivalLights(plan: readonly FestivalAnchor[]): LightSpec[] {
  const lights: LightSpec[] = [];
  for (const anchor of plan) {
    if (!anchor.lit) continue;
    const x = anchor.toX === undefined ? anchor.x : Math.round((anchor.x + anchor.toX) / 2);
    // 光心落在彩旗中央那盏灯的地面投影：横挂时就是灯柱脚底那条线，
    // 竖挂时取两端挂点的中点再补回灯头高度，不能直接用 depthY（那是下端灯柱）。
    const minHangY = Math.min(anchor.y, anchor.toY ?? anchor.y);
    const maxHangY = Math.max(anchor.y, anchor.toY ?? anchor.y);
    lights.push({
      x,
      y: Math.round((minHangY + maxHangY) / 2) + BUNTING_HANG_DY - 6,
      radius: LANTERN_LIGHT.radius,
      color: LANTERN_LIGHT.color,
      intensity: LANTERN_LIGHT.intensity,
      flicker: LANTERN_LIGHT.flicker,
    });
  }
  return lights;
}
