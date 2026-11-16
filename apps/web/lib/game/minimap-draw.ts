import {
  APARTMENT_SPECS,
  BOSS_ARENA,
  CLINIC_RECT,
  DICE_HALL,
  DISTRICTS,
  ISLAND,
  RING_ARENA,
  WORLD_CENTER,
  WORLD_LAYOUT,
  type DistrictId,
  type Point,
  type TreeInstance,
  type WorldRect,
} from '@niuma/shared-types';
import { MINIMAP_COLORS as M } from './terrain-palette';

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
/** 画布正好覆盖 AOI 视野半径，地形与玩家共用同一套世界变换（与 shared-types 的 VIEW_RADIUS 同步） */
const VIEW_RADIUS = 1000;
const SCALE = MINIMAP_SIZE / (VIEW_RADIUS * 2);

/** 2D 上下文：主线程是 CanvasRenderingContext2D，渲染线程是 Offscreen 版本 */
export type MiniMapContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface MinimapFrame {
  x: number;
  y: number;
  region: string;
  points: ReadonlyArray<{ x: number; y: number; self: boolean }>;
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

/** 核心场所：7 处「新人第一眼要找」的地标（顺序即绘制顺序，后画的压在上面） */
export const MINIMAP_VENUE_MARKS: ReadonlyArray<MiniMapMark> = [
  markAt(BOSS_ARENA, 'corporate'),
  markAt(DICE_HALL, 'amusement'),
  markAt(RING_ARENA, 'amusement'),
  markAt(CLINIC_RECT, 'service'),
  markAt(buildingRect('卫生间'), 'service'),
  markAt(buildingRect('小黑屋'), 'service'),
  markAt(APARTMENT_SPECS[0]!.rect, 'living'),
];

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

/** 树只画 1px 点：树丛是几粒聚在一起，孤树则是草地里的一粒深绿 */
function drawTreeDots(
  ctx: MiniMapContext,
  trees: readonly TreeInstance[],
  camX: number,
  camY: number,
  color: string,
): void {
  ctx.fillStyle = color;
  const reach = VIEW_RADIUS + 80;
  for (let i = 0; i < trees.length; i += 1) {
    const tree = trees[i]!;
    if (Math.abs(tree.x - camX) > reach || Math.abs(tree.y - camY) > reach) continue;
    ctx.fillRect(screenX(tree.x, camX), screenY(tree.y, camY), 1, 1);
  }
}

/** 小地图只画布局，不采样主视图：形状少、4Hz，绘制成本可以忽略 */
function drawTerrain(ctx: MiniMapContext, camX: number, camY: number): void {
  // 整块画布先铺密林：边界外的视野就是林墙，不能再露出 HUD 底色（ADR-0064）
  ctx.fillStyle = M.wild;
  ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  // 陆地是矩形：直接描四条边，沙色描边就是边界沙带
  const { x, y, w, h } = ISLAND.bounds;
  ctx.fillStyle = M.ground;
  fillWorldRect(ctx, { x, y, w, h }, camX, camY);
  ctx.strokeStyle = M.shore;
  ctx.lineWidth = 2;
  ctx.strokeRect(screenX(x, camX), screenY(y, camY), span(w), span(h));
  ctx.lineWidth = 1;

  // 树丛只铺一小片柔和底色，不再画整块「加班林」矩形
  ctx.fillStyle = M.forest;
  for (const grove of WORLD_LAYOUT.groves) {
    ctx.beginPath();
    ctx.arc(screenX(grove.x, camX), screenY(grove.y, camY), span(grove.radius), 0, Math.PI * 2);
    ctx.fill();
  }

  // 花海：亮一档的草色块 + 三粒该花田配色的花点，20px 内也能和普通草地分开
  for (const field of WORLD_LAYOUT.flowerFields) {
    ctx.fillStyle = M.meadow;
    fillWorldRect(ctx, field.rect, camX, camY);
    ctx.fillStyle = field.palette === 0 ? M.flowerWhite : field.palette === 1 ? M.flowerGold : M.flowerRose;
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

/**
 * 画一帧小地图。调用方负责 `prepareMiniMap()` 与画布已挂载；
 * 这里只做「一帧」的事，不持有任何状态。
 */
export function drawMiniMap(ctx: MiniMapContext, frame: MinimapFrame): void {
  const camX = frame.x;
  const camY = frame.y;
  drawTerrain(ctx, camX, camY);

  // 核心场所：发泄区 / 赌场 / 擂台 / 急救站 / 卫生间 / 小黑屋 / 公寓
  for (const mark of MINIMAP_VENUE_MARKS) drawMark(ctx, mark, camX, camY, 2);

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
