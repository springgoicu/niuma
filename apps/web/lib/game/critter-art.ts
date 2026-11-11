'use client';

import { Graphics, Rectangle, Texture, type Application } from 'pixi.js';
import { bake } from './terrain-textures';

/**
 * 园区小动物与蝴蝶的像素图集。
 *
 * 为什么不用玩家那套 `packages/pixel-assets`：角色图集是 64×64 帧、34 列、九层灰度 tint，
 * 为的是换色与配件；小动物只需要「一眼认出物种 + 换三套配色」，走那套管线等于
 * 让 `pnpm assets` 重新生成一整个 manifest、还要双端重发版（ADR-0042）。
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
export const CRITTER_ROWS = 10;
const COLUMNS = CRITTER_COLUMNS;
const ROWS = CRITTER_ROWS;
const SHEET_W = COLUMNS * CRITTER_CELL;
const SHEET_H = ROWS * CRITTER_CELL;

/** 0 正面 / 1 侧面 / 2 背面。侧面永远朝右，朝左靠 `scale.x = -1` 镜像 */
export const CRITTER_VIEW_DOWN = 0;
export const CRITTER_VIEW_SIDE = 1;
export const CRITTER_VIEW_UP = 2;
export const GROUND_VIEWS = 3;

/** 0 站立 / 1 低头吃草 / 2 走 A / 3 走 B */
export const FRAME_IDLE = 0;
export const FRAME_GRAZE = 1;
export const FRAME_WALK_A = 2;
export const FRAME_WALK_B = 3;
export const GROUND_FRAMES = 4;

const SPECIES = 3;
const VARIANTS = 3;
const GROUND_CELLS = SPECIES * VARIANTS * GROUND_VIEWS * GROUND_FRAMES;
const BUTTERFLY_BASE = GROUND_CELLS;
export const BUTTERFLY_VARIANTS = 3;
export const BUTTERFLY_FRAMES = 2;
/**
 * 小鱼（ADR-0045）：只占图集最后 6 格（114–119），1 物种 × 3 配色 × 2 帧。
 * 3 配色共用一张剪影，靠镜像转向；图集因此刚好画满 12×10。
 */
const FISH_BASE = BUTTERFLY_BASE + BUTTERFLY_VARIANTS * BUTTERFLY_FRAMES;
export const FISH_VARIANTS = 3;
export const FISH_FRAMES = 2;

/** 图集格号：物种 × 配色 × 视图 × 帧，顺序即布局，两端只认这一份常量 */
export function groundCell(species: number, variant: number, view: number, frame: number): number {
  return ((species * VARIANTS + variant) * GROUND_VIEWS + view) * GROUND_FRAMES + frame;
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

/** 每个物种三套配色：同一套剪影，只换调色板，保持合批 */
const COATS: readonly (readonly Coat[])[] = [
  // 兔：奶油白 / 燕麦灰 / 焦糖棕
  [
    { body: 0xfdf7ee, shade: 0xded1c0, light: 0xffffff, inner: 0xf3b0b8 },
    { body: 0xd8d3c6, shade: 0xb0a99a, light: 0xeae6dc, inner: 0xefa9b3 },
    { body: 0xc79463, shade: 0x9d7045, light: 0xe4b98c, inner: 0xe8a0a8 },
  ],
  // 猫：橘虎斑 / 灰狸花 / 墨靛
  [
    { body: 0xf0a75c, shade: 0xcd7d38, light: 0xffe3bd, inner: 0xf7c6a0 },
    { body: 0xa9a9b6, shade: 0x7f7f8d, light: 0xd4d4de, inner: 0xe0b7c2 },
    { body: 0x5c6079, shade: 0x424559, light: 0x8b90ab, inner: 0xb9a2c6 },
  ],
  // 狗：柴黄 / 奶白 / 深棕
  [
    { body: 0xe8bb72, shade: 0xc59850, light: 0xfdf0d8, inner: 0xd9a35f },
    { body: 0xf7f1e3, shade: 0xd1c7b2, light: 0xffffff, inner: 0xe3c9c0 },
    { body: 0x8a6247, shade: 0x684632, light: 0xb08a6c, inner: 0xc79c86 },
  ],
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
  for (let species = 0; species < SPECIES; species += 1) {
    for (let variant = 0; variant < VARIANTS; variant += 1) {
      for (let view = 0; view < GROUND_VIEWS; view += 1) {
        for (let frame = 0; frame < GROUND_FRAMES; frame += 1) {
          const cell = groundCell(species, variant, view, frame);
          drawGround(
            g,
            (cell % COLUMNS) * CRITTER_CELL,
            ((cell / COLUMNS) | 0) * CRITTER_CELL,
            species,
            COATS[species]![variant]!,
            view,
            frame,
          );
        }
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

/** 两段式剪影：先铺两圈描边，再铺两块本体，重叠处的内描边被后画的填充盖掉 */
function outlinedPair(
  g: Graphics,
  ox: number,
  oy: number,
  a: { cx: number; cy: number; rx: number; ry: number },
  b: { cx: number; cy: number; rx: number; ry: number },
  coat: Coat,
): void {
  blob(g, ox, oy, a.cx, a.cy, a.rx + 1, a.ry + 1, INK);
  blob(g, ox, oy, b.cx, b.cy, b.rx + 1, b.ry + 1, INK);
  blob(g, ox, oy, a.cx, a.cy, a.rx, a.ry, coat.body);
  blob(g, ox, oy, b.cx, b.cy, b.rx, b.ry, coat.body);
  rim(g, ox, oy, a.cx, a.cy, a.rx, a.ry, coat.shade);
  rim(g, ox, oy, b.cx, b.cy, b.rx, b.ry, coat.shade);
}

// ---------------------------------------------------------------------------
// 地面动物
// ---------------------------------------------------------------------------

interface SideSpec {
  bodyCx: number;
  bodyCy: number;
  bodyRx: number;
  bodyRy: number;
  headCx: number;
  headCy: number;
  headR: number;
  /** 躯干底边：腿从这里长到脚底线 */
  legTop: number;
  backLegX: number;
  frontLegX: number;
  legW: number;
  tail: 'puff' | 'curl' | 'stub';
  ear: 'long' | 'tri' | 'flop';
}

const SIDE: readonly SideSpec[] = [
  // 兔：团身、竖长耳、圆尾
  { bodyCx: 14, bodyCy: 22, bodyRx: 5, bodyRy: 4, headCx: 21, headCy: 19, headR: 3, legTop: 26, backLegX: 11, frontLegX: 16, legW: 2, tail: 'puff', ear: 'long' },
  // 猫：长身、短腿、尖耳、上翘尾
  { bodyCx: 14, bodyCy: 23, bodyRx: 6, bodyRy: 3, headCx: 22, headCy: 20, headR: 3, legTop: 26, backLegX: 10, frontLegX: 17, legW: 2, tail: 'curl', ear: 'tri' },
  // 狗：宽身、方头、垂耳、短尾
  { bodyCx: 14, bodyCy: 22, bodyRx: 7, bodyRy: 4, headCx: 23, headCy: 19, headR: 4, legTop: 26, backLegX: 9, frontLegX: 18, legW: 2, tail: 'stub', ear: 'flop' },
];

interface FrontSpec {
  bodyCx: number;
  bodyCy: number;
  bodyRx: number;
  bodyRy: number;
  headCx: number;
  headCy: number;
  headR: number;
  legTop: number;
  legInset: number;
  legW: number;
  /** 耳形与尾形直接写死，不要从半径反推——改一次体型就会把物种特征改错 */
  ear: 'long' | 'tri' | 'flop';
  tail: 'puff' | 'curl' | 'stub';
}

const FRONT: readonly FrontSpec[] = [
  { bodyCx: 16, bodyCy: 22, bodyRx: 5, bodyRy: 4, headCx: 16, headCy: 18, headR: 4, legTop: 26, legInset: 3, legW: 2, ear: 'long', tail: 'puff' },
  { bodyCx: 16, bodyCy: 23, bodyRx: 6, bodyRy: 3, headCx: 16, headCy: 19, headR: 3, legTop: 26, legInset: 4, legW: 2, ear: 'tri', tail: 'curl' },
  { bodyCx: 16, bodyCy: 22, bodyRx: 6, bodyRy: 4, headCx: 16, headCy: 18, headR: 4, legTop: 26, legInset: 4, legW: 2, ear: 'flop', tail: 'stub' },
];

function drawGround(
  g: Graphics,
  ox: number,
  oy: number,
  species: number,
  coat: Coat,
  view: number,
  frame: number,
): void {
  const shadowHalf = species === 1 ? 8 : 7;
  contactShadow(g, ox, oy, 16, shadowHalf);
  if (view === CRITTER_VIEW_SIDE) drawSide(g, ox, oy, species, coat, frame);
  else drawFront(g, ox, oy, species, coat, view === CRITTER_VIEW_UP, frame);
}

function drawSide(
  g: Graphics,
  ox: number,
  oy: number,
  species: number,
  coat: Coat,
  frame: number,
): void {
  const spec = SIDE[species]!;
  const graze = frame === FRAME_GRAZE;
  const walking = frame >= FRAME_WALK_A;
  // 走路第二帧整体抬 1px：脚不动、躯干起伏，比给耳朵加缩放便宜也更像像素动画
  const bob = frame === FRAME_WALK_B ? -1 : 0;
  const bodyCy = spec.bodyCy + bob;
  const headCy = spec.headCy + bob + (graze ? 2 : 0);
  const legTop = spec.legTop + bob;

  drawTail(g, ox, oy, spec, coat, bodyCy);
  drawSideLegs(g, ox, oy, spec, coat, legTop, walking ? frame : -1);
  outlinedPair(
    g,
    ox,
    oy,
    { cx: spec.bodyCx, cy: bodyCy, rx: spec.bodyRx, ry: spec.bodyRy },
    { cx: spec.headCx, cy: headCy, rx: spec.headR, ry: spec.headR },
    coat,
  );
  drawSideEar(g, ox, oy, spec, coat, headCy);
  // 侧视只露一只眼；吃草时眼睛跟着头下沉
  dot(g, ox, oy, spec.headCx + 1, headCy - 1, INK);
  dot(g, ox, oy, spec.headCx + spec.headR, headCy + 1, coat.inner);
  // 腹部高光：让深色配色也能读出体块
  rect(g, ox, oy, spec.bodyCx - spec.bodyRx + 2, bodyCy + spec.bodyRy - 1, spec.bodyRx * 2 - 3, 1, coat.light);
}

function drawSideLegs(
  g: Graphics,
  ox: number,
  oy: number,
  spec: SideSpec,
  coat: Coat,
  legTop: number,
  walkFrame: number,
): void {
  const backLift = walkFrame === FRAME_WALK_A ? 1 : 0;
  const frontLift = walkFrame === FRAME_WALK_B ? 1 : 0;
  for (const [x, lift] of [
    [spec.backLegX, backLift],
    [spec.frontLegX, frontLift],
  ] as const) {
    const top = legTop - 1 + lift;
    const bottom = CRITTER_FEET - 1 - lift;
    rect(g, ox, oy, x, top, spec.legW, Math.max(1, bottom - top + 1), coat.body);
    // 外侧一列压暗，两条腿才不会糊成一根柱子
    rect(g, ox, oy, x + spec.legW - 1, top, 1, Math.max(1, bottom - top + 1), coat.shade);
  }
}

function drawSideEar(
  g: Graphics,
  ox: number,
  oy: number,
  spec: SideSpec,
  coat: Coat,
  headCy: number,
): void {
  const top = headCy - spec.headR;
  if (spec.ear === 'long') {
    // 兔耳：一前一后错 2px，前耳稍短，避免两根等长像天线
    rect(g, ox, oy, spec.headCx - 2, top - 4, 2, 5, coat.body);
    rect(g, ox, oy, spec.headCx + 1, top - 3, 2, 4, coat.body);
    dot(g, ox, oy, spec.headCx - 2, top - 3, coat.inner);
    dot(g, ox, oy, spec.headCx + 2, top - 2, coat.shade);
    return;
  }
  if (spec.ear === 'tri') {
    // 猫耳：三层收尖
    rect(g, ox, oy, spec.headCx - 3, top - 2, 3, 1, coat.body);
    rect(g, ox, oy, spec.headCx - 2, top - 3, 2, 1, coat.body);
    dot(g, ox, oy, spec.headCx - 2, top - 2, coat.inner);
    rect(g, ox, oy, spec.headCx + 2, top - 2, 3, 1, coat.body);
    rect(g, ox, oy, spec.headCx + 3, top - 3, 2, 1, coat.body);
    dot(g, ox, oy, spec.headCx + 3, top - 2, coat.inner);
    return;
  }
  // 狗耳：垂在头两侧，终点比头心低 1px
  rect(g, ox, oy, spec.headCx - 4, top, 2, 4, coat.body);
  rect(g, ox, oy, spec.headCx + 3, top + 1, 2, 3, coat.shade);
}

function drawTail(
  g: Graphics,
  ox: number,
  oy: number,
  spec: SideSpec,
  coat: Coat,
  bodyCy: number,
): void {
  const x = spec.bodyCx - spec.bodyRx - 1;
  if (spec.tail === 'puff') {
    blob(g, ox, oy, x - 1, bodyCy + 1, 2, 2, INK);
    blob(g, ox, oy, x - 1, bodyCy + 1, 1, 1, coat.light);
    return;
  }
  if (spec.tail === 'curl') {
    // 上翘尾：竖一段再向上一格收尖
    rect(g, ox, oy, x - 1, bodyCy - 4, 2, 5, coat.body);
    rect(g, ox, oy, x - 2, bodyCy - 6, 2, 2, coat.body);
    dot(g, ox, oy, x - 1, bodyCy - 3, coat.shade);
    return;
  }
  // 短尾：向后上方翘一格
  rect(g, ox, oy, x, bodyCy - 1, 3, 2, coat.body);
  dot(g, ox, oy, x + 2, bodyCy - 2, coat.shade);
}

function drawFront(
  g: Graphics,
  ox: number,
  oy: number,
  species: number,
  coat: Coat,
  facingUp: boolean,
  frame: number,
): void {
  const spec = FRONT[species]!;
  const graze = frame === FRAME_GRAZE;
  const bob = frame === FRAME_WALK_B ? -1 : 0;
  const bodyCy = spec.bodyCy + bob;
  const headCy = spec.headCy + bob + (graze ? 2 : 0);
  const legTop = spec.legTop + bob;
  const headR = facingUp ? spec.headR - 1 : spec.headR;

  drawFrontLegs(g, ox, oy, spec, coat, legTop, frame, facingUp);
  if (facingUp) drawFrontTail(g, ox, oy, spec, coat, bodyCy);
  outlinedPair(
    g,
    ox,
    oy,
    { cx: spec.bodyCx, cy: bodyCy, rx: spec.bodyRx, ry: spec.bodyRy },
    { cx: spec.headCx, cy: headCy, rx: headR, ry: headR },
    coat,
  );
  drawFrontEar(g, ox, oy, spec, coat, headCy, headR, facingUp);
  if (facingUp) {
    // 背视：只留一条背线，不画脸
    rect(g, ox, oy, spec.bodyCx - spec.bodyRx + 2, bodyCy - spec.bodyRy + 1, spec.bodyRx * 2 - 3, 1, coat.light);
    return;
  }
  dot(g, ox, oy, spec.headCx - 2, headCy - 1, INK);
  dot(g, ox, oy, spec.headCx + 2, headCy - 1, INK);
  rect(g, ox, oy, spec.headCx - 1, headCy + headR - 1, 2, 1, coat.inner);
  rect(g, ox, oy, spec.bodyCx - spec.bodyRx + 2, bodyCy + spec.bodyRy - 1, spec.bodyRx * 2 - 3, 1, coat.light);
}

function drawFrontLegs(
  g: Graphics,
  ox: number,
  oy: number,
  spec: FrontSpec,
  coat: Coat,
  legTop: number,
  frame: number,
  facingUp: boolean,
): void {
  const leftLift = frame === FRAME_WALK_A ? 1 : 0;
  const rightLift = frame === FRAME_WALK_B ? 1 : 0;
  const xs = [spec.bodyCx - spec.legInset, spec.bodyCx + spec.legInset - spec.legW + 1];
  for (let i = 0; i < 2; i += 1) {
    const lift = i === 0 ? leftLift : rightLift;
    const top = legTop - 1 + lift;
    const bottom = CRITTER_FEET - 1 - lift;
    const color = facingUp ? coat.shade : coat.body;
    rect(g, ox, oy, xs[i]!, top, spec.legW, Math.max(1, bottom - top + 1), color);
  }
}

function drawFrontEar(
  g: Graphics,
  ox: number,
  oy: number,
  spec: FrontSpec,
  coat: Coat,
  headCy: number,
  headR: number,
  facingUp: boolean,
): void {
  const top = headCy - headR;
  const inner = facingUp ? coat.shade : coat.inner;
  const left = spec.headCx - headR;
  const right = spec.headCx + headR - 1;
  if (spec.ear === 'long') {
    // 兔耳：竖直两片，耳尖探出头顶 3px
    rect(g, ox, oy, left, top - 3, 2, 4, coat.body);
    rect(g, ox, oy, right - 1, top - 3, 2, 4, coat.body);
    dot(g, ox, oy, left, top - 2, inner);
    dot(g, ox, oy, right - 1, top - 2, inner);
    return;
  }
  if (spec.ear === 'flop') {
    // 狗耳：挂在头两侧、每侧探出轮廓 1px，并且整块压暗——正面看才是「垂耳」而不是圆头
    rect(g, ox, oy, spec.headCx - headR - 2, top, 2, 4, coat.shade);
    rect(g, ox, oy, spec.headCx + headR + 1, top, 2, 4, coat.shade);
    return;
  }
  // 猫：三角耳，两层收尖
  rect(g, ox, oy, left, top - 1, 3, 2, coat.body);
  dot(g, ox, oy, left + 1, top - 2, coat.body);
  rect(g, ox, oy, right - 2, top - 1, 3, 2, coat.body);
  dot(g, ox, oy, right - 1, top - 2, coat.body);
  dot(g, ox, oy, left + 1, top - 1, inner);
  dot(g, ox, oy, right - 1, top - 1, inner);
}

function drawFrontTail(
  g: Graphics,
  ox: number,
  oy: number,
  spec: FrontSpec,
  coat: Coat,
  bodyCy: number,
): void {
  const top = bodyCy - spec.bodyRy;
  if (spec.tail === 'curl') {
    // 猫：尾巴从体后中线上翘
    rect(g, ox, oy, spec.bodyCx - 1, top - 4, 2, 4, coat.body);
    dot(g, ox, oy, spec.bodyCx - 1, top - 5, coat.shade);
    return;
  }
  // 兔的圆尾 / 狗的短尾：只露出一小块高光，背视下不抢头部
  rect(g, ox, oy, spec.bodyCx - 1, top - 1, 3, 2, spec.tail === 'puff' ? coat.light : coat.shade);
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
