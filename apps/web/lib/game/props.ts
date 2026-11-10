'use client';

import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import {
  DESK_H,
  DESK_W,
  WORLD_LAYOUT,
  type BuildingSpec,
  type PropInstance,
  type PropKind,
  type SeatInstance,
  type SolidRect,
  type WorldRect,
} from '@niuma/shared-types';
import { bake } from './terrain-textures';

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
};

const DESK_SPRITE = { w: 96, h: 66 };
const CHAIR_SPRITE = { w: 26, h: 30 };
const TOILET_SPRITE = { w: 22, h: 28 };

/** 桌椅与马桶的精灵相对入座锚点下沉 6px：椅面落在角色臀下，而不是悬空 */
const SEAT_SINK = 6;

/**
 * 售货机的碰撞矩形尺寸，与 layout 中 PLAZA_SOLIDS 保持一致：这类碰撞体由精灵承担。
 * 精灵从 42×60 收到 34×48，底座碰撞同比收到 32×24。
 */
const VENDING_W = 32;
const VENDING_H = 24;

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
  }
}

/** 工位：显示器（带屏幕小代码 / 亮屏发光）+ 桌面（桌角有马克杯、绿植、便签） */
function drawDesk(g: Graphics, lit: boolean): void {
  const { w, h } = DESK_SPRITE;
  shadow(g, w / 2, h - 2, 42, 3);
  // 显示器支架与屏幕
  rect(g, 45, 22, 6, 7, COLOR.bezel);
  box(g, 32, 2, 32, 22, COLOR.bezel);
  box(g, 34, 4, 28, 16, lit ? COLOR.screenLit : COLOR.screenIdle, COLOR.bezel);
  if (lit) {
    g.rect(26, 0, 44, 26).fill({ color: COLOR.screenLit, alpha: 0.16 });
    rect(g, 37, 8, 12, 1, COLOR.ceramic);
    rect(g, 37, 12, 18, 1, COLOR.ceramic);
    rect(g, 37, 16, 8, 1, COLOR.ceramic);
  } else {
    rect(g, 37, 8, 14, 1, COLOR.screenInk);
    rect(g, 37, 12, 9, 1, COLOR.screenInk);
  }
  // 桌面与前挡板：顶面浅、前面深，带圆角与抽屉拉手
  box(g, 4, 28, 88, 24, COLOR.deskTop);
  rect(g, 6, 29, 84, 2, COLOR.deskTopLight);
  box(g, 4, 52, 88, 12, COLOR.deskFront);
  rect(g, 40, 56, 16, 2, COLOR.deskLeg);
  box(g, 6, 60, 5, 6, COLOR.deskLeg);
  box(g, 85, 60, 5, 6, COLOR.deskLeg);
  // 桌角生活细节
  box(g, 70, 19, 9, 9, COLOR.mint);
  rect(g, 71, 21, 7, 2, COLOR.ceramic);
  g.roundRect(78, 22, 3, 4, 1).stroke({ width: 1, color: COLOR.outline });
  box(g, 53, 33, 9, 7, COLOR.butter);
  rect(g, 55, 35, 5, 1, COLOR.peachDark);
  drawPlantPot(g, 14, 28, 1);
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

  /** 构造期一次性生成全部贴图与精灵；`sorted` 必须已开启 sortableChildren */
  build(sorted: Container, renderer: TextureFactory): void {
    const ground = new Graphics();
    for (const building of WORLD_LAYOUT.buildings) fillBuildingFloor(ground, building);
    for (const area of WORLD_LAYOUT.paved) fillPaving(ground, area);
    for (const solid of WORLD_LAYOUT.solids) {
      if (solid.kind === 'desk') continue;
      // 售货机本体由装饰精灵承担，地面层不再重复画
      if (solid.kind === 'fixture' && solid.w === VENDING_W && solid.h === VENDING_H) continue;
      fillSolidFlat(ground, solid);
    }
    this.base.addChild(ground);

    const frame = (w: number, h: number) => new Rectangle(0, 0, w, h);
    const deskIdle = bake(renderer, (g) => drawDesk(g, false), { frame: frame(DESK_SPRITE.w, DESK_SPRITE.h) });
    const deskLit = bake(renderer, (g) => drawDesk(g, true), { frame: frame(DESK_SPRITE.w, DESK_SPRITE.h) });
    const chair = bake(renderer, drawChair, { frame: frame(CHAIR_SPRITE.w, CHAIR_SPRITE.h) });
    const toilet = bake(renderer, drawToilet, { frame: frame(TOILET_SPRITE.w, TOILET_SPRITE.h) });
    this.textures.push(deskIdle, deskLit, chair, toilet);

    for (const desk of WORLD_LAYOUT.desks) {
      const bottom = desk.y + DESK_H / 2;
      const sprite = new Sprite(deskIdle);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(desk.x, bottom);
      sprite.zIndex = bottom;
      sorted.addChild(sprite);
      this.desks.push({ sprite, idle: deskIdle, lit: deskLit });
      this.cullables.push({ sprite, x: desk.x, y: bottom, padX: DESK_W / 2 + 8, padY: DESK_SPRITE.h });
    }

    for (const seat of WORLD_LAYOUT.seats) {
      const isToilet = seat.kind === 'toilet';
      const size = isToilet ? TOILET_SPRITE : CHAIR_SPRITE;
      const sprite = new Sprite(isToilet ? toilet : chair);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(seat.x, seat.y + SEAT_SINK);
      // 座椅排在入座者脚底 y 之下：角色坐上去时椅子在身后
      sprite.zIndex = seat.y - 1;
      sorted.addChild(sprite);
      this.cullables.push({ sprite, x: seat.x, y: seat.y, padX: size.w / 2 + 4, padY: size.h + SEAT_SINK });
    }

    for (const prop of WORLD_LAYOUT.props) this.addProp(sorted, renderer, prop);
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

  private addProp(sorted: Container, renderer: TextureFactory, prop: PropInstance): void {
    const size = PROP_SIZE[prop.kind];
    const texture = this.propTexture(renderer, prop.kind);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(prop.x, prop.y);
    sprite.zIndex = prop.y;
    sorted.addChild(sprite);
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
