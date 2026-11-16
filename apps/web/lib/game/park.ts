'use client';

import { Container, Graphics, Rectangle, Sprite, Text, type Application, type Texture } from 'pixi.js';
import {
  AMUSEMENT_PARK,
  PARK_ATTRACTIONS,
  PARK_RIDES,
  PARK_SLIDE,
  PARK_SOUTH_GATE,
  type ParkAttraction,
  type ParkAttractionKind,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import { lightToneAt } from './lighting/tone';
import { serverHourFraction } from './server-date';
import { serverNow, serverTzOffsetMin } from './server-clock';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';
import { WINTER_COLORS } from './terrain-palette';
import { bulbPulse, ferrisStep } from './venue-motion';

/**
 * 游乐园（本轮新增）：晴天下班后的糖果色游乐场。
 *
 * 与 `welcome.ts` 同一条纪律：
 * 1) 坐标只从 `@niuma/shared-types` 的 `AMUSEMENT_PARK` / `PARK_*` 读，渲染层不写第二份；
 * 2) 所有像素画在构造期烘焙一次，帧循环只改标量；滑梯、秋千、跷跷板与旋转木马都不参与碰撞
 *    （碰撞底座已经在共享布局的 `PARK_RIDE_SOLIDS` 里）；
 * 3) 滑梯的深度锚点放在塔顶，不放在落地点：角色沿滑道下来时永远压在滑梯精灵之前。
 */

type TextureFactory = Application['renderer'];

const C = {
  ink: 0x2a3142,
  inkSoft: 0x3b4560,
  cream: 0xfff6e0,
  mint: 0x8fe3c7,
  mintLight: 0xb6f0dc,
  mintDark: 0x5cc4a0,
  peach: 0xffb59e,
  peachDark: 0xe8856d,
  butter: 0xffe49a,
  sky: 0x9fd3ff,
  skyDark: 0x6aa8e0,
  lilac: 0xc9b6ff,
  lilacDark: 0x9c84e8,
  wood: 0xe0b48a,
  woodDark: 0x8a6446,
  red: 0xd94f4f,
  redLight: 0xef7a6a,
  gold: 0xffd166,
  glow: 0xfff0b8,
} as const;

const CJK_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

const SLIDE_ART = { w: PARK_SLIDE.hit.w, h: PARK_SLIDE.hit.h };
const GATE_ART = { w: 132, h: 96 };
const SWING_ART = { w: 82, h: 92 };
const SEESAW_ART = { w: 80, h: 34 };
const CAROUSEL_ART = { w: 124, h: 102 };

/* ------------------------------------------------------------------ *
 * 摩天轮：静态底 + 六只吊舱 + 一圈彩灯
 *
 * 轮盘中心与半径写在这里一次，底图、吊舱圆环 LUT 与彩灯挂点全部从它派生。
 * `FERRIS_STEPS = 72` 与 6 只吊舱整除（12 步一只），一圈 24s，每步约 5px：
 * 吊舱按整数坐标挪动，既看不出跳格，也不会出现浮点旋转的糊边。
 * ------------------------------------------------------------------ */
const FERRIS_CY = 74;
const FERRIS_R = 62;
const FERRIS_STEPS = 72;
const FERRIS_CABIN_COUNT = 6;
const FERRIS_PERIOD_MS = 24000;
const FERRIS_BULB_COUNT = 12;
const FERRIS_CABIN_ART = { w: 16, h: 18 };
const FERRIS_BULB_ART = { w: 3, h: 3 };

/** 大件器械的包围盒只从共享布局读，渲染层不写第二份尺寸 */
const ATTRACTIONS = Object.fromEntries(PARK_ATTRACTIONS.map((item) => [item.kind, item])) as Record<
  ParkAttractionKind,
  ParkAttraction
>;

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number = C.ink): void {
  g.roundRect(x, y, w, h, 2).fill(line);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 1).fill(fill);
}

function dot(g: Graphics, cx: number, cy: number, r: number, fill: number, line: number = C.ink): void {
  g.circle(cx, cy, r + 1).fill(line);
  g.circle(cx, cy, r).fill(fill);
}

/** 滑梯：塔楼 + 弯道 + 落地缓冲，局部坐标从 hit 左上角起算 */
function drawSlide(g: Graphics): void {
  const topX = PARK_SLIDE.top.x - PARK_SLIDE.hit.x;
  const topY = PARK_SLIDE.top.y - PARK_SLIDE.hit.y;
  const landingX = PARK_SLIDE.landing.x - PARK_SLIDE.hit.x;
  const landingY = PARK_SLIDE.landing.y - PARK_SLIDE.hit.y;

  // 落地缓冲：一圈薄荷色软垫，先把「这里能站人」画出来
  g.ellipse(landingX, landingY - 2, 30, 9).fill({ color: C.ink, alpha: 0.18 });
  g.ellipse(landingX, landingY - 4, 26, 8).fill(C.mintLight);
  g.ellipse(landingX, landingY - 4, 22, 6).fill(C.mint);

  // 滑道：直接读共享折线（局部坐标 = 世界坐标 - hit 左上角），先描边再压亮面
  const chute = PARK_SLIDE.chute.map(([x, y]) => [x - PARK_SLIDE.hit.x, y - PARK_SLIDE.hit.y] as const);
  const trace = (dy: number): void => {
    g.moveTo(chute[0]![0], chute[0]![1] + dy);
    for (let i = 1; i < chute.length; i += 1) g.lineTo(chute[i]![0], chute[i]![1] + dy);
  };
  trace(0);
  g.stroke({ width: 20, color: C.ink, join: 'round', cap: 'round' });
  trace(0);
  g.stroke({ width: 16, color: C.peach, join: 'round', cap: 'round' });
  trace(1);
  g.stroke({ width: 5, color: C.butter, join: 'round', cap: 'round' });

  // 塔楼：底座 + 四根立柱 + 条纹顶棚 + 小旗
  box(g, topX - 22, topY + 6, 46, 20, C.wood, C.woodDark);
  rect(g, topX - 18, topY + 10, 38, 2, 0xffe0bf);
  for (const px of [topX - 18, topX + 16]) {
    box(g, px, topY - 44, 4, 50, C.woodDark, C.ink);
  }
  box(g, topX - 26, topY - 56, 56, 14, C.red, C.ink);
  for (let i = 0; i < 4; i += 1) {
    rect(g, topX - 24 + i * 14, topY - 54, 8, 10, i % 2 === 0 ? C.cream : C.redLight);
  }
  rect(g, topX - 28, topY - 58, 60, 3, C.gold);
  // 小旗：挂在顶棚右角，不超出 178px 纹理帧
  rect(g, topX + 26, topY - 56, 2, 18, C.ink);
  g.poly([topX + 28, topY - 54, topX + 44, topY - 48, topX + 28, topY - 42]).fill(C.mint);
  rect(g, topX + 30, topY - 51, 8, 2, C.cream);
  // 爬梯：贴在塔楼左侧，五根横档
  box(g, topX - 34, topY - 24, 12, 42, C.wood, C.woodDark);
  for (let i = 0; i < 5; i += 1) rect(g, topX - 32, topY - 20 + i * 8, 8, 2, C.woodDark);
  // 塔顶平台：一条薄荷色软垫，服务端把角色放在 top 时脚下有东西
  box(g, topX - 20, topY - 4, 42, 8, C.mintLight, C.mintDark);
}

/** 东门：两根彩柱 + 一道横梁 + 彩旗，牌面文字由 Pixi Text 叠加 */
function drawGate(g: Graphics, winter = false): void {
  for (const x of [8, GATE_ART.w - 22]) {
    box(g, x, 16, 14, GATE_ART.h - 20, C.mint, C.ink);
    rect(g, x + 3, 22, 8, GATE_ART.h - 32, C.mintLight);
    dot(g, x + 7, 12, 5, C.gold, C.ink);
  }
  box(g, 4, 26, GATE_ART.w - 8, 16, C.peach, C.ink);
  rect(g, 8, 29, GATE_ART.w - 16, 4, C.cream);
  // 冬季：横梁顶与两个柱头各积一层雪，门口台阶两侧起雪堆（薄薄一道，不挡视线）
  if (winter) {
    for (let x = 6; x < GATE_ART.w - 6; x += 7) {
      const tall = ((Math.imul(x + 11, 2654435761) >>> 0) % 2) + 2;
      rect(g, x, 23, Math.min(7, GATE_ART.w - 6 - x), tall, WINTER_COLORS.snowBase);
    }
    for (const x of [8, GATE_ART.w - 22]) rect(g, x + 1, 15, 12, 2, WINTER_COLORS.snowBase);
    for (const x of [4, GATE_ART.w - 28]) rect(g, x, GATE_ART.h - 6, 24, 3, WINTER_COLORS.snowShade);
  }
  for (let i = 0; i < 7; i += 1) {
    const bx = 12 + i * 17;
    g.poly([bx, 42, bx + 8, 42, bx + 4, 54]).fill(i % 2 === 0 ? C.butter : C.sky);
  }
  // 门内地面：一条通往滑梯的奶油色导向线
  rect(g, GATE_ART.w / 2 - 3, 56, 6, GATE_ART.h - 56, C.cream);
}

function drawSwing(g: Graphics): void {
  const { w, h } = SWING_ART;
  g.ellipse(w / 2, h - 3, 30, 4).fill({ color: C.ink, alpha: 0.18 });
  // 两组 A 字架
  for (const cx of [12, w - 12]) {
    g.moveTo(cx - 10, h - 4).lineTo(cx, 12).lineTo(cx + 10, h - 4);
    g.stroke({ width: 4, color: C.ink, join: 'round' });
    g.moveTo(cx - 10, h - 4).lineTo(cx, 12).lineTo(cx + 10, h - 4);
    g.stroke({ width: 2, color: C.wood, join: 'round' });
  }
  // 横梁
  box(g, 8, 8, w - 16, 5, C.sky, C.skyDark);
  // 两条吊绳 + 两块座板：一高一低，读得出「正在荡」
  for (const [rx, ry] of [
    [w / 2 - 18, 22],
    [w / 2 + 14, 34],
  ] as const) {
    rect(g, rx, 12, 1, ry - 12, C.ink);
    rect(g, rx + 12, 12, 1, ry - 12, C.ink);
    box(g, rx - 2, ry, 16, 5, C.peach, C.ink);
    rect(g, rx, ry + 1, 12, 1, C.cream);
  }
}

function drawSeesaw(g: Graphics): void {
  const { w, h } = SEESAW_ART;
  g.ellipse(w / 2, h - 2, 28, 3).fill({ color: C.ink, alpha: 0.18 });
  // 支点
  g.poly([w / 2 - 8, h - 4, w / 2 + 8, h - 4, w / 2, h - 18]).fill(C.ink);
  g.poly([w / 2 - 5, h - 6, w / 2 + 5, h - 6, w / 2, h - 16]).fill(C.woodDark);
  // 斜板：左端高、右端低
  g.poly([8, h - 22, w - 8, h - 10, w - 8, h - 4, 8, h - 16]).fill(C.ink);
  g.poly([10, h - 20, w - 10, h - 9, w - 10, h - 6, 10, h - 17]).fill(C.mint);
  rect(g, 14, h - 20, 16, 3, C.cream);
  rect(g, w - 30, h - 12, 16, 3, C.butter);
  // 两只把手
  box(g, 8, h - 30, 3, 10, C.peach, C.ink);
  box(g, w - 11, h - 16, 3, 8, C.sky, C.ink);
}

function drawCarousel(g: Graphics): void {
  const { w, h } = CAROUSEL_ART;
  const cx = w / 2;
  const baseY = h - 18;
  g.ellipse(cx, baseY + 4, 50, 8).fill({ color: C.ink, alpha: 0.18 });
  // 底座
  g.ellipse(cx, baseY, 46, 9).fill(C.ink);
  g.ellipse(cx, baseY - 2, 43, 8).fill(C.lilac);
  g.ellipse(cx, baseY - 2, 36, 6).fill(C.lilacDark);
  // 顶棚：条纹圆顶 + 一圈彩边
  g.ellipse(cx, 30, 48, 16).fill(C.ink);
  g.ellipse(cx, 28, 45, 14).fill(C.red);
  // 六道奶油色顶棚条纹：手写六个偏移，不依赖三角函数
  for (const [dx, dy] of [
    [-22, -6],
    [-12, -10],
    [0, -12],
    [12, -10],
    [22, -6],
    [0, 0],
  ] as const) {
    rect(g, cx - 2 + dx, 20 + dy, 5, 12, C.cream);
  }
  g.ellipse(cx, 18, 10, 5).fill(C.gold);
  rect(g, cx - 2, 8, 4, 12, C.ink);
  g.poly([cx + 2, 8, cx + 18, 13, cx + 2, 18]).fill(C.mint);
  // 中心柱 + 四匹小马：四个固定方位，渲染层不需要浮点几何
  box(g, cx - 3, 34, 6, baseY - 36, C.gold, C.woodDark);
  const HORSES: ReadonlyArray<readonly [number, number]> = [
    [-34, 54],
    [0, 66],
    [34, 54],
    [0, 42],
  ];
  HORSES.forEach(([dx, hy], index) => {
    const hx = cx + dx;
    rect(g, hx - 1, hy - 18, 2, 18, C.ink);
    box(g, hx - 7, hy - 10, 14, 8, index % 2 === 0 ? C.mintLight : C.butter, C.ink);
    box(g, hx + 4, hy - 16, 6, 6, C.peach, C.ink);
    rect(g, hx - 5, hy - 2, 2, 8, C.ink);
    rect(g, hx + 3, hy - 2, 2, 8, C.ink);
  });
}

/**
 * 摩天轮静态底：A 字腿 + 双圈轮盘 + 八根辐条 + 桅杆小旗。
 *
 * **吊舱不在这张图里**（`drawFerrisCabin` 单独烘一张）：轮辐按 45° 自对称，
 * 旋转的视觉线索全部来自六个吊舱——它们沿圆环整数步进、始终直立，
 * 于是「轮子在慢慢转」既不需要多帧烘焙，也不会有任何浮点旋转把像素糊掉。
 */
function drawFerrisBase(g: Graphics): void {
  const { w, h } = ATTRACTIONS.ferris;
  const cx = w / 2;
  const cy = FERRIS_CY;
  const r = FERRIS_R;

  g.ellipse(cx, h - 4, 58, 6).fill({ color: C.ink, alpha: 0.18 });

  // 两条 A 字腿 + 底部横撑
  for (const [legX, footX] of [
    [cx - 26, cx - 50],
    [cx + 26, cx + 50],
  ] as const) {
    g.moveTo(legX, cy + 6).lineTo(footX, h - 6);
    g.stroke({ width: 6, color: C.ink });
    g.moveTo(legX, cy + 6).lineTo(footX, h - 6);
    g.stroke({ width: 3, color: C.wood });
  }
  box(g, cx - 44, h - 16, 88, 4, C.woodDark, C.ink);

  // 轮盘：外圈 + 内圈 + 八根辐条
  g.circle(cx, cy, r).stroke({ width: 5, color: C.ink });
  g.circle(cx, cy, r).stroke({ width: 3, color: C.lilac });
  g.circle(cx, cy, r - 10).stroke({ width: 2, color: C.lilacDark });
  for (const [dx, dy] of [
    [r, 0],
    [0, r],
    [-r, 0],
    [0, -r],
    [44, 44],
    [44, -44],
    [-44, 44],
    [-44, -44],
  ] as const) {
    g.moveTo(cx, cy).lineTo(cx + dx, cy + dy);
    g.stroke({ width: 2, color: C.inkSoft });
  }

  dot(g, cx, cy, 6, C.gold);
  rect(g, cx - 1, cy - r - 18, 2, 14, C.ink);
  g.poly([cx + 1, cy - r - 18, cx + 16, cy - r - 13, cx + 1, cy - r - 8]).fill(C.mint);
}

/** 吊舱：挂绳 + 舱体 + 亮面窗，锚点在吊舱顶部（挂在轮缘上，舱体始终直立） */
function drawFerrisCabin(g: Graphics): void {
  rect(g, 7, 0, 2, 5, C.ink);
  box(g, 0, 4, 16, 12, C.peach, C.ink);
  rect(g, 3, 6, 10, 3, C.cream);
  rect(g, 3, 11, 10, 1, C.peachDark);
}

/** 轮盘彩灯：3×3 的小灯泡，夜里逐颗亮灭 */
function drawFerrisBulb(g: Graphics): void {
  rect(g, 1, 0, 1, 3, C.cream);
  rect(g, 0, 1, 3, 1, C.cream);
}

/** 小火车：两节奶油车厢 + 红色车头，轮子做成黑点 */
function drawTrain(g: Graphics): void {
  const { w, h } = ATTRACTIONS.train;

  g.ellipse(w / 2, h - 2, w / 2 - 12, 3).fill({ color: C.ink, alpha: 0.16 });

  box(g, 2, h - 8, w - 4, 4, C.woodDark, C.ink);
  for (let i = 0; i < 9; i += 1) rect(g, 8 + i * 15, h - 6, 3, 2, C.cream);

  // 两节车厢：上亮窗 + 两只轮
  for (const cx of [8, 52]) {
    box(g, cx, 22, 40, 22, C.butter, C.ink);
    rect(g, cx + 3, 25, 34, 6, C.cream);
    for (const wx of [cx + 8, cx + 30]) dot(g, wx, h - 14, 4, C.ink, C.inkSoft);
  }

  // 车头：锅炉 + 双窗 + 烟囱与三团烟
  box(g, 92, 16, 40, 28, C.red, C.ink);
  rect(g, 96, 20, 14, 9, C.sky);
  rect(g, 114, 20, 12, 9, C.sky);
  box(g, 116, 2, 9, 14, C.inkSoft, C.ink);
  for (const [sx, sy, sr] of [
    [128, 8, 5],
    [134, 5, 4],
    [139, 3, 3],
  ] as const) {
    g.circle(sx, sy, sr).fill({ color: C.cream, alpha: 0.85 });
  }
  for (const wx of [100, 124]) dot(g, wx, h - 14, 5, C.ink, C.inkSoft);
}

/** 沙池：木框 + 奶油沙面 + 小红桶与蓝铲子 */
function drawSandpit(g: Graphics): void {
  const { w, h } = ATTRACTIONS.sandpit;

  box(g, 2, 18, w - 4, h - 20, C.wood, C.woodDark);
  rect(g, 6, 24, w - 12, h - 28, C.butter);
  for (const [sx, sy] of [
    [18, 32],
    [42, 44],
    [70, 30],
    [96, 40],
    [54, 26],
    [104, 52],
  ] as const) {
    dot(g, sx, sy, 2, C.cream, C.wood);
  }

  box(g, 22, 4, 14, 14, C.red, C.ink);
  rect(g, 24, 6, 10, 2, C.redLight);

  rect(g, 88, 2, 3, 20, C.woodDark);
  box(g, 84, 0, 11, 8, C.sky, C.ink);

  for (const px of [4, w - 8]) box(g, px, 12, 4, 8, C.woodDark, C.ink);
}

/** 喷泉：石台 + 椭圆水池 + 三层水盘 + 四道水柱 */
function drawFountain(g: Graphics): void {
  const { w, h } = ATTRACTIONS.fountain;
  const cx = w / 2;
  const pool = h - 34;

  g.ellipse(cx, h - 4, 48, 7).fill({ color: C.ink, alpha: 0.18 });

  box(g, 4, pool + 12, w - 8, 16, C.cream, C.ink);
  g.ellipse(cx, pool, 44, 16).fill(C.ink);
  g.ellipse(cx, pool, 42, 14).fill(C.cream);
  g.ellipse(cx, pool, 36, 10).fill(C.sky);

  box(g, cx - 3, h - 62, 6, 28, C.cream, C.ink);
  g.ellipse(cx, h - 62, 22, 8).fill(C.ink);
  g.ellipse(cx, h - 62, 20, 6).fill(C.cream);
  g.ellipse(cx, h - 62, 16, 4).fill(C.sky);

  for (const dx of [-8, -3, 2, 7]) rect(g, cx + dx, h - 78, 2, 14, C.mintLight);
  for (const [px, py] of [
    [cx - 14, h - 70],
    [cx + 12, h - 72],
    [cx - 4, h - 80],
    [cx + 6, h - 66],
  ] as const) {
    dot(g, px, py, 2, C.mintLight, C.sky);
  }

  g.ellipse(cx + 24, pool - 2, 8, 3).fill(C.mint);
}

function drawBalloons(g: Graphics): void {
  const colors = [C.red, C.sky, C.butter];
  colors.forEach((color, index) => {
    const cx = 8 + index * 7;
    const cy = 10 + (index % 2) * 4;
    rect(g, cx, cy + 8, 1, 18, C.ink);
    dot(g, cx, cy, 6, color, C.ink);
    rect(g, cx - 1, cy - 3, 2, 2, C.cream);
  });
}

/** 彩灯串：只画在 base 层，不进 y 排序，不参与碰撞 */
function drawStringLights(g: Graphics): void {
  const { x, y, w } = AMUSEMENT_PARK;
  const rows = [y + 60, y + 300, y + 540];
  rows.forEach((lineY, rowIndex) => {
    g.moveTo(x + 40, lineY).lineTo(x + w - 40, lineY).stroke({ width: 1, color: 0x5a6a7a });
    for (let px = x + 48; px < x + w - 40; px += 36) {
      const sway = (rowIndex + Math.floor(px / 36)) % 2 === 0 ? -2 : 2;
      dot(g, px, lineY + sway, 2, rowIndex % 2 === 0 ? C.gold : C.cream, C.inkSoft);
    }
  });
}

export class ParkView {
  private readonly textures: Texture[] = [];
  /** 入口彩灯 + 旋转木马两处地标光；灯柱本身由 propLights 统一出光 */
  readonly lights: LightSpec[];
  private readonly gateText: Text;
  /** 每个可排序件都带自己的深度键：滑梯用塔顶，其余用脚底 y */
  private readonly items: Array<{ root: Container; depthY: number }> = [];
  /** 六个吊舱：挂在轮缘、始终直立，靠整数圆环 LUT 绕圈 */
  private readonly cabins: Sprite[] = [];
  /** 一圈彩灯：只在夜里亮，逐颗错相脉冲 */
  private readonly bulbs: Sprite[] = [];
  /** 72 步整数圆环偏移（dx, dy 各一字节），构造期算一次 */
  private readonly ring: Int8Array;
  /** 轮盘中心在吊舱容器里的局部坐标（容器原点 = 精灵底边中心） */
  private readonly wheelX: number;
  private readonly wheelY: number;
  private lastStep = -1;
  private nightGain = 0;
  private nightSampledAt = Number.NEGATIVE_INFINITY;
  /** `?motion=0` 时全部时间量取 0：吊舱停在 0 步、彩灯停在首帧 */
  private readonly animate: boolean;
  /** 冬季：南门门头与柱脚积雪（纯表现层，`?season=off` 时不画） */
  private readonly winter: boolean;

  constructor(renderer: TextureFactory, devicePxPerTexel: number, animate = true, winter = false) {
    this.animate = animate;
    this.winter = winter;
    // 吊舱圆环：客户端表现层允许三角函数，且只在构造期算一次
    const ring = new Int8Array(FERRIS_STEPS * 2);
    for (let i = 0; i < FERRIS_STEPS; i += 1) {
      const angle = (i / FERRIS_STEPS) * Math.PI * 2;
      ring[i * 2] = Math.round(Math.cos(angle) * FERRIS_R);
      ring[i * 2 + 1] = Math.round(Math.sin(angle) * FERRIS_R);
    }
    this.ring = ring;
    this.wheelX = 0;
    this.wheelY = FERRIS_CY - ATTRACTIONS.ferris.h;
    // 旋转木马的灯随器械走：不再写死旧地图上的 (2560,5940)
    const carousel = PARK_RIDES.find((ride) => ride.kind === 'carousel');
    this.lights = [
      { x: PARK_SOUTH_GATE.x, y: PARK_SOUTH_GATE.y, radius: 62, color: 0xffd27a, intensity: 0.5, flicker: 0.12 },
      {
        x: carousel?.x ?? PARK_SOUTH_GATE.x,
        y: carousel?.y ?? PARK_SOUTH_GATE.y,
        radius: 88,
        color: 0xffc07a,
        intensity: 0.55,
        flicker: 0.1,
      },
    ];
    this.gateText = new Text({
      text: '游乐园',
      resolution: devicePxPerTexel,
      style: {
        fontFamily: CJK_FONT,
        fontSize: 11,
        fontWeight: '700',
        fill: C.cream,
        stroke: { color: C.ink, width: 2 },
        letterSpacing: 1,
      },
    });
    this.gateText.anchor.set(0.5, 1);

    const slideTexture = bake(renderer, drawSlide, { frame: new Rectangle(0, 0, SLIDE_ART.w, SLIDE_ART.h) });
    const gateTexture = bake(renderer, (g) => drawGate(g, this.winter), {
      frame: new Rectangle(0, 0, GATE_ART.w, GATE_ART.h),
    });
    const swingTexture = bake(renderer, drawSwing, { frame: new Rectangle(0, 0, SWING_ART.w, SWING_ART.h) });
    const seesawTexture = bake(renderer, drawSeesaw, { frame: new Rectangle(0, 0, SEESAW_ART.w, SEESAW_ART.h) });
    const carouselTexture = bake(renderer, drawCarousel, { frame: new Rectangle(0, 0, CAROUSEL_ART.w, CAROUSEL_ART.h) });
    const balloonTexture = bake(renderer, drawBalloons, { frame: new Rectangle(0, 0, 30, 36) });

    const attractionTextures: Record<ParkAttractionKind, Texture> = {
      ferris: bake(renderer, drawFerrisBase, {
        frame: new Rectangle(0, 0, ATTRACTIONS.ferris.w, ATTRACTIONS.ferris.h),
      }),
      train: bake(renderer, drawTrain, { frame: new Rectangle(0, 0, ATTRACTIONS.train.w, ATTRACTIONS.train.h) }),
      sandpit: bake(renderer, drawSandpit, {
        frame: new Rectangle(0, 0, ATTRACTIONS.sandpit.w, ATTRACTIONS.sandpit.h),
      }),
      fountain: bake(renderer, drawFountain, {
        frame: new Rectangle(0, 0, ATTRACTIONS.fountain.w, ATTRACTIONS.fountain.h),
      }),
    };

    const cabinTexture = bake(renderer, drawFerrisCabin, {
      frame: new Rectangle(0, 0, FERRIS_CABIN_ART.w, FERRIS_CABIN_ART.h),
    });
    const bulbTexture = bake(renderer, drawFerrisBulb, {
      frame: new Rectangle(0, 0, FERRIS_BULB_ART.w, FERRIS_BULB_ART.h),
    });

    this.textures.push(
      slideTexture,
      gateTexture,
      swingTexture,
      seesawTexture,
      carouselTexture,
      balloonTexture,
      cabinTexture,
      bulbTexture,
      ...Object.values(attractionTextures),
    );

    const slide = new Sprite(slideTexture);
    slide.anchor.set(0.5, 1);
    slide.position.set(PARK_SLIDE.hit.x + PARK_SLIDE.hit.w / 2, PARK_SLIDE.hit.y + PARK_SLIDE.hit.h);
    this.push(this.wrap(slide), PARK_SLIDE.top.y);

    // 南门：门头精灵 + Pixi 中文「游乐园」（正对北向主路，进门即园）
    const gate = new Container();
    gate.position.set(PARK_SOUTH_GATE.x, PARK_SOUTH_GATE.y);
    const gateSprite = new Sprite(gateTexture);
    gateSprite.anchor.set(0.5, 1);
    gateSprite.position.set(0, 8);
    this.gateText.position.set(0, -34);
    gate.addChild(gateSprite, this.gateText);
    this.push(gate, PARK_SOUTH_GATE.y);

    const balloons = new Sprite(balloonTexture);
    balloons.anchor.set(0.5, 1);
    balloons.position.set(PARK_SOUTH_GATE.x - 46, PARK_SOUTH_GATE.y + 16);
    this.push(this.wrap(balloons), PARK_SOUTH_GATE.y + 16);

    const textures: Record<string, Texture> = {
      swing: swingTexture,
      seesaw: seesawTexture,
      carousel: carouselTexture,
    };
    for (const ride of PARK_RIDES) {
      const sprite = new Sprite(textures[ride.kind]!);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(ride.x, ride.y);
      this.push(this.wrap(sprite), ride.y);
    }

    // 大件器械：共用一份包围盒，深度键取脚底，玩家从正面走过来时压在自己身前
    for (const attraction of PARK_ATTRACTIONS) {
      const sprite = new Sprite(attractionTextures[attraction.kind]);
      sprite.anchor.set(0.5, 1);
      const footY = attraction.y + attraction.h / 2;
      sprite.position.set(attraction.x, footY);
      const root = this.wrap(sprite);
      // 摩天轮的吊舱与彩灯挂进同一个容器：它们和轮盘共用一条深度键，
      // 不会被自己的基座或树干插到中间；容器原点 = 精灵底边中心。
      if (attraction.kind === 'ferris') this.attachFerris(root, cabinTexture, bulbTexture);
      this.push(root, footY);
    }
  }

  /**
   * 把六只吊舱与十二盏彩灯挂到摩天轮容器上。
   *
   * 吊舱锚点在顶部（吊在轮缘）、舱体始终直立；位置由 `update()` 按 72 步 LUT 刷新，
   * 因此这里只建精灵，不做任何浮点旋转。
   */
  private attachFerris(root: Container, cabinTexture: Texture, bulbTexture: Texture): void {
    for (let i = 0; i < FERRIS_CABIN_COUNT; i += 1) {
      const cabin = new Sprite(cabinTexture);
      cabin.anchor.set(0.5, 0);
      root.addChild(cabin);
      this.cabins.push(cabin);
    }
    for (let i = 0; i < FERRIS_BULB_COUNT; i += 1) {
      const bulb = new Sprite(bulbTexture);
      bulb.anchor.set(0.5, 0.5);
      // 一圈 12 盏三色轮换，暖白 / 蜜桃 / 薄荷，夜里读得出「游乐园的灯」
      bulb.tint = i % 3 === 0 ? C.cream : i % 3 === 1 ? C.peach : C.mint;
      bulb.visible = false;
      root.addChild(bulb);
      this.bulbs.push(bulb);
    }
    // 先摆一次 0 步：没有 update 调用（如 `?motion=0`）时也是一圈完整的轮盘
    this.applyFerrisStep(0);
  }

  /** 按步号把六只吊舱摆到圆环上（72 步 / 6 只 = 每只间隔 12 步） */
  private applyFerrisStep(step: number): void {
    const ring = this.ring;
    const span = FERRIS_STEPS / FERRIS_CABIN_COUNT;
    for (let i = 0; i < this.cabins.length; i += 1) {
      const index = ((step + i * span) % FERRIS_STEPS) * 2;
      const cabin = this.cabins[i]!;
      cabin.position.set(this.wheelX + ring[index]!, this.wheelY + ring[index + 1]! + 2);
    }
    for (let i = 0; i < this.bulbs.length; i += 1) {
      const index = ((step + i * (FERRIS_STEPS / FERRIS_BULB_COUNT)) % FERRIS_STEPS) * 2;
      this.bulbs[i]!.position.set(this.wheelX + ring[index]!, this.wheelY + ring[index + 1]!);
    }
  }

  /**
   * 每帧推进：吊舱换步 + 彩灯脉冲。
   * 掉帧只影响「下一次换步」，不累积误差——步号永远由绝对时间算出。
   */
  update(nowMs: number): void {
    const now = this.animate ? nowMs : 0;
    const step = ferrisStep(now, FERRIS_PERIOD_MS, FERRIS_STEPS);
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.applyFerrisStep(step);
    }

    // 夜间增益 30s 采样一次：白天整圈灯不画，省掉 12 次 alpha 写入
    if (nowMs - this.nightSampledAt >= 30_000) {
      this.nightSampledAt = nowMs;
      const tone = lightToneAt(serverHourFraction(serverNow(), serverTzOffsetMin()));
      this.nightGain = tone.label === 'night' ? 1 : tone.label === 'dusk' ? 0.55 : 0;
    }
    for (let i = 0; i < this.bulbs.length; i += 1) {
      const bulb = this.bulbs[i]!;
      const alpha = this.nightGain * (0.35 + 0.65 * bulbPulse(i * 13 + 5, now));
      const visible = alpha > 0.04;
      if (bulb.visible !== visible) bulb.visible = visible;
      if (visible) bulb.alpha = alpha;
    }
  }

  private wrap(sprite: Sprite): Container {
    const root = new Container();
    root.addChild(sprite);
    return root;
  }

  private push(root: Container, depthY: number): void {
    this.items.push({ root, depthY });
  }

  /**
   * `base` 收灯串（贴地、始终在角色下方）；`depth` 收立体器械。
   * ADR-0103 之后游乐园不再围矮栅栏，场地边界交给橡胶地面本身。
   * 滑梯的深度键用塔顶而不是落地点：角色沿滑道下来时不会被整张精灵盖住。
   */
  build(depth: DepthSink, base: Container): void {
    const lights = new Graphics();
    drawStringLights(lights);
    base.addChild(lights);

    for (const item of this.items) depth.add(item.depthY, item.root);
  }

  setTextResolution(devicePxPerTexel: number): void {
    this.gateText.resolution = devicePxPerTexel;
  }

  destroy(): void {
    // 吊舱与彩灯是摩天轮容器的子节点，随 `items` 一起销毁；这里只清引用
    this.cabins.length = 0;
    this.bulbs.length = 0;
    for (const item of this.items) item.root.destroy({ children: true });
    this.items.length = 0;
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
  }
}
