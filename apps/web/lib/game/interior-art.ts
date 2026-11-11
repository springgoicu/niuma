'use client';

import { Container, Graphics, Rectangle, Sprite, type Application, type Texture } from 'pixi.js';
import { WORLD_LAYOUT, type BuildingSpec, type WorldRect } from '@niuma/shared-types';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 室内陈设补完层：宿舍区、工作区、卫生间的「第二层细节」（ADR-0046 附带的观感改造）。
 *
 * 为什么不往 `WORLD_LAYOUT.props` 里加：`PropKind` 是双端共享的契约，
 * 加一种家具就要动 `packages/shared-types`，还要和服务端一起发版；
 * 而这里画的全部是**无碰撞**的墙面与地面陈设，渲染层自己算得出来。
 * 同理，所有坐标都贴墙——贴墙的位置本来就站在墙的碰撞盒里，
 * 玩家不可能「站进衣柜」，也就不需要为它们补碰撞。
 *
 * 画风沿用 `props.ts`：1px 深靛描边 + 糖果色点缀，每件都带一处生活细节。
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
} as const;

function box(g: Graphics, x: number, y: number, w: number, h: number, fill: number, line: number = COLOR.outline): void {
  g.roundRect(x, y, w, h, 2).fill(line);
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 1).fill(fill);
}

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

function shadow(g: Graphics, cx: number, cy: number, rx: number, ry: number): void {
  g.ellipse(cx, cy, rx, ry).fill({ color: COLOR.shadow, alpha: 0.2 });
}

function dot(g: Graphics, cx: number, cy: number, r: number, fill: number, line: number = COLOR.outline): void {
  g.circle(cx, cy, r + 1).fill(line);
  g.circle(cx, cy, r).fill(fill);
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

/** 衣柜：两扇门 + 把手 + 顶面一条亮边，门缝里透出一点暖色（柜里有灯） */
function drawWardrobe(g: Graphics): void {
  shadow(g, 13, 40, 12, 2);
  box(g, 1, 2, 24, 38, COLOR.woodLight, COLOR.woodDark);
  rect(g, 2, 3, 22, 2, 0xf0cdaa);
  box(g, 3, 8, 9, 30, 0xf0cdaa, COLOR.woodDark);
  box(g, 14, 8, 9, 30, 0xf0cdaa, COLOR.woodDark);
  // 门缝透出的暖光：柜里挂着一盏小灯，这条亮线是「有人住」的信号
  rect(g, 12, 10, 2, 26, COLOR.glow);
  rect(g, 11, 22, 1, 3, COLOR.woodDark);
  rect(g, 14, 22, 1, 3, COLOR.woodDark);
  rect(g, 4, 11, 7, 1, COLOR.woodSeam);
  rect(g, 15, 11, 7, 1, COLOR.woodSeam);
}

/** 书架：四层书脊，颜色随机感由固定色表给出，不用随机数 */
function drawBookshelf(g: Graphics): void {
  shadow(g, 13, 32, 12, 2);
  box(g, 1, 2, 24, 30, COLOR.woodLight, COLOR.woodDark);
  const spines = [COLOR.mintDark, COLOR.skyDark, COLOR.peachDark, COLOR.lilacDark, COLOR.butter];
  for (let row = 0; row < 4; row += 1) {
    const y = 5 + row * 7;
    rect(g, 3, y + 5, 20, 1, COLOR.woodDark);
    for (let i = 0; i < 6; i += 1) {
      const w = 2 + ((row + i) % 2);
      const x = 3 + i * 3.4;
      rect(g, x, y, w, 5, spines[(row * 2 + i) % spines.length]!);
    }
  }
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

/** 行李架：两根横杆 + 折叠的毯子，宿舍里最像「住人」的一件 */
function drawLuggageRack(g: Graphics): void {
  shadow(g, 10, 14, 9, 2);
  box(g, 1, 5, 18, 2, COLOR.woodLight, COLOR.woodDark);
  box(g, 1, 10, 18, 2, COLOR.woodLight, COLOR.woodDark);
  box(g, 3, 7, 3, 7, COLOR.woodDark);
  box(g, 14, 7, 3, 7, COLOR.woodDark);
  box(g, 5, 1, 10, 5, COLOR.lilac, COLOR.lilacDark);
  rect(g, 6, 3, 8, 1, COLOR.tileDeep);
}

/** 烘手机：东墙上的小白盒，出风口压一道暗边 */
function drawHandDryer(g: Graphics): void {
  box(g, 0, 0, 8, 10, COLOR.ceramic, COLOR.ceramicEdge);
  rect(g, 1, 2, 6, 1, COLOR.fixtureEdge);
  rect(g, 2, 8, 4, 1, COLOR.fixtureEdge);
  dot(g, 6, 4, 1, COLOR.mintDark);
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

export class InteriorArt {
  private readonly textures: Texture[] = [];

  /**
   * `base` 收墙面与地面陈设（在地板之上、家具精灵之下），
   * `depth` 收立式家具（衣柜 / 书架 / 推车 / 打印机 / 纸箱 / 落地灯 / 立架 / 行李架 / 烘手机）。
   */
  build(depth: DepthSink, base: Container, renderer: TextureFactory): void {
    const flat = new Graphics();
    const work = roomOf('工作区');
    const lounge = roomOf('宿舍区');
    const restroom = roomOf('卫生间');

    if (work) this.decorateWorkroom(flat, work);
    if (lounge) this.decorateLounge(flat, lounge);
    if (restroom) this.decorateRestroom(flat, restroom);
    base.addChild(flat);

    if (work) this.furnishWorkroom(depth, renderer, work);
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

  /* ---------------- 宿舍区：地毯 + 四面墙 ---------------- */

  private decorateLounge(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;

    // 南墙两扇窗：窗外是雪夜，窗台堆一层雪——室内不出雪，但「看得见雪」
    this.window(g, x + 130, y + h - t, 30, 16);
    this.window(g, x + 330, y + h - t, 30, 16);
    // 暖气片：窗下那条金属格栅，是「这间屋子有人住」的最省笔墨的细节
    const rx = x + 232;
    const ry = y + h - t;
    box(g, rx, ry - 9, 36, 9, COLOR.fixture, COLOR.fixtureEdge);
    for (let i = 0; i < 8; i += 1) rect(g, rx + 3 + i * 4, ry - 7, 1, 5, COLOR.fixtureEdge);
    rect(g, rx, ry - 9, 36, 1, COLOR.ceramic);

    // 北墙：挂钟 + 两盏壁灯（门在 x+200…x+260，全部避开门洞）
    this.clock(g, x + 300, y + t + 4);
    this.sconce(g, x + 150, y + t + 2);
    this.sconce(g, x + 380, y + t + 2);

    // 地面：圆毯 + 床边小毯 + 一双拖鞋
    this.roundRug(g, x + 250, y + 250, 28);
    rect(g, x + 78, y + 324, 64, 12, COLOR.lilac);
    rect(g, x + 79, y + 325, 62, 10, 0xded0ff);
    rect(g, x + 78, y + 324, 64, 1, COLOR.lilacDark);
    this.slippers(g, x + 176, y + 300);
  }

  private furnishLounge(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    this.place(depth, renderer, 'wardrobe', drawWardrobe, WARDROBE, x + 352, y + h - 8);
    this.place(depth, renderer, 'bookshelf', drawBookshelf, BOOKSHELF, x + 400, y + 120);
    this.place(depth, renderer, 'rack', drawLuggageRack, LUGGAGE_RACK, x + 300, y + 320);
  }

  /* ---------------- 卫生间：瓷砖 + 三区 ---------------- */

  private decorateRestroom(g: Graphics, room: Room): void {
    const { x, y, w, h } = room.rect;
    const t = room.wall;

    // 墙裙：南 / 东 / 西三面内缘压一圈更深的瓷砖，房间立刻有「装修过」的层次
    rect(g, x + t, y + h - t - 6, w - t * 2, 6, COLOR.tileDeep);
    rect(g, x + t, y + h - t - 6, w - t * 2, 1, COLOR.tileSeam);
    rect(g, x + t, y + t, 6, h - t * 2, COLOR.tileDeep);
    rect(g, x + w - t - 6, y + t, 6, h - t * 2, COLOR.tileDeep);

    // 镜子挂在洗手台上方；两侧是洗手液与纸巾盒
    this.mirror(g, x + 194, y + 344);
    this.mirror(g, x + 264, y + 344);
    box(g, x + 228, y + 336, 4, 8, COLOR.mint, COLOR.mintDark);
    rect(g, x + 229, y + 339, 2, 1, COLOR.ceramic);
    box(g, x + 212, y + 338, 8, 6, COLOR.fixture, COLOR.fixtureEdge);
    rect(g, x + 213, y + 340, 6, 1, COLOR.ceramic);

    // 防滑垫 + 地漏
    box(g, x + 200, y + 288, 40, 16, 0xdfeaf2, COLOR.tileSeam);
    for (let i = 0; i < 6; i += 1) rect(g, x + 204 + i * 6, y + 292, 1, 8, COLOR.tileSeam);
    g.circle(x + 230, y + 246, 4).fill(COLOR.tileSeam);
    g.circle(x + 230, y + 246, 3).fill(0xc8d6e0);
    rect(g, x + 228, y + 244, 4, 1, COLOR.fixtureEdge);
    rect(g, x + 228, y + 247, 4, 1, COLOR.fixtureEdge);

    // 隔间：半掩的门板 + 厕纸架（隔断在 x+77 与 x+377，宽 6）
    this.stallDoor(g, x + 84, y + t + 4);
    this.stallDoor(g, x + 384, y + t + 4);
    for (const px of [x + 84, x + 384]) {
      box(g, px + 2, y + 118, 5, 7, COLOR.fixture, COLOR.fixtureEdge);
      rect(g, px + 4, y + 121, 3, 2, COLOR.ceramic);
    }
  }

  private decorateRestroomFittings(depth: DepthSink, renderer: TextureFactory, room: Room): void {
    const { x, y, h } = room.rect;
    this.place(depth, renderer, 'dryer', drawHandDryer, HAND_DRYER, x + 320, y + h - room.wall);
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
    for (let i = 0; i < 5; i += 1) rect(g, x + 4 + i * 6, bottom - 8, 3, 2, COLOR.snow);
    // 窗棂
    rect(g, x + w / 2 - 1, top + 2, 2, h - 6, COLOR.woodLight);
    rect(g, x + 2, top + h / 2 - 1, w - 4, 2, COLOR.woodLight);
    // 窗外的雪粒
    rect(g, x + 6, top + 4, 1, 1, COLOR.snow);
    rect(g, x + 14, top + 6, 1, 1, COLOR.snow);
    rect(g, x + 22, top + 3, 1, 1, COLOR.snow);
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
    box(g, x, y, 8, 4, COLOR.woodDark);
    g.roundRect(x + 1, y + 3, 6, 5, 2).fill(COLOR.butter);
    rect(g, x + 3, y + 4, 2, 2, COLOR.glow);
  }

  /** 镜子：斜角高光两道，镜面用冷白而不是纯白 */
  private mirror(g: Graphics, cx: number, bottom: number): void {
    const w = 24;
    const h = 12;
    box(g, cx - w / 2, bottom - h, w, h, 0xeaf4f8, COLOR.fixtureEdge);
    rect(g, cx - w / 2 + 2, bottom - h + 2, w - 4, h - 4, 0xdceef6);
    rect(g, cx - w / 2 + 3, bottom - h + 3, 6, 1, 0xffffff);
    rect(g, cx - w / 2 + 3, bottom - h + 4, 3, 1, 0xffffff);
    rect(g, cx + w / 2 - 6, bottom - h + 6, 3, 1, 0xffffff);
  }

  /** 隔间门：一块半掩的门板，把手在靠外一侧 */
  private stallDoor(g: Graphics, x: number, top: number): void {
    box(g, x, top, 3, 34, COLOR.ceramic, COLOR.ceramicEdge);
    rect(g, x + 1, top + 2, 1, 30, COLOR.fixture);
    rect(g, x + 1, top + 22, 1, 2, COLOR.metal);
  }

  private roundRug(g: Graphics, cx: number, cy: number, r: number): void {
    g.ellipse(cx, cy, r, r * 0.62).fill(COLOR.carpetDark);
    g.ellipse(cx, cy, r - 2, r * 0.62 - 2).fill(COLOR.carpet);
    g.ellipse(cx, cy, r - 9, r * 0.62 - 7).fill(0xe8cbaa);
    g.ellipse(cx, cy, r - 9, r * 0.62 - 7).stroke({ width: 1, color: COLOR.carpetDark });
  }

  private slippers(g: Graphics, x: number, y: number): void {
    for (const dx of [0, 7]) {
      box(g, x + dx, y, 5, 8, COLOR.peach, COLOR.peachDark);
      g.ellipse(x + dx + 2, y + 3, 2, 2).fill(COLOR.butter);
    }
  }

  /** 立式家具统一走这里：按 `key` 缓存纹理，同类只烘焙一次 */
  private place(
    depth: DepthSink,
    renderer: TextureFactory,
    key: string,
    draw: (g: Graphics) => void,
    size: { w: number; h: number },
    x: number,
    y: number,
  ): void {
    const texture = this.texture(renderer, key, draw, size);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x, y);
    depth.add(y, sprite);
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
