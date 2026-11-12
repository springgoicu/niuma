'use client';

import { Container, Graphics, Rectangle, Sprite, type Application, type Texture } from 'pixi.js';
import {
  WORLD_LAYOUT,
  type BuildingSpec,
  type PropInstance,
  type SeatInstance,
  type WorldRect,
} from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

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

function seatsIn(room: Room, kind: SeatInstance['kind']): SeatInstance[] {
  return WORLD_LAYOUT.seats.filter((seat) => seat.kind === kind && insideRect(room.rect, seat.x, seat.y));
}

function propsIn(room: Room, kind: PropInstance['kind']): PropInstance[] {
  return WORLD_LAYOUT.props.filter((prop) => prop.kind === kind && insideRect(room.rect, prop.x, prop.y));
}

export class InteriorArt {
  private readonly textures: Texture[] = [];

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

    if (work) this.decorateWorkroom(flat, work);
    if (meeting) this.decorateMeeting(flat, meeting);
    if (lounge) this.decorateLounge(flat, lounge);
    if (restroom) this.decorateRestroom(flat, restroom);
    base.addChild(flat);

    if (work) this.furnishWorkroom(depth, renderer, work);
    if (meeting) this.furnishMeeting(depth, renderer, meeting);
    if (lounge) this.furnishLounge(depth, renderer, lounge);
    if (restroom) this.decorateRestroomFittings(depth, renderer, restroom);
  }

  destroy(): void {
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
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
    this.place(depth, renderer, 'boxes', drawBoxes, BOXES, x + 232, y + 338);
    this.place(depth, renderer, 'printer', drawPrinter, PRINTER, x + 272, y + 338);
    this.place(depth, renderer, 'cart', drawCart, CART, x + 318, y + 338);
    this.place(depth, renderer, 'lamp', drawFloorLamp, FLOOR_LAMP, x + 440, y + 40);
    this.place(depth, renderer, 'board', drawStandBoard, STAND_BOARD, x + 120, y + 332);
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

    // 北墙居中超宽投屏：200×56，屏幕外沿两层硬边冷光
    const screenW = 200;
    const screenH = 56;
    const screenX = x + (w - screenW) / 2;
    const screenY = y + 2;
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

    // 会议桌：从共享 solids 反查，渲染层不重写 200×90 的坐标
    const table = fixtureIn(room, 150);
    if (table) drawMeetingTable(g, table);
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

    // 北墙两扇雪窗：门洞 x+200..x+260 两侧
    this.window(g, x + 60, y + t + 12, 64, 18);
    this.window(g, x + 320, y + t + 12, 64, 18);
    // 浅蓝月光 / 雪景：从窗台向室内投出阶梯矩形遮罩
    this.moonbeam(g, x + 60, y + t + 12, 64, 74);
    this.moonbeam(g, x + 320, y + t + 12, 64, 74);

    // 南墙暖气片 + 烤橘子
    this.radiator(g, x + 232, y + h - t, 36);

    // 北墙：门两侧的暖黄壁灯与挂钟，避开门洞与窗
    this.sconce(g, x + 138, y + t + 2);
    this.clock(g, x + 170, y + t + 4);
    this.sconce(g, x + 396, y + t + 2);

    // 南墙软木留言板：离职倒计时 365
    this.corkBoard(g, x + 150, y + 330, 60, 18);

    // 地面：圆形编织地毯 + 床边长毯 + 床脚拖鞋
    this.roundRug(g, x + 250, y + 250, 34);
    rect(g, x + 70, y + 326, 52, 10, COLOR.carpetDark);
    rect(g, x + 71, y + 327, 50, 8, 0xe8cbaa);
    for (let i = 0; i < 5; i += 1) rect(g, x + 74 + i * 10, y + 329, 1, 4, COLOR.carpetDark);
    this.slippers(g, x + 66, y + 334);

    // 下铺床脚的牛皮纸快递箱：只给两组上下铺的下铺画，上铺不会长出箱子
    const beds = seatsIn(room, 'bed');
    beds.forEach((bed, index) => {
      if (index % 2 === 0) return;
      // 箱顶压在床架下沿（床精灵的 4px 底边是透明的），只露出 4px 牛皮纸
      this.underBedBoxes(g, bed.x - 12, bed.y + 10);
    });
  }

  private furnishLounge(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    this.place(depth, renderer, 'wardrobe', drawWardrobe, WARDROBE, x + 352, y + h - 8);
    // 书架贴东墙：26px 宽，中心 x+436 → 右缘正好压在墙内侧 x+450
    this.place(depth, renderer, 'bookshelf', drawBookshelf, BOOKSHELF, x + 436, y + 120);
    this.place(depth, renderer, 'rack', drawLuggageRack, LUGGAGE_RACK, x + 300, y + 320);
    this.place(depth, renderer, 'coat-rack', drawCoatRack, COAT_RACK, x + 438, y + 250);

    // 床头几上的枸杞热水杯：位置从共享 sideTable 反查，杯底落在桌面上
    const sideTable = propsIn(room, 'sideTable')[0];
    if (sideTable) {
      this.place(depth, renderer, 'hot-cup', drawHotCup, HOT_CUP, sideTable.x, sideTable.y - 10, sideTable.y + 1);
    }
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

    // 水渍：砖缝处的半透明反光贴花
    const stains: Array<[number, number, number, number]> = [
      [x + 172, y + 302, 18, 4],
      [x + 204, y + 278, 12, 3],
      [x + 244, y + 260, 20, 4],
      [x + 284, y + 292, 10, 3],
    ];
    for (const [sx, sy, sw, sh] of stains) {
      wash(g, sx, sy, sw, sh, COLOR.water, 0.16);
      rect(g, sx + 2, sy + 1, sw - 4, 1, 0xeaf8ff);
    }

    // 深灰地漏
    const dx = x + 230;
    const dy = y + 246;
    rect(g, dx - 4, dy - 4, 8, 8, COLOR.outline);
    rect(g, dx - 3, dy - 3, 6, 6, COLOR.drain);
    for (let i = 0; i < 3; i += 1) rect(g, dx - 2, dy - 2 + i * 2, 4, 1, COLOR.fixtureEdge);

    // 三面墙裙
    rect(g, innerX, y + h - t - 6, innerW, 6, COLOR.mintTileDeep);
    rect(g, innerX, y + h - t - 6, innerW, 1, COLOR.mintTile);
    rect(g, innerX, innerY, 6, innerH, COLOR.mintTileDeep);
    rect(g, x + w - t - 6, innerY, 6, innerH, COLOR.mintTileDeep);

    // 连体洗手台 + 宽镜 + 台面小物
    this.vanity(g, room);
    // 隔间木门 + 红锁 + 厕纸架
    this.stallDoors(g, room);
    // 北墙提示牌：节约用水 · 严禁超时（图标 + 点阵字块）
    this.restroomSign(g, x + 268, y + 2);
  }

  private decorateRestroomFittings(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    this.place(depth, renderer, 'dryer', drawHandDryer, HAND_DRYER, x + 320, y + h - room.wall);
    this.place(depth, renderer, 'diffuser', drawDiffuser, DIFFUSER, x + 28, y + 42);
    this.place(depth, renderer, 'pothos', drawPothos, POTHOS, x + 432, y + 42);

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
    const { y } = room.rect;
    const sinks = propsIn(room, 'sink');
    if (sinks.length < 2) return;
    const left = Math.min(...sinks.map((sink) => sink.x));
    const right = Math.max(...sinks.map((sink) => sink.x));
    const counterX = left - 28;
    const counterW = right - left + 56;
    const counterBottom = y + 350;
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
    rect(g, counterX, y + 348, counterW, 2, COLOR.mintTileDeep);
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

  /** 隔间：6px 木隔断 + 留 2px 缝的门扇 + 使用中红锁 + 厕纸架 */
  private stallDoors(g: Graphics, room: Room): void {
    const { x, y } = room.rect;
    const t = room.wall;
    for (const px of [x + 77, x + 377]) {
      // 6px 隔断重绘为胡桃木
      box(g, px, y + t, 6, 154, COLOR.walnut, COLOR.walnutDark);
      rect(g, px + 1, y + t + 1, 1, 152, COLOR.walnutLight);
      rect(g, px + 5, y + t + 1, 1, 152, COLOR.walnutDark);
      // 门扇：与隔断留 2px 缝，贴在南半段
      const doorX = px + 8;
      const doorTop = y + t + 82;
      box(g, doorX, doorTop, 4, 70, COLOR.walnutLight, COLOR.walnutDark);
      rect(g, doorX + 1, doorTop + 3, 1, 64, COLOR.walnut);
      rect(g, doorX + 4, doorTop + 4, 1, 62, 0xf2d6b8);
      // 使用中红锁
      g.rect(doorX + 2, doorTop + 32, 2, 3).fill(COLOR.peachDark);
      g.rect(doorX + 1, doorTop + 30, 3, 2).fill(COLOR.peachDark);
      rect(g, doorX + 2, doorTop + 32, 1, 1, 0xffc4b8);
      // 厕纸架：挂在隔断上，位于门扇上方
      box(g, px + 2, y + 70, 5, 7, COLOR.fixture, COLOR.fixtureEdge);
      rect(g, px + 4, y + 72, 3, 3, COLOR.ceramic);
      rect(g, px + 4, y + 72, 3, 1, COLOR.ceramicEdge);
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
