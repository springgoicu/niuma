import { ISLAND, WORLD_CENTER, WORLD_LAYOUT, type Point, type TreeInstance, type WorldRect } from '@niuma/shared-types';
import { MINIMAP_COLORS as M } from './terrain-palette';

/**
 * 小地图绘制。
 *
 * 从 `MiniMap.tsx` 里搬出来是为了让它能跑在渲染线程：Worker 里没有 React、
 * 也没有主线程的 canvas，只有一块 `OffscreenCanvas` 和一个 2D 上下文。
 * 这里的代码只依赖共享布局与调色板，主线程回退模式下用同一个函数重绘。
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
  points.forEach(([x, y], index) => {
    const px = screenX(x, camX);
    const py = screenY(y, camY);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
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
  for (const tree of trees) {
    if (Math.abs(tree.x - camX) > reach || Math.abs(tree.y - camY) > reach) continue;
    ctx.fillRect(screenX(tree.x, camX), screenY(tree.y, camY), 1, 1);
  }
}

/** 小地图只画布局，不采样主视图：形状少、4Hz，绘制成本可以忽略 */
function drawTerrain(ctx: MiniMapContext, camX: number, camY: number): void {
  // 整块画布先铺海：岛外的视野就是海，不能再露出 HUD 底色
  ctx.fillStyle = M.sea;
  ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  ctx.fillStyle = M.ground;
  traceWorldPolygon(ctx, ISLAND.points, camX, camY);
  ctx.fill();
  ctx.strokeStyle = M.shore;
  ctx.lineWidth = 2;
  traceWorldPolygon(ctx, ISLAND.points, camX, camY);
  ctx.stroke();
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
    const dots: Array<[number, number]> = [
      [0.32, 0.38],
      [0.56, 0.52],
      [0.44, 0.7],
    ];
    for (const [tx, ty] of dots) {
      ctx.fillRect(
        screenX(field.rect.x + field.rect.w * tx, camX),
        screenY(field.rect.y + field.rect.h * ty, camY),
        2,
        2,
      );
    }
  }

  // 放射状土路：按带状多边形画，斜向路不会变成方块
  ctx.fillStyle = M.dirt;
  for (const path of WORLD_LAYOUT.paths) {
    traceWorldPolygon(ctx, path.polygon, camX, camY);
    ctx.fill();
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
}

/**
 * 画一帧小地图。调用方负责 `prepareMiniMap()` 与画布已挂载；
 * 这里只做「一帧」的事，不持有任何状态。
 */
export function drawMiniMap(ctx: MiniMapContext, frame: MinimapFrame): void {
  const camX = frame.x;
  const camY = frame.y;
  drawTerrain(ctx, camX, camY);

  const points = frame.points;
  ctx.fillStyle = M.other;
  for (const point of points) {
    if (point.self) continue;
    ctx.fillRect(screenX(point.x, camX) - 1, screenY(point.y, camY) - 1, 2, 2);
  }

  for (const point of points) {
    if (!point.self) continue;
    const px = screenX(point.x, camX);
    const py = screenY(point.y, camY);
    ctx.fillStyle = '#1b1611';
    ctx.fillRect(px - 2, py - 2, 5, 5);
    ctx.fillStyle = M.self;
    ctx.fillRect(px - 1, py - 1, 3, 3);
  }
}
