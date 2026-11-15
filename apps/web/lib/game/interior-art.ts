'use client';

import { Container, Graphics, Rectangle, Sprite, type Application, type Texture } from 'pixi.js';
import {
  JAIL_ANCHOR,
  RESTROOM_STALLS,
  THEATER_SCREEN,
  THEATER_SEATS,
  THEATER_SPEAKERS,
  WORLD_LAYOUT,
  type BuildingSpec,
  type PropInstance,
  type SeatInstance,
  type WorldRect,
} from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import { LOUNGE_DECOR, RESTROOM_DECOR, WORK_DECOR } from './interior-spots';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';
import { badContactFlicker, warmGlowBreath } from './venue-motion';
import { MEETING_SCREEN_RECT } from './venue-spots';

/**
 * 室内陈设补完层：会议室、宿舍区、工作区、卫生间的「第二层细节」。
 *
 * 为什么不往 `WORLD_LAYOUT.props` 里加：`PropKind` 是双端共享的契约，
 * 加一种家具就要动 `packages/shared-types`，还要和服务端一起发版；
 * 而这里画的全部是**无碰撞**的墙面与地面陈设，渲染层自己算得出来。
 * 同理，所有坐标都贴墙——贴墙的位置本来就站在墙的碰撞盒里，
 * 玩家不可能「站进衣柜」，也就不需要为它们补碰撞。
 *
 * 画风沿用 `props.ts`：1px 深靛描边 + 糖果色点缀，每件都带一处生活细节；
 * 平面装饰写进 `flat`（始终在角色下方），立式摆件走 `place()` 按脚底 y 排序。
 */

type TextureFactory = Application['renderer'];

const COLOR = {
  outline: 0x2a3142,
  shadow: 0x1e2846,
  woodLight: 0xe0b48a,
  woodDark: 0x8a6446,
  woodSeam: 0xb5835a,
  metal: 0x9aa5b4,
  fixture: 0xe6ebf0,
  fixtureEdge: 0xa3afbd,
  ceramic: 0xfdfdff,
  ceramicEdge: 0xc4d0dc,
  mint: 0x8fe3c7,
  mintDark: 0x5cc4a0,
  butter: 0xffe49a,
  sky: 0x9fd3ff,
  skyDark: 0x6aa8e0,
  peach: 0xffb59e,
  peachDark: 0xe8856d,
  lilac: 0xc9b6ff,
  lilacDark: 0x9c84e8,
  leaf: 0x6fcf8e,
  leafDark: 0x3f9e66,
  glow: 0xfff0b8,
  screen: 0x9ff5d2,
  carpet: 0xdcbb96,
  carpetDark: 0xcaa680,
  tileSeam: 0xbfd0dc,
  tileDeep: 0xd7e3eb,
  nightSky: 0x3a4a6b,
  snow: 0xe9f0f7,
  snowShade: 0xd3dfec,
  // 会议室：冷灰地毯、深胡桃木、冷蓝投屏
  carpetSlate: 0x3c414b,
  carpetSlateLight: 0x474e5a,
  carpetSlateDeep: 0x2c313a,
  walnut: 0x4a3226,
  walnutLight: 0x6b4a35,
  walnutDark: 0x2f201a,
  screenBezel: 0x1b2436,
  screenGlass: 0x14263f,
  screenCyan: 0x7fd6ff,
  screenInk: 0x2f6f9e,
  coolWhite: 0xdfeaf5,
  // 宿舍：暖黄壁灯、软木留言板、牛皮纸箱
  amber: 0xffd27a,
  amberDeep: 0xe8a94f,
  cork: 0xc9985f,
  corkDark: 0x9a6f3f,
  corkFace: 0xd8ad78,
  kraft: 0xd8b183,
  kraftLight: 0xe8c39b,
  // 卫生间：薄荷马赛克、冷白瓷、深灰地漏
  mintTile: 0xb8ead9,
  mintTileAlt: 0xdcf6ec,
  mintTileDeep: 0x8fd3bd,
  mintSeam: 0xa9d8c7,
  porcelain: 0xfdfdff,
  chrome: 0xc7d3dd,
  drain: 0x4a4f57,
  water: 0xbfe6f5,
} as const;

function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number = COLOR.outline): void {
  g.roundRect(x, y, w, h, 2).fill(line);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 1).fill(fill);
}

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

/** 半透明硬边色块：光晕、水渍、月光都只用一档 alpha，不引入柔化滤镜 */
function wash(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number): void {
  g.rect(x, y, w, h).fill({ color, alpha });
}

function shadow(g: Graphics, cx: number, cy: number, rx: number, ry: number): void {
  g.ellipse(cx, cy, rx, ry).fill({ color: COLOR.shadow, alpha: 0.2 });
}

function dot(g: Graphics, cx: number, cy: number, r: number, fill: number, line: number = COLOR.outline): void {
  g.circle(cx, cy, r + 1).fill(line);
  g.circle(cx, cy, r).fill(fill);
}

/* ------------------------------------------------------------------ *
 * 3×5 像素字形：只用来写 OKR 与倒计时数字，中文继续用点阵字块
 * ------------------------------------------------------------------ */

const GLYPHS: Record<string, readonly number[]> = {
  O: [0b111, 0b101, 0b101, 0b101, 0b111],
  K: [0b101, 0b110, 0b100, 0b110, 0b101],
  R: [0b110, 0b101, 0b110, 0b101, 0b101],
  '3': [0b111, 0b001, 0b011, 0b001, 0b111],
  '5': [0b111, 0b100, 0b110, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
};

function glyph(g: Graphics, x: number, y: number, key: string, color: number, scale = 1): void {
  const rows = GLYPHS[key];
  if (!rows) return;
  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < 3; col += 1) {
      if ((row & (1 << (2 - col))) !== 0) {
        g.rect(x + col * scale, y + rowIndex * scale, scale, scale).fill(color);
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 * 家具贴图：只在构造期烘焙一次，尺寸全部按「角色 48 texel」定
 * ------------------------------------------------------------------ */

const WARDROBE = { w: 26, h: 42 };
const BOOKSHELF = { w: 26, h: 34 };
const CART = { w: 20, h: 18 };
const PRINTER = { w: 24, h: 18 };
const BOXES = { w: 20, h: 16 };
const FLOOR_LAMP = { w: 12, h: 36 };
const STAND_BOARD = { w: 22, h: 34 };
const LUGGAGE_RACK = { w: 20, h: 16 };
const HAND_DRYER = { w: 8, h: 12 };
const MEETING_BOARD = { w: 46, h: 50 };
const MONEY_TREE = { w: 30, h: 46 };
const WATER_COOLER = { w: 24, h: 40 };
const FOLDING_CHAIRS = { w: 30, h: 36 };
const COAT_RACK = { w: 24, h: 46 };
const HOT_CUP = { w: 12, h: 14 };
const WATER_DRIP = { w: 4, h: 6 };
const DIFFUSER = { w: 12, h: 26 };
const POTHOS = { w: 18, h: 30 };

/** 衣柜：两扇深胡桃木门 + 把手 + 顶面一条亮边，门缝里透出一点暖色（柜里有灯） */
function drawWardrobe(g: Graphics): void {
  shadow(g, 13, 40, 12, 2);
  box(g, 1, 2, 24, 38, COLOR.walnutLight, COLOR.walnutDark);
  rect(g, 2, 3, 22, 1, 0x8a6446);
  box(g, 3, 8, 9, 30, COLOR.walnut, COLOR.walnutDark);
  box(g, 14, 8, 9, 30, COLOR.walnut, COLOR.walnutDark);
  // 门缝透出的暖光：柜里挂着一盏小灯，这条亮线是「有人住」的信号
  rect(g, 12, 10, 2, 26, COLOR.amber);
  rect(g, 11, 22, 1, 3, COLOR.walnutDark);
  rect(g, 14, 22, 1, 3, COLOR.walnutDark);
  rect(g, 4, 11, 7, 1, 0x8a6446);
  rect(g, 15, 11, 7, 1, 0x8a6446);
  // 柜门下方的磨损亮边
  rect(g, 5, 34, 5, 1, 0x8a6446);
}

/** 书架：四层书脊，颜色随机感由固定色表给出，不用随机数 */
function drawBookshelf(g: Graphics): void {
  shadow(g, 13, 32, 12, 2);
  box(g, 1, 2, 24, 30, COLOR.walnutLight, COLOR.walnutDark);
  const spines = [COLOR.mintDark, COLOR.skyDark, COLOR.peachDark, COLOR.lilacDark, COLOR.butter];
  for (let row = 0; row < 4; row += 1) {
    const y = 5 + row * 7;
    rect(g, 3, y + 5, 20, 1, COLOR.walnutDark);
    for (let i = 0; i < 6; i += 1) {
      const w = 2 + ((row + i) % 2);
      const x = 3 + i * 3.4;
      rect(g, x, y, w, 5, spines[(row * 2 + i) % spines.length]!);
    }
  }
  // 柜脚
  rect(g, 3, 30, 2, 2, COLOR.walnutDark);
  rect(g, 21, 30, 2, 2, COLOR.walnutDark);
}

/** 零食推车：两层小货架，上层左边空一格（被拿走了） */
function drawCart(g: Graphics): void {
  shadow(g, 10, 16, 9, 2);
  box(g, 1, 6, 18, 4, COLOR.metal, COLOR.outline);
  box(g, 1, 12, 18, 4, COLOR.metal, COLOR.outline);
  rect(g, 2, 7, 16, 1, COLOR.fixture);
  rect(g, 2, 13, 16, 1, COLOR.fixture);
  box(g, 3, 2, 6, 4, COLOR.peach);
  box(g, 11, 2, 6, 4, COLOR.butter);
  box(g, 3, 8, 5, 4, COLOR.mint);
  box(g, 10, 8, 7, 4, COLOR.sky);
  rect(g, 3, 16, 1, 2, COLOR.metal);
  rect(g, 16, 16, 1, 2, COLOR.metal);
}

/** 打印机：出纸口的白纸是「还在用」的证据 */
function drawPrinter(g: Graphics): void {
  shadow(g, 12, 16, 11, 2);
  box(g, 1, 4, 22, 12, COLOR.fixture, COLOR.fixtureEdge);
  rect(g, 3, 6, 18, 1, COLOR.ceramic);
  box(g, 4, 1, 16, 3, COLOR.tileDeep, COLOR.fixtureEdge);
  box(g, 9, 9, 6, 2, COLOR.metal);
  rect(g, 6, 12, 12, 1, COLOR.ceramicEdge);
  // 出纸口：一张刚吐出来的纸，斜出一格
  rect(g, 12, 12, 8, 3, COLOR.ceramic);
  rect(g, 14, 13, 4, 1, COLOR.carpetDark);
  dot(g, 20, 7, 1, COLOR.mintDark);
}

/** 纸箱堆：三个箱子错落叠放，最小那个还没拆 */
function drawBoxes(g: Graphics): void {
  shadow(g, 10, 14, 9, 2);
  box(g, 1, 7, 11, 8, COLOR.woodLight, COLOR.woodDark);
  box(g, 8, 4, 10, 11, 0xe8c39b, COLOR.woodDark);
  box(g, 13, 0, 6, 5, 0xf0cdaa, COLOR.woodDark);
  rect(g, 2, 9, 9, 1, COLOR.woodSeam);
  rect(g, 9, 7, 9, 1, COLOR.woodSeam);
  // 封箱胶带：一小段亮色横条，箱子才不是三块褐色方块
  rect(g, 4, 11, 5, 1, COLOR.butter);
}

/** 落地灯：三脚底座 + 锥形灯罩 + 一圈暖光（工作区没有墙，靠它提亮角落） */
function drawFloorLamp(g: Graphics): void {
  g.circle(6, 6, 9).fill({ color: COLOR.glow, alpha: 0.22 });
  rect(g, 5, 8, 2, 25, COLOR.metal);
  box(g, 2, 32, 8, 3, COLOR.outline, COLOR.outline);
  g.roundRect(1, 1, 10, 8, 3).fill(COLOR.outline);
  g.roundRect(2, 2, 8, 6, 2).fill(COLOR.butter);
  rect(g, 3, 3, 2, 2, COLOR.glow);
}

/** 白板立架：没有墙的工作区用立架挂流程，板面留三道笔迹 */
function drawStandBoard(g: Graphics): void {
  shadow(g, 11, 32, 10, 2);
  box(g, 1, 1, 20, 16, COLOR.fixture, COLOR.fixtureEdge);
  rect(g, 3, 3, 16, 12, COLOR.ceramic);
  rect(g, 5, 6, 9, 1, COLOR.skyDark);
  rect(g, 5, 9, 12, 1, COLOR.peachDark);
  rect(g, 5, 12, 6, 1, COLOR.mintDark);
  box(g, 4, 17, 2, 14, COLOR.metal);
  box(g, 16, 17, 2, 14, COLOR.metal);
  box(g, 3, 29, 16, 2, COLOR.metal);
}

/** 行李架：两根胡桃木横杆 + 折叠的毯子，宿舍里最像「住人」的一件 */
function drawLuggageRack(g: Graphics): void {
  shadow(g, 10, 14, 9, 2);
  box(g, 1, 5, 18, 2, COLOR.walnutLight, COLOR.walnutDark);
  box(g, 1, 10, 18, 2, COLOR.walnutLight, COLOR.walnutDark);
  box(g, 3, 7, 3, 7, COLOR.walnutDark);
  box(g, 14, 7, 3, 7, COLOR.walnutDark);
  box(g, 5, 1, 10, 5, COLOR.peach, COLOR.peachDark);
  rect(g, 6, 3, 8, 1, 0xffd6c2);
  rect(g, 7, 1, 2, 1, COLOR.butter);
}

/** 烘手机：东墙上的小白盒，出风口压一道暗边 */
function drawHandDryer(g: Graphics): void {
  box(g, 0, 0, 8, 10, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, 1, 2, 6, 1, COLOR.fixtureEdge);
  rect(g, 2, 8, 4, 1, COLOR.fixtureEdge);
  dot(g, 6, 4, 1, COLOR.mintDark);
}

/* ------------------------------------------------------------------ *
 * 会议室细节
 * ------------------------------------------------------------------ */

/** 白板立架：红蓝箭头思维导图 + 黄色便利贴 + 没擦干净的笔迹 */
function drawMeetingBoard(g: Graphics): void {
  shadow(g, 23, 48, 20, 2);
  // 两条腿 + 横杆
  box(g, 5, 30, 3, 18, COLOR.metal, COLOR.outline);
  box(g, 38, 30, 3, 18, COLOR.metal, COLOR.outline);
  box(g, 6, 46, 34, 2, COLOR.metal, COLOR.outline);
  // 白板
  box(g, 1, 2, 44, 32, COLOR.fixture, COLOR.fixtureEdge);
  rect(g, 3, 4, 40, 28, COLOR.ceramic);
  // 没擦干净的思维导图：中心红节点 + 蓝红箭头 + 三个分支
  box(g, 18, 13, 6, 5, COLOR.peach, COLOR.peachDark);
  rect(g, 19, 14, 4, 2, COLOR.peachDark);
  rect(g, 12, 9, 6, 1, COLOR.skyDark);
  rect(g, 12, 9, 1, 4, COLOR.skyDark);
  g.poly([10, 9, 13, 8, 13, 10]).fill(COLOR.skyDark);
  rect(g, 24, 19, 7, 1, COLOR.peachDark);
  rect(g, 30, 19, 1, 5, COLOR.peachDark);
  g.poly([30, 24, 29, 21, 31, 21]).fill(COLOR.peachDark);
  rect(g, 8, 20, 7, 1, COLOR.skyDark);
  rect(g, 14, 16, 1, 5, COLOR.skyDark);
  // 黄色便利贴：三张，边角翘起
  const notes: Array<[number, number]> = [
    [6, 6],
    [31, 7],
    [36, 22],
  ];
  for (const [sx, sy] of notes) {
    box(g, sx, sy, 7, 6, COLOR.butter, COLOR.amberDeep);
    rect(g, sx + 1, sy + 1, 5, 1, COLOR.glow);
    rect(g, sx + 2, sy + 3, 4, 1, COLOR.amberDeep);
  }
  // 板擦痕：几道浅灰斜线
  rect(g, 25, 26, 10, 1, 0xd3dfe8);
  rect(g, 28, 28, 6, 1, 0xd3dfe8);
  rect(g, 8, 25, 8, 1, 0xd3dfe8);
  // 笔槽：红蓝两支马克笔
  rect(g, 4, 32, 38, 1, COLOR.fixtureEdge);
  rect(g, 7, 31, 4, 1, COLOR.peachDark);
  rect(g, 12, 31, 4, 1, COLOR.skyDark);
}

/** 发财树：编织树干 + 三团叶 + 金币点缀，会议室里最像「老板」的一件 */
function drawMoneyTree(g: Graphics): void {
  shadow(g, 15, 44, 11, 2);
  // 陶盆 + 金色腰线
  box(g, 8, 34, 14, 10, COLOR.peach, COLOR.peachDark);
  rect(g, 9, 35, 12, 1, 0xffd6c2);
  rect(g, 8, 39, 14, 1, COLOR.amber);
  // 编织树干
  rect(g, 14, 24, 2, 11, COLOR.corkDark);
  rect(g, 12, 22, 1, 12, COLOR.cork);
  rect(g, 17, 22, 1, 12, COLOR.cork);
  rect(g, 13, 26, 4, 1, COLOR.cork);
  rect(g, 13, 30, 4, 1, COLOR.cork);
  // 冠层：三团深叶 + 两团亮叶
  dot(g, 9, 14, 5, COLOR.leafDark);
  dot(g, 21, 13, 5, COLOR.leafDark);
  dot(g, 15, 8, 6, COLOR.leaf);
  dot(g, 11, 18, 4, COLOR.leaf);
  dot(g, 20, 19, 4, COLOR.leaf);
  // 金叶 / 金币
  rect(g, 13, 5, 2, 2, COLOR.butter);
  rect(g, 7, 12, 2, 1, COLOR.amber);
  rect(g, 22, 16, 2, 1, COLOR.amber);
  rect(g, 17, 10, 1, 2, COLOR.amberDeep);
  // 红丝带
  rect(g, 14, 30, 2, 4, COLOR.peachDark);
  rect(g, 13, 33, 4, 1, COLOR.peachDark);
}

/** 静音双温饮水机：蓝桶 + 红蓝双龙头 + 接水槽 */
function drawWaterCooler(g: Graphics): void {
  shadow(g, 12, 38, 10, 2);
  // 天蓝色水桶
  box(g, 5, 0, 14, 11, COLOR.sky, COLOR.skyDark);
  rect(g, 6, 1, 12, 2, 0xd9efff);
  rect(g, 11, 5, 2, 5, COLOR.skyDark);
  // 机身
  box(g, 3, 11, 18, 25, COLOR.fixture, COLOR.fixtureEdge);
  rect(g, 5, 13, 14, 1, COLOR.ceramic);
  // 双温龙头：蓝 / 红，下面是接水槽
  rect(g, 7, 17, 3, 2, COLOR.skyDark);
  rect(g, 14, 17, 3, 2, COLOR.peachDark);
  rect(g, 8, 19, 1, 4, COLOR.chrome);
  rect(g, 15, 19, 1, 4, COLOR.chrome);
  box(g, 9, 24, 9, 4, 0xd7e3eb, COLOR.fixtureEdge);
  rect(g, 11, 25, 5, 1, COLOR.drain);
  // 静音标识：两段短横线（不出声）
  rect(g, 5, 31, 2, 1, COLOR.mintDark);
  rect(g, 8, 31, 4, 1, COLOR.mintDark);
  rect(g, 5, 33, 7, 1, COLOR.fixtureEdge);
  // 底座
  rect(g, 3, 35, 18, 2, COLOR.fixtureEdge);
}

/** 一摞备用折叠椅：三把错位叠放，金属腿 + 深蓝座面 */
function drawFoldingChairs(g: Graphics): void {
  shadow(g, 15, 34, 12, 2);
  for (let i = 0; i < 3; i += 1) {
    const cx = 4 + i * 2;
    const cy = 14 - i * 3;
    // 椅背、座面、两根腿、横撑：越靠前越近镜头
    box(g, cx + 1, cy - 6, 16, 6, 0x5b6680, COLOR.outline);
    box(g, cx, cy, 18, 4, 0x4a5470, COLOR.outline);
    rect(g, cx + 1, cy + 1, 16, 1, 0x8f9ab0);
    rect(g, cx + 2, cy + 4, 1, 14, COLOR.metal);
    rect(g, cx + 15, cy + 4, 1, 14, COLOR.metal);
    rect(g, cx + 2, cy + 17, 14, 1, COLOR.metal);
  }
}

/** 挂衣架：未洗的工服 + 安全帽 + 工牌，宿舍里最「过载」的一件 */
function drawCoatRack(g: Graphics): void {
  shadow(g, 12, 44, 8, 2);
  // 底座 + 立杆
  box(g, 3, 41, 18, 3, COLOR.walnut, COLOR.walnutDark);
  rect(g, 11, 10, 2, 31, COLOR.walnutLight);
  rect(g, 11, 10, 1, 31, 0x8a6446);
  // 挂钩
  rect(g, 7, 12, 8, 1, COLOR.walnutDark);
  rect(g, 13, 18, 7, 1, COLOR.walnutDark);
  rect(g, 4, 12, 1, 3, COLOR.walnutDark);
  rect(g, 19, 18, 1, 3, COLOR.walnutDark);
  // 安全帽
  g.roundRect(3, 2, 9, 6, 2).fill(COLOR.outline);
  g.roundRect(4, 3, 7, 4, 1).fill(COLOR.butter);
  rect(g, 4, 6, 7, 1, COLOR.amberDeep);
  // 未洗的工服：蓝色连体服，口袋边有一块污渍
  box(g, 3, 13, 8, 16, COLOR.sky, COLOR.skyDark);
  rect(g, 4, 14, 6, 2, 0xd9efff);
  rect(g, 5, 20, 4, 1, COLOR.skyDark);
  rect(g, 8, 26, 2, 2, COLOR.corkDark);
  // 两条裤腿
  box(g, 3, 29, 3, 10, COLOR.skyDark, COLOR.outline);
  box(g, 8, 29, 3, 10, COLOR.skyDark, COLOR.outline);
  // 工牌：挂在衣服前襟
  box(g, 12, 15, 5, 7, COLOR.ceramic, COLOR.fixtureEdge);
  rect(g, 13, 17, 3, 1, COLOR.skyDark);
  rect(g, 13, 19, 2, 1, COLOR.fixtureEdge);
}

/** 床头热水杯：枸杞茶 + 两缕白汽，杯把手是一条 1px 弧 */
function drawHotCup(g: Graphics): void {
  // 白汽：两缕 1px，一高一低，交替断开
  g.rect(4, 0, 1, 2).fill({ color: COLOR.ceramic, alpha: 0.7 });
  g.rect(3, 2, 1, 1).fill({ color: COLOR.ceramic, alpha: 0.45 });
  g.rect(7, 1, 1, 2).fill({ color: COLOR.ceramic, alpha: 0.55 });
  g.rect(8, 3, 1, 1).fill({ color: COLOR.ceramic, alpha: 0.35 });
  // 杯身
  box(g, 2, 5, 8, 9, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, 3, 6, 6, 1, COLOR.coolWhite);
  // 枸杞茶
  rect(g, 3, 8, 6, 4, COLOR.peach);
  rect(g, 3, 8, 6, 1, COLOR.peachDark);
  rect(g, 4, 9, 1, 1, COLOR.peachDark);
  rect(g, 6, 10, 1, 1, COLOR.peachDark);
  // 把手
  g.roundRect(9, 7, 2, 5, 1).stroke({ width: 1, color: COLOR.outline });
}

/** 水龙头下的一滴微弱水滴 */
function drawWaterDrip(g: Graphics): void {
  g.rect(1, 0, 1, 1).fill({ color: COLOR.water, alpha: 0.55 });
  g.rect(1, 1, 2, 2).fill({ color: COLOR.water, alpha: 0.75 });
  g.rect(1, 2, 1, 1).fill(0xeaf4f8);
  g.rect(0, 3, 1, 1).fill({ color: COLOR.water, alpha: 0.35 });
}

/** 除臭香薰：玻璃瓶 + 四根藤条 + 两粒香气 */
function drawDiffuser(g: Graphics): void {
  shadow(g, 6, 24, 5, 2);
  // 藤条：四根，长短不一
  for (let i = 0; i < 4; i += 1) {
    rect(g, 3 + i * 2, 2 + i, 1, 13 - i, COLOR.cork);
  }
  // 玻璃瓶
  box(g, 2, 15, 8, 9, 0xdceef6, COLOR.fixtureEdge);
  rect(g, 3, 17, 6, 4, COLOR.water);
  rect(g, 3, 22, 6, 1, COLOR.fixtureEdge);
  // 瓶口
  rect(g, 3, 14, 6, 1, COLOR.chrome);
  // 香气：两粒 1px
  rect(g, 0, 7, 1, 1, COLOR.mint);
  rect(g, 10, 10, 1, 1, COLOR.mint);
}

/** 绿萝：白盆 + 两条垂藤 + 心形叶，角落里的顽强生命 */
function drawPothos(g: Graphics): void {
  shadow(g, 9, 28, 7, 2);
  // 白盆
  box(g, 5, 20, 8, 8, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, 6, 21, 6, 1, COLOR.coolWhite);
  // 垂下的两条藤
  rect(g, 4, 17, 1, 8, COLOR.leafDark);
  rect(g, 13, 16, 1, 10, COLOR.leafDark);
  // 心形叶：深浅两档 + 每片一点高光
  const leaves: Array<[number, number]> = [
    [4, 10],
    [7, 7],
    [11, 11],
    [14, 6],
    [9, 14],
    [14, 17],
    [6, 16],
  ];
  for (const [lx, ly] of leaves) {
    g.circle(lx, ly, 2).fill(COLOR.leafDark);
    g.circle(lx, ly, 1).fill(COLOR.leaf);
    rect(g, lx, ly - 1, 1, 1, COLOR.mint);
  }
  // 顽强生长的新芽
  rect(g, 13, 15, 1, 2, COLOR.leaf);
  rect(g, 12, 15, 1, 1, COLOR.mint);
}

/* ------------------------------------------------------------------ *
 * 会议桌与桌面小物（平面层，画在桌面之上、角色之下）
 * ------------------------------------------------------------------ */

function drawLaptop(g: Graphics, x: number, y: number): void {
  wash(g, x - 1, y - 1, 14, 12, COLOR.screenCyan, 0.1);
  box(g, x, y + 6, 12, 4, 0x2f3a4a, COLOR.outline);
  box(g, x + 1, y, 10, 7, 0x2f3a4a, COLOR.outline);
  rect(g, x + 2, y + 1, 8, 5, COLOR.screenGlass);
  rect(g, x + 3, y + 2, 6, 1, COLOR.screenCyan);
  rect(g, x + 3, y + 4, 4, 1, 0x5aa6c9);
}

function drawIcedCoffee(g: Graphics, x: number, y: number): void {
  box(g, x, y, 6, 8, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, x + 1, y + 2, 4, 5, 0x6b4a35);
  rect(g, x + 1, y + 2, 4, 1, COLOR.cork);
  rect(g, x + 2, y + 3, 1, 1, 0xeaf4f8);
  rect(g, x + 4, y + 4, 1, 1, 0xeaf4f8);
  rect(g, x + 4, y - 4, 1, 5, COLOR.coolWhite);
  rect(g, x + 4, y - 4, 1, 1, COLOR.peachDark);
  rect(g, x, y + 3, 6, 1, COLOR.cork);
  // 冷凝水：杯壁两粒
  rect(g, x - 1, y + 5, 1, 1, COLOR.water);
  rect(g, x + 6, y + 6, 1, 1, COLOR.water);
}

function drawPaperBall(g: Graphics, x: number, y: number): void {
  rect(g, x, y, 4, 3, COLOR.outline);
  rect(g, x + 1, y, 2, 3, 0xeef2f5);
  rect(g, x, y + 1, 4, 1, 0xeef2f5);
  rect(g, x + 1, y + 1, 1, 1, 0xc4d0dc);
}

/** 深胡桃木会议桌：冷白高光、45° 阶梯反光、木纹与线缆孔 */
function drawMeetingTable(g: Graphics, table: WorldRect): void {
  const { x, y, w, h } = table;
  // 硬投影：贴南沿一档
  wash(g, x + 2, y + h, w - 4, 3, COLOR.shadow, 0.28);
  // 桌面：圆角内缩 1px，四角不露旧 fixture 灰
  rect(g, x, y, w, h, COLOR.walnutDark);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 2).fill(COLOR.walnut);
  // 冷白高光：顶边一条 + 两道 45° 阶梯反光
  rect(g, x + 6, y + 2, w - 12, 1, COLOR.coolWhite);
  rect(g, x + 6, y + 3, w - 12, 1, 0x8fa7bd);
  for (let i = 0; i < 9; i += 1) {
    rect(g, x + 26 + i * 4, y + 10 + i * 2, 6, 1, 0x9fb3c8);
  }
  for (let i = 0; i < 7; i += 1) {
    rect(g, x + w - 62 + i * 4, y + 14 + i * 2, 5, 1, 0x6f8299);
  }
  // 木纹：三条短暗线
  rect(g, x + 18, y + 42, 34, 1, COLOR.walnutDark);
  rect(g, x + 76, y + 58, 46, 1, COLOR.walnutDark);
  rect(g, x + 132, y + 38, 30, 1, COLOR.walnutDark);
  // 前缘
  rect(g, x, y + h - 1, w, 1, COLOR.walnutDark);
  // 线缆孔
  box(g, x + w / 2 - 6, y + h / 2 - 2, 12, 5, 0x1f2a3a, COLOR.outline);
  rect(g, x + w / 2 - 4, y + h / 2 - 1, 8, 1, 0x3b4a66);
  // 桌面小物：笔记本、冰美式、草稿纸
  drawLaptop(g, x + 32, y + 16);
  drawLaptop(g, x + 96, y + 50);
  drawLaptop(g, x + 152, y + 22);
  drawIcedCoffee(g, x + 62, y + 64);
  drawIcedCoffee(g, x + 124, y + 14);
  drawPaperBall(g, x + 20, y + 68);
  drawPaperBall(g, x + 112, y + 66);
  drawPaperBall(g, x + 168, y + 62);
  drawPaperBall(g, x + 78, y + 22);
  drawPaperBall(g, x + 140, y + 72);
}

/* ------------------------------------------------------------------ */

interface Room {
  rect: WorldRect;
  /** 墙厚：从共享布局的墙体里读，不另写一份常量 */
  wall: number;
}

/** 按显示名取房间：`CAMPUS_BUILDINGS` 的名字同时被 HUD 区域标签使用，是稳定键 */
function roomOf(name: string): Room | undefined {
  const building = WORLD_LAYOUT.buildings.find((item: BuildingSpec) => item.name === name);
  if (!building) return undefined;
  const wall = WORLD_LAYOUT.solids.find(
    (solid) =>
      solid.kind === 'wall' && Math.abs(solid.y - building.rect.y) < 2 && solid.h <= 16 && solid.w > 60,
  );
  return { rect: building.rect, wall: wall?.h ?? 10 };
}

function insideRect(rect: WorldRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** 从共享碰撞体里反查家具：会议桌是 200×90 的 fixture，不在渲染层重写坐标 */
function fixtureIn(room: Room, minW: number): WorldRect | undefined {
  return WORLD_LAYOUT.solids.find(
    (solid) =>
      solid.kind === 'fixture' &&
      solid.w >= minW &&
      insideRect(room.rect, solid.x + solid.w / 2, solid.y + solid.h / 2),
  );
}

/**
 * 房间内部的纵向隔墙：直接反查共享碰撞体（宽度不超过两堵墙，两端都不贴外圈）。
 * 卫生间那两道内隔墙早先只进碰撞、不进贴图，玩家会在 60px 门洞之外撞到「空气墙」（ADR-0053）。
 */
function innerWalls(room: Room): WorldRect[] {
  const { x, y, w, h } = room.rect;
  const t = room.wall;
  return WORLD_LAYOUT.solids.filter(
    (solid) =>
      solid.kind === 'wall' &&
      solid.w <= t * 2 &&
      solid.x >= x + t &&
      solid.x + solid.w <= x + w - t &&
      solid.y >= y &&
      solid.y + solid.h <= y + h,
  );
}

function seatsIn(room: Room, kind: SeatInstance['kind']): SeatInstance[] {
  return WORLD_LAYOUT.seats.filter((seat) => seat.kind === kind && insideRect(room.rect, seat.x, seat.y));
}

function propsIn(room: Room, kind: PropInstance['kind']): PropInstance[] {
  return WORLD_LAYOUT.props.filter((prop) => prop.kind === kind && insideRect(room.rect, prop.x, prop.y));
}

export class InteriorArt {
  private readonly textures: Texture[] = [];
  /**
   * 室内灯具的光位：由绘制方法现场收集，和墙面/家具同一坐标。
   * 光源模块只消费这个数组，不再复制 `x+138 / x+396 / screenX` 这类偏移（ADR-0048）。
   */
  readonly lights: LightSpec[] = [];

  /**
   * 隔间门：每坑一枚精灵 + open / closed 两张烘焙纹理。
   *
   * 为什么拆出 flat：flat 是「一次性画完、永不改动」的地面层，
   * 开关状态要跟着 `S2C_SEAT_STATE` 变，只能走可换纹理的精灵。
   * 门扇进 y 排序层（深度键取坑位南沿），人站在门外时门在身后，
   * 坐进去时门在前景把下半身挡住——格子间该有的遮挡关系。
   */
  private readonly stallDoors: Array<{ sprite: Sprite; open: Texture; closed: Texture }> = [];
  /** 马桶 seatId → 坑位下标：构造期按 x 匹配，不按 id 硬编码（座位表只允许末尾追加） */
  private readonly stallOfSeat = new Map<number, number>();

  /** 小黑屋吊灯：灯罩留在 flat，灯泡单独一枚双帧精灵，接触不良时才闪 */
  private cellBulb?: Sprite;
  private cellBulbTextures: readonly Texture[] = [];
  private cellBulbSeed = 7;
  /** 灯泡中心：`decorateCell` 现场写入，`buildCellBulb` 再据此烘焙 */
  private cellBulbAt: { x: number; y: number } | null = null;
  /** 灯泡当前是不是「暗档」：只在翻转时换纹理 */
  private cellBulbDim = false;

  /** 宿舍暖光：壁灯外的一层暖黄光晕，躺下 + 夜/冬才亮 */
  private readonly warmGlows: Sprite[] = [];
  private warmEligible = false;
  /** 宿舍区当前躺了几个人（只统计下发给客户端的座位占用） */
  private loungeResting = 0;
  private readonly loungeBedSeats = new Set<number>();
  /** 当前躺在宿舍床上的座位：重复广播不会重复计数 */
  private readonly loungeOccupied = new Set<number>();

  /**
   * `base` 收墙面与地面陈设（在地板之上、家具精灵之下），
   * `depth` 收立式家具（衣柜 / 书架 / 推车 / 打印机 / 纸箱 / 落地灯 /
   * 白板立架 / 发财树 / 饮水机 / 折叠椅 / 挂衣架 / 热水杯 / 香薰 / 绿萝）。
   */
  build(depth: DepthSink, base: Container, renderer: TextureFactory): void {
    const flat = new Graphics();
    const work = roomOf('工作区');
    const meeting = roomOf('会议室');
    const lounge = roomOf('宿舍区');
    const restroom = roomOf('卫生间');
    const theater = roomOf('家庭影音室');
    const cell = roomOf('小黑屋');

    if (work) this.decorateWorkroom(flat, work);
    if (meeting) this.decorateMeeting(flat, meeting);
    if (lounge) this.decorateLounge(flat, lounge);
    if (restroom) this.decorateRestroom(flat, restroom);
    if (theater) this.decorateTheater(flat, theater);
    if (cell) this.decorateCell(flat, cell);
    base.addChild(flat);

    if (work) this.furnishWorkroom(depth, renderer, work);
    if (meeting) this.furnishMeeting(depth, renderer, meeting);
    if (lounge) this.furnishLounge(depth, renderer, lounge);
    if (restroom) this.decorateRestroomFittings(depth, renderer, restroom);
    if (theater) this.furnishTheater(depth, renderer, theater);

    // 可切换的美术：隔间门、吊灯灯泡、宿舍暖光。
    // 三处都在构造期把「开 / 关」两张纹理烘好，运行时只换引用或写 alpha。
    if (restroom) this.buildStallDoors(depth, renderer, restroom);
    if (cell) this.buildCellBulb(base, renderer);
    if (lounge) this.buildLoungeGlow(base, renderer, lounge);
  }

  destroy(): void {
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
  }

  /* ---------------- 可切换的状态美术（占用 / 时间驱动） ---------------- */

  /**
   * 座位占用：马桶 → 隔间门，宿舍床 → 暖光条件。
   * 工位屏幕由 `PropsView` 自己处理（桌子在它手里），这里不重复。
   */
  setSeatOccupied(seatId: number, occupied: boolean): void {
    const stallIndex = this.stallOfSeat.get(seatId);
    if (stallIndex !== undefined) {
      const door = this.stallDoors[stallIndex];
      if (door) door.sprite.texture = occupied ? door.closed : door.open;
      return;
    }
    if (!this.loungeBedSeats.has(seatId)) return;
    // 服务端可能重发同一份占用快照：只在真正的变化沿上加减，人数不会越加越多
    if (occupied) {
      if (this.loungeOccupied.has(seatId)) return;
      this.loungeOccupied.add(seatId);
      this.loungeResting += 1;
      return;
    }
    if (!this.loungeOccupied.delete(seatId)) return;
    if (this.loungeResting > 0) this.loungeResting -= 1;
  }

  /**
   * 暖光时机（冬季或夜间）：由 renderer 在季节判定之后灌进来。
   * 季节只在这里被「消费」一次，子模块不再各读一遍 `location.search`。
   */
  setWarmEligible(eligible: boolean): void {
    this.warmEligible = eligible;
  }

  /**
   * 每帧推进：吊灯接触不良、宿舍暖光呼吸。
   * 只写 alpha / visible，不改几何、不建对象。
   */
  update(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    const bulb = this.cellBulb;
    if (bulb && this.cellBulbTextures.length === 2) {
      // 断闪只切纹理，不写 alpha：半透明的灯芯会露出后面的灯罩，看起来像重影
      const dim = badContactFlicker(this.cellBulbSeed, nowMs) < 0.5;
      if (dim !== this.cellBulbDim) {
        this.cellBulbDim = dim;
        bulb.texture = this.cellBulbTextures[dim ? 1 : 0]!;
      }
    }
    if (this.warmGlows.length === 0) return;
    const warm = this.warmEligible && this.loungeResting > 0;
    if (!warm) {
      for (const glow of this.warmGlows) if (glow.visible) glow.visible = false;
      return;
    }
    const alpha = 0.5 * warmGlowBreath(this.cellBulbSeed + 31, nowMs);
    for (const glow of this.warmGlows) {
      glow.visible = true;
      glow.alpha = alpha;
    }
  }

  /** 小黑屋灯泡：亮 / 暗两张纹理，接触不良时整枚精灵断闪（灯罩与墙面不动） */
  private buildCellBulb(base: Container, renderer: TextureFactory): void {
    const at = this.cellBulbAt;
    if (!at) return;
    const on = this.texture(
      renderer,
      'cell-bulb-on',
      (g) => {
        // 光晕 + 搪瓷罩里的灯芯：亮的时候带一圈硬边暖光
        g.ellipse(9, 5, 9, 4).fill({ color: 0xffd79a, alpha: 0.28 });
        rect(g, 3, 3, 12, 4, 0xffe3a3);
        rect(g, 4, 3, 2, 4, 0xfff3cc);
        rect(g, 3, 6, 12, 1, 0xe8a94f);
      },
      { w: 18, h: 9 },
    );
    const dim = this.texture(
      renderer,
      'cell-bulb-dim',
      (g) => {
        rect(g, 3, 3, 12, 4, 0x7a6a52);
        rect(g, 4, 3, 2, 4, 0x9a866a);
        rect(g, 3, 6, 12, 1, 0x584a38);
      },
      { w: 18, h: 9 },
    );
    const sprite = new Sprite(on);
    sprite.anchor.set(0.5, 0.5);
    // 精灵中心对灯芯，不盖住 flat 里那只搪瓷罩；`dim` 只留作纹理引用，断电时不会闪回黑块
    sprite.position.set(at.x + 0.5, at.y);
    sprite.texture = on;
    base.addChild(sprite);
    this.cellBulb = sprite;
    // 断电那一帧要能切到暗纹理：把两张都挂在精灵的纹理缓存里（不新增显示对象）
    this.cellBulbTextures = [on, dim];
  }

  /** 宿舍暖光：两盏壁灯外各一层暖黄光晕，默认不可见，有人躺下才呼吸 */
  private buildLoungeGlow(base: Container, renderer: TextureFactory, room: Room): void {
    const { x, y } = room.rect;
    const sconceY = y + room.wall + 2;
    const halo = this.texture(
      renderer,
      'lounge-warm-halo',
      (g) => {
        // 三层硬边椭圆，越往外越淡：像素画里不用柔化滤镜
        g.ellipse(22, 16, 21, 14).fill({ color: 0xffcf8a, alpha: 0.16 });
        g.ellipse(22, 16, 15, 10).fill({ color: 0xffcf8a, alpha: 0.18 });
        g.ellipse(22, 16, 8, 6).fill({ color: 0xffe6b8, alpha: 0.22 });
      },
      { w: 44, h: 32 },
    );
    for (const dx of LOUNGE_DECOR.sconceXs) {
      const glow = new Sprite(halo);
      glow.anchor.set(0.5, 0.5);
      glow.position.set(x + dx + 4, sconceY + 11);
      glow.visible = false;
      base.addChild(glow);
      this.warmGlows.push(glow);
    }
  }

  /* ---------------- 小黑屋：水泥地、吊灯、铁窗、反省凳（ADR-0072） ---------------- */

  /**
   * 小球房只有四件东西：一盏晃的吊灯、一扇铁窗、一张红叉桃心海报、一只反省凳。
   * 海报不写文字——「不许色色」由 HUD 卡片负责，地图上只用红叉和色块，缩到最小地图也认得出。
   */
  private decorateCell(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;
    const innerX = x + t;
    const innerY = y + t;

    // 北墙铁窗：窗框 + 三根竖栅，压住墙顶
    const winX = innerX + 48;
    rect(g, winX, y + 2, 104, t - 3, 0x40464f);
    rect(g, winX + 3, y + 3, 98, t - 5, 0x1e2228);
    for (let i = 0; i < 4; i += 1) rect(g, winX + 16 + i * 24, y + 3, 3, t - 5, 0x6c737e);

    // 红叉桃心海报：贴在门对面的北墙上，文字交给 UI
    const posterX = innerX + 196;
    const posterY = innerY + 5;
    rect(g, posterX - 2, posterY - 2, 78, 50, 0x3e434a);
    rect(g, posterX, posterY, 74, 46, 0xe9e3d4);
    rect(g, posterX, posterY, 74, 2, 0xbeb6a4);
    // 桃心：两瓣 + 下尖，故意画得笨一点，像保安手绘
    rect(g, posterX + 20, posterY + 11, 14, 7, 0xb83b47);
    rect(g, posterX + 38, posterY + 11, 14, 7, 0xb83b47);
    rect(g, posterX + 18, posterY + 18, 38, 9, 0xb83b47);
    rect(g, posterX + 24, posterY + 27, 26, 7, 0xb83b47);
    rect(g, posterX + 32, posterY + 33, 10, 3, 0x8e2b35);
    // 红叉：两道 2px 斜线压过桃心
    for (let i = 0; i < 34; i += 1) {
      rect(g, posterX + 20 + i, posterY + 9 + i, 2, 2, 0xd13f3f);
      rect(g, posterX + 53 - i, posterY + 9 + i, 2, 2, 0xd13f3f);
    }
    // 海报下沿的两条「标语」横线，暗示有字但不真的画字
    rect(g, posterX + 6, posterY + 39, 62, 1, 0x8d8577);
    rect(g, posterX + 16, posterY + 42, 42, 1, 0xb0a795);

    // 吊灯：一根线、一只搪瓷罩；灯泡本体留给 `buildCellBulb` 的双帧精灵，
    // 这样「接触不良」只在灯泡上闪，灯罩与墙不会跟着呼吸
    const bulbX = innerX + (w - t * 2) / 2;
    rect(g, bulbX, innerY, 1, 34, 0x4b4f57);
    rect(g, bulbX - 8, innerY + 34, 17, 3, 0x2c3037);
    this.cellBulbSeed = (bulbX * 17 + innerY) | 0;
    this.cellBulbAt = { x: bulbX, y: innerY + 38 };
    this.lights.push({
      x: bulbX,
      y: innerY + 38,
      radius: 92,
      color: 0xffd79a,
      intensity: 0.5,
      flicker: 0.12,
    });

    // 反省凳：低矮木板条 + 四条铁腿，坐上去时正好被角色压住
    const sx = JAIL_ANCHOR.x;
    const sy = JAIL_ANCHOR.y + 7;
    rect(g, sx - 15, sy - 7, 31, 7, 0x8b6b4a);
    rect(g, sx - 15, sy - 7, 31, 1, 0xb18b63);
    for (let i = 0; i < 3; i += 1) rect(g, sx - 13 + i * 10, sy - 6, 1, 6, 0x6a5038);
    rect(g, sx - 13, sy, 2, 9, 0x5d6167);
    rect(g, sx + 12, sy, 2, 9, 0x5d6167);

    // 凳子后面的地上：两圈拖拽过的鞋印，让空房有一点「有人来过」的证据
    rect(g, sx - 34, sy + 20, 10, 1, 0x5b5e63);
    rect(g, sx + 26, sy + 26, 12, 1, 0x5b5e63);

    // 北墙上的两个铁环：押送时挂人用的，纯装饰
    rect(g, sx - 30, innerY + 2, 9, 7, 0x40464f);
    rect(g, sx + 22, innerY + 2, 9, 7, 0x40464f);
    rect(g, sx - 28, innerY + 4, 5, 4, 0x0f1116);
    rect(g, sx + 24, innerY + 4, 5, 4, 0x0f1116);

    // 墙上的反省刻痕：前人留下的「正」字，四组各五笔，高低不一。
    // 1px 凹痕色取墙体暗面，不做描边——墙上刻的东西不该浮在表面
    const tallyY = innerY + 6;
    for (let group = 0; group < 4; group += 1) {
      const gx = sx - 62 + group * 16;
      const gy = tallyY + (group % 2) * 3;
      for (let line = 0; line < 4; line += 1) {
        rect(g, gx + line * 3, gy, 1, 7, 0x9aa3ae);
      }
      // 第五笔横过来，正好压住四条竖线
      rect(g, gx - 1, gy + 3, 11, 1, 0x9aa3ae);
      // 每组底下补一道更浅的旧痕：刻过又被磨平的样子
      rect(g, gx, gy + 9, 9, 1, 0xb9c0c9);
    }
  }

  /* ---------------- 工作区：开放木地板，无墙 ---------------- */

  private decorateWorkroom(g: Graphics, room: Room): void {
    const { x, y, w } = room.rect;
    // 走线槽：两排工位之间一条 3px 暗槽，隔一段压一个接线盒。
    // 一个开放办公区有没有「线」，观感差得非常远
    rect(g, x + 40, y + 186, w - 80, 3, COLOR.tileSeam);
    rect(g, x + 40, y + 186, w - 80, 1, COLOR.fixtureEdge);
    for (let i = 0; i < 7; i += 1) {
      const bx = x + 62 + i * 52;
      rect(g, bx, y + 184, 6, 7, COLOR.fixture);
      rect(g, bx, y + 184, 6, 1, COLOR.ceramic);
      rect(g, bx + 1, y + 188, 4, 1, COLOR.mintDark);
    }
  }

  private furnishWorkroom(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y } = room.rect;
    // 落点全部来自 `interior-spots.ts`：按 F 的感应点与这里共用同一份偏移
    this.place(depth, renderer, 'boxes', drawBoxes, BOXES, x + WORK_DECOR.boxes.dx, y + WORK_DECOR.boxes.dy);
    this.place(
      depth,
      renderer,
      'printer',
      drawPrinter,
      PRINTER,
      x + WORK_DECOR.printer.dx,
      y + WORK_DECOR.printer.dy,
    );
    this.place(depth, renderer, 'cart', drawCart, CART, x + WORK_DECOR.cart.dx, y + WORK_DECOR.cart.dy);
    this.place(
      depth,
      renderer,
      'lamp',
      drawFloorLamp,
      FLOOR_LAMP,
      x + WORK_DECOR.floorLamp.dx,
      y + WORK_DECOR.floorLamp.dy,
    );
    // 落地灯光位：place 的脚底 y+40，纹理高 36、灯罩中心在顶部下 6px
    this.lights.push({
      x: x + WORK_DECOR.floorLamp.dx,
      y: y + WORK_DECOR.floorLamp.dy - 30,
      radius: 58,
      color: 0xffd79a,
      intensity: 0.65,
      flicker: 0.08,
    });
    this.place(
      depth,
      renderer,
      'board',
      drawStandBoard,
      STAND_BOARD,
      x + WORK_DECOR.standBoard.dx,
      y + WORK_DECOR.standBoard.dy,
    );
  }

  /* ---------------- 会议室：深灰地毯 + 冷蓝投屏 + 长桌 ---------------- */

  private decorateMeeting(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;
    const innerX = x + t;
    const innerY = y + t;
    const innerW = w - t * 2;
    const innerH = h - t * 2;

    // 深灰降噪地毯：底色 + 稀疏 1px 噪点 + 两道接缝
    rect(g, innerX, innerY, innerW, innerH, COLOR.carpetSlate);
    rect(g, innerX, innerY, innerW, 1, COLOR.carpetSlateLight);
    rect(g, innerX, innerY, 1, innerH, COLOR.carpetSlateLight);
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 11; col += 1) {
        const nx = innerX + 14 + col * 38 + (row % 2) * 7;
        const ny = innerY + 14 + row * 36;
        rect(g, nx, ny, 1, 1, COLOR.carpetSlateLight);
        if ((row + col) % 3 === 0) rect(g, nx + 4, ny + 2, 1, 1, COLOR.carpetSlateDeep);
      }
    }
    rect(g, innerX, innerY + innerH / 2, innerW, 1, COLOR.carpetSlateDeep);
    rect(g, innerX + innerW / 2, innerY, 1, innerH, COLOR.carpetSlateDeep);
    // 墙脚线：冷灰内框
    rect(g, innerX, innerY + innerH - 1, innerW, 1, COLOR.carpetSlateLight);
    rect(g, innerX + innerW - 1, innerY, 1, innerH, COLOR.carpetSlateLight);

    // 北墙居中超宽投屏：200×56，屏幕外沿两层硬边冷光。
    // 坐标从 `venue-spots.ts` 的共享矩形取：待机遮罩与幻灯片叠层要严丝合缝地压在上面，
    // 一旦这里再写一份 200×56 的推导，叠层错开 1px 就会露出旧笔迹。
    const { x: screenX, y: screenY, w: screenW, h: screenH } = MEETING_SCREEN_RECT;
    wash(g, screenX - 6, screenY - 2, screenW + 12, screenH + 10, COLOR.screenCyan, 0.06);
    wash(g, screenX - 3, screenY, screenW + 6, screenH + 4, COLOR.screenCyan, 0.1);
    // 地毯上的冷光池：阶梯边缘，不是渐变
    wash(g, screenX + 10, screenY + screenH, screenW - 20, 34, COLOR.screenCyan, 0.06);
    wash(g, screenX + 24, screenY + screenH, screenW - 48, 54, COLOR.screenCyan, 0.04);
    // 屏幕本体
    box(g, screenX, screenY, screenW, screenH, COLOR.screenBezel, COLOR.outline);
    rect(g, screenX + 2, screenY + 2, screenW - 4, screenH - 4, COLOR.screenGlass);
    rect(g, screenX + 2, screenY + 2, screenW - 4, 1, COLOR.screenCyan);
    // 网格
    for (let gx = screenX + 12; gx < screenX + screenW - 8; gx += 16) {
      rect(g, gx, screenY + 7, 1, screenH - 14, 0x1f3555);
    }
    for (let gy = screenY + 9; gy < screenY + screenH - 5; gy += 10) {
      rect(g, screenX + 8, gy, screenW - 16, 1, 0x1f3555);
    }
    // OKR：3×5 像素字形，2 倍放大
    glyph(g, screenX + 10, screenY + 5, 'O', COLOR.screenCyan, 2);
    glyph(g, screenX + 19, screenY + 5, 'K', COLOR.screenCyan, 2);
    glyph(g, screenX + 28, screenY + 5, 'R', COLOR.screenCyan, 2);
    // 永远向上的折线：阶梯画法，每一步水平 + 垂直各一段
    const chartX = screenX + 58;
    const chartBottom = screenY + screenH - 12;
    const steps = [0, 6, 5, 13, 12, 20, 19, 27, 26, 34];
    let lastX = chartX;
    let lastY = chartBottom;
    steps.forEach((dx, index) => {
      const px = chartX + dx;
      const py = chartBottom - 3 - index * 3;
      rect(g, px, Math.min(lastY, py), 1, Math.abs(lastY - py) + 1, COLOR.screenCyan);
      rect(g, px, py, 4, 1, COLOR.screenCyan);
      lastX = px;
      lastY = py;
    });
    dot(g, lastX + 3, lastY, 2, COLOR.screenCyan);
    // 柱状图：四根递增的冷蓝柱
    for (let i = 0; i < 4; i += 1) {
      const barH = 6 + i * 4;
      rect(g, screenX + 138 + i * 10, chartBottom - barH, 6, barH, COLOR.screenInk);
      rect(g, screenX + 138 + i * 10, chartBottom - barH, 6, 1, COLOR.screenCyan);
    }
    // 模糊的「闭环 / 赋能」：三行低对比字块，不画汉字
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 6 - row; col += 1) {
        rect(g, screenX + 100 + col * 5, screenY + 30 + row * 5, 3, 1, row === 0 ? 0x8fd4ff : 0x4f86a8);
      }
    }
    rect(g, screenX + 2, screenY + screenH - 3, screenW - 4, 1, 0x5aa6c9);

    // 大屏光位 = 屏幕中心，冷蓝微弱泛光；半径覆盖到桌边
    this.lights.push({
      x: screenX + screenW / 2,
      y: screenY + screenH / 2,
      radius: 140,
      color: 0x7fd6ff,
      intensity: 0.6,
      flicker: 0,
    });

    // 会议桌：从共享 solids 反查，渲染层不重写 200×90 的坐标
    const table = fixtureIn(room, 150);
    if (table) {
      drawMeetingTable(g, table);
      // 投影仪从桌面中央往外泛的弱冷光：与长桌同一坐标，不另写一份
      this.lights.push({
        x: table.x + table.w / 2,
        y: table.y + table.h / 2,
        radius: 78,
        color: 0x8fc8ee,
        intensity: 0.28,
        flicker: 0,
      });
    }
  }

  private furnishMeeting(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y } = room.rect;
    this.place(depth, renderer, 'meeting-board', drawMeetingBoard, MEETING_BOARD, x + 34, y + 300);
    this.place(depth, renderer, 'money-tree', drawMoneyTree, MONEY_TREE, x + 34, y + 48);
    this.place(depth, renderer, 'water-cooler', drawWaterCooler, WATER_COOLER, x + 430, y + 348);
    this.place(depth, renderer, 'folding-chairs', drawFoldingChairs, FOLDING_CHAIRS, x + 432, y + 260);
  }

  /* ---------------- 宿舍区：暖光胡桃木 + 北窗月光 ---------------- */

  private decorateLounge(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;

    // 暖色墙脚线：把标准冷灰墙面压回暖调，家具还没出现就有暖意
    rect(g, x + t, y + t, w - t * 2, 1, COLOR.walnut);
    rect(g, x + t, y + h - t - 1, w - t * 2, 1, COLOR.walnut);
    rect(g, x + t, y + t, 1, h - t * 2, COLOR.walnut);
    rect(g, x + w - t - 1, y + t, 1, h - t * 2, COLOR.walnut);

    // 北墙两扇雪窗：门洞 x+200..x+260 两侧。落点来自 `interior-spots.ts`，
    // 「按 F 看窗外」的感应圈与这里共用同一份坐标
    const windowBottom = y + t + LOUNGE_DECOR.windowDrop;
    for (const dx of LOUNGE_DECOR.windowXs) {
      this.window(g, x + dx, windowBottom, LOUNGE_DECOR.windowW, LOUNGE_DECOR.windowH);
    }
    // 浅蓝月光 / 雪景：从窗台向室内投出阶梯矩形遮罩
    for (const dx of LOUNGE_DECOR.windowXs) {
      this.moonbeam(g, x + dx, windowBottom, LOUNGE_DECOR.windowW, 74);
    }

    // 南墙暖气片 + 烤橘子
    this.radiator(g, x + 232, y + h - t, 36);

    // 北墙：门两侧的暖黄壁灯与挂钟，避开门洞与窗
    const sconceY = y + t + 2;
    this.sconce(g, x + LOUNGE_DECOR.sconceXs[0], sconceY);
    this.clock(g, x + LOUNGE_DECOR.clockDx, y + t + LOUNGE_DECOR.clockDrop);
    this.sconce(g, x + LOUNGE_DECOR.sconceXs[1], sconceY);
    // 壁灯光位：灯罩下方 11px，光圈落进室内而不是压在墙里
    for (const offset of LOUNGE_DECOR.sconceXs) {
      this.lights.push({
        x: x + offset + 4,
        y: sconceY + 11,
        radius: 62,
        color: 0xffcf8a,
        intensity: 0.7,
        flicker: 0.1,
      });
    }

    // 南墙软木留言板：离职倒计时 365
    this.corkBoard(g, x + 150, y + 330, 60, 18);

    // 地面：圆形编织地毯铺在茶几下方 + 床边长毯 + 床脚拖鞋
    this.roundRug(g, x + 341, y + 134, 34);
    rect(g, x + 70, y + 326, 52, 10, COLOR.carpetDark);
    rect(g, x + 71, y + 327, 50, 8, 0xe8cbaa);
    for (let i = 0; i < 5; i += 1) rect(g, x + 74 + i * 10, y + 329, 1, 4, COLOR.carpetDark);
    this.slippers(g, x + 66, y + 334);

    // 下铺床脚的牛皮纸快递箱：只给两组上下铺的下铺画，上铺不会长出箱子
    const beds = seatsIn(room, 'bed');
    // 暖光只看「宿舍这张床有没有人躺」：床位 id 在构造期收好，占用回调里查 Set 即可
    for (const bed of beds) this.loungeBedSeats.add(bed.id);
    beds.forEach((bed, index) => {
      if (index % 2 === 0) return;
      // 箱顶压在床架下沿（床精灵的 4px 底边是透明的），只露出 4px 牛皮纸
      this.underBedBoxes(g, bed.x - 12, bed.y + 10);
    });
  }

  private furnishLounge(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    this.place(
      depth,
      renderer,
      'wardrobe',
      drawWardrobe,
      WARDROBE,
      x + LOUNGE_DECOR.wardrobeDx,
      y + h - LOUNGE_DECOR.wardrobeLift,
    );
    // 书架贴东墙：26px 宽，中心 x+436 → 右缘正好压在墙内侧 x+450
    this.place(
      depth,
      renderer,
      'bookshelf',
      drawBookshelf,
      BOOKSHELF,
      x + LOUNGE_DECOR.bookshelfDx,
      y + LOUNGE_DECOR.bookshelfDy,
    );
    this.place(depth, renderer, 'rack', drawLuggageRack, LUGGAGE_RACK, x + 300, y + 320);
    this.place(depth, renderer, 'coat-rack', drawCoatRack, COAT_RACK, x + 438, y + 250);

    // 茶几上的枸杞热水杯：位置从共享 coffeeTable 反查，杯底落在桌面上
    const coffeeTable = propsIn(room, 'coffeeTable')[0];
    if (coffeeTable) {
      this.place(depth, renderer, 'hot-cup', drawHotCup, HOT_CUP, coffeeTable.x, coffeeTable.y - 8, coffeeTable.y + 1);
    }
  }

  /* ---------------- 家庭影音室：深色地毯 + 冷蓝屏幕 + 四只环绕音箱 ---------------- */

  private decorateTheater(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;
    const innerX = x + t;
    const innerY = y + t;
    const innerW = w - t * 2;
    const innerH = h - t * 2;

    // 暗厅：地面再压一层冷黑，屏幕光才有对比；地毯接缝每 48px 一道
    wash(g, innerX, innerY, innerW, innerH, 0x0b0e14, 0.3);
    for (let sy = innerY + 48; sy < innerY + innerH; sy += 48) rect(g, innerX, sy, innerW, 1, 0x1b2029);

    // 东侧走道：从门一直铺到屏幕前，酒红地毯；踏步灯落在走道内侧
    const aisleX = x + w - 66;
    rect(g, aisleX, innerY, 38, innerH, 0x4a2a2e);
    rect(g, aisleX + 2, innerY, 34, innerH, 0x5c3438);

    // 三排台阶：每排前缘一条亮边 + 下方阴影，逐排错位读出「阶梯」
    const rowYs = [...new Set(THEATER_SEATS.map((seat) => seat.y))].sort((a, b) => a - b);
    rowYs.forEach((rowY, index) => {
      const stepY = rowY - 22;
      rect(g, innerX + 8, stepY, innerW - 16, 7, 0x2a303d);
      rect(g, innerX + 8, stepY, innerW - 16, 2, 0x4a5468);
      rect(g, innerX + 8, stepY + 7, innerW - 16, 1, 0x12161d);
      if (index < rowYs.length - 1) dot(g, aisleX + 6, stepY + 3, 2, 0xffd27a, 0x2a3142);
    });

    // 屏幕：北墙大屏 + 三层硬边光池（越靠外越淡）
    const screen = THEATER_SCREEN;
    wash(g, screen.x - 8, screen.y - 2, screen.w + 16, screen.h + 12, 0x7fd6ff, 0.05);
    wash(g, screen.x + 10, screen.y + screen.h, screen.w - 20, 44, 0x7fd6ff, 0.06);
    wash(g, screen.x + 26, screen.y + screen.h, screen.w - 52, 74, 0x7fd6ff, 0.04);
    box(g, screen.x, screen.y, screen.w, screen.h, 0x121a26, 0x0b0e14);
    rect(g, screen.x + 2, screen.y + 2, screen.w - 4, screen.h - 4, 0x0f2238);
    // 画面：夜空星点 + 月亮 + 两层远山 + 一叶小舟
    for (let i = 0; i < 14; i += 1) {
      rect(g, screen.x + 8 + i * 17, screen.y + 8 + ((i * 7) % 18), 1, 1, 0x9fd3ff);
    }
    dot(g, screen.x + 58, screen.y + 20, 7, 0xfff6e0, 0x0f2238);
    g.poly([screen.x + 12, screen.y + 48, screen.x + 82, screen.y + 28, screen.x + 152, screen.y + 48]).fill(0x1d3b5a);
    g.poly([screen.x + 72, screen.y + 48, screen.x + 132, screen.y + 34, screen.x + 192, screen.y + 48]).fill(0x2a5478);
    rect(g, screen.x + 150, screen.y + 44, 18, 2, 0x8fd4ff);
    g.poly([screen.x + 158, screen.y + 41, screen.x + 158, screen.y + 48, screen.x + 165, screen.y + 44]).fill(0x8fd4ff);

    // 四只环绕音箱：前左 / 前右 / 后左 / 后右，金色锥盆 + 一圈冷光
    for (const speaker of THEATER_SPEAKERS) {
      wash(g, speaker.x - 10, speaker.y - 12, 20, 24, 0x7fd6ff, 0.06);
      box(g, speaker.x - 7, speaker.y - 9, 14, 18, 0x2a3142, 0x12161d);
      rect(g, speaker.x - 1, speaker.y - 7, 2, 14, 0x12161d);
      dot(g, speaker.x, speaker.y - 2, 3, 0x4a5468, 0x12161d);
      dot(g, speaker.x, speaker.y + 4, 2, COLOR.amber, 0x12161d);
    }

    // 投影仪：南墙中央，一束淡蓝光打向屏幕
    const projectorX = x + w / 2;
    const projectorY = y + h - 22;
    g.poly([
      projectorX - 4,
      projectorY,
      screen.x + 20,
      screen.y + screen.h,
      screen.x + screen.w - 20,
      screen.y + screen.h,
    ]).fill({ color: 0x7fd6ff, alpha: 0.04 });
    box(g, projectorX - 12, projectorY - 4, 24, 12, 0x2a3142, 0x12161d);
    dot(g, projectorX, projectorY + 1, 3, 0x7fd6ff, 0x12161d);
    rect(g, projectorX - 9, projectorY + 6, 18, 2, 0x12161d);

    // 两盏灯：屏幕冷光 + 入口暖光；数量控制在 2 个，给外景光源留额度
    this.lights.push(
      {
        x: screen.x + screen.w / 2,
        y: screen.y + screen.h + 12,
        radius: 150,
        color: 0x7fd6ff,
        intensity: 0.62,
        flicker: 0.03,
      },
      {
        x: x + w - 48,
        y: y + 160,
        radius: 60,
        color: 0xffc07a,
        intensity: 0.5,
        flicker: 0.1,
      },
    );
  }

  private furnishTheater(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    // 爆米花车压在西南角：不挡东侧走道，也不压任何座位
    this.place(depth, renderer, 'theater-cart', drawCart, CART, x + 28, y + h - 12);
  }

  /* ---------------- 卫生间：薄荷马赛克 + 连体洗手台 ---------------- */

  private decorateRestroom(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;
    const innerX = x + t;
    const innerY = y + t;
    const innerW = w - t * 2;
    const innerH = h - t * 2;
    const tile = 10;

    // 浅薄荷 + 冷白 10px 马赛克：先铺底，再压砖缝与交错的冷白砖
    rect(g, innerX, innerY, innerW, innerH, COLOR.mintTile);
    for (let col = 0; col < innerW / tile; col += 1) {
      rect(g, innerX + col * tile, innerY, 1, innerH, COLOR.mintSeam);
      for (let row = 0; row < innerH / tile; row += 1) {
        if ((row + col) % 2 === 0) {
          rect(g, innerX + col * tile + 1, innerY + row * tile + 1, tile - 1, tile - 1, COLOR.mintTileAlt);
        }
        if ((row * 3 + col * 7) % 13 === 0) {
          rect(g, innerX + col * tile + 1, innerY + row * tile + 1, tile - 1, tile - 1, COLOR.tileDeep);
        }
      }
    }
    for (let row = 0; row < innerH / tile; row += 1) {
      rect(g, innerX, innerY + row * tile, innerW, 1, COLOR.mintSeam);
    }
    // 外围一圈深薄荷收边
    rect(g, innerX, innerY, innerW, 1, COLOR.mintTileDeep);
    rect(g, innerX, innerY + innerH - 1, innerW, 1, COLOR.mintTileDeep);
    rect(g, innerX, innerY, 1, innerH, COLOR.mintTileDeep);
    rect(g, innerX + innerW - 1, innerY, 1, innerH, COLOR.mintTileDeep);

    // 水渍：砖缝处的半透明反光贴花（ADR-0077：房间 340×300，全部收在中央区附近）
    const stains: Array<[number, number, number, number]> = [
      [x + 130, y + 250, 18, 4],
      [x + 160, y + 228, 12, 3],
      [x + 186, y + 212, 20, 4],
      [x + 196, y + 240, 10, 3],
    ];
    for (const [sx, sy, sw, sh] of stains) {
      wash(g, sx, sy, sw, sh, COLOR.water, 0.16);
      rect(g, sx + 2, sy + 1, sw - 4, 1, 0xeaf8ff);
    }

    // 深灰地漏
    const dx = x + 166;
    const dy = y + 200;
    rect(g, dx - 4, dy - 4, 8, 8, COLOR.outline);
    rect(g, dx - 3, dy - 3, 6, 6, COLOR.drain);
    for (let i = 0; i < 3; i += 1) rect(g, dx - 2, dy - 2 + i * 2, 4, 1, COLOR.fixtureEdge);

    // 三面墙裙
    rect(g, innerX, y + h - t - 6, innerW, 6, COLOR.mintTileDeep);
    rect(g, innerX, y + h - t - 6, innerW, 1, COLOR.mintTile);
    rect(g, innerX, innerY, 6, innerH, COLOR.mintTileDeep);
    rect(g, x + w - t - 6, innerY, 6, innerH, COLOR.mintTileDeep);

    // 两道内隔墙：位置从共享碰撞体读，墙画出来了才不会变成「空气墙」（ADR-0053）
    for (const wall of innerWalls(room)) this.zoneDivider(g, wall);

    // 连体洗手台 + 宽镜 + 台面小物
    this.vanity(g, room);
    // 隔断 + 红锁 + 厕纸架（门扇另行做成可换纹理的精灵，见 buildStallDoors）
    this.stallPartitions(g);
    // 北墙提示牌：节约用水 · 严禁超时（图标 + 点阵字块）
    this.restroomSign(g, x + 146, y + 2);
  }

  private decorateRestroomFittings(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    this.place(
      depth,
      renderer,
      'dryer',
      drawHandDryer,
      HAND_DRYER,
      x + RESTROOM_DECOR.dryerDx,
      y + h - room.wall,
    );
    // 香薰与绿萝挪到男 / 女区南端：北墙整排让给坑位，留在原处会压在马桶上
    this.place(depth, renderer, 'diffuser', drawDiffuser, DIFFUSER, x + 26, y + h - room.wall - 6);
    this.place(depth, renderer, 'pothos', drawPothos, POTHOS, x + 300, y + h - room.wall - 6);

    // 水龙头下的一滴水：sink 精灵在 depth y+350，水滴要再晚一格才画得出来
    const sink = propsIn(room, 'sink')[0];
    if (sink) this.place(depth, renderer, 'drip', drawWaterDrip, WATER_DRIP, sink.x, sink.y, sink.y + 1);
  }

  /* ---------------- 小型墙面 / 地面图元 ---------------- */

  /** 窗：夜空 + 一层雪 + 木窗框；窗台雪压出一道冷色高光 */
  private window(g: Graphics, x: number, bottom: number, w: number, h: number): void {
    const top = bottom - h;
    box(g, x, top, w, h, COLOR.woodDark, COLOR.outline);
    rect(g, x + 2, top + 2, w - 4, h - 6, COLOR.nightSky);
    // 玻璃上的雪：贴着窗台的一条起伏雪线
    rect(g, x + 2, bottom - 6, w - 4, 4, COLOR.snow);
    rect(g, x + 2, bottom - 6, w - 4, 1, 0xf6fafd);
    const bumps = Math.max(3, Math.floor((w - 8) / 6));
    for (let i = 0; i < bumps; i += 1) rect(g, x + 4 + i * 6, bottom - 8, 3, 2, COLOR.snow);
    // 窗棂
    rect(g, x + w / 2 - 1, top + 2, 2, h - 6, COLOR.woodLight);
    rect(g, x + 2, top + h / 2 - 1, w - 4, 2, COLOR.woodLight);
    // 窗外的雪粒
    for (let i = 0; i < 4; i += 1) rect(g, x + 8 + i * 12, top + 4 + (i % 2) * 2, 1, 1, COLOR.snow);
  }

  /** 月光 / 雪景矩形遮罩：三层硬边浅蓝，越靠窗越亮 */
  private moonbeam(g: Graphics, x: number, bottom: number, w: number, h: number): void {
    wash(g, x + 2, bottom, w - 4, h, 0xbfe0ff, 0.1);
    wash(g, x + 8, bottom, w - 16, h + 8, 0xbfe0ff, 0.07);
    wash(g, x + 16, bottom, w - 32, h + 16, 0xbfe0ff, 0.05);
    // 窗棂投影：两条 1px 冷色竖线，和窗框对齐
    wash(g, x + w / 2 - 1, bottom, 2, h, 0xd7e9ff, 0.14);
  }

  /** 挂钟：白盘 + 两根指针，指向固定的 10:10 */
  private clock(g: Graphics, x: number, y: number): void {
    g.circle(x + 6, y + 6, 6).fill(COLOR.outline);
    g.circle(x + 6, y + 6, 5).fill(COLOR.ceramic);
    g.circle(x + 6, y + 6, 4).stroke({ width: 1, color: COLOR.ceramicEdge });
    rect(g, x + 6, y + 3, 1, 4, COLOR.outline);
    rect(g, x + 6, y + 6, 3, 1, COLOR.outline);
  }

  /** 壁灯：小灯罩 + 一圈暖光，夜里配合柔光是室内的暖点 */
  private sconce(g: Graphics, x: number, y: number): void {
    g.circle(x + 4, y + 5, 7).fill({ color: COLOR.glow, alpha: 0.2 });
    box(g, x, y, 8, 4, COLOR.walnutDark);
    g.roundRect(x + 1, y + 3, 6, 5, 2).fill(COLOR.butter);
    rect(g, x + 3, y + 4, 2, 2, COLOR.glow);
  }

  /** 暖气片 + 烤橘子：三瓣果肉、一瓣皮、两缕白汽 */
  private radiator(g: Graphics, x: number, bottom: number, w: number): void {
    const top = bottom - 9;
    box(g, x, top, w, 9, COLOR.fixture, COLOR.fixtureEdge);
    for (let i = 0; i < 8; i += 1) rect(g, x + 3 + i * 4, top + 2, 1, 5, COLOR.fixtureEdge);
    rect(g, x, top, w, 1, COLOR.ceramic);
    // 烤橘子：三瓣果肉 + 一瓣皮
    const ox = x + 11;
    g.poly([ox, top - 4, ox + 8, top - 4, ox + 4, top]).fill(COLOR.peachDark);
    g.poly([ox + 1, top - 3, ox + 7, top - 3, ox + 4, top - 1]).fill(COLOR.peach);
    rect(g, ox + 3, top - 3, 1, 1, COLOR.butter);
    g.poly([ox + 9, top - 3, ox + 15, top - 3, ox + 12, top]).fill(COLOR.peachDark);
    g.poly([ox + 10, top - 2, ox + 14, top - 2, ox + 12, top]).fill(COLOR.peach);
    rect(g, ox - 2, top - 1, 3, 1, COLOR.amberDeep);
    // 热气：两粒白汽
    wash(g, ox + 2, top - 8, 9, 2, COLOR.ceramic, 0.35);
    rect(g, ox + 5, top - 10, 1, 1, COLOR.ceramic);
  }

  /** 离职倒计时软木板：日历格 + 3×5 数字 365 + 红图钉 */
  private corkBoard(g: Graphics, x: number, y: number, w: number, h: number): void {
    box(g, x, y, w, h, COLOR.cork, COLOR.walnutDark);
    rect(g, x + 2, y + 2, w - 4, h - 4, COLOR.corkFace);
    // 日历格：两行小方块
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        rect(g, x + 4 + col * 5, y + 5 + row * 5, 3, 3, 0xe8cfa8);
      }
    }
    // 365：3×5 像素字，2 倍放大
    glyph(g, x + 34, y + 4, '3', COLOR.peachDark, 2);
    glyph(g, x + 42, y + 4, '6', COLOR.peachDark, 2);
    glyph(g, x + 50, y + 4, '5', COLOR.peachDark, 2);
    // 红色下划线 + 图钉
    rect(g, x + 34, y + 15, 18, 1, COLOR.peachDark);
    rect(g, x + 3, y + 3, 2, 2, COLOR.peachDark);
    // 一条小纸条
    rect(g, x + 24, y + 4, 6, 1, COLOR.ceramic);
    rect(g, x + 24, y + 7, 4, 1, COLOR.ceramic);
  }

  private roundRug(g: Graphics, cx: number, cy: number, r: number): void {
    const ry = r * 0.62;
    g.ellipse(cx, cy, r + 1, ry + 1).fill(COLOR.carpetDark);
    g.ellipse(cx, cy, r, ry).fill(0xd8ad78);
    g.ellipse(cx, cy, r - 3, ry - 2).fill(0xe8cbaa);
    g.ellipse(cx, cy, r - 9, ry - 6).fill(0xf2ddc2);
    g.ellipse(cx, cy, r - 14, ry - 9).fill(0xe0b48a);
    g.ellipse(cx, cy, r - 6, ry - 4).stroke({ width: 1, color: COLOR.carpetDark });
    // 流苏：左右四段 1px
    for (const dx of [-r - 2, -r + 2, r - 2, r + 2]) rect(g, cx + dx, cy - 2, 1, 4, COLOR.carpetDark);
  }

  private slippers(g: Graphics, x: number, y: number): void {
    for (const dx of [0, 9]) {
      box(g, x + dx, y, 5, 8, COLOR.peach, COLOR.peachDark);
      g.ellipse(x + dx + 2, y + 3, 2, 2).fill(COLOR.butter);
    }
    // 一只翻过来：底面朝上
    box(g, x + 18, y + 1, 5, 7, COLOR.peachDark, COLOR.peach);
    rect(g, x + 19, y + 3, 3, 1, COLOR.butter);
  }

  /** 连体洗手台：从两个 sink prop 的坐标反推台面，画一条连续白瓷台 + 宽镜 */
  private vanity(g: Graphics, room: Room): void {
    const sinks = propsIn(room, 'sink');
    if (sinks.length < 2) return;
    const left = Math.min(...sinks.map((sink) => sink.x));
    const right = Math.max(...sinks.map((sink) => sink.x));
    const counterX = left - 28;
    const counterW = right - left + 56;
    // 台面贴南墙内侧：不再写死 y+350，卫生间收到 300 高后仍然对齐
    const counterBottom = room.rect.y + room.rect.h - room.wall;
    const counterTop = counterBottom - 24;
    const mirrorX = counterX + 16;
    const mirrorW = counterW - 32;
    const mirrorTop = counterTop - 28;
    const mirrorH = 22;

    // 台面硬投影 + 连体白瓷台面
    wash(g, counterX + 2, counterBottom, counterW - 4, 2, COLOR.shadow, 0.18);
    box(g, counterX, counterTop, counterW, 24, COLOR.porcelain, COLOR.ceramicEdge);
    rect(g, counterX + 1, counterTop + 1, counterW - 2, 2, COLOR.coolWhite);
    rect(g, counterX, counterBottom - 3, counterW, 1, COLOR.tileDeep);
    // 后挡水
    rect(g, counterX, counterBottom - 2, counterW, 2, COLOR.mintTileDeep);
    // 宽幅镜面：冷白框 + 45° 阶梯反光斜条
    box(g, mirrorX, mirrorTop, mirrorW, mirrorH, 0xeaf4f8, COLOR.fixtureEdge);
    rect(g, mirrorX + 2, mirrorTop + 2, mirrorW - 4, mirrorH - 4, 0xdceef6);
    for (let i = 0; i < 4; i += 1) {
      const sx = mirrorX + 10 + i * 22;
      rect(g, sx, mirrorTop + 4, 3, 1, COLOR.ceramic);
      rect(g, sx + 3, mirrorTop + 5, 3, 1, COLOR.ceramic);
      rect(g, sx + 6, mirrorTop + 6, 3, 1, COLOR.ceramic);
    }
    rect(g, mirrorX + 4, mirrorTop + 3, 1, mirrorH - 6, COLOR.coolWhite);
    // 压泵洗手液：放在两个盆之间
    box(g, left + 20, counterTop + 2, 5, 8, COLOR.mint, COLOR.mintDark);
    rect(g, left + 22, counterTop, 1, 2, COLOR.metal);
    rect(g, left + 21, counterTop + 5, 3, 1, COLOR.ceramic);
    rect(g, left + 21, counterTop + 7, 3, 1, COLOR.mintDark);
    // 纸巾盒：抽出一半的白纸
    box(g, right + 12, counterTop + 2, 11, 7, COLOR.fixture, COLOR.fixtureEdge);
    rect(g, right + 14, counterTop, 7, 2, COLOR.ceramic);
    rect(g, right + 16, counterTop - 1, 3, 1, COLOR.ceramic);
    rect(g, right + 15, counterTop + 4, 5, 1, COLOR.fixtureEdge);
  }

  /** 内隔墙：与外墙同一套冷白墙面 + 亮压顶 + 暗收边 */
  private zoneDivider(g: Graphics, wall: WorldRect): void {
    const { x, y, w, h } = wall;
    rect(g, x, y, w, h, COLOR.fixture);
    rect(g, x, y, 2, h, COLOR.ceramic);
    rect(g, x + w - 2, y, 2, h, COLOR.fixtureEdge);
    // 两端亮口：北端接外墙，南端就是 60px 门洞的门垛
    rect(g, x, y, w, 2, COLOR.ceramic);
    rect(g, x, y + h - 2, w, 2, COLOR.ceramicEdge);
  }

  /**
   * 隔间静态件：6px 胡桃木隔断 + 厕纸架。
   *
   * 门扇不在这里画 —— 它要跟着马桶占用开合，改由 `buildStallDoors` 做成可换纹理的精灵。
   * 坑位表来自共享布局（ADR-0053），加减坑位不用在渲染层重写坐标。
   */
  private stallPartitions(g: Graphics): void {
    for (const stall of RESTROOM_STALLS) {
      const { partition } = stall;
      if (!partition) continue;
      box(g, partition.x, partition.y, partition.w, partition.h, COLOR.walnut, COLOR.walnutDark);
      rect(g, partition.x + 1, partition.y + 1, 1, partition.h - 2, COLOR.walnutLight);
      rect(g, partition.x + partition.w - 2, partition.y + 1, 1, partition.h - 2, COLOR.walnutDark);
      // 厕纸架：挂在隔断朝本格的一侧
      box(g, partition.x + 2, stall.y + 60, 5, 7, COLOR.fixture, COLOR.fixtureEdge);
      rect(g, partition.x + 4, stall.y + 62, 3, 3, COLOR.ceramic);
      rect(g, partition.x + 4, stall.y + 62, 3, 1, COLOR.ceramicEdge);
    }
  }

  /**
   * 隔间门：每坑一枚精灵，两张烘焙纹理在开 / 关之间切换。
   *
   * - 空坑：半掩门扇（与改前的画法完全一致），红锁换成灰扣；
   * - 有人：门扇闭合、门锁变红、门缝透出一线暖光——「占坑」不用写字也读得出来。
   *
   * 座位 → 坑位按 x 就近匹配：`RESTROOM_STALLS` 与马桶座位表都由同一份布局派生，
   * 但座位 id 只允许末尾追加，硬编码 id 会在下次加座位时整体错位。
   */
  private buildStallDoors(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const toilets = seatsIn(room, 'toilet');
    const doorH = 14;
    for (let index = 0; index < RESTROOM_STALLS.length; index += 1) {
      const stall = RESTROOM_STALLS[index]!;
      const doorW = stall.w - 8;
      const open = this.texture(renderer, `stall-open:${doorW}`, (g) => {
        // 半掩：门扇贴在坑位南沿，右端留 5px 缝，红锁挂在门边
        box(g, 3, doorH - 6, doorW, 6, COLOR.walnutLight, COLOR.walnutDark);
        rect(g, 4, doorH - 4, doorW - 2, 1, COLOR.walnut);
        rect(g, doorW - 1, doorH - 4, 3, 2, COLOR.fixtureEdge);
      }, { w: stall.w, h: doorH });
      const closed = this.texture(
        renderer,
        `stall-closed:${doorW}`,
        (g) => {
          // 闭合：门扇加高到 10px（盖住半掩那一版），红锁 + 门缝暖光
          box(g, 3, doorH - 10, doorW, 10, COLOR.walnut, COLOR.walnutDark);
          rect(g, 4, doorH - 9, doorW - 2, 1, COLOR.walnutLight);
          rect(g, 5, doorH - 7, doorW - 4, 1, COLOR.walnutDark);
          // 门缝暖光：一线 1px 亮黄，表示里面有人开着灯
          rect(g, 4, doorH - 2, doorW - 2, 1, COLOR.amber);
          // 红锁：门右侧的横担 + 一枚红点
          rect(g, doorW - 2, doorH - 6, 4, 2, COLOR.outline);
          rect(g, doorW - 1, doorH - 6, 2, 2, COLOR.peachDark);
          rect(g, doorW - 1, doorH - 6, 1, 1, 0xffc4b8);
        },
        { w: stall.w, h: doorH },
      );
      const sprite = new Sprite(open);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(stall.x + stall.w / 2, stall.y + stall.h);
      // 深度键取坑位南沿：人站门外时门在身后，坐进去时门把下半身挡住
      depth.add(stall.y + stall.h, sprite);
      this.stallDoors.push({ sprite, open, closed });

      // 就近匹配马桶座位（两坑相距 53，取最近的一定不会串格）
      const cx = stall.x + stall.w / 2;
      let bestId = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const seat of toilets) {
        const distance = Math.abs(seat.x - cx);
        if (distance >= bestDistance) continue;
        bestId = seat.id;
        bestDistance = distance;
      }
      if (bestId !== 0) this.stallOfSeat.set(bestId, index);
    }
  }

  /** 节约用水 · 严禁超时：水滴 + 时钟 + 红斜线 + 两行点阵字块 */
  private restroomSign(g: Graphics, x: number, y: number): void {
    box(g, x, y, 48, 18, COLOR.ceramic, COLOR.fixtureEdge);
    rect(g, x + 1, y + 1, 46, 1, COLOR.coolWhite);
    // 水滴
    g.poly([x + 7, y + 4, x + 10, y + 9, x + 4, y + 9]).fill(COLOR.skyDark);
    rect(g, x + 6, y + 7, 2, 2, COLOR.sky);
    // 时钟 + 红色禁止斜线
    g.circle(x + 21, y + 8, 4).fill(COLOR.outline);
    g.circle(x + 21, y + 8, 3).fill(COLOR.ceramic);
    rect(g, x + 21, y + 6, 1, 3, COLOR.outline);
    rect(g, x + 21, y + 8, 2, 1, COLOR.outline);
    for (let i = 0; i < 7; i += 1) rect(g, x + 16 + i, y + 4 + i, 1, 1, COLOR.peachDark);
    // 两行点阵字块
    for (let i = 0; i < 7; i += 1) rect(g, x + 29 + i * 2, y + 5, 1, 1, 0x6a7a8a);
    for (let i = 0; i < 5; i += 1) rect(g, x + 29 + i * 2, y + 9, 1, 1, 0x6a7a8a);
    for (let i = 0; i < 6; i += 1) rect(g, x + 29 + i * 2, y + 13, 1, 1, 0x6a7a8a);
  }

  /** 下铺床脚的快递箱：flat 层，床精灵会盖住上半截，只露出半截牛皮纸 */
  private underBedBoxes(g: Graphics, x: number, y: number): void {
    box(g, x, y, 11, 6, COLOR.kraft, COLOR.walnutDark);
    box(g, x + 9, y + 2, 9, 5, COLOR.kraftLight, COLOR.walnutDark);
    rect(g, x + 2, y + 2, 6, 1, COLOR.butter);
    rect(g, x + 11, y + 4, 4, 1, COLOR.butter);
    rect(g, x, y, 11, 1, COLOR.walnutDark);
  }

  /** 立式家具统一走这里：按 `key` 缓存纹理，同类只烘焙一次；`sortY` 可单独指定遮挡键 */
  private place(
    depth: DepthSink,
    renderer: TextureFactory,
    key: string,
    draw: (g: Graphics) => void,
    size: { w: number; h: number },
    x: number,
    y: number,
    sortY: number = y,
  ): void {
    const texture = this.texture(renderer, key, draw, size);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, y);
    depth.add(sortY, sprite);
  }

  private readonly cache = new Map<string, Texture>();

  private texture(
    renderer: TextureFactory,
    key: string,
    draw: (g: Graphics) => void,
    size: { w: number; h: number },
  ): Texture {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const texture = bake(renderer, draw, { frame: new Rectangle(0, 0, size.w, size.h) });
    this.cache.set(key, texture);
    this.textures.push(texture);
    return texture;
  }
}
