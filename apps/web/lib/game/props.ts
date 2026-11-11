'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import {
  DESK_H,
  DESK_W,
  DIRECTION,
  WORLD_LAYOUT,
  type BuildingSpec,
  type Direction,
  type PropInstance,
  type PropKind,
  type SeatInstance,
  type SeatKind,
  type SolidRect,
  type WorldRect,
} from '@niuma/shared-types';
import { DESK_ART_SIZE, deskArtFor, type DeskArt } from './desk-art';
import { bake } from './terrain-textures';
import type { DepthSink } from './sort-layer';

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
  sofaBody: 0x8fe3c7,
  sofaSeat: 0xb6f0dc,
  stoolSeat: 0xffb59e,
  metal: 0x9aa5b4,
  gold: 0xffd166,
  lampGlow: 0xfff0b8,
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
  bench: { w: 40, h: 18 },
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
};

const CHAIR_SPRITE = { w: 26, h: 30 };
const TOILET_SPRITE = { w: 22, h: 28 };
const STOOL_SPRITE = { w: 18, h: 22 };
const SOFA_SPRITE = { w: 58, h: 30 };
/**
 * 床：横向 64×42，躺下的角色正好横卧在床垫上。
 * 角色帧是 64×64、锚点在脚底中心，所以床要往锚点下方压 16px 才托住躯干。
 */
const BED_SPRITE = { w: 64, h: 42 };

/**
 * 座位精灵相对锚点的下沉量与尺寸。
 * 椅子 / 马桶沿用 6；凳子面更矮、沙发更厚、床要把身体托起来。
 */
const SEAT_ART: Record<SeatKind, { w: number; h: number; sink: number }> = {
  chair: { ...CHAIR_SPRITE, sink: 6 },
  toilet: { ...TOILET_SPRITE, sink: 6 },
  stool: { ...STOOL_SPRITE, sink: 4 },
  sofa: { ...SOFA_SPRITE, sink: 8 },
  bed: { ...BED_SPRITE, sink: 16 },
};

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

function drawProp(kind: PropKind, g: Graphics): void {
  const { w, h } = PROP_SIZE[kind];
  shadow(g, w / 2, h - 1, Math.max(6, w / 2 - 2), 2);
  switch (kind) {
    case 'lamp':
      // 灯罩先晕一圈暖光，再画实体灯头
      g.circle(7, 5, 9).fill({ color: COLOR.lampGlow, alpha: 0.28 });
      rect(g, 6, 8, 2, h - 8, COLOR.metal);
      g.roundRect(2, 1, 10, 6, 3).fill(COLOR.outline);
      g.roundRect(3, 2, 8, 4, 2).fill(COLOR.gold);
      rect(g, 4, 3, 2, 1, COLOR.lampGlow);
      return;
    case 'bench':
      rect(g, 2, 7, 36, 1, COLOR.outline);
      box(g, 1, 3, 38, 4, COLOR.woodLight);
      box(g, 1, 8, 38, 4, COLOR.woodDark);
      box(g, 4, 12, 3, 5, COLOR.woodDark);
      box(g, 33, 12, 3, 5, COLOR.woodDark);
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
      box(g, 0, 10, 20, 11, COLOR.fixture, COLOR.fixtureEdge);
      box(g, 4, 5, 12, 6, COLOR.ceramic, COLOR.ceramicEdge);
      rect(g, 9, 1, 2, 5, COLOR.gold);
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
  }
}

/**
 * 显示器：正面 / 背面 / 侧视三种画法（ADR-0027）。
 *
 * 桌子只有一块桌面，屏幕必须朝坐的人；`art` 给出显示器落在哪条边、
 * 镜头看到的是屏幕、背壳还是侧面。点亮状态三种视角都要一眼读出来：
 * 正面亮屏、背面沿外框漏光、侧视在屏幕那一侧留一条亮边与一片反光。
 */
function drawMonitor(g: Graphics, lit: boolean, art: DeskArt): void {
  const m = art.monitor;
  const standX = Math.round(m.x + m.w / 2 - 3);
  const side = art.screen === 'west' || art.screen === 'east';

  // 泛光按帧内裁剪：朝北的显示器贴在帧顶，外扩 4px 会越过画布上沿
  if (lit) {
    const glowY = Math.max(0, m.y - 4);
    g.rect(m.x - 4, glowY, m.w + 8, m.h + 8 - (glowY - (m.y - 4))).fill({ color: COLOR.screenLit, alpha: 0.12 });
  }
  // 支架：机身下沿压 2px，底座落在桌面上 / 桌面前沿
  rect(g, standX, m.y + m.h - 2, 6, 7, COLOR.bezel);

  if (side) {
    // 侧视：竖窄机身 + 屏幕一侧的亮边；屏幕朝东就亮右边，朝西就亮左边
    const screenX = art.screen === 'east' ? m.x + m.w - 3 : m.x + 1;
    box(g, m.x, m.y, m.w, m.h, COLOR.bezel);
    rect(g, m.x + 3, m.y + 2, m.w - 6, m.h - 4, COLOR.chairBase);
    rect(g, screenX, m.y + 3, 2, m.h - 6, lit ? COLOR.screenLit : COLOR.screenInk);
    if (lit) {
      // 光从屏幕那一侧洒在桌面上：侧视只有这一片反光读得出「亮着」
      const spillX = art.screen === 'east' ? m.x + m.w + 4 : m.x - 4;
      g.ellipse(spillX, m.y + m.h / 2, 5, m.h * 0.42).fill({ color: COLOR.screenLit, alpha: 0.24 });
    }
    return;
  }

  box(g, m.x, m.y, m.w, m.h, COLOR.bezel);
  if (art.screen === 'front') {
    // 正面：屏幕 + 代码行；灯亮时行变白，未点亮时是深色墨线
    box(g, m.x + 2, m.y + 2, m.w - 4, m.h - 6, lit ? COLOR.screenLit : COLOR.screenIdle, COLOR.bezel);
    if (lit) {
      rect(g, m.x + 5, m.y + 6, 12, 1, COLOR.ceramic);
      rect(g, m.x + 5, m.y + 10, 18, 1, COLOR.ceramic);
      rect(g, m.x + 5, m.y + 14, 8, 1, COLOR.ceramic);
      g.ellipse(m.x + m.w / 2, m.y + m.h + 4, m.w * 0.55, 5).fill({ color: COLOR.screenLit, alpha: 0.2 });
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
    rect(g, m.x + 1, m.y + 1, m.w - 2, 1, COLOR.screenLit);
    rect(g, m.x + 1, m.y + m.h - 2, m.w - 2, 1, COLOR.screenLit);
  }
}

/**
 * 工位：显示器（带屏幕小代码 / 亮屏发光）+ 桌面（桌角有马克杯、绿植、便签）。
 *
 * 桌面本体与工位位置四面一致，只有显示器按 `DeskInstance.facing` 换边换角度；
 * 绘制顺序是「桌面 → 显示器 → 陈设」，显示器才站得住桌面而不是被桌面盖住。
 */
function drawDesk(g: Graphics, lit: boolean, art: DeskArt): void {
  const { w, h } = DESK_ART_SIZE;
  shadow(g, w / 2, h - 2, 42, 3);
  // 桌面与前挡板：顶面浅、前面深，带圆角与抽屉拉手
  box(g, 4, 28, 88, 24, COLOR.deskTop);
  rect(g, 6, 29, 84, 2, COLOR.deskTopLight);
  box(g, 4, 52, 88, 12, COLOR.deskFront);
  rect(g, 40, 56, 16, 2, COLOR.deskLeg);
  box(g, 6, 60, 5, 6, COLOR.deskLeg);
  box(g, 85, 60, 5, 6, COLOR.deskLeg);
  drawMonitor(g, lit, art);
  // 桌角生活细节：左右朝向时让开显示器
  const { plantCx, mugX, noteX } = art.details;
  box(g, mugX, 19, 9, 9, COLOR.mint);
  rect(g, mugX + 1, 21, 7, 2, COLOR.ceramic);
  g.roundRect(mugX + 8, 22, 3, 4, 1).stroke({ width: 1, color: COLOR.outline });
  box(g, noteX, 33, 9, 7, COLOR.butter);
  rect(g, noteX + 2, 35, 5, 1, COLOR.peachDark);
  drawPlantPot(g, plantCx, 28, 1);
}

/** 工位椅：薰衣草色软垫，靠背圆润，五星脚 */
function drawChair(g: Graphics): void {
  const { w, h } = CHAIR_SPRITE;
  shadow(g, w / 2, h - 1, 10, 2.5);
  box(g, 6, 2, 14, 13, COLOR.lilacDark);
  box(g, 4, 13, 18, 10, COLOR.lilac);
  rect(g, 8, 15, 10, 2, COLOR.ceramic);
  rect(g, 11, 23, 4, 4, COLOR.chairBase);
  rect(g, 6, 26, 14, 2, COLOR.chairBase);
}

/** 马桶：白瓷水箱 + 圆润马桶圈，坐上去时后背靠水箱 */
function drawToilet(g: Graphics): void {
  const { w, h } = TOILET_SPRITE;
  shadow(g, w / 2, h - 1, 9, 2.5);
  box(g, 4, 0, 14, 10, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, 6, 3, 10, 1, COLOR.ceramicEdge);
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

/** 沙发：靠背在上、两个座垫在下，两侧各一只扶手 */
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

/**
 * 床：木框 + 床垫 + 枕头 + 被子，朝向统一朝右（角色横卧时头朝右）。
 * 不做镜像翻转：`sprite.scale` 会把 1px 描边拉成半像素（ADR-0005）。
 */
function drawBed(g: Graphics): void {
  const { w, h } = BED_SPRITE;
  shadow(g, w / 2, h - 2, w / 2 - 3, 3);
  box(g, 2, 4, w - 4, h - 8, COLOR.woodDark);
  box(g, 5, 7, w - 10, h - 14, COLOR.linen, COLOR.linenEdge);
  // 被子铺左三分之二，靠右留出枕头
  box(g, 7, 9, w - 26, h - 18, COLOR.blanket, COLOR.blanketLight);
  rect(g, 9, 11, w - 30, 1, COLOR.blanketLight);
  // 枕头与床头板
  box(g, w - 19, 10, 12, h - 20, COLOR.pillow, COLOR.linenEdge);
  rect(g, w - 17, 13, 8, 1, COLOR.ceramic);
  box(g, w - 5, 2, 4, h - 4, COLOR.woodLight, COLOR.woodDark);
}

function fillFloorWood(g: Graphics, r: WorldRect): void {
  rect(g, r.x, r.y, r.w, r.h, COLOR.woodA);
  // 木板错缝：每条板的起点错开，像真的拼花地板
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += 14) {
    rect(g, r.x, y, r.w, 1, COLOR.woodSeam);
    const offset = (row % 2) * 24;
    for (let x = r.x + offset; x < r.x + r.w; x += 48) {
      rect(g, x, y, 1, 14, COLOR.woodSeam);
    }
    if (row % 2 === 1) rect(g, r.x, y + 1, r.w, 12, COLOR.woodB);
  }
}

function fillFloorTile(g: Graphics, r: WorldRect): void {
  // 卫生间瓷砖：浅蓝白格子交错，接缝更淡
  for (let row = 0, y = r.y; y < r.y + r.h; row += 1, y += 16) {
    for (let col = 0, x = r.x; x < r.x + r.w; col += 1, x += 16) {
      rect(g, x, y, 16, 16, (row + col) % 2 === 0 ? COLOR.tileA : COLOR.tileB);
    }
  }
  for (let x = r.x; x < r.x + r.w; x += 16) rect(g, x, r.y, 1, r.h, COLOR.tileSeam);
  for (let y = r.y; y < r.y + r.h; y += 16) rect(g, r.x, y, r.w, 1, COLOR.tileSeam);
}

/** 休息室地毯：暖色横向条带 + 内圈收边，软地面与木地板的读感差一档 */
function fillFloorCarpet(g: Graphics, r: WorldRect): void {
  rect(g, r.x, r.y, r.w, r.h, COLOR.carpetA);
  for (let y = r.y + 16, row = 0; y < r.y + r.h; y += 16, row += 1) {
    rect(g, r.x, y, r.w, 1, COLOR.carpetSeam);
    if (row % 2 === 0 && y + 15 < r.y + r.h) rect(g, r.x, y + 1, r.w, 15, COLOR.carpetB);
  }
  // 内圈收边：站在门口一眼能看出这是软地面
  rect(g, r.x + 4, r.y + 4, r.w - 8, 1, COLOR.carpetSeam);
  rect(g, r.x + 4, r.y + r.h - 5, r.w - 8, 1, COLOR.carpetSeam);
  rect(g, r.x + 4, r.y + 4, 1, r.h - 8, COLOR.carpetSeam);
  rect(g, r.x + r.w - 5, r.y + 4, 1, r.h - 8, COLOR.carpetSeam);
}

function fillPaving(g: Graphics, r: WorldRect): void {
  rect(g, r.x, r.y, r.w, r.h, COLOR.paving);
  for (let x = r.x + 40; x < r.x + r.w; x += 40) rect(g, x, r.y, 1, r.h, COLOR.pavingSeam);
  for (let y = r.y + 40; y < r.y + r.h; y += 40) rect(g, r.x, y, r.w, 1, COLOR.pavingSeam);
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

function fillBuildingFloor(g: Graphics, building: BuildingSpec): void {
  if (building.floor === 'wood') fillFloorWood(g, building.rect);
  else if (building.floor === 'carpet') fillFloorCarpet(g, building.rect);
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
  lit: Texture;
}

export class PropsView {
  /** 地面层：木地板、瓷砖、铺装与墙体，位于地形之上、y 排序层之下 */
  readonly base = new Container();
  private readonly cullables: Cullable[] = [];
  /** 与 WORLD_LAYOUT.desks 同下标：seat.desk 直接索引 */
  private readonly desks: DeskSprite[] = [];
  private readonly textures: Texture[] = [];
  /**
   * 每种装饰只烘焙一次：加密道具之后同类道具会有几十个，
   * 逐个烘焙等于几十张同内容的纹理，显存与初始化时间都会被放大。
   */
  private readonly propTextures = new Map<PropKind, Texture>();

  /** 构造期一次性生成全部贴图与精灵；`depth` 负责按脚底 y 归入深度层 */
  build(depth: DepthSink, renderer: TextureFactory): void {
    const ground = new Graphics();
    for (const building of WORLD_LAYOUT.buildings) fillBuildingFloor(ground, building);
    for (const area of WORLD_LAYOUT.paved) fillPaving(ground, area);
    for (const solid of WORLD_LAYOUT.solids) {
      if (solid.kind === 'desk') continue;
      // 售货机 / 饮水机 / 咖啡机的本体由装饰精灵承担，地面层不再重复画
      if (solid.kind === 'prop') continue;
      fillSolidFlat(ground, solid);
    }
    this.base.addChild(ground);

    const frame = (w: number, h: number) => new Rectangle(0, 0, w, h);
    const deskFrame = frame(DESK_ART_SIZE.w, DESK_ART_SIZE.h);
    // 四个朝向各烘焙一对 idle / lit：桌子只有一种桌面，显示器换边换角度（ADR-0027）
    const deskTextures = new Map<Direction, { idle: Texture; lit: Texture }>();
    for (const facing of [DIRECTION.Up, DIRECTION.Down, DIRECTION.Left, DIRECTION.Right]) {
      const art = deskArtFor(facing);
      deskTextures.set(facing, {
        idle: bake(renderer, (g) => drawDesk(g, false, art), { frame: deskFrame }),
        lit: bake(renderer, (g) => drawDesk(g, true, art), { frame: deskFrame }),
      });
    }
    const seatTextures: Record<SeatKind, Texture> = {
      chair: bake(renderer, drawChair, { frame: frame(CHAIR_SPRITE.w, CHAIR_SPRITE.h) }),
      toilet: bake(renderer, drawToilet, { frame: frame(TOILET_SPRITE.w, TOILET_SPRITE.h) }),
      stool: bake(renderer, drawStool, { frame: frame(STOOL_SPRITE.w, STOOL_SPRITE.h) }),
      sofa: bake(renderer, drawSofa, { frame: frame(SOFA_SPRITE.w, SOFA_SPRITE.h) }),
      bed: bake(renderer, drawBed, { frame: frame(BED_SPRITE.w, BED_SPRITE.h) }),
    };
    for (const art of deskTextures.values()) this.textures.push(art.idle, art.lit);
    this.textures.push(...Object.values(seatTextures));

    for (const desk of WORLD_LAYOUT.desks) {
      const bottom = desk.y + DESK_H / 2;
      const texture = deskTextures.get(desk.facing) ?? deskTextures.get(DIRECTION.Up)!;
      const sprite = new Sprite(texture.idle);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(desk.x, bottom);
      depth.add(bottom, sprite);
      this.desks.push({ sprite, idle: texture.idle, lit: texture.lit });
      this.cullables.push({ sprite, x: desk.x, y: bottom, padX: DESK_W / 2 + 8, padY: DESK_ART_SIZE.h });
    }

    for (const seat of WORLD_LAYOUT.seats) {
      const art = SEAT_ART[seat.kind];
      const sprite = new Sprite(seatTextures[seat.kind]);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(seat.x, seat.y + art.sink);
      // 座椅排在入座者脚底 y 之下：角色坐上去 / 躺下去时家具在身后
      depth.add(seat.y - 1, sprite);
      this.cullables.push({ sprite, x: seat.x, y: seat.y, padX: art.w / 2 + 4, padY: art.h + art.sink });
    }

    for (const prop of WORLD_LAYOUT.props) this.addProp(depth, renderer, prop);
  }

  private propTexture(renderer: TextureFactory, kind: PropKind): Texture {
    const cached = this.propTextures.get(kind);
    if (cached) return cached;
    const size = PROP_SIZE[kind];
    const texture = bake(renderer, (g) => drawProp(kind, g), { frame: new Rectangle(0, 0, size.w, size.h) });
    this.propTextures.set(kind, texture);
    this.textures.push(texture);
    return texture;
  }

  private addProp(depth: DepthSink, renderer: TextureFactory, prop: PropInstance): void {
    const size = PROP_SIZE[prop.kind];
    const texture = this.propTexture(renderer, prop.kind);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(prop.x, prop.y);
    depth.add(prop.y, sprite);
    this.cullables.push({ sprite, x: prop.x, y: prop.y, padX: size.w / 2 + 2, padY: size.h + 2 });
  }

  /** 占用变化：工位显示器点亮 / 熄灭。椅子与马桶没有视觉状态，只靠姿态表现 */
  setSeatOccupied(seat: SeatInstance, occupied: boolean): void {
    if (seat.desk < 0) return;
    const desk = this.desks[seat.desk];
    if (!desk) return;
    desk.sprite.texture = occupied ? desk.lit : desk.idle;
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
