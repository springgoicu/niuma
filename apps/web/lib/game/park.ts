'use client';

import { Container, Graphics, Rectangle, Sprite, Text, type Application, type Texture } from 'pixi.js';
import { AMUSEMENT_PARK, PARK_EAST_GATE, PARK_RIDES, PARK_SLIDE, parkFencePosts } from '@niuma/shared-types';
import type { LightSpec } from './lighting/light-registry';
import type { DepthSink } from './sort-layer';
import { bake } from './terrain-textures';

/**
 * 游乐园（本轮新增）：晴天下班后的糖果色游乐场。
 *
 * 与 `pavilion.ts` / `welcome.ts` 同一条纪律：
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
function drawGate(g: Graphics): void {
  for (const x of [8, GATE_ART.w - 22]) {
    box(g, x, 16, 14, GATE_ART.h - 20, C.mint, C.ink);
    rect(g, x + 3, 22, 8, GATE_ART.h - 32, C.mintLight);
    dot(g, x + 7, 12, 5, C.gold, C.ink);
  }
  box(g, 4, 26, GATE_ART.w - 8, 16, C.peach, C.ink);
  rect(g, 8, 29, GATE_ART.w - 16, 4, C.cream);
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

function drawFence(g: Graphics): void {
  for (const post of parkFencePosts()) {
    rect(g, post.x - 3, post.y - 10, 6, 12, C.ink);
    rect(g, post.x - 2, post.y - 9, 4, 9, C.wood);
    rect(g, post.x - 1, post.y - 8, 2, 2, C.cream);
  }
}

export class ParkView {
  private readonly textures: Texture[] = [];
  /** 入口彩灯 + 旋转木马两处地标光；灯柱本身由 propLights 统一出光 */
  readonly lights: LightSpec[];
  private readonly gateText: Text;
  /** 每个可排序件都带自己的深度键：滑梯用塔顶，其余用脚底 y */
  private readonly items: Array<{ root: Container; depthY: number }> = [];

  constructor(renderer: TextureFactory, devicePxPerTexel: number) {
    this.lights = [
      { x: PARK_EAST_GATE.x, y: PARK_EAST_GATE.y, radius: 62, color: 0xffd27a, intensity: 0.5, flicker: 0.12 },
      { x: 2560, y: 5940, radius: 88, color: 0xffc07a, intensity: 0.55, flicker: 0.1 },
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
    const gateTexture = bake(renderer, drawGate, { frame: new Rectangle(0, 0, GATE_ART.w, GATE_ART.h) });
    const swingTexture = bake(renderer, drawSwing, { frame: new Rectangle(0, 0, SWING_ART.w, SWING_ART.h) });
    const seesawTexture = bake(renderer, drawSeesaw, { frame: new Rectangle(0, 0, SEESAW_ART.w, SEESAW_ART.h) });
    const carouselTexture = bake(renderer, drawCarousel, { frame: new Rectangle(0, 0, CAROUSEL_ART.w, CAROUSEL_ART.h) });
    const balloonTexture = bake(renderer, drawBalloons, { frame: new Rectangle(0, 0, 30, 36) });
    this.textures.push(
      slideTexture,
      gateTexture,
      swingTexture,
      seesawTexture,
      carouselTexture,
      balloonTexture,
    );

    const slide = new Sprite(slideTexture);
    slide.anchor.set(0.5, 1);
    slide.position.set(PARK_SLIDE.hit.x + PARK_SLIDE.hit.w / 2, PARK_SLIDE.hit.y + PARK_SLIDE.hit.h);
    this.push(this.wrap(slide), PARK_SLIDE.top.y);

    // 东门：门头精灵 + Pixi 中文「游乐园」
    const gate = new Container();
    gate.position.set(PARK_EAST_GATE.x, PARK_EAST_GATE.y);
    const gateSprite = new Sprite(gateTexture);
    gateSprite.anchor.set(0.5, 1);
    gateSprite.position.set(0, 8);
    this.gateText.position.set(0, -34);
    gate.addChild(gateSprite, this.gateText);
    this.push(gate, PARK_EAST_GATE.y);

    const balloons = new Sprite(balloonTexture);
    balloons.anchor.set(0.5, 1);
    balloons.position.set(PARK_EAST_GATE.x - 46, PARK_EAST_GATE.y + 16);
    this.push(this.wrap(balloons), PARK_EAST_GATE.y + 16);

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
   * `base` 收围栏与灯串（贴地、始终在角色下方）；`depth` 收立体器械。
   * 滑梯的深度键用塔顶而不是落地点：角色沿滑道下来时不会被整张精灵盖住。
   */
  build(depth: DepthSink, base: Container): void {
    const fence = new Graphics();
    drawFence(fence);
    const lights = new Graphics();
    drawStringLights(lights);
    base.addChild(fence, lights);

    for (const item of this.items) depth.add(item.depthY, item.root);
  }

  setTextResolution(devicePxPerTexel: number): void {
    this.gateText.resolution = devicePxPerTexel;
  }

  destroy(): void {
    for (const item of this.items) item.root.destroy({ children: true });
    this.items.length = 0;
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
  }
}
