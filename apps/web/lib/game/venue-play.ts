'use client';

import { Container, Graphics, Rectangle, Sprite, type Application, type Texture } from 'pixi.js';
import { THEATER_SPEAKERS } from '@niuma/shared-types';
import {
  MEETING_SCREEN_RECT,
  THEATER_CHANNELS,
  THEATER_ROOM_RECT,
  THEATER_SCREEN_RECT,
  theaterChannelAt,
  type TheaterChannelId,
} from './venue-spots';
import {
  approachValue,
  noteAlpha,
  noteRise,
  noteSway,
  photoFlashAlpha,
  screenFlicker,
  slideIndex,
} from './venue-motion';

/**
 * 弱交互场所的**局域演出层**：会议投屏、影厅大屏、影院压暗、音箱音符、打卡闪光。
 *
 * 三条纪律（与 `venue-art.ts` / `water-fx.ts` 一致）：
 * 1. **构造期烘焙，帧循环零分配**：所有底图在 `build()` 前一次 `bake()`，帧内只换
 *    `texture`、写整数坐标、写 `alpha`，不 new 对象 / 数组、不 `generateTexture`；
 * 2. **不做浮点缩放与旋转**：屏幕画面是整张贴图，动件靠整数像素平移与换帧，
 *    摩天轮之外没有任何旋转插值；
 * 3. **纯客户端**：不新增协议、不改碰撞与座位，占用计数只读 `S2C_SEAT_STATE`。
 *
 * `?venue=0` 时整层不构造；`?motion=0` 时所有时间量取 0，画面停在第一帧。
 */

type TextureFactory = Application['renderer'];

/** 与 `interior-art.ts` 的会议 / 影厅配色同源，避免同一块屏幕两套色 */
const C = {
  outline: 0x2a3142,
  bezel: 0x1b2436,
  glass: 0x14263f,
  cyan: 0x7fd6ff,
  cyanDeep: 0x2f6f9e,
  grid: 0x1f3555,
  cream: 0xfff6e0,
  butter: 0xffe49a,
  amber: 0xffd27a,
  mint: 0x8fe3c7,
  mintDeep: 0x3f9e66,
  peach: 0xffb59e,
  peachDeep: 0xe8856d,
  lilac: 0xc9b6ff,
  snow: 0xe9f0f7,
  snowShade: 0xc7d6e6,
  hill: 0x2a5478,
  hillDeep: 0x1d3b5a,
  night: 0x0f2238,
  white: 0xffffff,
} as const;

/** 幻灯片轮播间隔：4s 一张，三张循环 */
const SLIDE_HOLD_MS = 4000;
/** 会议投屏无人入座时的亮度：低亮待机，仍能看出「屏还开着」 */
const IDLE_SCREEN_ALPHA = 0.42;
/** 影厅压暗目标 alpha 与时间常数（约 0.8s 到位） */
const THEATER_DIM_ALPHA = 0.22;
const THEATER_DIM_TAU = 260;
/** 相机闪光寿命 */
const FLASH_LIFE_MS = 420;
const FLASH_COUNT = 4;
/** 音箱音符池 */
const NOTE_COUNT = 8;
const NOTE_RISE_PX = 20;
/** 摩天轮吊舱不在本层：留给 `park.ts` */

function rect(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  g.rect(x, y, w, h).fill({ color, alpha });
}

/** 逐行填一个硬边圆（避免曲线细分把像素糊掉） */
function pixelDisc(g: Graphics, cx: number, cy: number, r: number, color: number): void {
  for (let dy = -r; dy <= r; dy += 1) {
    const inner = r * r - dy * dy;
    if (inner <= 0) continue;
    const half = Math.round(Math.sqrt(inner));
    if (half <= 0) continue;
    g.rect(cx - half, cy + dy, half * 2, 1).fill(color);
  }
}

/** 三角波：0 → 1 → 0，用于屏保方块的整数弹跳 */
function pingPong(t: number): number {
  const phase = t - Math.floor(t);
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

/* ------------------------------------------------------------------ *
 * 会议室投屏：三张幻灯片
 * ------------------------------------------------------------------ */

const MEETING_INNER = {
  x: 2,
  y: 2,
  w: MEETING_SCREEN_RECT.w - 4,
  h: MEETING_SCREEN_RECT.h - 4,
};

/** 底：深蓝玻璃 + 顶部一条冷光 + 网格 */
function drawSlideBase(g: Graphics): void {
  const { w, h } = MEETING_INNER;
  rect(g, 0, 0, w, h, C.glass);
  rect(g, 0, 0, w, 1, C.cyan);
  for (let x = 10; x < w - 6; x += 16) rect(g, x, 5, 1, h - 10, C.grid);
  for (let y = 9; y < h - 5; y += 10) rect(g, 6, y, w - 12, 1, C.grid);
}

/** 每张幻灯片都要有的页眉：三道点阵字块 + 页码点 */
function drawSlideChrome(g: Graphics, page: number): void {
  const { w, h } = MEETING_INNER;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 5 - row; col += 1) {
      rect(g, 8 + col * 4, 3 + row * 3, 3, 1, row === 0 ? C.cyan : C.cyanDeep);
    }
  }
  for (let i = 0; i < 3; i += 1) {
    const on = i === page;
    rect(g, w - 20 + i * 6, h - 6, on ? 4 : 3, 2, on ? C.cyan : C.cyanDeep);
  }
  rect(g, 2, h - 3, w - 4, 1, C.cyanDeep);
}

/** 幻灯片 1：甘特图 —— 三条泳道 + 不同起点与长度的任务条 */
function drawSlideGantt(g: Graphics): void {
  drawSlideBase(g);
  const lanes = [
    [4, 26],
    [10, 34],
    [16, 22],
  ] as const;
  lanes.forEach(([offset, length], index) => {
    const y = 14 + index * 11;
    rect(g, 8, y, MEETING_INNER.w - 18, 1, 0x24406a);
    rect(g, 10 + offset, y - 3, length, 6, index === 0 ? C.mint : index === 1 ? C.butter : C.peach);
    // 里程碑菱形：整数像素的四条斜线
    const mx = 10 + offset + length + 4;
    rect(g, mx, y - 2, 1, 1, C.cream);
    rect(g, mx - 1, y - 1, 3, 1, C.cream);
    rect(g, mx, y, 1, 1, C.cream);
  });
  drawSlideChrome(g, 0);
}

/** 幻灯片 2：永远向上的折线 + 四根柱 */
function drawSlideGrowth(g: Graphics): void {
  drawSlideBase(g);
  const baseY = MEETING_INNER.h - 8;
  const steps = [0, 8, 7, 18, 17, 30, 29, 42, 41, 54, 53, 66];
  let lastY = baseY;
  steps.forEach((dx, index) => {
    const px = 10 + dx;
    const py = baseY - 3 - index * 3;
    const top = Math.min(lastY, py);
    rect(g, px, top, 1, Math.abs(lastY - py) + 2, C.cyan);
    rect(g, px, py, 4, 1, C.cyan);
    lastY = py;
  });
  rect(g, 10 + 66, lastY - 2, 3, 3, C.cream);
  for (let i = 0; i < 4; i += 1) {
    const barH = 7 + i * 5;
    rect(g, MEETING_INNER.w - 56 + i * 11, baseY - barH, 7, barH, C.cyanDeep);
    rect(g, MEETING_INNER.w - 56 + i * 11, baseY - barH, 7, 1, C.cyan);
  }
  drawSlideChrome(g, 1);
}

/** 幻灯片 3：大饼图 —— 四象限硬边圆 + 图例 */
function drawSlidePie(g: Graphics): void {
  drawSlideBase(g);
  const cx = 40;
  const cy = MEETING_INNER.h / 2 - 1;
  const r = 18;
  pixelDisc(g, cx, cy, r, C.cyanDeep);
  // 右上象限提亮、左下象限压暖：四块拼出一张 2×2 的饼
  for (let dy = -r; dy <= r; dy += 1) {
    const inner = r * r - dy * dy;
    if (inner <= 0) continue;
    const half = Math.round(Math.sqrt(inner));
    if (half <= 0) continue;
    if (dy < 0) g.rect(cx, cy + dy, half, 1).fill(C.cyan);
    if (dy > 0) g.rect(cx - half, cy + dy, half, 1).fill(C.peach);
    if (dy === 0) g.rect(cx, cy, half, 1).fill(C.butter);
  }
  pixelDisc(g, cx, cy, 5, C.glass);
  // 图例：三条色块 + 长度不一的字块
  const legend = [
    [C.cyan, 30],
    [C.peach, 22],
    [C.butter, 16],
  ] as const;
  legend.forEach(([color, width], index) => {
    const y = 12 + index * 10;
    rect(g, 74, y, 5, 5, color);
    rect(g, 83, y + 1, width, 3, 0x5aa6c9);
  });
  drawSlideChrome(g, 2);
}

/* ------------------------------------------------------------------ *
 * 影厅大屏：四个频道底图 + 各自的动件
 * ------------------------------------------------------------------ */

function drawTheaterBase(g: Graphics): void {
  const { w, h } = THEATER_SCREEN_RECT;
  rect(g, 0, 0, w, h, C.night);
  // 夜空：两层压暗，越靠上越深
  rect(g, 0, 0, w, 18, 0x0b1a2c);
  rect(g, 0, 18, w, 14, 0x122a44);
}

function drawStars(g: Graphics, count: number, maxY: number): void {
  const { w } = THEATER_SCREEN_RECT;
  for (let i = 0; i < count; i += 1) {
    // 固定步长的星点：不随机，两端画面完全一致
    const x = 8 + ((i * 37) % (w - 16));
    const y = 4 + ((i * 13) % maxY);
    rect(g, x, y, 1, 1, i % 5 === 0 ? C.cream : 0x9fd3ff);
  }
}

/** 频道 1 底：雪夜山脊 + 铁轨（列车是动件，不画进来） */
function drawTrainChannel(g: Graphics): void {
  drawTheaterBase(g);
  drawStars(g, 28, 26);
  pixelDisc(g, 214, 16, 8, C.cream);
  g.rect(6, 40, THEATER_SCREEN_RECT.w - 12, 1).fill(C.snowShade);
  g.rect(6, 44, THEATER_SCREEN_RECT.w - 12, 1).fill(0x2c4a6a);
  // 远山两层：三角坡用逐行收窄的矩形堆出来
  for (let row = 0; row < 10; row += 1) {
    const half = 34 - row * 3;
    if (half > 0) g.rect(58 - half, 30 + row, half * 2, 1).fill(C.hillDeep);
    if (half > 6) g.rect(180 - half + 4, 32 + row, half * 2 - 8, 1).fill(C.hill);
  }
  // 路面积雪
  rect(g, 0, 46, THEATER_SCREEN_RECT.w, 10, 0x1b2f47);
  for (let x = 4; x < THEATER_SCREEN_RECT.w; x += 12) rect(g, x, 48, 6, 1, C.snowShade);
}

/** 频道 2 底：办公室布景（老板头像单独一张，两帧） */
function drawBossChannel(g: Graphics): void {
  drawTheaterBase(g);
  rect(g, 0, 34, THEATER_SCREEN_RECT.w, 22, 0x1c2b3d);
  // 背景三根柱 + 一排灯带
  for (let x = 18; x < THEATER_SCREEN_RECT.w; x += 46) rect(g, x, 8, 6, 26, 0x24384f);
  rect(g, 0, 6, THEATER_SCREEN_RECT.w, 2, C.amber);
  rect(g, 62, 34, 132, 6, 0x2a3f56);
  rect(g, 62, 34, 132, 1, C.amber);
  // 底部滚动字幕条
  rect(g, 0, 50, THEATER_SCREEN_RECT.w, 6, 0x0a1524);
  for (let x = 8; x < THEATER_SCREEN_RECT.w - 8; x += 14) rect(g, x, 52, 10, 2, 0x5aa6c9);
}

/** 频道 3 底：复古屏保的静态星空（DVD 方块是动件） */
function drawScreensaverChannel(g: Graphics): void {
  drawTheaterBase(g);
  drawStars(g, 40, 50);
  // 屏幕四角的像素角标，像老显示器
  rect(g, 3, 3, 10, 1, 0x3f6f9e);
  rect(g, 3, 3, 1, 6, 0x3f6f9e);
  rect(g, THEATER_SCREEN_RECT.w - 13, THEATER_SCREEN_RECT.h - 4, 10, 1, 0x3f6f9e);
  rect(g, THEATER_SCREEN_RECT.w - 4, THEATER_SCREEN_RECT.h - 9, 1, 6, 0x3f6f9e);
}

/** 频道 4 底：星夜湖面（小舟是动件） */
function drawBoatChannel(g: Graphics): void {
  drawTheaterBase(g);
  drawStars(g, 26, 24);
  pixelDisc(g, 58, 18, 7, C.cream);
  g.poly([10, 46, 78, 30, 148, 46]).fill(C.hillDeep);
  g.poly([70, 46, 128, 34, 190, 46]).fill(C.hill);
  rect(g, 0, 46, THEATER_SCREEN_RECT.w, 10, 0x0e2a44);
  for (let x = 6; x < THEATER_SCREEN_RECT.w; x += 16) rect(g, x, 48 + ((x / 16) % 2 === 0 ? 0 : 2), 8, 1, 0x2a5478);
}

/** 动件：雪夜列车车厢 */
function drawTrainCar(g: Graphics): void {
  g.ellipse(22, 17, 20, 3).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(0, 6, 44, 10).fill(C.mintDeep);
  g.rect(1, 7, 42, 3).fill(C.mint);
  for (let i = 0; i < 4; i += 1) g.rect(4 + i * 10, 9, 6, 3).fill(C.butter);
  g.rect(2, 16, 6, 2).fill(C.outline);
  g.rect(34, 16, 6, 2).fill(C.outline);
  g.rect(40, 2, 3, 6).fill(C.snow);
}

/** 动件：老板头像两帧（A 眨眼 / B 张嘴） */
function drawBossFace(g: Graphics, mouthOpen: boolean): void {
  g.rect(2, 4, 24, 22).fill(C.peachDeep);
  g.rect(3, 5, 22, 20).fill(C.peach);
  // 头发与领带
  g.rect(3, 3, 22, 5).fill(0x3a2b26);
  g.rect(12, 20, 5, 6).fill(0xd94f4f);
  // 眼睛：A 帧闭成一条线，B 帧瞪圆
  if (mouthOpen) {
    g.rect(8, 12, 4, 4).fill(C.white);
    g.rect(16, 12, 4, 4).fill(C.white);
    g.rect(9, 13, 2, 2).fill(C.outline);
    g.rect(17, 13, 2, 2).fill(C.outline);
  } else {
    g.rect(8, 14, 4, 1).fill(C.outline);
    g.rect(16, 14, 4, 1).fill(C.outline);
  }
  // 嘴：A 帧抿着，B 帧张开发言
  if (mouthOpen) g.rect(11, 18, 6, 3).fill(0x8e2b35);
  else g.rect(11, 19, 6, 1).fill(0x8e2b35);
}

/** 动件：复古屏保的 DVD 方块 */
function drawScreenSaverBlock(g: Graphics): void {
  g.rect(0, 0, 28, 14).fill(C.outline);
  g.rect(1, 1, 26, 12).fill(C.mint);
  g.rect(1, 1, 26, 2).fill(0xd6fff0);
  g.rect(4, 5, 20, 1).fill(C.mintDeep);
  g.rect(4, 8, 13, 1).fill(C.mintDeep);
  g.rect(4, 11, 8, 1).fill(C.mintDeep);
}

/** 动件：湖上小舟 */
function drawBoat(g: Graphics): void {
  g.rect(2, 8, 20, 3).fill(C.outline);
  g.rect(3, 9, 18, 2).fill(0x8a6446);
  g.rect(10, 0, 2, 9).fill(0x543d2c);
  g.poly([12, 1, 22, 8, 12, 8]).fill(C.cream);
}

/** 影厅银幕光晕：三层硬边矩形，越靠外越淡 */
function drawScreenHalo(g: Graphics): void {
  const pad = 10;
  rect(g, 0, 0, THEATER_SCREEN_RECT.w + pad * 2, THEATER_SCREEN_RECT.h + pad * 2, C.white, 0.16);
  rect(g, pad - 4, pad - 4, THEATER_SCREEN_RECT.w + 8, THEATER_SCREEN_RECT.h + 8, C.white, 0.22);
  rect(g, pad, pad, THEATER_SCREEN_RECT.w, THEATER_SCREEN_RECT.h, C.white, 0.32);
}

/** 音箱音符：3×5 点阵，一拍一个符头加符干 */
function drawNote(g: Graphics): void {
  rect(g, 0, 3, 3, 3, C.white);
  rect(g, 3, 0, 1, 4, C.white);
  rect(g, 3, 0, 3, 1, C.white);
}

/** 打卡闪光：四角星 + 外圈十字光 */
function drawFlash(g: Graphics): void {
  rect(g, 6, 0, 1, 13, C.white);
  rect(g, 0, 6, 13, 1, C.white);
  rect(g, 4, 4, 5, 5, C.white);
  rect(g, 5, 2, 3, 9, 0xfff3cc);
  rect(g, 2, 5, 9, 3, 0xfff3cc);
}

/* ------------------------------------------------------------------ *
 * 演出层
 * ------------------------------------------------------------------ */

interface NoteSprite {
  sprite: Sprite;
  seed: number;
  speaker: number;
  side: number;
}

interface FlashSprite {
  sprite: Sprite;
  age: number;
  active: boolean;
}

export class VenuePlay {
  /** 影厅压暗层：由 renderer 挂在 y 排序层之后、昵称之前 */
  readonly dim = new Container();

  private readonly textures: Texture[] = [];
  private readonly bases: Container[] = [];

  private readonly meetingSlide: Sprite;
  private readonly meetingPointer: Sprite;
  /** 待机遮罩：盖在屏上把画面压暗，有人入座时淡出 */
  private readonly meetingCover: Sprite;
  private meetingSeated = 0;
  private meetingSlideIndex = -1;
  private meetingCoverAlpha = IDLE_SCREEN_ALPHA;

  private readonly theaterScreen: Sprite;
  private readonly theaterHalo: Sprite;
  private readonly theaterMover: Sprite;
  private readonly theaterBaseTextures: Record<TheaterChannelId, Texture>;
  private readonly theaterMoverTextures: Record<TheaterChannelId, Texture[]>;
  private readonly notes: NoteSprite[] = [];
  private readonly flashes: FlashSprite[] = [];
  private theaterSeated = 0;
  private theaterLocal = false;
  private theaterChannel = 0;
  private dimAlpha = 0;

  private readonly animate: boolean;
  private nextFlash = 0;

  constructor(renderer: TextureFactory, options: { animate: boolean }) {
    this.animate = options.animate;

    /* ---- 会议室投屏 ---- */
    const slideTextures = [drawSlideGantt, drawSlideGrowth, drawSlidePie].map((draw) =>
      bake(renderer, draw, MEETING_INNER.w, MEETING_INNER.h),
    );
    this.textures.push(...slideTextures);
    this.meetingSlide = new Sprite(slideTextures[0]!);
    this.meetingSlide.position.set(MEETING_SCREEN_RECT.x + MEETING_INNER.x, MEETING_SCREEN_RECT.y + MEETING_INNER.y);

    // 待机遮罩：一块纯暗色，盖住烘焙好的静态投屏；有人入座时淡到 0
    const cover = bake(renderer, (g) => rect(g, 0, 0, MEETING_INNER.w, MEETING_INNER.h, 0x05070c), MEETING_INNER.w, MEETING_INNER.h);
    this.textures.push(cover);
    this.meetingCover = new Sprite(cover);
    this.meetingCover.position.copyFrom(this.meetingSlide.position);
    this.meetingCover.alpha = IDLE_SCREEN_ALPHA;

    const pointer = bake(
      renderer,
      (g) => {
        rect(g, 1, 1, 3, 3, 0xff6f8a);
        rect(g, 0, 2, 5, 1, 0xffb3c1);
        rect(g, 2, 0, 1, 5, 0xffb3c1);
      },
      5,
      5,
    );
    this.textures.push(pointer);
    this.meetingPointer = new Sprite(pointer);
    this.meetingPointer.visible = false;

    const meeting = new Container();
    meeting.addChild(this.meetingSlide, this.meetingPointer, this.meetingCover);
    this.bases.push(meeting);

    /* ---- 影厅大屏 ---- */
    const channelBases: Record<TheaterChannelId, Texture> = {
      train: bake(renderer, drawTrainChannel, THEATER_SCREEN_RECT.w, THEATER_SCREEN_RECT.h),
      boss: bake(renderer, drawBossChannel, THEATER_SCREEN_RECT.w, THEATER_SCREEN_RECT.h),
      screensaver: bake(renderer, drawScreensaverChannel, THEATER_SCREEN_RECT.w, THEATER_SCREEN_RECT.h),
      boat: bake(renderer, drawBoatChannel, THEATER_SCREEN_RECT.w, THEATER_SCREEN_RECT.h),
    };
    this.theaterBaseTextures = channelBases;
    const bossFrames = [
      bake(renderer, (g) => drawBossFace(g, false), 28, 28),
      bake(renderer, (g) => drawBossFace(g, true), 28, 28),
    ];
    this.theaterMoverTextures = {
      train: [bake(renderer, drawTrainCar, 44, 18)],
      boss: bossFrames,
      screensaver: [bake(renderer, drawScreenSaverBlock, 28, 14)],
      boat: [bake(renderer, drawBoat, 24, 12)],
    };
    this.textures.push(
      ...Object.values(channelBases),
      ...bossFrames,
      ...this.theaterMoverTextures.train,
      ...this.theaterMoverTextures.screensaver,
      ...this.theaterMoverTextures.boat,
    );

    this.theaterHalo = new Sprite(bake(renderer, drawScreenHalo, THEATER_SCREEN_RECT.w + 20, THEATER_SCREEN_RECT.h + 20));
    this.theaterHalo.tint = THEATER_CHANNELS[0]!.color;
    this.theaterHalo.position.set(THEATER_SCREEN_RECT.x - 10, THEATER_SCREEN_RECT.y - 10);
    this.theaterHalo.alpha = 0.16;

    this.theaterScreen = new Sprite(channelBases.train);
    this.theaterScreen.position.set(THEATER_SCREEN_RECT.x, THEATER_SCREEN_RECT.y);

    this.theaterMover = new Sprite(this.theaterMoverTextures.train[0]!);
    this.theaterMover.position.set(THEATER_SCREEN_RECT.x + 20, THEATER_SCREEN_RECT.y + 34);

    const theater = new Container();
    theater.addChild(this.theaterHalo, this.theaterScreen, this.theaterMover);
    this.bases.push(theater);

    /* ---- 音箱音符池 ---- */
    const noteTexture = bake(renderer, drawNote, 6, 6);
    this.textures.push(noteTexture);
    for (let i = 0; i < NOTE_COUNT; i += 1) {
      const sprite = new Sprite(noteTexture);
      sprite.anchor.set(0.5, 0.5);
      sprite.visible = false;
      sprite.tint = i % 3 === 0 ? C.butter : C.cream;
      theater.addChild(sprite);
      this.notes.push({ sprite, seed: i * 41 + 7, speaker: i % THEATER_SPEAKERS.length, side: i % 2 === 0 ? -1 : 1 });
    }

    /* ---- 打卡闪光池 ---- */
    const flashTexture = bake(renderer, drawFlash, 13, 13);
    this.textures.push(flashTexture);
    const flashLayer = new Container();
    for (let i = 0; i < FLASH_COUNT; i += 1) {
      const sprite = new Sprite(flashTexture);
      sprite.anchor.set(0.5, 0.5);
      sprite.visible = false;
      flashLayer.addChild(sprite);
      this.flashes.push({ sprite, age: 0, active: false });
    }
    this.bases.push(flashLayer);

    /* ---- 影院压暗层：屏幕下方到南墙，屏幕本身不进暗区 ---- */
    const dimGraphics = new Graphics();
    const room = THEATER_ROOM_RECT;
    const top = THEATER_SCREEN_RECT.y + THEATER_SCREEN_RECT.h;
    const left = room.x + 4;
    const width = room.w - 8;
    const height = Math.max(0, room.y + room.h - top - 4);
    rect(dimGraphics, left, top, width, height, 0x05070c);
    this.dim.addChild(dimGraphics);
    this.dim.alpha = 0;
  }

  /** 把屏幕与闪光挂进 `props.base`（永远在角色脚下），压暗层由 renderer 单独挂 */
  build(base: Container): void {
    for (const layer of this.bases) base.addChild(layer);
  }

  /** 占用计数：会议室决定投屏亮度，影厅决定音符是否起舞 */
  setRoomOccupied(room: 'meeting' | 'theater', count: number): void {
    if (room === 'meeting') this.meetingSeated = Math.max(0, count);
    else this.theaterSeated = Math.max(0, count);
  }

  /** 本地是否坐在影厅座椅：驱动压暗层 */
  setTheaterLocalSeated(seated: boolean): void {
    this.theaterLocal = seated;
  }

  get channelName(): string {
    return theaterChannelAt(this.theaterChannel).name;
  }

  /** 本地换台：返回新频道名，屏幕与光晕主色一起换 */
  cycleChannel(): string {
    this.theaterChannel = (this.theaterChannel + 1) % THEATER_CHANNELS.length;
    const channel = theaterChannelAt(this.theaterChannel);
    this.theaterScreen.texture = this.theaterBaseTextures[channel.id];
    this.theaterMover.texture = this.theaterMoverTextures[channel.id][0]!;
    this.theaterHalo.tint = channel.color;
    return channel.name;
  }

  /** 打卡闪光：在角色头顶放一枚四角星 */
  flashPhoto(x: number, y: number): void {
    const slot = this.flashes[this.nextFlash]!;
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    slot.sprite.position.set(Math.round(x), Math.round(y));
    slot.sprite.visible = true;
    slot.age = 0;
    slot.active = true;
  }

  /** 每帧推进：全部是标量与贴图切换，不分配对象 */
  update(nowMs: number, dtMs: number): void {
    const now = this.animate ? nowMs : 0;

    /* 会议投屏：有人入座才亮，三张幻灯片 4s 一张，激光笔沿板面绕 8 字 */
    const lit = this.meetingSeated > 0;
    const coverTarget = lit ? 0 : IDLE_SCREEN_ALPHA * (0.85 + 0.15 * screenFlicker(11, now));
    this.meetingCoverAlpha = this.animate
      ? approachValue(this.meetingCoverAlpha, coverTarget, dtMs, 180)
      : coverTarget;
    if (this.meetingCover.alpha !== this.meetingCoverAlpha) this.meetingCover.alpha = this.meetingCoverAlpha;
    const index = slideIndex(now, 3, SLIDE_HOLD_MS);
    if (index !== this.meetingSlideIndex) {
      this.meetingSlideIndex = index;
      this.meetingSlide.texture = this.textures[index]!;
    }
    this.meetingPointer.visible = lit;
    if (lit) {
      const px = MEETING_SCREEN_RECT.x + 14 + Math.round((0.5 + 0.5 * Math.sin(now / 1700)) * (MEETING_INNER.w - 28));
      const py = MEETING_SCREEN_RECT.y + 10 + Math.round((0.5 + 0.5 * Math.sin(now / 1100 + 1.2)) * (MEETING_INNER.h - 22));
      this.meetingPointer.position.set(px, py);
    }

    /* 影厅：光晕呼吸 + 动件按频道平移 + 压暗收敛 */
    this.theaterHalo.alpha = 0.1 + screenFlicker(5, now) * 0.08;
    this.updateTheaterMover(now);
    const dimTarget = this.theaterLocal ? THEATER_DIM_ALPHA : 0;
    this.dimAlpha = approachValue(this.dimAlpha, dimTarget, dtMs, THEATER_DIM_TAU);
    if (this.dim.alpha !== this.dimAlpha) this.dim.alpha = this.dimAlpha;

    /* 音符：只有厅里有人时才飘 */
    const notesOn = this.theaterSeated > 0;
    for (const note of this.notes) {
      if (!notesOn) {
        if (note.sprite.visible) note.sprite.visible = false;
        continue;
      }
      if (!note.sprite.visible) note.sprite.visible = true;
      const speaker = THEATER_SPEAKERS[note.speaker]!;
      const rise = noteRise(note.seed, now);
      const x = Math.round(speaker.x + note.side * 7 + noteSway(note.seed, now, 2));
      const y = Math.round(speaker.y - 6 - rise * NOTE_RISE_PX);
      note.sprite.position.set(x, y);
      note.sprite.alpha = noteAlpha(note.seed, now);
    }

    /* 打卡闪光 */
    for (const flash of this.flashes) {
      if (!flash.active) continue;
      flash.age += dtMs;
      const alpha = photoFlashAlpha(flash.age, FLASH_LIFE_MS);
      if (alpha <= 0) {
        flash.active = false;
        flash.sprite.visible = false;
        continue;
      }
      flash.sprite.alpha = alpha;
    }
  }

  private updateTheaterMover(now: number): void {
    const channel = theaterChannelAt(this.theaterChannel);
    const left = THEATER_SCREEN_RECT.x;
    const top = THEATER_SCREEN_RECT.y;
    const w = THEATER_SCREEN_RECT.w;
    const h = THEATER_SCREEN_RECT.h;
    switch (channel.id) {
      case 'train': {
        // 列车 9s 从左驶到右，出屏后从左侧重新进站
        const travel = w + 60;
        const x = left - 44 + ((now / 9000) % 1) * travel;
        this.theaterMover.position.set(Math.round(x), top + h - 24);
        return;
      }
      case 'boss': {
        // 两帧鬼畜：睁眼 / 张嘴交替，整体上下各 2px 台阶
        const frame = Math.floor(now / 240) % 2;
        this.theaterMover.texture = this.theaterMoverTextures.boss[frame]!;
        const bob = Math.floor(now / 480) % 2 === 0 ? 0 : 2;
        this.theaterMover.position.set(left + Math.round(w / 2) - 14, top + h - 34 + bob);
        return;
      }
      case 'screensaver': {
        // DVD 方块：两个方向各自三角波，整数坐标贴边反弹
        const spanX = w - 30;
        const spanY = h - 18;
        const x = left + 1 + Math.round(pingPong(now / 6400) * spanX);
        const y = top + 2 + Math.round(pingPong(now / 4300 + 0.37) * spanY);
        this.theaterMover.position.set(x, y);
        return;
      }
      default: {
        // 小舟左右各 8px 轻摆，与 `boat` 频道的湖面同高
        const sway = Math.round(Math.sin(now / 2600) * 8);
        this.theaterMover.position.set(left + Math.round(w / 2) - 12 + sway, top + h - 20);
      }
    }
  }

  destroy(): void {
    this.dim.destroy({ children: true });
    for (const texture of this.textures) texture.destroy(true);
    this.textures.length = 0;
    this.bases.length = 0;
    this.notes.length = 0;
    this.flashes.length = 0;
  }
}

/** 构造期小贴图：nearest 采样 + 关抗锯齿，和 terrain / venue-art 同一套参数 */
function bake(renderer: TextureFactory, draw: (g: Graphics) => void, width: number, height: number): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, width, height),
    resolution: 1,
    antialias: false,
    textureSourceOptions: { scaleMode: 'nearest' },
  });
  g.destroy();
  return texture;
}
