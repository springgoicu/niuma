'use client';

import { Graphics, Rectangle, Texture, type Application } from 'pixi.js';
import { bake } from './terrain-textures';

/**
 * 园区小动物与蝴蝶的像素图集。
 *
 * 为什么不用玩家那套 `packages/pixel-assets`：角色图集是 64×64 帧、34 列、九层灰度 tint，
 * 为的是换色与配件；园区地面动物只保留兔子，只需要「一眼认出兔子 + 换三套配色」，
 * 走那套管线等于让 `pnpm assets` 重新生成一整个 manifest、还要双端重发版（ADR-0042）。
 *
 * 纪律与地形/道具一致（ADR-0005 / ADR-0013）：
 * - 一张图集、一次 `generateTexture`，运行期不再生成纹理；
 * - 32px 格、1:1、nearest，脚底线固定在 y=29，锚点与 SortLayer 的「脚底即深度」对齐；
 * - 只画硬像素矩形与整数半径的圆斑，不出现曲线细分与半像素；
 * - 接触阴影直接烘进帧里，不为一只小动物多挂一个精灵。
 */

type TextureFactory = Application['renderer'];

export const CRITTER_CELL = 32;
/** 脚底线：帧内像素坐标。28 是最后一排脚掌像素，29 预留 1px 给接触阴影的下沿 */
export const CRITTER_FEET = 29;
export const CRITTER_COLUMNS = 12;
/**
 * 地面动物只保留兔子：3 配色 × 3 视图 × 5 帧 = 45 格，
 * 加蝴蝶 6 + 小鱼 6 = 57 格；12×5=60 格，留 3 格空位。
 */
export const CRITTER_ROWS = 5;
const COLUMNS = CRITTER_COLUMNS;
const ROWS = CRITTER_ROWS;
const SHEET_W = COLUMNS * CRITTER_CELL;
const SHEET_H = ROWS * CRITTER_CELL;

/** 0 正面 / 1 侧面 / 2 背面。侧面永远朝右，朝左靠 `scale.x = -1` 镜像 */
export const CRITTER_VIEW_DOWN = 0;
export const CRITTER_VIEW_SIDE = 1;
export const CRITTER_VIEW_UP = 2;
export const GROUND_VIEWS = 3;

/**
 * 0 坐姿抬头 / 1 坐姿抖耳眨眼 / 2 坐姿低头啃草 / 3 走 A / 4 走 B。
 * 兔子待机时全部用坐姿帧，行走 / 逃跑才切站立行走帧。
 */
export const FRAME_IDLE = 0;
export const FRAME_SIT_B = 1;
export const FRAME_GRAZE = 2;
export const FRAME_WALK_A = 3;
export const FRAME_WALK_B = 4;
export const GROUND_FRAMES = 5;

const VARIANTS = 3;
const GROUND_CELLS = VARIANTS * GROUND_VIEWS * GROUND_FRAMES;
const BUTTERFLY_BASE = GROUND_CELLS;
export const BUTTERFLY_VARIANTS = 3;
export const BUTTERFLY_FRAMES = 2;
/**
 * 小鱼（ADR-0045）：只占图集最后 6 格（51–56），1 物种 × 3 配色 × 2 帧。
 * 3 配色共用一张剪影，靠镜像转向。
 */
const FISH_BASE = BUTTERFLY_BASE + BUTTERFLY_VARIANTS * BUTTERFLY_FRAMES;
export const FISH_VARIANTS = 3;
export const FISH_FRAMES = 2;

/** 图集格号：配色 × 视图 × 帧，顺序即布局，两端只认这一份常量 */
export function groundCell(variant: number, view: number, frame: number): number {
  return (variant * GROUND_VIEWS + view) * GROUND_FRAMES + frame;
}

export function butterflyCell(variant: number, frame: number): number {
  return BUTTERFLY_BASE + variant * BUTTERFLY_FRAMES + frame;
}

export function fishCell(variant: number, frame: number): number {
  return FISH_BASE + variant * FISH_FRAMES + frame;
}

const INK = 0x2a3142;
/** 阴影是冷靛蓝而不是炭黑：暖色草地上纯黑会把周围的暖调吸掉（与 fx.ts 同一支色） */
const SHADOW = 0x191e3c;

interface Coat {
  body: number;
  /** 一档压暗边：小尺寸下这就是全部的体积感 */
  shade: number;
  /** 腹部 / 口鼻的高光 */
  light: number;
  /** 耳内与鼻头的粉色系点缀 */
  inner: number;
}

/** 兔子三套配色：奶油白 / 燕麦灰 / 焦糖棕；同一套剪影，只换调色板，保持合批 */
const COATS: readonly Coat[] = [
  { body: 0xfdf7ee, shade: 0xded1c0, light: 0xffffff, inner: 0xf3b0b8 },
  { body: 0xd8d3c6, shade: 0xb0a99a, light: 0xeae6dc, inner: 0xefa9b3 },
  { body: 0xc79463, shade: 0x9d7045, light: 0xe4b98c, inner: 0xe8a0a8 },
];

/** 蝴蝶三套：鹅黄 / 樱粉 / 天蓝，一深一浅两种翅膀色 */
const WINGS: ReadonlyArray<{ wing: number; edge: number; spot: number }> = [
  { wing: 0xffd97a, edge: 0xe8a63a, spot: 0xfff6d8 },
  { wing: 0xffb3c9, edge: 0xe07c9c, spot: 0xfff0f4 },
  { wing: 0x9ecfff, edge: 0x5f9fe0, spot: 0xeef7ff },
];

/** 小鱼三套：青灰 / 金红 / 银白，冷色压过水面纹样，俯视也能一眼认出 */
const FISH_COLORS: ReadonlyArray<{ body: number; shade: number; light: number; fin: number }> = [
  { body: 0x8fc7da, shade: 0x4f7f95, light: 0xd8f2ff, fin: 0xb9e4f2 },
  { body: 0xf0a75c, shade: 0xcd7d38, light: 0xffe3bd, fin: 0xffcf9a },
  { body: 0xe6edf5, shade: 0x9aa8b8, light: 0xffffff, fin: 0xc9d6e4 },
];

export interface CritterArt {
  readonly frames: readonly Texture[];
  destroy(): void;
}

/**
 * 把整张图集画进一个 Graphics。抽成独立函数是为了让单测能用「记录型 Graphics」
 * 验证每一笔都落在自己的 32px 格里——越界会在图集里糊到相邻帧上，是最难肉眼定位的错。
 */
export function paintCritterSheet(g: Graphics): void {
  for (let variant = 0; variant < VARIANTS; variant += 1) {
    for (let view = 0; view < GROUND_VIEWS; view += 1) {
      for (let frame = 0; frame < GROUND_FRAMES; frame += 1) {
        const cell = groundCell(variant, view, frame);
        drawGround(
          g,
          (cell % COLUMNS) * CRITTER_CELL,
          ((cell / COLUMNS) | 0) * CRITTER_CELL,
          COATS[variant]!,
          view,
          frame,
        );
      }
    }
  }
  for (let variant = 0; variant < BUTTERFLY_VARIANTS; variant += 1) {
    for (let frame = 0; frame < BUTTERFLY_FRAMES; frame += 1) {
      const cell = butterflyCell(variant, frame);
      drawButterfly(
        g,
        (cell % COLUMNS) * CRITTER_CELL,
        ((cell / COLUMNS) | 0) * CRITTER_CELL,
        WINGS[variant]!,
        frame,
      );
    }
  }
  for (let variant = 0; variant < FISH_VARIANTS; variant += 1) {
    for (let frame = 0; frame < FISH_FRAMES; frame += 1) {
      const cell = fishCell(variant, frame);
      drawFish(
        g,
        (cell % COLUMNS) * CRITTER_CELL,
        ((cell / COLUMNS) | 0) * CRITTER_CELL,
        FISH_COLORS[variant]!,
        frame,
      );
    }
  }
}

export function bakeCritterArt(renderer: TextureFactory): CritterArt {
  const sheet = bake(renderer, paintCritterSheet, { frame: new Rectangle(0, 0, SHEET_W, SHEET_H) });

  const source = sheet.source;
  const frames: Texture[] = new Array(COLUMNS * ROWS);
  for (let index = 0; index < frames.length; index += 1) {
    const col = index % COLUMNS;
    const row = (index / COLUMNS) | 0;
    frames[index] = new Texture({
      source,
      frame: new Rectangle(col * CRITTER_CELL, row * CRITTER_CELL, CRITTER_CELL, CRITTER_CELL),
    });
  }

  return {
    frames,
    destroy() {
      // 切片与整张图集共用同一个 TextureSource：先放切片，再连源一起销毁
      for (const frame of frames) frame.destroy(false);
      sheet.destroy(true);
    },
  };
}

// ---------------------------------------------------------------------------
// 绘制原语
// ---------------------------------------------------------------------------

function rect(
  g: Graphics,
  ox: number,
  oy: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  if (w <= 0 || h <= 0) return;
  g.rect(ox + x, oy + y, w, h).fill(color);
}

function dot(g: Graphics, ox: number, oy: number, x: number, y: number, color: number): void {
  g.rect(ox + x, oy + y, 1, 1).fill(color);
}

/** 单行半宽：整数 Math.round 保证上下左右对称，且不产生曲线细分 */
function halfWidth(rx: number, ry: number, dy: number): number {
  if (ry <= 0) return 0;
  const k = 1 - (dy * dy) / (ry * ry);
  if (k <= 0) return 0;
  return Math.round(rx * Math.sqrt(k));
}

function blob(
  g: Graphics,
  ox: number,
  oy: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
): void {
  for (let dy = -ry; dy <= ry; dy += 1) {
    const half = halfWidth(rx, ry, dy);
    if (half <= 0) {
      dot(g, ox, oy, cx, cy + dy, color);
      continue;
    }
    rect(g, ox, oy, cx - half, cy + dy, half * 2 + 1, 1, color);
  }
}

/** 右下 1px 压暗边：体积靠这一圈，不靠抖动噪点 */
function rim(
  g: Graphics,
  ox: number,
  oy: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
): void {
  for (let dy = -ry; dy <= ry; dy += 1) {
    const half = halfWidth(rx, ry, dy);
    if (half <= 0) continue;
    dot(g, ox, oy, cx + half, cy + dy, color);
    if (dy === ry) rect(g, ox, oy, cx - half + 1, cy + dy, half * 2 - 1, 1, color);
  }
}

/** 接触阴影：两排、内深外浅，压到脚下不参与任何运行期绘制 */
function contactShadow(g: Graphics, ox: number, oy: number, cx: number, halfW: number): void {
  for (let i = 0; i < halfW; i += 1) {
    const t = i / Math.max(1, halfW);
    const alpha = 0.2 * (1 - t * 0.55);
    g.rect(ox + cx - i, oy + CRITTER_FEET - 1, i * 2 + 1, 2).fill({ color: SHADOW, alpha });
  }
}

// ---------------------------------------------------------------------------
// 地面动物：只保留兔子
// ---------------------------------------------------------------------------

interface BlobSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * 多块圆斑的并集轮廓：先整体描边，再按「后块覆盖前块」的顺序填充与压暗。
 * 兔子的臀 / 胸 / 头三块必须读成一个剪影，逐块描边会在接缝留下内部暗边。
 */
function outlinedBlobs(g: Graphics, ox: number, oy: number, blobs: readonly BlobSpec[], coat: Coat): void {
  for (const b of blobs) blob(g, ox, oy, b.cx, b.cy, b.rx + 1, b.ry + 1, INK);
  for (const b of blobs) {
    blob(g, ox, oy, b.cx, b.cy, b.rx, b.ry, coat.body);
    rim(g, ox, oy, b.cx, b.cy, b.rx, b.ry, coat.shade);
  }
}

/** 兔耳：2px 宽、带 1px 描边与一条耳内色；`tilt` 让耳尖向右偏一格 */
function rabbitEar(
  g: Graphics,
  ox: number,
  oy: number,
  x: number,
  y: number,
  h: number,
  inner: number,
  coat: Coat,
  tilt = false,
): void {
  rect(g, ox, oy, x - 1, y - 1, 4, h + 2, INK);
  rect(g, ox, oy, x, y, 2, h, coat.body);
  if (tilt) rect(g, ox, oy, x + 1, y, 2, 1, coat.body);
  rect(g, ox, oy, x + 1, y + 1, 1, Math.max(1, h - 2), inner);
}

const RABBIT_HEAD_R = 4;

function drawGround(g: Graphics, ox: number, oy: number, coat: Coat, view: number, frame: number): void {
  // 兔子比旧猫狗略圆，接触阴影固定 8px 半宽
  contactShadow(g, ox, oy, 16, 8);
  if (view === CRITTER_VIEW_SIDE) drawSide(g, ox, oy, coat, frame);
  else drawFront(g, ox, oy, coat, view === CRITTER_VIEW_UP, frame);
}

/** 侧视：头朝右，臀在后、胸在前、前爪并拢；坐姿与行走共用头 / 耳 / 尾 */
function drawSide(g: Graphics, ox: number, oy: number, coat: Coat, frame: number): void {
  const sitting = frame <= FRAME_GRAZE;
  const graze = frame === FRAME_GRAZE;
  const twitch = frame === FRAME_SIT_B;
  const bob = frame === FRAME_WALK_B ? -1 : 0;
  const headCy = 17 + bob + (graze ? 3 : 0);
  const bodyCy = (sitting ? 23 : 22) + bob;
  const haunchCy = 24 + bob;

  // 尾巴先画，压在臀部后面
  const tailX = sitting ? 5 : 6;
  const tailY = bodyCy - 1;
  blob(g, ox, oy, tailX, tailY, 2, 2, INK);
  blob(g, ox, oy, tailX, tailY, 1, 1, coat.light);

  // 耳朵在头后面：低头 / 抖耳时高度与倾角变化
  const earTop = headCy - RABBIT_HEAD_R - 6 + (graze ? 2 : 0);
  const earH = graze ? 4 : 6;
  rabbitEar(g, ox, oy, 19, earTop, earH, coat.inner, coat, twitch);
  rabbitEar(g, ox, oy, 25, earTop + 1, earH - (graze ? 0 : 1), coat.inner, coat, !twitch);

  if (!sitting) {
    // 行走：先画腿，躯干盖住腿根
    drawSideLegs(g, ox, oy, coat, frame, bob);
  }

  const blobs: BlobSpec[] = sitting
    ? [
        { cx: 12, cy: haunchCy, rx: 6, ry: 4 },
        { cx: 17, cy: bodyCy - 1, rx: 4, ry: 4 },
        { cx: 23, cy: headCy, rx: RABBIT_HEAD_R, ry: RABBIT_HEAD_R },
      ]
    : [
        { cx: 14, cy: bodyCy, rx: 6, ry: 4 },
        { cx: 23, cy: headCy, rx: RABBIT_HEAD_R, ry: RABBIT_HEAD_R },
      ];
  outlinedBlobs(g, ox, oy, blobs, coat);

  if (sitting) {
    // 前爪并拢撑在胸前：两列，外侧一列压暗
    const pawTop = bodyCy;
    for (const x of [18, 21]) {
      rect(g, ox, oy, x, pawTop, 2, CRITTER_FEET - pawTop, coat.body);
      rect(g, ox, oy, x + 1, pawTop, 1, CRITTER_FEET - pawTop, coat.shade);
    }
    // 臀底一道亮边：把「整块后躯坐在地上」读出来
    rect(g, ox, oy, 8, haunchCy + 3, 8, 1, coat.light);
  }

  // 眼睛：抖耳帧眨眼；高光让深色配色也有神
  const eyeX = 25;
  const eyeY = headCy - 1;
  if (twitch) {
    rect(g, ox, oy, eyeX - 1, eyeY, 2, 1, INK);
  } else {
    dot(g, ox, oy, eyeX, eyeY, INK);
    dot(g, ox, oy, eyeX, eyeY - 1, coat.light);
  }
  dot(g, ox, oy, 27, headCy + 1, coat.inner); // 鼻头
  dot(g, ox, oy, 26, headCy + 2, coat.shade); // W 嘴的一角
}

function drawSideLegs(g: Graphics, ox: number, oy: number, coat: Coat, frame: number, bob: number): void {
  const backLift = frame === FRAME_WALK_A ? 1 : 0;
  const frontLift = frame === FRAME_WALK_B ? 1 : 0;
  for (const [x, lift] of [
    [11, backLift],
    [18, frontLift],
  ] as const) {
    const top = 25 + bob + lift;
    const bottom = CRITTER_FEET - 1 - lift;
    rect(g, ox, oy, x, top, 2, Math.max(1, bottom - top + 1), coat.body);
    rect(g, ox, oy, x + 1, top, 1, Math.max(1, bottom - top + 1), coat.shade);
  }
}

/** 正视 / 背视：梨形身体 + 两片竖耳；坐姿时前爪并拢、后爪只露不落地的小鼓包 */
function drawFront(
  g: Graphics,
  ox: number,
  oy: number,
  coat: Coat,
  facingUp: boolean,
  frame: number,
): void {
  const sitting = frame <= FRAME_GRAZE;
  const graze = frame === FRAME_GRAZE;
  const twitch = frame === FRAME_SIT_B;
  const bob = frame === FRAME_WALK_B ? -1 : 0;
  const headCy = 16 + bob + (graze ? 2 : 0);
  const bodyCy = (sitting ? 24 : 23) + bob;
  const chestCy = (sitting ? 21 : 20) + bob;

  const earTop = headCy - RABBIT_HEAD_R - 6 + (graze ? 2 : 0);
  const earH = graze ? 4 : 6;
  const inner = facingUp ? coat.shade : coat.inner;
  rabbitEar(g, ox, oy, 11, earTop, earH, inner, coat, twitch);
  rabbitEar(g, ox, oy, 19, earTop + 1, earH - (graze ? 0 : 1), inner, coat, !twitch);

  if (!sitting) drawFrontLegs(g, ox, oy, coat, frame, bob);

  const blobs: BlobSpec[] = sitting
    ? [
        { cx: 16, cy: bodyCy, rx: 6, ry: 4 },
        { cx: 16, cy: chestCy, rx: 4, ry: 3 },
        { cx: 16, cy: headCy, rx: RABBIT_HEAD_R, ry: RABBIT_HEAD_R },
      ]
    : [
        { cx: 16, cy: bodyCy, rx: 6, ry: 4 },
        { cx: 16, cy: headCy, rx: RABBIT_HEAD_R, ry: RABBIT_HEAD_R },
      ];
  outlinedBlobs(g, ox, oy, blobs, coat);

  if (sitting) {
    // 前爪并拢；后爪只露 2px，不落地成第三、四条腿
    for (const x of [14, 18]) {
      rect(g, ox, oy, x, chestCy + 3, 2, CRITTER_FEET - (chestCy + 3), coat.body);
      rect(g, ox, oy, x + 1, chestCy + 3, 1, CRITTER_FEET - (chestCy + 3), coat.shade);
    }
    for (const x of [10, 21]) {
      rect(g, ox, oy, x, bodyCy + 2, 2, 2, coat.shade);
    }
  }

  if (facingUp) {
    // 背视：只留耳背、背线与绒球尾，不画脸
    rect(g, ox, oy, 12, bodyCy - 3, 8, 1, coat.light);
    rect(g, ox, oy, 15, bodyCy + 2, 3, 2, coat.light);
    return;
  }

  // 正面：大眼 + 高光、粉鼻、W 嘴与胡须点
  for (const x of [14, 18]) {
    if (twitch) {
      rect(g, ox, oy, x, headCy - 1, 2, 1, INK);
    } else {
      dot(g, ox, oy, x, headCy - 1, INK);
      dot(g, ox, oy, x, headCy - 2, coat.light);
    }
  }
  dot(g, ox, oy, 12, headCy + 1, coat.light); // 左脸颊绒
  dot(g, ox, oy, 20, headCy + 1, coat.light); // 右脸颊绒
  rect(g, ox, oy, 15, headCy + 2, 2, 1, coat.inner);
  dot(g, ox, oy, 14, headCy + 3, coat.shade);
  dot(g, ox, oy, 17, headCy + 3, coat.shade);
  rect(g, ox, oy, 12, bodyCy - 3, 8, 1, coat.light);
}

function drawFrontLegs(g: Graphics, ox: number, oy: number, coat: Coat, frame: number, bob: number): void {
  const leftLift = frame === FRAME_WALK_A ? 1 : 0;
  const rightLift = frame === FRAME_WALK_B ? 1 : 0;
  for (const [x, lift] of [
    [14, leftLift],
    [18, rightLift],
  ] as const) {
    const top = 23 + bob + lift;
    const bottom = CRITTER_FEET - 1 - lift;
    rect(g, ox, oy, x, top, 2, Math.max(1, bottom - top + 1), coat.body);
    rect(g, ox, oy, x + 1, top, 1, Math.max(1, bottom - top + 1), coat.shade);
  }
  // 后爪在身体两侧，行走时只露一小截
  for (const [x, lift] of [
    [10, rightLift],
    [21, leftLift],
  ] as const) {
    const top = 25 + bob + lift;
    const bottom = CRITTER_FEET - 1 - lift;
    rect(g, ox, oy, x, top, 2, Math.max(1, bottom - top + 1), coat.shade);
  }
}

// ---------------------------------------------------------------------------
// 蝴蝶
// ---------------------------------------------------------------------------

function drawButterfly(
  g: Graphics,
  ox: number,
  oy: number,
  wing: { wing: number; edge: number; spot: number },
  frame: number,
): void {
  const cx = 16;
  const cy = 15;
  if (frame === 0) {
    // 翅开：上翅 5×5、下翅 3×3，中间留一行空隙，剪影才不是一块方板
    for (const side of [-1, 1] as const) {
      blob(g, ox, oy, cx + side * 3, cy - 2, 2, 2, wing.edge);
      blob(g, ox, oy, cx + side * 3, cy - 2, 1, 1, wing.wing);
      dot(g, ox, oy, cx + side * 3, cy - 2, wing.spot);
      blob(g, ox, oy, cx + side * 2, cy + 3, 1, 1, wing.edge);
      dot(g, ox, oy, cx + side * 2, cy + 3, wing.wing);
    }
  } else {
    // 翅合：收成贴着身体的两条 1px 竖翅，与身体连成一根 3px 的细条
    rect(g, ox, oy, cx - 1, cy - 3, 1, 6, wing.edge);
    rect(g, ox, oy, cx + 1, cy - 3, 1, 6, wing.edge);
    rect(g, ox, oy, cx - 1, cy - 2, 1, 4, wing.wing);
    rect(g, ox, oy, cx + 1, cy - 2, 1, 4, wing.wing);
  }
  // 身体与触角
  rect(g, ox, oy, cx, cy - 2, 1, 5, INK);
  dot(g, ox, oy, cx, cy - 3, INK);
  dot(g, ox, oy, cx - 1, cy - 5, INK);
  dot(g, ox, oy, cx + 1, cy - 5, INK);
}

// ---------------------------------------------------------------------------
// 小鱼（ADR-0045）
// ---------------------------------------------------------------------------

/**
 * 侧视小鱼：默认头朝右、尾在左，两帧只摆尾鳍。
 * 俯视水面的读法靠「身体 + 背鳍 + 一圈压暗边」，不做水下渐隐（合成成本比观感收益高）。
 */
function drawFish(
  g: Graphics,
  ox: number,
  oy: number,
  coat: { body: number; shade: number; light: number; fin: number },
  frame: number,
): void {
  const cx = 16;
  const cy = 16;
  const tailY = frame === 0 ? cy - 2 : cy + 2;
  // 尾鳍：先画，压在身体后面
  rect(g, ox, oy, cx - 9, tailY - 1, 3, 3, coat.fin);
  rect(g, ox, oy, cx - 7, tailY, 2, 1, coat.fin);
  // 身体：一圈压暗边 + 本体，俯视是一个横向水滴
  blob(g, ox, oy, cx, cy, 6, 3, coat.shade);
  blob(g, ox, oy, cx, cy, 5, 2, coat.body);
  // 背鳍与腹鳍
  rect(g, ox, oy, cx - 2, cy - 4, 4, 1, coat.fin);
  rect(g, ox, oy, cx - 2, cy + 4, 3, 1, coat.fin);
  // 眼与吻部高光
  dot(g, ox, oy, cx + 4, cy - 1, INK);
  dot(g, ox, oy, cx + 5, cy - 1, coat.light);
  rect(g, ox, oy, cx - 3, cy + 1, 4, 1, coat.light);
}
