import {
  APARTMENT_SPECS,
  BOSS_ARENA,
  CLINIC_RECT,
  DISTRICTS,
  ISLAND,
  NEON_STRIP_PLAZA,
  VIEW_RADIUS,
  VILLA_SPECS,
  WORLD_CENTER,
  WORLD_LAYOUT,
  type DistrictId,
  type Point,
  type TreeInstance,
  type VillaPacket,
  type WorldRect,
} from '@niuma/shared-types';
import { ACTIVITY_TTL_MS } from './activity-feed';
import { MINIMAP_COLORS as M } from './terrain-palette';
import { MINIMAP_TREE_COLORS } from './vegetation-species';

/**
 * 小地图绘制。
 *
 * 从 `MiniMap.tsx` 里搬出来是为了让它能跑在渲染线程：Worker 里没有 React、
 * 也没有主线程的 canvas，只有一块 `OffscreenCanvas` 和一个 2D 上下文。
 * 这里的代码只依赖共享布局与调色板，主线程回退模式下用同一个函数重绘。
 *
 * 可读性靠三层，而不是靠调色：
 * 1. **区色轮廓**：五区薄薄填一层区色 + 1px 同色描边，先读出「这是哪一片」；
 * 2. **道路骨架**：土路照着带状多边形画，再补一道压暗描边，斜向街道不会糊成方块；
 * 3. **核心场所图标**：发泄区 / 赌场 / 擂台 / 急救站等 8 处各一枚 3px 色块 + 1px 深边，
 *    新人不用记标签也能找到地标。图标表在模块顶层算一次，帧内不再分配。
 */

/** 画布边长（CSS 像素），组件与绘制共用 */
export const MINIMAP_SIZE = 168;
const SCALE = MINIMAP_SIZE / (VIEW_RADIUS * 2);

/** 2D 上下文：主线程是 CanvasRenderingContext2D，渲染线程是 Offscreen 版本 */
export type MiniMapContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 小地图事件标记：`tier` 0 强演出 / 1 生活 / 2 常规，`age` 为收到后毫秒数 */
export interface MinimapEvent {
  x: number;
  y: number;
  tier: number;
  age: number;
}

export interface MinimapFrame {
  x: number;
  y: number;
  region: string;
  points: ReadonlyArray<{ x: number; y: number; self: boolean }>;
  /** 全园区播报事件（ADR-0112）：视野内脉冲、视野外贴边箭头 */
  events?: ReadonlyArray<MinimapEvent>;
  /** 8 处房产归属态：直接绘制三态屋标（我的 / 他人 / 待售） */
  villas?: ReadonlyArray<VillaPacket>;
  /** 载具小地图点（x, y, occupied） */
  vehicles?: ReadonlyArray<{ x: number; y: number; occupied: boolean }>;
  /** 高星通缉嫌疑人坐标 */
  wanted?: ReadonlyArray<{ x: number; y: number; stars: number }>;
  /** 零工交付目标坐标 */
  gigTarget?: { x: number; y: number } | null;
  /** 涂鸦领地归属点（ownerId=0 无主） */
  turf?: ReadonlyArray<{ x: number; y: number; owned: boolean }>;
}

/* ------------------------------------------------------------------ *
 * 预计算常量：帧循环里一个对象、一个字符串都不再新建
 * ------------------------------------------------------------------ */

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** 区色字符串：模块加载时算一次，帧内不再拼 `#rrggbb` */
const DISTRICT_FILL = new Map<DistrictId, string>();
for (const district of DISTRICTS) DISTRICT_FILL.set(district.id, css(district.color));

/** 花海里的三粒花点（相对包围盒的比例）：原本每帧 new 一次数组 */
const FLOWER_DOTS: ReadonlyArray<readonly [number, number]> = [
  [0.32, 0.38],
  [0.56, 0.52],
  [0.44, 0.7],
];

interface MiniMapMark {
  readonly x: number;
  readonly y: number;
  readonly fill: string;
  readonly line: string;
}

/** 核心场所图标从共享布局派生，不写第二份坐标 */
function markAt(rect: WorldRect, district: DistrictId): MiniMapMark {
  return {
    x: Math.round(rect.x + rect.w / 2),
    y: Math.round(rect.y + rect.h / 2),
    fill: DISTRICT_FILL.get(district)!,
    line: M.markInk,
  };
}

/** 按显示名反查房间矩形：卫生间/小黑屋的矩形只从 `buildings` 取，不另写坐标 */
function buildingRect(name: string): WorldRect {
  const found = WORLD_LAYOUT.buildings.find((building) => building.name === name);
  // 取不到就退回原点：测试里的「地标必须在陆地上」会立刻拦下这种静默失败
  return found ? found.rect : { x: 0, y: 0, w: 0, h: 0 };
}

/** 核心场所：6 处地标 + 房产三态屋标由 drawVillaPins 单独绘制 */
export const MINIMAP_VENUE_MARKS: ReadonlyArray<MiniMapMark> = [
  markAt(BOSS_ARENA, 'corporate'),
  markAt(NEON_STRIP_PLAZA, 'amusement'),
  markAt(CLINIC_RECT, 'service'),
  markAt(buildingRect('卫生间'), 'service'),
  markAt(buildingRect('小黑屋'), 'service'),
  markAt(APARTMENT_SPECS[0]!.rect, 'living'),
];

const VILLA_PIN_OUTLINE = '#2a3142';
const VILLA_PIN_MINE = '#f2c879';
const VILLA_PIN_OTHER = '#38bdf8';
const VILLA_PIN_FREE = '#e6dec8';

/** 按 DPR 出图，否则 1px 围栏线在 2x 屏上会糊成两像素灰边 */
export function prepareMiniMap(ctx: MiniMapContext, dpr: number): void {
  const ratio = Math.min(Math.max(dpr, 1), 2);
  const canvas = ctx.canvas;
  const size = Math.round(MINIMAP_SIZE * ratio);
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function screenX(worldX: number, camX: number): number {
  return Math.round((worldX - camX) * SCALE + MINIMAP_SIZE / 2);
}

function screenY(worldY: number, camY: number): number {
  return Math.round((worldY - camY) * SCALE + MINIMAP_SIZE / 2);
}

function span(length: number): number {
  return Math.max(1, Math.round(length * SCALE));
}

function fillWorldRect(ctx: MiniMapContext, rect: WorldRect, camX: number, camY: number): void {
  ctx.fillRect(screenX(rect.x, camX), screenY(rect.y, camY), span(rect.w), span(rect.h));
}

function traceWorldPolygon(ctx: MiniMapContext, points: readonly Point[], camX: number, camY: number): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    const px = screenX(point[0], camX);
    const py = screenY(point[1], camY);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 按物种分色画树：标准树 1px、地标古树 3×3 亮点带墨框，零分配 */
function drawTreeDots(
  ctx: MiniMapContext,
  trees: readonly TreeInstance[],
  camX: number,
  camY: number,
  fallback: string,
): void {
  const reach = VIEW_RADIUS + 80;
  let lastFill = '';
  for (let i = 0; i < trees.length; i += 1) {
    const tree = trees[i]!;
    if (Math.abs(tree.x - camX) > reach || Math.abs(tree.y - camY) > reach) continue;
    const sx = screenX(tree.x, camX);
    const sy = screenY(tree.y, camY);
    const fill = MINIMAP_TREE_COLORS[tree.species] ?? fallback;
    if (tree.scale === 1) {
      ctx.fillStyle = M.markInk;
      ctx.fillRect(sx - 2, sy - 2, 5, 5);
      ctx.fillStyle = fill;
      ctx.fillRect(sx - 1, sy - 1, 3, 3);
      lastFill = fill;
      continue;
    }
    if (fill !== lastFill) {
      ctx.fillStyle = fill;
      lastFill = fill;
    }
    ctx.fillRect(sx, sy, 1, 1);
  }
}

/** 小地图只画布局，不采样主视图：形状少、4Hz，绘制成本可以忽略 */
function drawTerrain(ctx: MiniMapContext, camX: number, camY: number): void {
  // 整块画布先铺密林：边界外的视野就是林墙，不能再露出 HUD 底色（ADR-0064）
  ctx.fillStyle = M.wild;
  ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  // 29 顶点有机岛屿与海岸沙滩轮廓
  ctx.fillStyle = M.ground;
  traceWorldPolygon(ctx, ISLAND.points, camX, camY);
  ctx.fill();
  ctx.strokeStyle = M.shore;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineWidth = 1;

  // 树丛只铺一小片柔和底色
  ctx.fillStyle = M.forest;
  for (const grove of WORLD_LAYOUT.groves) {
    ctx.beginPath();
    ctx.arc(screenX(grove.x, camX), screenY(grove.y, camY), span(grove.radius), 0, Math.PI * 2);
    ctx.fill();
  }

  // 花海：四色花点（白雏菊 / 金盏 / 暖粉 / 熏衣草），帧内零分配
  for (const field of WORLD_LAYOUT.flowerFields) {
    ctx.fillStyle = M.meadow;
    fillWorldRect(ctx, field.rect, camX, camY);
    ctx.fillStyle =
      field.palette === 0
        ? M.flowerWhite
        : field.palette === 1
          ? M.flowerGold
          : field.palette === 2
            ? M.flowerRose
            : M.flowerLavender;
    for (let i = 0; i < FLOWER_DOTS.length; i += 1) {
      const dot = FLOWER_DOTS[i]!;
      ctx.fillRect(
        screenX(field.rect.x + field.rect.w * dot[0], camX),
        screenY(field.rect.y + field.rect.h * dot[1], camY),
        2,
        2,
      );
    }
  }

  // 放射状土路：按带状多边形画，斜向路不会变成方块
  for (const path of WORLD_LAYOUT.paths) {
    traceWorldPolygon(ctx, path.polygon, camX, camY);
    ctx.fillStyle = M.dirt;
    ctx.fill();
    // 压暗描边：0.084 的缩放下一条 112px 的路只剩 9px，
    // 描边让「路网骨架」在五区色块之上仍然读得出来（ADR-0097 的放射状路网）
    ctx.strokeStyle = M.dirtEdge;
    ctx.stroke();
  }

  // 中央石砖圆庭：浅石色圆 + 深缝描边（ADR-0047）
  ctx.fillStyle = M.stone;
  ctx.beginPath();
  ctx.arc(
    screenX(WORLD_CENTER.x, camX),
    screenY(WORLD_CENTER.y, camY),
    span(WORLD_LAYOUT.plazaRadius),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.strokeStyle = M.plazaCurb;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = M.water;
  for (const lake of WORLD_LAYOUT.lakes) {
    traceWorldPolygon(ctx, lake.points, camX, camY);
    ctx.fill();
  }

  ctx.strokeStyle = M.sand;
  for (const lake of WORLD_LAYOUT.lakes) {
    traceWorldPolygon(ctx, lake.points, camX, camY);
    ctx.stroke();
  }

  // 研发园：铺装庭院与室内空间，颜色沿用路缘色以免小地图出现新色系
  ctx.fillStyle = M.plazaCurb;
  for (const area of WORLD_LAYOUT.paved) fillWorldRect(ctx, area, camX, camY);
  for (const building of WORLD_LAYOUT.buildings) fillWorldRect(ctx, building.rect, camX, camY);

  for (const grove of WORLD_LAYOUT.groves) drawTreeDots(ctx, grove.trees, camX, camY, M.forestDot);
  drawTreeDots(ctx, WORLD_LAYOUT.looseTrees, camX, camY, M.forestDot);

  // 五区（ADR-0097）：0.10 填色 + 1px 同色描边。
  // 旧版是 0.18 的纯填色、没有轮廓，五块地会糊成一团灰蒙；
  // 描边让「这是哪一片」在缩略图上也成立，填色压薄后建筑与树点又能透出来。
  for (const district of DISTRICTS) {
    ctx.fillStyle = DISTRICT_FILL.get(district.id)!;
    ctx.globalAlpha = 0.1;
    for (const rect of district.rects) fillWorldRect(ctx, rect, camX, camY);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = DISTRICT_FILL.get(district.id)!;
    for (const rect of district.rects) {
      ctx.strokeRect(screenX(rect.x, camX) + 0.5, screenY(rect.y, camY) + 0.5, span(rect.w), span(rect.h));
    }
  }
}

/** 一枚 3px 地标：1px 深边 + 1px 亮芯，保证在任何底色上都读得出来 */
function drawMark(ctx: MiniMapContext, mark: MiniMapMark, camX: number, camY: number, size: number): void {
  const x = screenX(mark.x, camX);
  const y = screenY(mark.y, camY);
  if (x < -size || y < -size || x > MINIMAP_SIZE + size || y > MINIMAP_SIZE + size) return;
  ctx.fillStyle = mark.line;
  ctx.fillRect(x - size, y - size, size * 2 + 1, size * 2 + 1);
  ctx.fillStyle = mark.fill;
  ctx.fillRect(x - size + 1, y - size + 1, size * 2 - 1, size * 2 - 1);
}

/** 事件标记寿命：与客户端队列的保留时长一致，过期直接不再画 */
const EVENT_LIFETIME_MS = ACTIVITY_TTL_MS;
/** 分级配色：0 强演出（朱红）/ 1 生活（暖金）/ 2 常规（薄荷） */
const EVENT_COLORS = ['#D64545', '#FFD08A', '#7EE3B4'] as const;

/** 视野外事件贴边内缩：箭头本身就 5px 长，不能顶到画布边缘 */
const EVENT_EDGE_INSET = 6;

export interface EventMarker {
  /** 画布坐标；视野外时为贴边后的位置 */
  px: number;
  py: number;
  /** 是否落在本人视野内：决定画菱形还是贴边箭头 */
  inside: boolean;
  /** 视野外的真实方位角（弧度），视野内为 0 */
  angle: number;
}

/**
 * 把事件的世界坐标投影到小地图：视野内原样，视野外沿中心到事件的射线
 * 钳到画布内缩边缘。抽成纯函数是为了让「贴边不越界 / 角度不反」可测。
 */
export function projectEventMarker(px: number, py: number, size: number = MINIMAP_SIZE): EventMarker {
  if (px >= 0 && px <= size && py >= 0 && py <= size) {
    return { px, py, inside: true, angle: 0 };
  }
  const center = size / 2;
  const dx = px - center;
  const dy = py - center;
  const angle = Math.atan2(dy, dx);
  const scale = (center - EVENT_EDGE_INSET) / Math.max(Math.abs(dx), Math.abs(dy));
  return { px: center + dx * scale, py: center + dy * scale, inside: false, angle };
}

/**
 * 全园区播报的事件层（ADR-0112）。
 *
 * 视野内画菱形 + 每 500ms 一圈脉冲；视野外把点钳到画布边缘内缩 6px，
 * 改成朝真实方位旋转的楔形箭头——远处的人看到「大概在哪个方向」，
 * 不需要把 168px 的画布硬改成全图缩略。
 */
function drawEvents(
  ctx: MiniMapContext,
  events: ReadonlyArray<MinimapEvent>,
  camX: number,
  camY: number,
): void {
  for (const event of events) {
    if (event.age > EVENT_LIFETIME_MS) continue;
    const color = EVENT_COLORS[event.tier] ?? EVENT_COLORS[2];
    const marker = projectEventMarker(screenX(event.x, camX), screenY(event.y, camY));
    const fade = 1 - event.age / EVENT_LIFETIME_MS;
    ctx.globalAlpha = Math.min(1, Math.max(0.25, fade * 1.4));

    if (marker.inside) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(marker.px, marker.py - 3);
      ctx.lineTo(marker.px + 3, marker.py);
      ctx.lineTo(marker.px, marker.py + 3);
      ctx.lineTo(marker.px - 3, marker.py);
      ctx.closePath();
      ctx.fill();

      // 相位按 age 直接算：4Hz 重绘下环会自己扩散，不需要额外状态
      const phase = (event.age % 500) / 500;
      ctx.globalAlpha *= 0.45;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(marker.px, marker.py, 3 + phase * 5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const { px: ex, py: ey, angle } = marker;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(angle) * 5, ey + Math.sin(angle) * 5);
      ctx.lineTo(ex + Math.cos(angle + 2.5) * 4, ey + Math.sin(angle + 2.5) * 4);
      ctx.lineTo(ex + Math.cos(angle - 2.5) * 4, ey + Math.sin(angle - 2.5) * 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * 画一帧小地图。调用方负责 `prepareMiniMap()` 与画布已挂载；
 * 这里只做「一帧」的事，不持有任何状态。
 */
export function drawMiniMap(ctx: MiniMapContext, frame: MinimapFrame): void {
  const camX = frame.x;
  const camY = frame.y;
  drawTerrain(ctx, camX, camY);

  // 核心场所地标 + 8 处房产三态屋标 + 街头涂鸦/载具/零工/通缉
  for (const mark of MINIMAP_VENUE_MARKS) drawMark(ctx, mark, camX, camY, 2);
  drawVillaPins(ctx, frame.villas, camX, camY);
  drawGtaOverlays(ctx, frame, camX, camY);

  // 事件层压在场所图标之上、玩家点之下：玩家永远是最上层
  if (frame.events && frame.events.length > 0) drawEvents(ctx, frame.events, camX, camY);

  const points = frame.points;
  ctx.fillStyle = M.other;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    if (point.self) continue;
    ctx.fillRect(screenX(point.x, camX) - 1, screenY(point.y, camY) - 1, 2, 2);
  }

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    if (!point.self) continue;
    const px = screenX(point.x, camX);
    const py = screenY(point.y, camY);
    ctx.fillStyle = '#1b1611';
    ctx.fillRect(px - 2, py - 2, 5, 5);
    ctx.fillStyle = M.self;
    ctx.fillRect(px - 1, py - 1, 3, 3);
  }
}

/** 8 处房产的小地图 5x5 像素屋标：金=我的 / 青=他人 / 米=待售 */
function drawVillaPins(
  ctx: MiniMapContext,
  villas: ReadonlyArray<VillaPacket> | undefined,
  camX: number,
  camY: number,
): void {
  for (let i = 0; i < VILLA_SPECS.length; i += 1) {
    const spec = VILLA_SPECS[i]!;
    const px = screenX(spec.gate.x, camX);
    const py = screenY(spec.gate.y, camY);
    if (px < -4 || py < -4 || px > MINIMAP_SIZE + 4 || py > MINIMAP_SIZE + 4) continue;

    let fill = VILLA_PIN_FREE;
    if (villas) {
      for (let j = 0; j < villas.length; j += 1) {
        const v = villas[j]!;
        if (v.id === spec.id) {
          fill = v.mine ? VILLA_PIN_MINE : v.owned ? VILLA_PIN_OTHER : VILLA_PIN_FREE;
          break;
        }
      }
    }
    ctx.fillStyle = VILLA_PIN_OUTLINE;
    ctx.fillRect(px - 2, py - 2, 5, 5);
    ctx.fillStyle = fill;
    ctx.fillRect(px - 1, py - 1, 3, 3);
    ctx.fillRect(px, py - 3, 1, 1);
  }
}

function drawGtaOverlays(
  ctx: MiniMapContext,
  frame: MinimapFrame,
  camX: number,
  camY: number,
): void {
  const turf = frame.turf;
  if (turf) {
    for (let i = 0; i < turf.length; i += 1) {
      const t = turf[i]!;
      const px = screenX(t.x, camX);
      const py = screenY(t.y, camY);
      if (px < -2 || py < -2 || px > MINIMAP_SIZE + 2 || py > MINIMAP_SIZE + 2) continue;
      ctx.fillStyle = t.owned ? '#f2c879' : '#64748b';
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  const vehicles = frame.vehicles;
  if (vehicles) {
    for (let i = 0; i < vehicles.length; i += 1) {
      const v = vehicles[i]!;
      const px = screenX(v.x, camX);
      const py = screenY(v.y, camY);
      if (px < -3 || py < -3 || px > MINIMAP_SIZE + 3 || py > MINIMAP_SIZE + 3) continue;
      ctx.fillStyle = '#2a3142';
      ctx.fillRect(px - 2, py - 2, 4, 4);
      ctx.fillStyle = v.occupied ? '#ffd166' : '#4fe3c1';
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  const wanted = frame.wanted;
  if (wanted) {
    for (let i = 0; i < wanted.length; i += 1) {
      const w = wanted[i]!;
      if (w.stars <= 0) continue;
      const px = screenX(w.x, camX);
      const py = screenY(w.y, camY);
      if (px < -4 || py < -4 || px > MINIMAP_SIZE + 4 || py > MINIMAP_SIZE + 4) continue;
      ctx.fillStyle = '#2a3142';
      ctx.fillRect(px - 3, py - 3, 6, 6);
      ctx.fillStyle = '#e05252';
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
  }

  const gig = frame.gigTarget;
  if (gig) {
    const marker = projectEventMarker(screenX(gig.x, camX), screenY(gig.y, camY));
    ctx.fillStyle = '#ffb703';
    ctx.fillRect(marker.px - 2, marker.py - 2, 5, 5);
  }
}
