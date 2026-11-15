'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import {
  BULLETIN_BOARD,
  DIRECTION,
  WORLD_LAYOUT,
  deskDepthOffset,
  deskFootprint,
  type BuildingSpec,
  type Direction,
  type PropInstance,
  type PropKind,
  type SeatInstance,
  type SeatKind,
  type SolidRect,
  type WorldRect,
} from '@niuma/shared-types';
import { chairArtFor, type ChairArt } from './chair-art';
import { deskArtFor, type DeskArt } from './desk-art';
import { BENCH_ART, seatArtFor } from './seat-art';
import { bake } from './terrain-textures';
import { paintRoadDressing, roadPostPlan } from './road-dressing';
import { buildStreetDecor } from './street-decor-art';
import type { DepthSink } from './sort-layer';
import { VENUE_COLORS, darken, lighten, type VenueColors } from './venue-palette';
import { codeLinePhase, focusPulse } from './venue-motion';

/**
 * 室内与园区设施的渲染层：工位、座椅、马桶、会议室、卫生间、庭院与装饰。
 *
 * 画风：1px 深靛描边 + 糖果色点缀（薄荷、奶油、天蓝、蜜桃、薰衣草），
 * 每件小物都带一处生活细节（马克杯、便签、绿植、伞）。
 * 纪律与地形一致（ADR-0013）：贴图构造期一次烘焙，帧循环只做裁剪与显示器贴图切换。
 */

type TextureFactory = Application['renderer'];

const COLOR = {
  outline: 0x2a3142,
  shadow: 0x1e2846,
  // 地面
  woodA: 0xd9ab7c,
  woodB: 0xcf9d70,
  woodSeam: 0xb5835a,
  tileA: 0xf3f8fb,
  tileB: 0xe3edf3,
  tileSeam: 0xbfd0dc,
  paving: 0xc9c4b1,
  pavingSeam: 0xb0ab97,
  wall: 0xdfe6ee,
  wallCap: 0xf7fafd,
  wallEdge: 0x9aa8b8,
  fixture: 0xe6ebf0,
  fixtureEdge: 0xa3afbd,
  // 工位
  bezel: 0x3b4560,
  screenIdle: 0x7aa6d8,
  screenLit: 0x9ff5d2,
  screenInk: 0x3d6fa8,
  /**
   * 工位亮屏的冷蓝白。
   *
   * 刻意不复用 `screenLit`（薄荷绿）：那档绿是售货机与马桶手机的「待机色」，
   * 工位整排亮成绿色会像一排自动贩卖机。蓝白 #c6e6ff 与木色桌面是互补对比，
   * 亮度只比熄屏高两档，夜里也不会把角色压成剪影。
   */
  deskScreen: 0xc6e6ff,
  deskScreenDim: 0x8fb6dd,
  deskScreenInk: 0x2f6f9e,
  deskScreenLine: 0xeaf4f8,
  deskTop: 0xf2c79b,
  deskTopLight: 0xffe0bf,
  deskFront: 0xd9a77a,
  deskLeg: 0x8a6b4f,
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
  ceramic: 0xfdfdff,
  ceramicEdge: 0xc4d0dc,
  chairBase: 0x4a5470,
  // 装饰
  woodLight: 0xe0b48a,
  woodDark: 0x8a6446,
  // 休息室：地毯、床品与软包
  carpetA: 0xe8c9a6,
  carpetB: 0xdcbb96,
  carpetSeam: 0xcaa680,
  linen: 0xfdf6ec,
  linenEdge: 0xdcc9b4,
  blanket: 0x9fd3ff,
  blanketLight: 0xc6e6ff,
  pillow: 0xffe49a,
  // 宿舍床：深胡桃木框 + 暖色被褥（与蓝白床品分开，方便只改宿舍的床）
  bedFrame: 0x6b4a35,
  bedFrameLight: 0x8a6446,
  bedFrameDark: 0x4a3226,
  bedBlanket: 0xd98a6a,
  bedBlanketLight: 0xf2b394,
  sofaBody: 0x8fe3c7,
  sofaSeat: 0xb6f0dc,
  stoolSeat: 0xffb59e,
  metal: 0x9aa5b4,
  gold: 0xffd166,
  lampGlow: 0xfff0b8,
  /** 复古路灯：铸铁杆与磨亮的铁沿，不用纯黑 */
  iron: 0x4a4f58,
  ironLight: 0x6f7680,
  binBody: 0x7dd6b0,
  binLid: 0x4fb591,
  signPaper: 0xfff6e0,
  signEdge: 0x8a6446,
  boardFrame: 0xb9c2cf,
  boardFace: 0xfdfefe,
  vendingBody: 0x6fb0ec,
  vendingGlass: 0xc9ecff,
  vendingBase: 0x3b4a66,
  potBody: 0xffb59e,
  potRim: 0xe8856d,
  // 放假告示板（ADR-0059）：软木、红布横幅与黄铜钉
  cork: 0xc08a55,
  corkLight: 0xd9a76f,
  corkDark: 0x9a6a3f,
  banner: 0xd94f4f,
  bannerDark: 0xa83a3a,
  bannerLight: 0xef7a6a,
  brass: 0xd8a33f,
  brassLight: 0xf2c879,
  paperAged: 0xf4e6c8,
  // 庭院植被与叠石（ADR-0096）：竹丛、圆润巨石、层叠石板
  bambooStalk: 0x7fbf6a,
  bambooStalkDark: 0x4a8a46,
  bambooNode: 0xa9dc8c,
  bambooLeaf: 0x63b364,
  bambooLeafLight: 0x9ad98b,
  taihuBody: 0xcfc7b6,
  taihuBodyDark: 0xa79f8e,
  taihuBodyLight: 0xf0eadb,
  taihuMoss: 0x8fae7a,
  qingshi: 0xb5ad9c,
  qingshiDark: 0x8f8877,
  qingshiLight: 0xd8d1c0,
  stoneBase: 0xb5ad9c,
  // 石鼓凳：汉白玉鼓身，比木凳更冷更亮
  drumStone: 0xe9e3d6,
  drumStoneDark: 0xb0a794,
  drumStoneLight: 0xfcf8ee,
} as const;

/**
 * 装饰贴图尺寸（px）：锚点在底边中心。
 *
 * 全部按「角色 48 纹素」重新收过一档：旧尺寸（花箱 34×44、售货机 42×60）几乎与角色等高，
 * 站在旁边像一件家具而不是一件小物。缩小只能改这里的数字与 drawProp 的手写坐标，
 * 不能用 sprite.scale——非整数纹素会把 1px 描边糊开（ADR-0005）。
 */
const PROP_SIZE: Record<PropKind, { w: number; h: number }> = {
  lamp: { w: 14, h: 40 },
  bench: BENCH_ART.frame,
  bin: { w: 14, h: 18 },
  sign: { w: 24, h: 32 },
  board: { w: 34, h: 24 },
  sink: { w: 20, h: 22 },
  vending: { w: 34, h: 48 },
  bike: { w: 38, h: 20 },
  table: { w: 40, h: 34 },
  plant: { w: 16, h: 22 },
  cooler: { w: 20, h: 30 },
  coffee: { w: 22, h: 28 },
  sideTable: { w: 20, h: 18 },
  /** 客厅茶几：48×24 的矮桌，桌面压一杯热茶与一本杂志 */
  coffeeTable: { w: 48, h: 24 },
  /** 树篱：一段 32 宽的灌木，沿南侧休息庭院围边（不参与碰撞） */
  hedge: { w: 32, h: 18 },
  /** 上下铺爬梯：两根木轨 + 四根横档，贴在床沿侧面示意上下层（ADR-0044） */
  ladder: { w: 14, h: 34 },
  /** 区域 logo 立牌：一块小板 + 木柱，variant 决定图标 */
  logo: { w: 28, h: 38 },
  /** 牛马放假告示板（ADR-0059）：尺寸直接取布局常量，避免第二份 80×48 */
  bulletin: { w: BULLETIN_BOARD.width, h: BULLETIN_BOARD.height },
  /** 翠竹（ADR-0061）：104 高 ≈ 2.2 个角色，压出「竹林」的纵向感 */
  bamboo: { w: 46, h: 104 },
  /** 太湖石叠石盆景（ADR-0061）：石身略高于角色半个身位 */
  taihu: { w: 30, h: 34 },
};

const TOILET_SPRITE = { w: 22, h: 28 };
const STOOL_SPRITE = { w: 18, h: 22 };
/** 石鼓凳（ADR-0061）：鼓身矮胖、两端鼓钉各一圈，座面比木凳低 5 纹素 */
const DRUM_SPRITE = { w: 20, h: 22 };
const SOFA_SPRITE = { w: 58, h: 30 };
/**
 * 床：横向 64×42，躺下的角色正好横卧在床垫上。
 * 角色帧是 64×64、锚点在脚底中心，所以床要往锚点下方压 16px 才托住躯干。
 */
const BED_SPRITE = { w: 64, h: 42 };

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

/** 带描边的圆角矩形：外圈描边，内圈填色 */
function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number = COLOR.outline): void {
  g.roundRect(x, y, w, h, 2).fill(line);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 1).fill(fill);
}

/** 带描边的圆（用于绿植、车轮、马桶盖之类） */
function dot(g: Graphics, cx: number, cy: number, r: number, fill: number, line: number = COLOR.outline): void {
  g.circle(cx, cy, r + 1).fill(line);
  g.circle(cx, cy, r).fill(fill);
}

function shadow(g: Graphics, cx: number, cy: number, rx: number, ry: number): void {
  g.ellipse(cx, cy, rx, ry).fill({ color: COLOR.shadow, alpha: 0.22 });
}

/** 一株小绿植：圆盆 + 三片叶子，给桌面与广场增添生气 */
function drawPlantPot(g: Graphics, cx: number, bottom: number, scale = 1): void {
  const potW = 8 * scale;
  const potH = 7 * scale;
  box(g, cx - potW / 2, bottom - potH, potW, potH, COLOR.potBody);
  rect(g, cx - potW / 2 - 1, bottom - potH - 1, potW + 2, 2, COLOR.potRim);
  dot(g, cx - 3 * scale, bottom - potH - 4 * scale, 3 * scale, COLOR.leaf);
  dot(g, cx + 3 * scale, bottom - potH - 4 * scale, 3 * scale, COLOR.leaf);
  dot(g, cx, bottom - potH - 7 * scale, 3 * scale, COLOR.mintDark);
}

function drawProp(kind: PropKind, g: Graphics, variant = 0): void {
  const { w, h } = PROP_SIZE[kind];
  shadow(g, w / 2, h - 1, Math.max(6, w / 2 - 2), 2);
  switch (kind) {
    case 'lamp':
      // 复古铸铁灯柱：暖光先晕开，再压底座、杆身与四角灯檐
      g.circle(7, 5, 10).fill({ color: COLOR.lampGlow, alpha: 0.24 });
      box(g, 4, h - 4, 6, 3, COLOR.iron, COLOR.outline);
      box(g, 5, h - 7, 4, 4, COLOR.ironLight, COLOR.iron);
      box(g, 6, 12, 2, h - 18, COLOR.iron, COLOR.ironLight);
      rect(g, 5, 19, 4, 1, COLOR.ironLight);
      rect(g, 5, 27, 4, 1, COLOR.ironLight);
      box(g, 2, 3, 10, 3, COLOR.iron, COLOR.outline);
      g.poly([3, 6, 11, 6, 9, 12, 5, 12]).fill(COLOR.iron);
      g.poly([5, 7, 9, 7, 8, 11, 6, 11]).fill(COLOR.gold);
      rect(g, 6, 8, 2, 2, COLOR.lampGlow);
      return;
    case 'bench':
      rect(g, 2, BENCH_ART.seatTop - 1, 36, 1, COLOR.outline);
      box(g, 1, 3, 38, 4, COLOR.woodLight);
      box(g, 1, BENCH_ART.seatTop, 38, 4, COLOR.woodDark);
      box(g, 4, BENCH_ART.seatTop + 4, 3, 5, COLOR.woodDark);
      box(g, 33, BENCH_ART.seatTop + 4, 3, 5, COLOR.woodDark);
      return;
    case 'bin':
      box(g, 2, 4, 10, 13, COLOR.binBody);
      box(g, 1, 2, 12, 3, COLOR.binLid);
      rect(g, 4, 8, 6, 1, COLOR.wallCap);
      return;
    case 'sign':
      box(g, 10, 13, 3, 18, COLOR.woodDark);
      box(g, 1, 1, 22, 13, COLOR.signPaper, COLOR.signEdge);
      // 一个小箭头：指路的牌子才像牌子
      rect(g, 6, 6, 9, 2, COLOR.mintDark);
      g.poly([15, 4, 19, 7, 15, 10]).fill(COLOR.mintDark);
      return;
    case 'board':
      box(g, 0, 0, 34, 24, COLOR.boardFrame);
      rect(g, 2, 2, 30, 20, COLOR.boardFace);
      // 白板上的三道彩色笔迹
      rect(g, 6, 7, 11, 2, COLOR.skyDark);
      rect(g, 6, 11, 16, 2, COLOR.peachDark);
      rect(g, 6, 15, 8, 2, COLOR.mintDark);
      dot(g, 27, 7, 2, COLOR.butter);
      return;
    case 'sink':
      // 靠墙的洗手台：底座贴墙（精灵底边），所以柜面朝房间（上），水龙头贴墙（下）。
      // 旧画法把龙头画在上方，只有挂在北墙才成立；卫生间南墙用这套。
      box(g, 0, 0, 20, 11, COLOR.fixture, COLOR.fixtureEdge);
      rect(g, 2, 1, 16, 1, COLOR.wallCap);
      box(g, 4, 9, 12, 7, COLOR.ceramic, COLOR.ceramicEdge);
      // 盆底一层薄水：让白瓷盆不是一块空白
      rect(g, 5, 11, 10, 1, 0xbfe6f5);
      // 龙头：冷灰金属 + 一道高光，金色留给咖啡机
      rect(g, 9, 16, 2, 6, COLOR.metal);
      rect(g, 8, 16, 4, 1, COLOR.metal);
      rect(g, 9, 16, 1, 1, COLOR.wallCap);
      return;
    case 'vending':
      box(g, 0, 0, 34, 48, COLOR.vendingBody);
      box(g, 3, 5, 22, 30, COLOR.vendingGlass, COLOR.vendingBase);
      // 货道：三行糖果色饮料
      for (let row = 0; row < 3; row += 1) {
        const y = 9 + row * 9;
        dot(g, 8, y, 2, [COLOR.peach, COLOR.butter, COLOR.mint][row]!);
        dot(g, 14, y, 2, [COLOR.sky, COLOR.lilac, COLOR.peach][row]!);
        dot(g, 20, y, 2, [COLOR.mint, COLOR.sky, COLOR.butter][row]!);
      }
      box(g, 26, 13, 5, 5, COLOR.vendingBase);
      rect(g, 27, 15, 3, 1, COLOR.gold);
      box(g, 3, 39, 28, 6, COLOR.vendingBase);
      return;
    case 'bike':
      // 两辆小单车：车轮是圆环，车架是一条线
      for (const cx of [9, 29]) {
        g.circle(cx, 14, 5).stroke({ width: 2, color: COLOR.outline });
        g.circle(cx, 14, 3.5).stroke({ width: 1, color: COLOR.lilacDark });
      }
      rect(g, 9, 13, 20, 1, COLOR.outline);
      rect(g, 19, 7, 1, 7, COLOR.outline);
      return;
    case 'table':
      // 野餐桌 + 一把彩色遮阳伞
      rect(g, 19, 6, 2, 21, COLOR.outline);
      g.ellipse(20, 6, 16, 5).fill(COLOR.outline);
      g.ellipse(20, 6, 15, 4).fill(COLOR.peach);
      g.ellipse(20, 6, 15, 2).fill(COLOR.butter);
      box(g, 1, 22, 38, 4, COLOR.woodLight);
      box(g, 4, 26, 4, 7, COLOR.woodDark);
      box(g, 32, 26, 4, 7, COLOR.woodDark);
      return;
    case 'plant':
      drawPlantPot(g, w / 2, h - 1, 1);
      return;
    case 'cooler':
      // 饮水机：顶上一只天蓝色水桶，机身两个出水按钮，底部一层空杯
      box(g, 2, 0, 16, 11, COLOR.sky, COLOR.skyDark);
      rect(g, 3, 2, 14, 2, COLOR.skyDark);
      rect(g, 8, 4, 4, 5, COLOR.wallCap);
      box(g, 1, 11, 18, 18, COLOR.fixture, COLOR.fixtureEdge);
      rect(g, 4, 14, 4, 3, COLOR.skyDark);
      rect(g, 11, 14, 4, 3, COLOR.peachDark);
      box(g, 6, 20, 8, 6, COLOR.wallCap, COLOR.ceramicEdge);
      return;
    case 'coffee':
      // 咖啡机：深色机身 + 亮屏菜单 + 出水口下的一只白杯
      box(g, 1, 1, 20, 25, COLOR.bezel);
      box(g, 3, 4, 16, 8, COLOR.screenIdle, COLOR.bezel);
      rect(g, 5, 6, 5, 1, COLOR.ceramic);
      rect(g, 5, 9, 8, 1, COLOR.ceramic);
      rect(g, 10, 14, 2, 3, COLOR.metal);
      box(g, 7, 17, 8, 6, COLOR.ceramic, COLOR.ceramicEdge);
      rect(g, 9, 19, 4, 1, COLOR.woodDark);
      rect(g, 2, 26, 18, 1, COLOR.outline);
      return;
    case 'sideTable':
      // 床头小几：圆桌面 + 一根细腿
      g.ellipse(10, 6, 9, 4).fill(COLOR.outline);
      g.ellipse(10, 5, 8, 3).fill(COLOR.woodLight);
      box(g, 9, 7, 2, 8, COLOR.woodDark);
      box(g, 4, 14, 12, 3, COLOR.woodDark);
      return;
    case 'coffeeTable':
      // 客厅茶几：矮桌面 + 四条短腿，桌上压一杯热茶与一本摊开的杂志
      g.ellipse(w / 2, h - 2, 23, 3).fill({ color: COLOR.shadow, alpha: 0.18 });
      box(g, 2, 6, w - 4, 10, COLOR.woodLight, COLOR.woodDark);
      rect(g, 4, 7, w - 8, 2, 0xffe0bf);
      rect(g, 4, 15, w - 8, 1, COLOR.woodSeam);
      box(g, 5, 16, 3, 7, COLOR.woodDark);
      box(g, w - 8, 16, 3, 7, COLOR.woodDark);
      // 热茶：白瓷杯 + 一点薄荷绿茶汤
      box(g, 12, 1, 8, 8, COLOR.ceramic, COLOR.ceramicEdge);
      rect(g, 13, 3, 6, 4, COLOR.mint);
      rect(g, 20, 3, 2, 4, COLOR.ceramicEdge);
      // 杂志：天蓝封面 + 两道白字块
      box(g, 28, 2, 12, 8, COLOR.sky, COLOR.skyDark);
      rect(g, 30, 4, 8, 1, COLOR.ceramic);
      rect(g, 30, 6, 5, 1, COLOR.ceramic);
      return;
    case 'hedge':
      // 一段修剪过的树篱：左右两团深叶夹一团亮叶，顶面点两粒高光；
      // 32 宽配 64 间距，沿边拼起来是一道连绵但不封路的软边界
      dot(g, 8, 10, 6, COLOR.leafDark);
      dot(g, 24, 10, 6, COLOR.leafDark);
      dot(g, 16, 8, 7, COLOR.leaf);
      rect(g, 12, 3, 3, 1, COLOR.mint);
      rect(g, 20, 5, 2, 1, COLOR.mint);
      rect(g, 5, 8, 2, 1, COLOR.mintDark);
      return;
    case 'ladder':
      // 上下铺爬梯：两根木轨 + 四根横档，靠在下铺床沿外侧
      box(g, 1, 1, 3, 32, COLOR.woodLight, COLOR.woodDark);
      box(g, 10, 1, 3, 32, COLOR.woodLight, COLOR.woodDark);
      for (const y of [6, 13, 20, 27]) rect(g, 3, y, 8, 2, COLOR.woodDark);
      rect(g, 2, 3, 1, 28, COLOR.deskTopLight);
      return;
    case 'logo': {
      // 区域立牌：木板 + 木柱 + 底座，四种图标由 variant 决定（ADR-0044）
      box(g, 1, 0, 26, 20, COLOR.signPaper, COLOR.signEdge);
      box(g, 12, 20, 4, 15, COLOR.woodLight, COLOR.woodDark);
      rect(g, 7, 35, 14, 2, COLOR.woodDark);
      switch (variant) {
        case 1:
          // 会议桌 + 三把椅子
          rect(g, 6, 11, 16, 3, COLOR.woodDark);
          rect(g, 7, 6, 3, 3, COLOR.lilacDark);
          rect(g, 13, 6, 3, 3, COLOR.lilacDark);
          rect(g, 19, 6, 3, 3, COLOR.lilacDark);
          rect(g, 6, 15, 2, 2, COLOR.woodDark);
          rect(g, 20, 15, 2, 2, COLOR.woodDark);
          return;
        case 2:
          // 上下铺：两层床垫 + 四根立柱
          rect(g, 5, 4, 18, 2, COLOR.woodDark);
          rect(g, 5, 7, 18, 4, COLOR.linen);
          rect(g, 5, 13, 18, 4, COLOR.blanket);
          rect(g, 5, 4, 2, 14, COLOR.woodLight);
          rect(g, 21, 4, 2, 14, COLOR.woodLight);
          rect(g, 6, 8, 5, 2, COLOR.pillow);
          rect(g, 6, 14, 5, 2, COLOR.pillow);
          return;
        case 3:
          // 男 / 女：两个小人夹一道分割线
          dot(g, 9, 7, 2, COLOR.sky);
          dot(g, 19, 7, 2, COLOR.peach);
          rect(g, 8, 10, 3, 7, COLOR.skyDark);
          rect(g, 18, 10, 3, 7, COLOR.peachDark);
          rect(g, 14, 12, 1, 6, COLOR.fixtureEdge);
          return;
        default:
          // 工作区：显示器 + 键盘
          rect(g, 5, 5, 18, 11, COLOR.bezel);
          rect(g, 7, 7, 14, 7, COLOR.screenIdle);
          rect(g, 8, 9, 5, 1, COLOR.ceramic);
          rect(g, 12, 11, 7, 1, COLOR.screenInk);
          rect(g, 13, 16, 2, 2, COLOR.bezel);
          rect(g, 9, 18, 10, 1, COLOR.bezel);
          return;
      }
    }
    case 'bulletin': {
      /**
       * 牛马放假告示板（ADR-0059）：双立柱 + 软木板 + 铜钉 + 红布横幅。
       *
       * 80×48 里只画「形」：横幅上的中文与顶部的薄荷绿跑马灯要逐帧变，
       * 由 `bulletin.ts` 用 Pixi Text 叠在同一个深度层上（烘焙纹理不能装动态文本）。
       * 所有坐标手写取整，保证 1px 描边不被半像素糊开（ADR-0005）。
       */
      // 两根立柱：先画，中段被软木板压住
      for (const x of [4, w - 10]) {
        box(g, x, 13, 6, h - 13, COLOR.woodDark, COLOR.outline);
        box(g, x + 1, 14, 4, h - 15, COLOR.woodLight, COLOR.woodDark);
        // 斜切木纹：立柱上两小段 1px 斜线
        for (const y of [24, 34]) {
          g.poly([x + 1, y, x + 2, y, x + 5, y + 3, x + 4, y + 3]).fill(COLOR.woodDark);
        }
      }

      // 红布横幅：挂在顶梁上，底部两个燕尾缺口
      box(g, 16, 0, 48, 10, COLOR.banner, COLOR.bannerDark);
      g.poly([16, 10, 22, 10, 19, 13]).fill(COLOR.bannerDark);
      g.poly([64, 10, 58, 10, 61, 13]).fill(COLOR.bannerDark);
      rect(g, 17, 1, 46, 1, COLOR.bannerLight);

      // 顶梁 + 四道斜切木纹
      box(g, 2, 9, w - 4, 8, COLOR.woodDark, COLOR.outline);
      box(g, 3, 10, w - 6, 6, COLOR.woodLight, COLOR.woodDark);
      for (const x of [12, 26, 54, 68]) rect(g, x, 12, 5, 1, COLOR.woodDark);

      // 软木面：外框、内芯、颗粒与四角铜钉
      box(g, 8, 16, w - 16, 26, COLOR.cork, COLOR.corkDark);
      rect(g, 9, 17, w - 18, 24, COLOR.corkLight);
      // 颗粒坐标手写：布局纪律不允许 Math.random 进渲染，双端截图才对得上
      for (const [x, y] of [
        [13, 21],
        [21, 25],
        [30, 19],
        [38, 27],
        [47, 22],
        [54, 29],
        [62, 20],
        [66, 34],
        [18, 34],
        [41, 35],
        [58, 24],
        [26, 31],
      ] as const) {
        rect(g, x, y, 1, 1, COLOR.corkDark);
      }

      // 三张钉住的便签：奶油纸、泛黄纸与一张日历撕页
      const notes: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
        [12, 20, 18, 9, COLOR.signPaper, COLOR.banner],
        [34, 19, 22, 11, COLOR.paperAged, COLOR.mintDark],
        [45, 32, 18, 7, COLOR.ceramic, COLOR.brass],
      ];
      for (const [x, y, noteW, noteH, paper, pin] of notes) {
        box(g, x, y, noteW, noteH, paper, COLOR.signEdge);
        // 便签上的两行「手写」
        rect(g, x + 3, y + 3, Math.max(4, noteW - 7), 1, COLOR.woodDark);
        rect(g, x + 3, y + 5, Math.max(4, noteW - 12), 1, COLOR.woodDark);
        // 大头图钉：3×3 钉身 + 1px 高光
        rect(g, x + Math.round(noteW / 2) - 1, y - 2, 3, 3, COLOR.signEdge);
        rect(g, x + Math.round(noteW / 2), y - 1, 1, 1, pin);
      }
      // 日历撕页的红色页眉
      rect(g, 46, 32, 16, 2, COLOR.banner);

      for (const [x, y] of [
        [10, 18],
        [w - 12, 18],
        [10, 38],
        [w - 12, 38],
      ] as const) {
        rect(g, x, y, 2, 2, COLOR.brass);
        rect(g, x, y, 1, 1, COLOR.brassLight);
      }

      // 底梁：按 F 的提示文字由 bulletin.ts 叠在中间
      box(g, 6, 41, w - 12, 6, COLOR.woodDark, COLOR.outline);
      box(g, 7, 42, w - 14, 4, COLOR.woodLight, COLOR.woodDark);
      return;
    }
    case 'bamboo': {
      // 翠竹（ADR-0061）：四根高矮错落的竹竿，每 14px 一道竹节环，竿顶挑两片叶。
      // 竿宽 3px（暗-亮-暗）在 20px 粒度下是唯一读得出「圆柱」的宽度；
      // 节环错开半格，四根竿才不会连成一条横线。
      const stalks: ReadonlyArray<{ x: number; top: number; sway: number }> = [
        { x: 7, top: 34, sway: 0 },
        { x: 17, top: 16, sway: 1 },
        { x: 26, top: 26, sway: 0 },
        { x: 35, top: 40, sway: 1 },
      ];
      // 根部土堆与贴地草
      box(g, 4, h - 7, 38, 6, COLOR.stoneBase, COLOR.outline);
      rect(g, 6, h - 8, 34, 1, COLOR.bambooLeaf);
      for (const stalk of stalks) {
        const top = stalk.top - variant * 2;
        rect(g, stalk.x, top, 3, h - top - 6, COLOR.bambooStalkDark);
        rect(g, stalk.x + 1, top, 1, h - top - 7, COLOR.bambooStalk);
        for (let y = top + 8 + stalk.sway * 4; y < h - 10; y += 14) {
          rect(g, stalk.x, y, 3, 1, COLOR.bambooNode);
        }
        // 顶端叶簇：左挑一片、右压一片，加 1px 高光
        rect(g, stalk.x - 3, top + 2, 4, 1, COLOR.bambooLeaf);
        rect(g, stalk.x + 3, top + 5, 4, 1, COLOR.bambooLeaf);
        rect(g, stalk.x - 2, top + 1, 2, 1, COLOR.bambooLeafLight);
        rect(g, stalk.x + 4, top + 4, 2, 1, COLOR.bambooLeafLight);
      }
      return;
    }
    case 'taihu': {
      // 庭院叠石（ADR-0096）：石座 + 圆润巨石 / 层叠石板，不再是太湖石的透光孔造型
      box(g, 4, h - 6, 22, 5, COLOR.stoneBase, COLOR.outline);
      if (variant === 0) {
        // 圆润巨石：主石 + 两侧矮石，靠三段收边读出体积
        box(g, 9, 7, 13, 22, COLOR.taihuBody, COLOR.outline);
        box(g, 7, 15, 4, 11, COLOR.taihuBody, COLOR.outline);
        box(g, 20, 12, 4, 12, COLOR.taihuBody, COLOR.outline);
        rect(g, 10, 8, 4, 1, COLOR.taihuBodyLight);
        rect(g, 10, 9, 1, 7, COLOR.taihuBodyLight);
        // 石面一道斜裂纹：擦痕替代原来的透光孔
        rect(g, 15, 16, 3, 1, COLOR.taihuBodyDark);
        rect(g, 14, 17, 2, 3, COLOR.taihuBodyDark);
        // 石根一圈草色
        rect(g, 8, 27, 4, 2, COLOR.taihuMoss);
        rect(g, 19, 25, 3, 2, COLOR.taihuMoss);
        return;
      }
      // 层叠石板：三块横石由下往上收，石缝里塞草色
      box(g, 3, 22, 24, 7, COLOR.qingshi, COLOR.outline);
      box(g, 6, 15, 18, 8, COLOR.qingshi, COLOR.outline);
      box(g, 10, 8, 11, 8, COLOR.qingshi, COLOR.outline);
      rect(g, 4, 23, 22, 1, COLOR.qingshiLight);
      rect(g, 7, 16, 16, 1, COLOR.qingshiLight);
      rect(g, 11, 9, 9, 1, COLOR.qingshiLight);
      rect(g, 8, 20, 5, 2, COLOR.qingshiDark);
      rect(g, 16, 13, 4, 2, COLOR.qingshiDark);
      rect(g, 5, 27, 4, 2, COLOR.taihuMoss);
      rect(g, 18, 21, 3, 1, COLOR.taihuMoss);
      return;
    }
  }
}

/**
 * 显示器：正面 / 背面 / 侧视三种画法（ADR-0027）。
 *
 * 桌子只有一块桌面，屏幕必须朝坐的人；`art` 给出显示器落在哪条边、
 * 镜头看到的是屏幕、背壳还是侧面。点亮状态三种视角都要一眼读出来：
 * 正面亮屏、背面沿外框漏光、侧视在屏幕那一侧留一条亮边与一片反光。
 *
 * `phase` 是亮屏代码行的两帧相位（0 / 1）：两帧只改行的长度与缩进，
 * 换成纹理引用即可，不需要在帧循环里重画。
 */
function drawMonitor(g: Graphics, lit: boolean, art: DeskArt, phase: 0 | 1): void {
  const m = art.monitor;
  const standX = Math.round(m.x + m.w / 2 - 3);
  const side = art.screen === 'west' || art.screen === 'east';

  // 泛光按帧内裁剪：朝北的显示器贴在帧顶，外扩 4px 会越过画布上沿
  if (lit) {
    const glowY = Math.max(0, m.y - 4);
    g.rect(m.x - 4, glowY, m.w + 8, m.h + 8 - (glowY - (m.y - 4))).fill({ color: COLOR.deskScreen, alpha: 0.12 });
  }
  // 支架：机身下沿压 2px，底座落在桌面上 / 桌面前沿
  rect(g, standX, m.y + m.h - 2, 6, 7, COLOR.bezel);

  if (side) {
    // 侧视：竖窄机身 + 屏幕一侧的亮边；屏幕朝东就亮右边，朝西就亮左边
    const screenX = art.screen === 'east' ? m.x + m.w - 3 : m.x + 1;
    box(g, m.x, m.y, m.w, m.h, COLOR.bezel);
    rect(g, m.x + 3, m.y + 2, m.w - 6, m.h - 4, COLOR.chairBase);
    rect(g, screenX, m.y + 3, 2, m.h - 6, lit ? COLOR.deskScreen : COLOR.screenInk);
    if (lit) {
      // 光从屏幕那一侧洒在桌面上：侧视只有这一片反光读得出「亮着」
      const spillX = art.screen === 'east' ? m.x + m.w + 4 : m.x - 4;
      g.ellipse(spillX, m.y + m.h / 2, 5, m.h * 0.42).fill({ color: COLOR.deskScreen, alpha: 0.24 });
      // 两帧的差别落在屏幕那一条亮边的中段：侧视也能看出「有人在敲」
      rect(g, screenX, m.y + (phase === 0 ? 6 : 10), 2, 3, COLOR.deskScreenLine);
    }
    return;
  }

  box(g, m.x, m.y, m.w, m.h, COLOR.bezel);
  if (art.screen === 'front') {
    // 正面：屏幕 + 标题栏 + 代码行；熄屏时只剩一道深色墨线
    box(g, m.x + 2, m.y + 2, m.w - 4, m.h - 6, lit ? COLOR.deskScreen : COLOR.screenIdle, COLOR.bezel);
    if (lit) {
      // 标题栏：一条深蓝 + 右侧三个窗口点，屏幕才像「开着一个编辑器」
      rect(g, m.x + 4, m.y + 4, m.w - 8, 2, COLOR.deskScreenInk);
      for (let i = 0; i < 3; i += 1) rect(g, m.x + m.w - 11 + i * 2, m.y + 4, 1, 2, COLOR.deskScreenLine);
      // 代码行：两帧换长度与缩进；末尾 1px 是光标
      if (phase === 0) {
        rect(g, m.x + 5, m.y + 8, 14, 1, COLOR.deskScreenLine);
        rect(g, m.x + 7, m.y + 11, 9, 1, COLOR.deskScreenLine);
        rect(g, m.x + 5, m.y + 14, 18, 1, COLOR.deskScreenLine);
        rect(g, m.x + 24, m.y + 14, 1, 1, COLOR.deskScreenLine);
      } else {
        rect(g, m.x + 5, m.y + 8, 10, 1, COLOR.deskScreenLine);
        rect(g, m.x + 7, m.y + 11, 16, 1, COLOR.deskScreenLine);
        rect(g, m.x + 5, m.y + 14, 7, 1, COLOR.deskScreenLine);
        rect(g, m.x + 13, m.y + 14, 1, 1, COLOR.deskScreenLine);
      }
      g.ellipse(m.x + m.w / 2, m.y + m.h + 4, m.w * 0.55, 5).fill({ color: COLOR.deskScreen, alpha: 0.2 });
    } else {
      rect(g, m.x + 5, m.y + 6, 14, 1, COLOR.screenInk);
      rect(g, m.x + 5, m.y + 10, 9, 1, COLOR.screenInk);
    }
    return;
  }

  // 背面：素色背壳 + 两道散热缝；屏幕朝人（北），光只从外框与桌面反光里漏出来
  box(g, m.x + 3, m.y + 3, m.w - 6, m.h - 6, COLOR.chairBase, COLOR.bezel);
  rect(g, m.x + 6, m.y + 8, m.w - 12, 1, COLOR.bezel);
  rect(g, m.x + 6, m.y + 12, m.w - 12, 1, COLOR.bezel);
  if (lit) {
    // 屏幕朝人（北），镜头这一侧只能看到光沿外框漏出来的一圈
    rect(g, m.x + 1, m.y + 1, m.w - 2, 1, COLOR.deskScreen);
    rect(g, m.x + 1, m.y + m.h - 2, m.w - 2, 1, COLOR.deskScreen);
    // 漏光在两帧里错开一格，避免背壳看久了像死图
    rect(g, m.x + (phase === 0 ? 4 : 8), m.y + m.h - 3, 10, 1, COLOR.deskScreenDim);
  }
}

/**
 * 工位：桌面 + 前挡板 + 桌腿 + 显示器 + 桌角陈设，全部按 `DeskArt` 的盒子绘制。
 *
 * 朝向只改几何（`desk-art.ts`），这里不再写四套画法：横桌与竖桌走同一条绘制路径，
 * 侧放桌的桌面、前挡板、桌腿与显示器位置都来自同一份数据。
 * 绘制顺序是「桌面 → 显示器 → 陈设」，显示器才站得住桌面而不是被桌面盖住。
 */
function drawDesk(g: Graphics, lit: boolean, art: DeskArt, phase: 0 | 1): void {
  const { top, front, handle, legs, shadow: sh, details } = art;
  shadow(g, sh.cx, sh.cy, sh.rx, sh.ry);
  // 桌面与前挡板：顶面浅、前面深，带圆角与抽屉拉手
  box(g, top.x, top.y, top.w, top.h, COLOR.deskTop);
  rect(g, top.x + 2, top.y + 1, top.w - 4, 2, COLOR.deskTopLight);
  box(g, front.x, front.y, front.w, front.h, COLOR.deskFront);
  rect(g, handle.x, handle.y, handle.w, handle.h, COLOR.deskLeg);
  for (const leg of legs) box(g, leg.x, leg.y, leg.w, leg.h, COLOR.deskLeg);
  drawMonitor(g, lit, art, phase);
  // 桌角生活细节：侧放桌的显示器占住西 / 东长边，陈设让到靠人的半边
  const { plant, mug, note } = details;
  box(g, mug.x, mug.y, 9, 9, COLOR.mint);
  rect(g, mug.x + 1, mug.y + 2, 7, 2, COLOR.ceramic);
  g.roundRect(mug.x + 8, mug.y + 3, 3, 4, 1).stroke({ width: 1, color: COLOR.outline });
  box(g, note.x, note.y, 9, 7, COLOR.butter);
  rect(g, note.x + 2, note.y + 2, 5, 1, COLOR.peachDark);
  drawPlantPot(g, plant.cx, plant.bottom, 1);
}

/**
 * 工位椅 / 会议椅：薰衣草色软垫，高背带一条头枕分区，五星脚带两个可见滚轮。
 *
 * 几何来自 `chairArtFor(facing)`：靠背永远在入座朝向的反侧，
 * 空椅不会出现「靠背朝着桌子、人却要坐上去」的错觉。
 * 头枕、扶手与滚轮都画在既有 26×30 帧内，不改座面接触契约（ADR-0032）。
 */
function drawChair(g: Graphics, art: ChairArt): void {
  const { seat, back, highlight, stem, base, shadow: sh } = art;
  shadow(g, sh.cx, sh.cy, sh.rx, sh.ry);
  box(g, seat.x, seat.y, seat.w, seat.h, COLOR.lilac);
  box(g, back.x, back.y, back.w, back.h, COLOR.lilacDark);
  // 头枕：靠背顶端一条更亮的软包，下面压一道深色缝
  rect(g, back.x + 1, back.y + 1, Math.max(1, back.w - 2), 2, COLOR.lilac);
  rect(g, back.x, back.y + 3, back.w, 1, COLOR.chairBase);
  // 扶手：正 / 背视角才看得到座面两侧，侧视不画，免得压住靠背
  if (back.w >= 10) {
    rect(g, seat.x - 1, seat.y + 2, 1, Math.max(1, seat.h - 2), COLOR.chairBase);
    rect(g, seat.x + seat.w, seat.y + 2, 1, Math.max(1, seat.h - 2), COLOR.chairBase);
  }
  rect(g, highlight.x, highlight.y, highlight.w, highlight.h, COLOR.ceramic);
  rect(g, stem.x, stem.y, stem.w, stem.h, COLOR.chairBase);
  rect(g, base.x, base.y, base.w, base.h, COLOR.chairBase);
  // 滚轮：五星脚两端各一个 2×2 小轮，椅子可以「滑走」而不是钉在地上
  for (const wheelX of [base.x + 2, base.x + base.w - 4]) {
    rect(g, wheelX, base.y + base.h - 1, 2, 2, COLOR.chairBase);
    rect(g, wheelX, base.y + base.h - 1, 1, 1, COLOR.metal);
  }
}

/** 马桶：白瓷水箱 + 圆润马桶圈；水箱上放着一部亮屏手机（带薪摸鱼） */
function drawToilet(g: Graphics): void {
  const { w, h } = TOILET_SPRITE;
  shadow(g, w / 2, h - 1, 9, 2.5);
  box(g, 4, 0, 14, 10, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, 6, 3, 10, 1, COLOR.ceramicEdge);
  // 冲水按钮 + 手机：屏幕是整间卫生间最亮的一块
  rect(g, 6, 5, 2, 1, COLOR.ceramicEdge);
  box(g, 12, 1, 5, 3, COLOR.bezel, COLOR.outline);
  rect(g, 13, 2, 3, 1, COLOR.screenLit);
  g.ellipse(11, 18, 9, 7).fill(COLOR.outline);
  g.ellipse(11, 18, 8, 6).fill(COLOR.ceramic);
  g.ellipse(11, 18, 5, 3.5).stroke({ width: 1, color: COLOR.ceramicEdge });
}

/** 凳子：糖果色软垫 + 两根可见细腿，比椅子矮一档 */
function drawStool(g: Graphics): void {
  const { w, h } = STOOL_SPRITE;
  shadow(g, w / 2, h - 1, 7, 2);
  box(g, 2, 6, 14, 7, COLOR.stoolSeat);
  rect(g, 4, 8, 10, 1, COLOR.ceramic);
  box(g, 3, 13, 2, 8, COLOR.woodDark);
  box(g, 13, 13, 2, 8, COLOR.woodDark);
}

/**
 * 石鼓凳（ADR-0061）：鼓腹 + 两道弦纹 + 四枚鼓钉，汉白玉本色。
 * 与木凳的区别必须靠三处同时成立——冷白配色、鼓起的腰线、贴地的鼓足，
 * 少一处就会读成「刷白了的木凳子」。
 */
function drawDrumStool(g: Graphics): void {
  const { w, h } = DRUM_SPRITE;
  shadow(g, w / 2, h - 1, 8, 2);
  // 鼓腹：上下收、中间鼓，靠两条弦纹把鼓面分割出来
  box(g, 2, 4, 16, 13, COLOR.drumStone, COLOR.outline);
  rect(g, 3, 5, 14, 1, COLOR.drumStoneLight);
  rect(g, 3, 8, 14, 1, COLOR.drumStoneDark);
  rect(g, 3, 11, 14, 1, COLOR.drumStoneDark);
  // 鼓钉：上下各两枚
  for (const x of [5, 12]) {
    rect(g, x, 6, 1, 1, COLOR.drumStoneDark);
    rect(g, x, 13, 1, 1, COLOR.drumStoneDark);
  }
  // 鼓足：贴地一圈深色，坐下时不至于「浮」在草地上
  rect(g, 4, 17, 12, 2, COLOR.drumStoneDark);
  rect(g, 5, 19, 10, 2, COLOR.drumStone);
}

/** 沙发：靠背在上、两个座垫在下，两侧各一只扶手（保留给旧数据 / 单座沙发） */
function drawSofa(g: Graphics): void {
  const { w, h } = SOFA_SPRITE;
  shadow(g, w / 2, h - 1, 26, 2.5);
  box(g, 0, 0, w, 12, COLOR.sofaBody);
  box(g, 3, 12, 24, 10, COLOR.sofaSeat);
  box(g, 31, 12, 24, 10, COLOR.sofaSeat);
  rect(g, 5, 14, 20, 1, COLOR.ceramic);
  rect(g, 33, 14, 20, 1, COLOR.ceramic);
  box(g, 0, 10, 5, 12, COLOR.mintDark);
  box(g, w - 5, 10, 5, 12, COLOR.mintDark);
}

/** 双人沙发的一侧：62×40，两半拼成 124px；座垫顶面在帧内 y=16 */
const COUCH_HALF = { w: 62, h: 40 };

/**
 * 双人沙发左右半：靠背连续、座垫各一半、扶手只在外侧。
 * `side = 0` 是左半（扶手在左），`side = 1` 是右半（扶手在右）。
 */
function drawCouchHalf(g: Graphics, side: 0 | 1): void {
  const { w, h } = COUCH_HALF;
  shadow(g, w / 2, h - 2, 28, 3);
  // 靠背：两半共用同一条 16px 高的靠背，拼起来不断层
  box(g, 0, 0, w, 16, COLOR.sofaBody);
  rect(g, 1, 2, w - 2, 1, COLOR.sofaSeat);
  // 座垫：一半一只，中缝只留 2px
  box(g, side === 0 ? 6 : 2, 16, w - 8, 14, COLOR.sofaSeat);
  rect(g, side === 0 ? 9 : 5, 18, w - 14, 1, COLOR.ceramic);
  // 扶手：左半在左、右半在右，拼起来两端各一只
  if (side === 0) box(g, 0, 10, 6, 20, COLOR.mintDark);
  else box(g, w - 6, 10, 6, 20, COLOR.mintDark);
  // 抱枕：靠背前压一只奶油色小方枕
  const pillowX = side === 0 ? 10 : 36;
  box(g, pillowX, 8, 14, 8, COLOR.butter, 0xd8a33f);
  rect(g, pillowX + 2, 10, 8, 1, 0xfff2cc);
  // 前缘与两只木脚
  rect(g, 2, 30, w - 4, 1, COLOR.mintDark);
  box(g, 4, 32, 3, 6, COLOR.woodDark);
  box(g, w - 7, 32, 3, 6, COLOR.woodDark);
}

/**
 * 影厅座椅：几何完全复用椅子的四向座面契约，只把薰衣草软包换成暗红丝绒，
 * 并在靠背侧加一只金色杯架——「电影院」的读感靠配色与杯架，不靠新尺寸。
 */
function drawCinemaSeat(g: Graphics, art: ChairArt, facing: Direction): void {
  shadow(g, art.shadow.cx, art.shadow.cy, art.shadow.rx, art.shadow.ry);
  // 深胡桃木底座与立柱
  box(g, art.base.x, art.base.y, art.base.w, art.base.h, 0x4a3226);
  box(g, art.stem.x, art.stem.y, art.stem.w, art.stem.h, 0x6b4a35);
  // 靠背：暗红丝绒 + 顶端一条亮边
  box(g, art.back.x, art.back.y, art.back.w, art.back.h, 0x8f2f2f, 0x4a1c17);
  rect(g, art.back.x + 1, art.back.y + 1, Math.max(1, art.back.w - 2), 2, 0xd05a5a);
  // 座面：比靠背亮一档，坐下时能看出软垫的边缘
  box(g, art.seat.x, art.seat.y, art.seat.w, art.seat.h, 0xa63a3a, 0x4a1c17);
  rect(g, art.highlight.x, art.highlight.y, art.highlight.w, art.highlight.h, 0xe07a6a);
  // 金色杯架：挂在靠背靠近走道的一侧
  const cupX = facing === DIRECTION.Left ? art.back.x + art.back.w - 2 : art.back.x + 2;
  const cupY = art.back.y + Math.floor(art.back.h / 2);
  dot(g, cupX, cupY, 2, COLOR.gold, 0x4a1c17);
}

/**
 * 床：深胡桃木框 + 床垫 + 羽绒枕 + 凌乱被褥，朝向统一朝右（角色横卧时头朝右）。
 *
 * 宿舍区的「昏睡感」全部压在这张 64×42 的贴图里：床尾一角掀起、被子两段错位、
 * 枕头两道褶皱，床头上挂防噪耳机与垂落的充电线。不做镜像翻转——
 * `sprite.scale` 会把 1px 描边拉成半像素（ADR-0005）。
 * 床底快递箱是地面陈设，交给 `interior-art.ts` 的 flat 层，避免上铺也长出箱子。
 */
function drawBed(g: Graphics): void {
  const { w, h } = BED_SPRITE;
  shadow(g, w / 2, h - 2, w / 2 - 3, 3);
  // 胡桃木床架：外框深、内侧一道亮边
  box(g, 2, 4, w - 4, h - 8, COLOR.bedFrame, COLOR.bedFrameDark);
  rect(g, 3, 5, w - 6, 1, COLOR.bedFrameLight);
  // 床垫
  box(g, 5, 7, w - 10, h - 14, COLOR.linen, COLOR.linenEdge);
  // 凌乱被褥：两段错位的暖色被子 + 三道褶皱，不再是一整块矩形
  box(g, 7, 9, 30, 7, COLOR.bedBlanket, COLOR.bedBlanketLight);
  box(g, 7, 16, 36, 6, COLOR.bedBlanket, COLOR.bedBlanketLight);
  rect(g, 9, 12, 2, 5, COLOR.bedBlanketLight);
  rect(g, 14, 18, 10, 1, COLOR.bedBlanketLight);
  rect(g, 30, 10, 6, 1, COLOR.bedBlanketLight);
  // 床尾掀起的一角：外层浅色描边、内层床垫、再叠一块折回的被子
  g.poly([7, 22, 18, 22, 7, 33]).fill(COLOR.linenEdge);
  g.poly([8, 23, 16, 23, 8, 31]).fill(COLOR.linen);
  g.poly([8, 23, 14, 23, 8, 29]).fill(COLOR.bedBlanketLight);
  rect(g, 9, 25, 5, 1, COLOR.linenEdge);
  // 羽绒枕：右侧留出枕头，两道褶皱压出蓬松感
  box(g, w - 19, 10, 12, h - 20, COLOR.pillow, COLOR.linenEdge);
  rect(g, w - 17, 13, 8, 1, COLOR.ceramic);
  rect(g, w - 17, 20, 6, 1, COLOR.linenEdge);
  rect(g, w - 16, 23, 4, 1, COLOR.ceramic);
  rect(g, w - 19, 31, 12, 1, COLOR.linenEdge);
  // 床头板
  box(g, w - 5, 2, 4, h - 4, COLOR.bedFrameLight, COLOR.bedFrameDark);
  // 防噪耳机：挂在床头板内侧，头梁一条弧、两团耳罩
  rect(g, w - 10, 7, 1, 9, COLOR.bezel);
  rect(g, w - 6, 7, 1, 9, COLOR.bezel);
  rect(g, w - 10, 6, 5, 1, COLOR.bezel);
  box(g, w - 11, 15, 3, 4, COLOR.bezel);
  box(g, w - 6, 15, 3, 4, COLOR.bezel);
  rect(g, w - 10, 16, 1, 1, COLOR.metal);
  rect(g, w - 5, 16, 1, 1, COLOR.metal);
  // 垂落的充电线：床头板外侧一根 1px 线 + 小插头
  rect(g, w - 3, 19, 1, 13, COLOR.ceramicEdge);
  rect(g, w - 4, 31, 3, 2, COLOR.bezel);
  rect(g, w - 4, 31, 1, 1, COLOR.metal);
}

/**
 * 木地板通用画法：错缝长条 + 交替板压一档暗色 + 板顶一线高光。
 *
 * 高光只加在「压暗的那一半板」上，明度阶梯仍是三档（描边/本体/高光），
 * 不会把地面刷成一张亮网——地面越花，角色越出不来（ADR-0013）。
 */
function fillPlankFloor(g: Graphics, r: WorldRect, c: VenueColors, plank = 14, span = 48): void {
  rect(g, r.x, r.y, r.w, r.h, c.main);
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += plank) {
    rect(g, r.x, y, r.w, 1, c.seam);
    const offset = (row % 2) * (span / 2);
    for (let x = r.x + offset; x < r.x + r.w; x += span) {
      rect(g, x, y, 1, plank, c.seam);
    }
    if (row % 2 === 1) {
      rect(g, r.x, y + 1, r.w, plank - 2, c.alt);
      rect(g, r.x, y + 1, r.w, 1, lighten(c.alt, 0.18));
    }
  }
}

/** 方格地砖：交错两色 + 砖缝，受光的左上角补 1px 亮边 */
function fillGridFloor(g: Graphics, r: WorldRect, c: VenueColors, tile = 16): void {
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += tile) {
    for (let col = 0, x = r.x; x < r.x + r.w; col += 1, x += tile) {
      rect(g, x, y, tile, tile, (row + col) % 2 === 0 ? c.main : c.alt);
      if ((row + col) % 2 === 1) rect(g, x + 1, y + 1, tile - 2, 1, lighten(c.alt, 0.3));
    }
  }
  for (let x = r.x; x < r.x + r.w; x += tile) rect(g, x, r.y, 1, r.h, c.seam);
  for (let y = r.y; y < r.y + r.h; y += tile) rect(g, r.x, y, r.w, 1, c.seam);
}

function fillFloorWood(g: Graphics, r: WorldRect): void {
  fillPlankFloor(g, r, VENUE_COLORS.workroom, 14, 48);
}

/** 会议室与两栋小院：胡桃色细板，比工作区的奶油木深一档、板更窄 */
function fillFloorWalnut(g: Graphics, r: WorldRect): void {
  fillPlankFloor(g, r, VENUE_COLORS.meeting, 12, 40);
}

function fillFloorTile(g: Graphics, r: WorldRect): void {
  fillGridFloor(g, r, VENUE_COLORS.restroom, 16);
}

/** 宿舍区地毯：暖色横向条带 + 内圈收边，软地面与木地板的读感差一档 */
function fillFloorCarpet(g: Graphics, r: WorldRect): void {
  const c = VENUE_COLORS.lounge;
  rect(g, r.x, r.y, r.w, r.h, c.main);
  for (let y = r.y + 16, row = 0; y < r.y + r.h; y += 16, row += 1) {
    rect(g, r.x, y, r.w, 1, c.seam);
    if (row % 2 === 0 && y + 15 < r.y + r.h) {
      rect(g, r.x, y + 1, r.w, 15, c.alt);
      rect(g, r.x, y + 1, r.w, 1, lighten(c.alt, 0.2));
    }
  }
  // 内圈收边：站在门口一眼能看出这是软地面
  rect(g, r.x + 4, r.y + 4, r.w - 8, 1, c.seam);
  rect(g, r.x + 4, r.y + r.h - 5, r.w - 8, 1, c.seam);
  rect(g, r.x + 4, r.y + 4, 1, r.h - 8, c.seam);
  rect(g, r.x + r.w - 5, r.y + 4, 1, r.h - 8, c.seam);
}

/** 影音室：深炭色地毯 + 酒红收边，配合屏幕冷光形成暗厅 */
function fillFloorCinema(g: Graphics, r: WorldRect): void {
  const c = VENUE_COLORS.theater;
  rect(g, r.x, r.y, r.w, r.h, c.main);
  for (let y = r.y + 8; y < r.y + r.h; y += 16) rect(g, r.x, y, r.w, 1, c.alt);
  // 一圈酒红地毯收边：暗厅里唯一的暖色底
  rect(g, r.x + 3, r.y + 3, r.w - 6, 2, c.seam);
  rect(g, r.x + 3, r.y + r.h - 5, r.w - 6, 2, c.seam);
  rect(g, r.x + 3, r.y + 3, 2, r.h - 6, c.seam);
  rect(g, r.x + r.w - 5, r.y + 3, 2, r.h - 6, c.seam);
}

/** 游乐园：薄荷与奶油交替的软垫，边缘压一圈亮白安全线 */
function fillFloorRubber(g: Graphics, r: WorldRect): void {
  const c = VENUE_COLORS.park;
  const tile = 32;
  rect(g, r.x, r.y, r.w, r.h, c.main);
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += tile) {
    for (let col = 0, x = r.x; x < r.x + r.w; col += 1, x += tile) {
      if ((row + col) % 2 === 0) rect(g, x, y, tile, tile, c.alt);
    }
  }
  // 接缝之外再补一道极淡的内凹，软垫的厚度读得出来
  for (let y = r.y; y < r.y + r.h; y += tile) {
    rect(g, r.x, y, r.w, 1, c.seam);
    rect(g, r.x, y + 1, r.w, 1, lighten(c.alt, 0.22));
  }
  for (let x = r.x; x < r.x + r.w; x += tile) rect(g, x, r.y, 1, r.h, c.seam);
  rect(g, r.x + 4, r.y + 4, r.w - 8, 3, c.accent);
  rect(g, r.x + 4, r.y + r.h - 7, r.w - 8, 3, c.accent);
  rect(g, r.x + 4, r.y + 4, 3, r.h - 8, c.accent);
  rect(g, r.x + r.w - 7, r.y + 4, 3, r.h - 8, c.accent);
}

/** 小黑屋：冷灰水泥地，两道固定裂缝 + 中央排水口，和影厅的软地毯形成硬对比 */
function fillFloorConcrete(g: Graphics, r: WorldRect): void {
  const c = VENUE_COLORS.cell;
  rect(g, r.x, r.y, r.w, r.h, c.main);
  // 水泥浇筑分块：每 46px 一道浅缝，错缝排布
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += 46) {
    rect(g, r.x, y, r.w, 1, c.seam);
    const offset = (row % 2) * 23;
    for (let x = r.x + offset; x < r.x + r.w; x += 46) {
      rect(g, x, y, 1, 46, c.seam);
      rect(g, x + 1, y + 1, 45, 1, c.alt);
    }
  }
  // 固定裂缝：避开门口与反省凳，只做视觉，不影响碰撞
  const crack = darken(c.seam, 0.9);
  rect(g, r.x + 64, r.y + 58, 1, 34, crack);
  rect(g, r.x + 65, r.y + 58, 3, 1, crack);
  rect(g, r.x + 66, r.y + 59, 1, 17, crack);
  rect(g, r.x + r.w - 96, r.y + r.h - 92, 1, 28, crack);
  rect(g, r.x + r.w - 95, r.y + r.h - 92, 11, 1, crack);
  // 中央排水口：一圈深色格栅
  const drainX = r.x + r.w / 2 - 12;
  const drainY = r.y + r.h - 112;
  rect(g, drainX, drainY, 24, 10, darken(c.seam, 0.85));
  rect(g, drainX + 1, drainY + 1, 22, 8, c.seam);
  for (let i = 0; i < 5; i += 1) rect(g, drainX + 3 + i * 4, drainY + 2, 1, 6, darken(c.seam, 0.7));
}

/**
 * 铺装街区（ADR-0099）：底色 + 40px 错缝 + 一圈内凹路缘 + 1px 顶面高光。
 *
 * 以前只有 40px 井字缝，五片街区广场读起来是一整块灰布；加了路缘之后
 * 「踩上台阶进了街区」这件事才有像素上的交代。明度只多一档高光，
 * 地面没有变花，角色仍然出得来。
 *
 * `curb` 只在街区级的铺装上画：楼体自己占用的铺装（小院院落、公寓楼体）
 * 已经在 `fillBuildingFloor` 里有地面，再加一圈边会像给房子描了个框。
 */
function fillPaving(g: Graphics, r: WorldRect, curb: boolean): void {
  rect(g, r.x, r.y, r.w, r.h, COLOR.paving);
  for (let x = r.x + 40; x < r.x + r.w; x += 40) rect(g, x, r.y, 1, r.h, COLOR.pavingSeam);
  for (let y = r.y + 40; y < r.y + r.h; y += 40) rect(g, r.x, y, r.w, 1, COLOR.pavingSeam);
  if (!curb || r.w < 60 || r.h < 40) return;
  // 路缘石：四周 2px 深缝，再向内让 1px 受光，边缘就有厚度
  rect(g, r.x, r.y, r.w, 2, COLOR.pavingSeam);
  rect(g, r.x, r.y + r.h - 2, r.w, 2, COLOR.pavingSeam);
  rect(g, r.x, r.y, 2, r.h, COLOR.pavingSeam);
  rect(g, r.x + r.w - 2, r.y, 2, r.h, COLOR.pavingSeam);
  rect(g, r.x + 2, r.y + 2, r.w - 4, 1, lighten(COLOR.paving, 0.14));
  rect(g, r.x + 2, r.y + 2, 1, r.h - 4, lighten(COLOR.paving, 0.08));
}

/** 这片铺装是否与某栋有地板的建筑相交：相交就不画路缘（那是楼自己的地面） */
function pavingTouchesBuilding(r: WorldRect): boolean {
  for (const building of WORLD_LAYOUT.buildings) {
    const b = building.rect;
    if (r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y) return true;
  }
  return false;
}

/** 墙与平面设施（会议桌、隔断）：俯视压扁，带一道顶面高光 */
function fillSolidFlat(g: Graphics, s: SolidRect): void {
  if (s.kind === 'wall') {
    rect(g, s.x, s.y, s.w, s.h, COLOR.wall);
    rect(g, s.x, s.y, s.w, 2, COLOR.wallCap);
    rect(g, s.x, s.y + s.h - 2, s.w, 2, COLOR.wallEdge);
    return;
  }
  rect(g, s.x, s.y, s.w, s.h, COLOR.fixture);
  rect(g, s.x, s.y, s.w, 2, COLOR.wallCap);
  rect(g, s.x, s.y + s.h - 1, s.w, 1, COLOR.fixtureEdge);
}

/** 赌场墨绿绒：60px 大方格无缝绒面，靠极低的对比度表现「吸光的布」 */
function fillFloorFelt(g: Graphics, r: WorldRect): void {
  const c = VENUE_COLORS.diceHall;
  const tile = 60;
  rect(g, r.x, r.y, r.w, r.h, c.main);
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += tile) {
    for (let col = 0, x = r.x; x < r.x + r.w; col += 1, x += tile) {
      if ((row + col) % 2 === 0) rect(g, x, y, tile, tile, c.alt);
    }
  }
  // 绒面没有硬缝，只留一层压暗的织纹格，走近才看得出
  for (let y = r.y; y < r.y + r.h; y += tile) rect(g, r.x, y, r.w, 1, darken(c.main, 0.88));
  for (let x = r.x; x < r.x + r.w; x += tile) rect(g, x, r.y, 1, r.h, darken(c.main, 0.88));
}

/** 公寓暖灰抹面：46px 伸缩缝 + 每块左上角一线受光，安静但不像水泥地 */
function fillFloorPlaster(g: Graphics, r: WorldRect): void {
  const c = VENUE_COLORS.apartment;
  const tile = 46;
  rect(g, r.x, r.y, r.w, r.h, c.main);
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += tile) {
    const offset = (row % 2) * (tile / 2);
    for (let x = r.x + offset; x < r.x + r.w; x += tile) {
      rect(g, x, y, Math.min(tile, r.x + r.w - x), tile, c.alt);
      rect(g, x + 1, y + 1, Math.min(tile, r.x + r.w - x) - 2, 1, lighten(c.alt, 0.26));
      rect(g, x, y, 1, tile, c.seam);
    }
    rect(g, r.x, y, r.w, 1, c.seam);
  }
}

function fillBuildingFloor(g: Graphics, building: BuildingSpec): void {
  if (building.floor === 'wood') fillFloorWood(g, building.rect);
  else if (building.floor === 'walnut') fillFloorWalnut(g, building.rect);
  else if (building.floor === 'carpet') fillFloorCarpet(g, building.rect);
  else if (building.floor === 'cinema') fillFloorCinema(g, building.rect);
  else if (building.floor === 'rubber') fillFloorRubber(g, building.rect);
  else if (building.floor === 'concrete') fillFloorConcrete(g, building.rect);
  else if (building.floor === 'felt') fillFloorFelt(g, building.rect);
  else if (building.floor === 'plaster') fillFloorPlaster(g, building.rect);
  else fillFloorTile(g, building.rect);
}

interface Cullable {
  sprite: Sprite;
  x: number;
  y: number;
  padX: number;
  padY: number;
}

interface DeskSprite {
  sprite: Sprite;
  idle: Texture;
  /** 亮屏两帧：代码行的长度与缩进不同，只换纹理引用（帧循环零绘制） */
  lit: readonly [Texture, Texture];
  /** 桌面中心（专注光的落点） */
  x: number;
  y: number;
  /** 相位种子：由桌心派生，同排工位不会一起闪 */
  seed: number;
  /** 是否有人坐着：只有占用的工位才推进相位 */
  occupied: boolean;
  phase: 0 | 1;
}

export class PropsView {
  /** 地面层：木地板、瓷砖、铺装与墙体，位于地形之上、y 排序层之下 */
  readonly base = new Container();
  private readonly cullables: Cullable[] = [];
  /** 与 WORLD_LAYOUT.desks 同下标：seat.desk 直接索引 */
  private readonly desks: DeskSprite[] = [];
  private readonly textures: Texture[] = [];
  /**
   * 专注光：全场只有一张。搬砖的是本地玩家，同时最多一处亮着，
   * 做成「一枚精灵挪到对应桌面」比给 8 张桌子各挂一枚更省对象、也更容易读。
   */
  private focusDesk = -1;
  private focusSprite?: Sprite;
  /** 上一帧时钟：`update` 与 `setSeatOccupied` 共用同一个相位基准 */
  private nowMs = 0;
  /**
   * 每种装饰只烘焙一次：加密道具之后同类道具会有几十个，
   * 逐个烘焙等于几十张同内容的纹理，显存与初始化时间都会被放大。
   * 键是 `kind:variant`——logo 四个变体共用一张尺寸表、四张图标纹理。
   */
  private readonly propTextures = new Map<string, Texture>();
  /**
   * 路灯落地光晕：一张 36×20 的暖色椭圆 + 四根光针，全场复用一张纹理。
   *
   * **不进光图**：`LightRegistry` 的预算被 `lighting.test.ts` 钉在 `MAX_LIGHTS`，
   * 给三十几盏路灯各加一个 `LightSpec` 会把后面的场所光挤掉；像素风里
   * 「地上有一圈暖色」本来就够读，多一道烘焙椭圆即可。
   */
  private lampGlow?: Texture;
  /** 路侧指示桩纹理：按区色缓存，全图最多五张 */
  private readonly roadPostTextures = new Map<number, Texture>();

  /**
   * 构造期一次性生成全部贴图与精灵；`depth` 负责按脚底 y 归入深度层。
   *
   * `options.decor` 对应 `?decor=0`（与 `?venue=0` 同一套灰度惯例）：
   * 过渡带装饰是纯表现层，关掉之后地图与碰撞完全不变，只少一层点缀。
   */
  build(
    depth: DepthSink,
    renderer: TextureFactory,
    options: { winter?: boolean; decor?: boolean; flat?: boolean } = {},
  ): void {
    const ground = new Graphics();
    for (const building of WORLD_LAYOUT.buildings) fillBuildingFloor(ground, building);
    const paved = !options.flat;
    for (const area of WORLD_LAYOUT.paved) fillPaving(ground, area, paved && !pavingTouchesBuilding(area));
    // 路面叙事（ADR-0099）：路口铺砖 / 斑马线 / 指引箭头，全部构造期一次成图。
    // `?flat=1` 与旧的「矩形平铺」画法保持一致：整层不画，回到改动前的观感
    if (!options.flat) paintRoadDressing(ground);
    for (const solid of WORLD_LAYOUT.solids) {
      if (solid.kind === 'desk') continue;
      // 售货机 / 饮水机 / 咖啡机的本体由装饰精灵承担，地面层不再重复画
      if (solid.kind === 'prop') continue;
      fillSolidFlat(ground, solid);
    }
    this.base.addChild(ground);

    const frame = (w: number, h: number) => new Rectangle(0, 0, w, h);
    // 路灯的落地光晕：只烘一张，三十几盏灯共用（不进 LightRegistry，见字段注释）
    this.lampGlow = bake(
      renderer,
      (g) => {
        g.ellipse(18, 12, 17, 6).fill({ color: COLOR.lampGlow, alpha: 0.09 });
        g.ellipse(18, 12, 11, 4).fill({ color: COLOR.lampGlow, alpha: 0.13 });
        // 光针：像素风靠 1px 硬线读「有光」，不用渐隐
        g.rect(17, 3, 1, 4).fill({ color: COLOR.lampGlow, alpha: 0.2 });
        g.rect(17, 17, 1, 3).fill({ color: COLOR.lampGlow, alpha: 0.16 });
        g.rect(6, 11, 5, 1).fill({ color: COLOR.lampGlow, alpha: 0.16 });
        g.rect(26, 11, 5, 1).fill({ color: COLOR.lampGlow, alpha: 0.16 });
      },
      { frame: frame(36, 20) },
    );
    this.textures.push(this.lampGlow);
    // 四个朝向各烘焙一对 idle / lit：桌子随朝向转置（横桌 96×66、侧放桌 48×110），
    // 每张桌子按自己的帧尺寸烘焙，显示器永远立在远侧长边之上（ADR-0027 / ADR-0032）
    const deskTextures = new Map<
      Direction,
      { idle: Texture; lit: readonly [Texture, Texture]; frame: { w: number; h: number } }
    >();
    for (const facing of [DIRECTION.Up, DIRECTION.Down, DIRECTION.Left, DIRECTION.Right]) {
      const art = deskArtFor(facing);
      const deskFrame = frame(art.frame.w, art.frame.h);
      deskTextures.set(facing, {
        idle: bake(renderer, (g) => drawDesk(g, false, art, 0), { frame: deskFrame }),
        // 两帧只有代码行不同：亮屏是「有人在敲」，不是一张静止壁纸
        lit: [
          bake(renderer, (g) => drawDesk(g, true, art, 0), { frame: deskFrame }),
          bake(renderer, (g) => drawDesk(g, true, art, 1), { frame: deskFrame }),
        ],
        frame: art.frame,
      });
    }
    // 椅子四个朝向各烘焙一张：靠背永远在入座朝向的反侧（ADR-0029）
    const chairTextures = new Map<Direction, Texture>();
    for (const facing of [DIRECTION.Up, DIRECTION.Down, DIRECTION.Left, DIRECTION.Right]) {
      const art = chairArtFor(facing);
      chairTextures.set(
        facing,
        bake(renderer, (g) => drawChair(g, art), { frame: frame(art.frame.w, art.frame.h) }),
      );
    }
    // 影厅座椅与椅子共用四向几何，只换配色；靠背仍随入座朝向换边
    const cinemaTextures = new Map<Direction, Texture>();
    for (const facing of [DIRECTION.Up, DIRECTION.Down, DIRECTION.Left, DIRECTION.Right]) {
      const art = chairArtFor(facing);
      cinemaTextures.set(
        facing,
        bake(renderer, (g) => drawCinemaSeat(g, art, facing), { frame: frame(art.frame.w, art.frame.h) }),
      );
    }
    const couchLeft = bake(renderer, (g) => drawCouchHalf(g, 0), {
      frame: frame(COUCH_HALF.w, COUCH_HALF.h),
    });
    const couchRight = bake(renderer, (g) => drawCouchHalf(g, 1), {
      frame: frame(COUCH_HALF.w, COUCH_HALF.h),
    });
    const seatTextures: Record<'toilet' | 'stool' | 'drum' | 'sofa' | 'bed', Texture> = {
      toilet: bake(renderer, drawToilet, { frame: frame(TOILET_SPRITE.w, TOILET_SPRITE.h) }),
      stool: bake(renderer, drawStool, { frame: frame(STOOL_SPRITE.w, STOOL_SPRITE.h) }),
      drum: bake(renderer, drawDrumStool, { frame: frame(DRUM_SPRITE.w, DRUM_SPRITE.h) }),
      sofa: bake(renderer, drawSofa, { frame: frame(SOFA_SPRITE.w, SOFA_SPRITE.h) }),
      bed: bake(renderer, drawBed, { frame: frame(BED_SPRITE.w, BED_SPRITE.h) }),
    };
    for (const art of deskTextures.values()) this.textures.push(art.idle, art.lit[0], art.lit[1]);
    this.textures.push(
      ...Object.values(seatTextures),
      ...chairTextures.values(),
      ...cinemaTextures.values(),
      couchLeft,
      couchRight,
    );

    for (const desk of WORLD_LAYOUT.desks) {
      const art = deskTextures.get(desk.facing) ?? deskTextures.get(DIRECTION.Up)!;
      // 帧底 = 桌脚占地的南边：横桌让开 20、竖桌让开 44，桌子不会陷进地面
      const bottom = desk.y + deskFootprint(desk.facing).h / 2;
      const sprite = new Sprite(art.idle);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(desk.x, bottom);
      // 深度键按朝向派生：东西向的桌子与椅子同 y，必须让到人与椅子之后（ADR-0032）
      depth.add(desk.y + deskDepthOffset(desk.facing), sprite);
      this.desks.push({
        sprite,
        idle: art.idle,
        lit: art.lit,
        x: desk.x,
        y: desk.y,
        // 相位种子由桌心派生：同一排工位不会整齐划一地闪
        seed: (desk.x * 31 + desk.y) | 0,
        occupied: false,
        phase: 0,
      });
      this.cullables.push({ sprite, x: desk.x, y: bottom, padX: art.frame.w / 2 + 4, padY: art.frame.h });
    }

    // 专注光：一枚 92×36 的硬边椭圆环，冷蓝白、居中锚点，默认不可见。
    // 走 `base`（地面层之上、角色之下）——光圈不该盖住坐在桌后的人。
    const focusTexture = bake(
      renderer,
      (g) => {
        g.ellipse(46, 18, 44, 15).fill({ color: 0xffffff, alpha: 0.1 });
        g.ellipse(46, 18, 36, 11).fill({ color: 0xffffff, alpha: 0.08 });
        // 外圈 1px 亮环：像素风里靠硬边读「有光」，不靠渐隐
        g.ellipse(46, 18, 45, 16).stroke({ width: 1, color: 0xffffff, alpha: 0.42 });
      },
      { frame: frame(92, 36) },
    );
    this.textures.push(focusTexture);
    const focus = new Sprite(focusTexture);
    focus.anchor.set(0.5, 0.5);
    focus.tint = COLOR.deskScreen;
    focus.visible = false;
    this.base.addChild(focus);
    this.focusSprite = focus;

    for (const seat of WORLD_LAYOUT.seats) {
      // 长椅视觉由道具管线绘制（`addProp`），座位只登记坐点；这里跳过以免出现两张长椅
      if (seat.kind === 'bench') continue;
      // 尺寸、下沉量与接触高度共用座位契约：渲染层不再自己写一份 SEAT_ART（ADR-0032）
      const art = seatArtFor(seat.kind, seat.facing);
      let texture: Texture;
      if (seat.kind === 'chair') {
        texture = chairTextures.get(seat.facing) ?? chairTextures.get(DIRECTION.Down)!;
      } else if (seat.kind === 'cinema') {
        texture = cinemaTextures.get(seat.facing) ?? cinemaTextures.get(DIRECTION.Down)!;
      } else if (seat.kind === 'couch') {
        // 双人沙发的左右半各画一次，两半拼起来才是一张长沙发
        texture = seat.variant === 1 ? couchRight : couchLeft;
      } else {
        texture = seatTextures[seat.kind];
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(seat.x, seat.y + art.sink);
      // 座椅排在入座者脚底 y 之下：角色坐上去 / 躺下去时家具在身后
      depth.add(seat.y - 1, sprite);
      this.cullables.push({
        sprite,
        x: seat.x,
        y: seat.y,
        padX: art.frame.w / 2 + 4,
        // 精灵顶边 = 锚点 + sink - 帧高；多出来的 sink 不该再算进裁剪余量
        padY: art.frame.h - art.sink,
      });
    }

    for (const prop of WORLD_LAYOUT.props) this.addProp(depth, renderer, prop);

    // 过渡带装饰：草地空档里的灌木、路边邮筒/消防栓/垃圾桶与路肩碎石。
    // 全部零碰撞、不写布局，只借用这条管线已有的纹理缓存与视口裁剪。
    if (options.decor !== false) {
      buildStreetDecor(
        {
          base: this.base,
          addSprite: (texture, x, y, padX, padY) => {
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5, 1);
            sprite.position.set(x, y);
            depth.add(y, sprite);
            this.cullables.push({ sprite, x, y, padX, padY });
          },
          keepTexture: (texture) => this.textures.push(texture),
        },
        renderer,
        options.winter === true,
      );
    }

    // 路侧指示桩（ADR-0099）：五座街口 + 四条主路中点各一根，牌面挂所属大区的区色。
    // 纯客户端：不进 `WORLD_LAYOUT.props`，因此不产生碰撞、不扰动树点；`?flat=1` 时一起关掉
    if (options.flat !== true) this.addRoadPosts(depth, renderer);
  }

  /** 指示桩纹理：木柱 + 一块带区色的牌面，按区色各烘一张（全图最多五张） */
  private roadPostTexture(renderer: TextureFactory, color: number): Texture {
    const cached = this.roadPostTextures.get(color);
    if (cached) return cached;
    const texture = bake(
      renderer,
      (g) => {
        // 底座投影：冷靛蓝，与其它道具同一档透明度
        g.ellipse(9, 27, 6, 2).fill({ color: COLOR.shadow, alpha: 0.24 });
        // 木柱：3px 宽，左沿受光
        rect(g, 8, 10, 3, 17, COLOR.woodDark);
        rect(g, 8, 10, 1, 17, COLOR.woodLight);
        // 牌面：12×8 奶油底 + 1px 深边，中间一条区色带
        rect(g, 2, 1, 14, 10, COLOR.outline);
        rect(g, 3, 2, 12, 8, COLOR.signPaper);
        rect(g, 3, 5, 12, 3, color);
        rect(g, 3, 2, 12, 1, lighten(COLOR.signPaper, 0.2));
        rect(g, 3, 9, 12, 1, COLOR.signEdge);
      },
      { frame: new Rectangle(0, 0, 18, 28) },
    );
    this.roadPostTextures.set(color, texture);
    this.textures.push(texture);
    return texture;
  }

  private addRoadPosts(depth: DepthSink, renderer: TextureFactory): void {
    for (const post of roadPostPlan()) {
      const sprite = new Sprite(this.roadPostTexture(renderer, post.color));
      sprite.anchor.set(0.5, 1);
      sprite.position.set(post.x, post.y);
      depth.add(post.y, sprite);
      this.cullables.push({ sprite, x: post.x, y: post.y, padX: 12, padY: 30 });
    }
  }

  private propTexture(renderer: TextureFactory, prop: PropInstance): Texture {
    const variant = prop.variant ?? 0;
    const key = `${prop.kind}:${variant}`;
    const cached = this.propTextures.get(key);
    if (cached) return cached;
    const size = PROP_SIZE[prop.kind];
    const texture = bake(renderer, (g) => drawProp(prop.kind, g, variant), {
      frame: new Rectangle(0, 0, size.w, size.h),
    });
    this.propTextures.set(key, texture);
    this.textures.push(texture);
    return texture;
  }

  private addProp(depth: DepthSink, renderer: TextureFactory, prop: PropInstance): void {
    const size = PROP_SIZE[prop.kind];
    // 路灯：先在地上压一层暖光晕，深度键比灯柱小半格，人走过去仍然盖住光
    if (prop.kind === 'lamp' && this.lampGlow) {
      const glow = new Sprite(this.lampGlow);
      glow.anchor.set(0.5, 1);
      glow.position.set(prop.x, prop.y - 1);
      depth.add(prop.y - 0.5, glow);
      this.cullables.push({ sprite: glow, x: prop.x, y: prop.y, padX: 20, padY: 22 });
    }
    const texture = this.propTexture(renderer, prop);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(prop.x, prop.y);
    depth.add(prop.y, sprite);
    this.cullables.push({ sprite, x: prop.x, y: prop.y, padX: size.w / 2 + 2, padY: size.h + 2 });
  }

  /**
   * 占用变化：工位显示器点亮 / 熄灭。椅子与马桶没有视觉状态，只靠姿态表现。
   *
   * 点亮时取当前时钟算相位，坐下那一刻屏幕就已经是「有人在敲」的那一帧，
   * 不会先亮一帧静止图再开始动。
   */
  setSeatOccupied(seat: SeatInstance, occupied: boolean): void {
    if (seat.desk < 0) return;
    const desk = this.desks[seat.desk];
    if (!desk) return;
    desk.occupied = occupied;
    if (!occupied) {
      desk.sprite.texture = desk.idle;
      return;
    }
    desk.phase = codeLinePhase(desk.seed, this.nowMs);
    desk.sprite.texture = desk.lit[desk.phase];
  }

  /**
   * 本人搬砖中的专注光：`deskIndex < 0` 表示收起。
   *
   * 只挪一枚共享精灵，不新增光源（光图预算 64 盏已经很紧），
   * 亮度由 `focusPulse` 的纯函数给出，每帧只写一次 alpha。
   */
  setWorkingDesk(deskIndex: number, active: boolean): void {
    const focus = this.focusSprite;
    if (!focus) return;
    const desk = active && deskIndex >= 0 ? this.desks[deskIndex] : undefined;
    if (!desk) {
      this.focusDesk = -1;
      focus.visible = false;
      return;
    }
    this.focusDesk = deskIndex;
    focus.position.set(desk.x, desk.y);
    focus.visible = true;
  }

  /** 每帧推进：亮着的工位切代码行相位，专注光呼吸。只写 texture 引用与 alpha */
  update(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    this.nowMs = nowMs;
    for (let i = 0; i < this.desks.length; i += 1) {
      const desk = this.desks[i]!;
      if (!desk.occupied) continue;
      const phase = codeLinePhase(desk.seed, nowMs);
      if (phase === desk.phase) continue;
      desk.phase = phase;
      desk.sprite.texture = desk.lit[phase];
    }
    const focus = this.focusSprite;
    if (!focus || this.focusDesk < 0) return;
    const desk = this.desks[this.focusDesk];
    if (!desk) return;
    focus.alpha = focusPulse(desk.seed, nowMs);
  }

  /** 视口裁剪：与地形同一套规则，离屏的桌椅与装饰不参与绘制 */
  cull(minX: number, minY: number, maxX: number, maxY: number): void {
    for (const entry of this.cullables) {
      const top = entry.y - entry.padY;
      entry.sprite.renderable =
        entry.x + entry.padX >= minX && entry.x - entry.padX <= maxX && entry.y >= minY && top <= maxY;
    }
  }

  destroy(): void {
    this.base.destroy({ children: true });
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
  }
}
