/**
 * 弱交互场所的「本地点」唯一真相（纯函数，不 import pixi，可直接 `bun:test`）。
 *
 * 会议室 / 家庭影音室 / 游乐园 / 摸鱼亭四处此前只有建筑没有玩法：
 * 这里把「站在哪儿按 F」「坐在哪张椅子上算开会 / 看电影 / 发呆」以及台词
 * 全部收敛成一份可测数据，`interactions.ts` 出提示、`session.ts` 分发按键、
 * `venue-play.ts` 画演出，三处读同一张表，不会再出现「提示说能按、按下去没反应」。
 *
 * 两条纪律：
 * 1) **不写第二份坐标**：屏幕矩形由 `MEETING_ROOM` / `THEATER_SCREEN` 派生，
 *    游乐园打卡点由 `PARK_RIDES` / `PARK_ATTRACTIONS` 派生，亭心读 `PAVILION_CENTER`。
 * 2) **不改共享契约**：本文件只读 `WORLD_LAYOUT`，不新增热区、不碰碰撞与协议；
 *    因此服务端零改动，也不需要双端同步发布。
 */

import {
  AMUSEMENT_PARK,
  PARK_ATTRACTIONS,
  PARK_RIDES,
  PAVILION_CENTER,
  THEATER_SCREEN,
  WORLD_LAYOUT,
  rectContains,
  type SeatInstance,
  type WorldRect,
} from '@niuma/shared-types';

/* ------------------------------------------------------------------ *
 * 房间矩形：`MEETING_ROOM` / `HOME_THEATER` 只在 shared-types 内部流转，
 * 客户端历来按显示名从 `WORLD_LAYOUT.buildings` 反查（同 interior-art / venue-lights），
 * 这里沿用同一把稳定键，不新增导出、不动共享契约。
 * ------------------------------------------------------------------ */

function roomRectOf(name: string): WorldRect {
  const building = WORLD_LAYOUT.buildings.find((item) => item.name === name);
  if (!building) throw new Error(`布局里缺少房间 ${name}`);
  return building.rect;
}

/** 会议室：8 把会议椅、北墙投屏与「按 F 发言」都在这个矩形里 */
export const MEETING_ROOM_RECT: WorldRect = roomRectOf('会议室');
/** 家庭影音室：15 张影厅座椅与四只音箱在这个矩形里 */
export const THEATER_ROOM_RECT: WorldRect = roomRectOf('家庭影音室');

/* ------------------------------------------------------------------ *
 * 屏幕矩形：会议投屏与影厅大屏的内屏，渲染层与演出层共用这一份
 * ------------------------------------------------------------------ */

/** 会议室北墙投屏：200×56 居中，`interior-art.ts` 与本模块的叠层都读它 */
export const MEETING_SCREEN_RECT: WorldRect = {
  x: MEETING_ROOM_RECT.x + (MEETING_ROOM_RECT.w - 200) / 2,
  y: MEETING_ROOM_RECT.y + 2,
  w: 200,
  h: 56,
};

/** 影厅大屏可见画面：从共享矩形内缩 2px 的边框 */
export const THEATER_SCREEN_RECT: WorldRect = {
  x: THEATER_SCREEN.x + 2,
  y: THEATER_SCREEN.y + 2,
  w: THEATER_SCREEN.w - 4,
  h: THEATER_SCREEN.h - 4,
};

/** 点击命中：影厅大屏整块画面（换台用），与 `session.onStageClick` 的世界坐标同一把尺 */
export function isTheaterScreenHit(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return rectContains(THEATER_SCREEN, x, y);
}

/* ------------------------------------------------------------------ *
 * 影厅频道：4 个固定频道，纯本地切换，不进协议
 * ------------------------------------------------------------------ */

export type TheaterChannelId = 'train' | 'boss' | 'screensaver' | 'boat';

export interface TheaterChannel {
  readonly id: TheaterChannelId;
  readonly name: string;
  /** 屏幕光晕与频道色的主色（0xRRGGBB） */
  readonly color: number;
}

export const THEATER_CHANNELS: ReadonlyArray<TheaterChannel> = [
  { id: 'train', name: '雪夜列车', color: 0x7fd6ff },
  { id: 'boss', name: '老板鬼畜', color: 0xffb27a },
  { id: 'screensaver', name: '复古屏保', color: 0x9fe6b0 },
  { id: 'boat', name: '星夜小舟', color: 0xa9c6ff },
];

/** 按序号取频道（自动回环），负数也能安全取到 */
export function theaterChannelAt(index: number): TheaterChannel {
  const list = THEATER_CHANNELS;
  const safe = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return list[safe % list.length]!;
}

/* ------------------------------------------------------------------ *
 * 座位归属：构造期建四张 id 表，帧循环只做一次 Set 命中
 * ------------------------------------------------------------------ */

function inside(rect: WorldRect, x: number, y: number): boolean {
  return rectContains(rect, x, y);
}

function collectSeats(accept: (seat: SeatInstance) => boolean): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const seat of WORLD_LAYOUT.seats) if (accept(seat)) ids.add(seat.id);
  return ids;
}

/** 会议椅：会议室内的普通椅子（工位椅在另一栋楼，不会被误认） */
const MEETING_SEAT_IDS = collectSeats(
  (seat) => seat.kind === 'chair' && inside(MEETING_ROOM_RECT, seat.x, seat.y),
);

/** 影厅座椅：`cinema` 只出现在家庭影音室 */
const THEATER_SEAT_IDS = collectSeats(
  (seat) => seat.kind === 'cinema' && inside(THEATER_ROOM_RECT, seat.x, seat.y),
);

/** 石鼓凳：四张全在摸鱼亭 */
const PAVILION_SEAT_IDS = collectSeats(
  (seat) => seat.kind === 'drum' && Math.abs(seat.x - PAVILION_CENTER.x) <= 60 && Math.abs(seat.y - PAVILION_CENTER.y) <= 60,
);

/** 园内长椅：`bench` 遍布全图，只有落在游乐园里的这几张算「童年回忆」 */
const PARK_BENCH_SEAT_IDS = collectSeats(
  (seat) => seat.kind === 'bench' && inside(AMUSEMENT_PARK, seat.x, seat.y),
);

export function isMeetingSeat(seatId: number): boolean {
  return Number.isInteger(seatId) && MEETING_SEAT_IDS.has(seatId);
}

export function isTheaterSeat(seatId: number): boolean {
  return Number.isInteger(seatId) && THEATER_SEAT_IDS.has(seatId);
}

export function isPavilionSeat(seatId: number): boolean {
  return Number.isInteger(seatId) && PAVILION_SEAT_IDS.has(seatId);
}

export function isParkBenchSeat(seatId: number): boolean {
  return Number.isInteger(seatId) && PARK_BENCH_SEAT_IDS.has(seatId);
}

/** 房间占用计数用：某座位计入哪一处演出（会议室投屏 / 影厅开场） */
export type VenueRoom = 'meeting' | 'theater';

export function venueRoomOfSeat(seatId: number): VenueRoom | null {
  if (isMeetingSeat(seatId)) return 'meeting';
  if (isTheaterSeat(seatId)) return 'theater';
  return null;
}

/** 供调试与单测读取，不参与帧循环 */
export const VENUE_SEAT_GROUPS = {
  meeting: MEETING_SEAT_IDS,
  theater: THEATER_SEAT_IDS,
  pavilion: PAVILION_SEAT_IDS,
  parkBench: PARK_BENCH_SEAT_IDS,
} as const;

/* ------------------------------------------------------------------ *
 * 本地点：坐姿类在前，游乐园打卡点在后
 * ------------------------------------------------------------------ */

export type VenueSpotKind = 'meeting' | 'theater' | 'pavilion' | 'parkPhoto';

export interface VenueSpot {
  readonly kind: VenueSpotKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /**
   * 是否需要先坐在指定种类的座位上。
   * 坐姿类一律 true：站立时把提示让给「按 Z 坐下」，站位类（打卡点）为 false。
   */
  readonly seatGated: boolean;
}

/** 会议桌中心：投屏演出与「按 F 发言」都从房间矩形派生，不手写第二份 */
export const MEETING_SPOT: VenueSpot = {
  kind: 'meeting',
  x: MEETING_ROOM_RECT.x + MEETING_ROOM_RECT.w / 2,
  y: MEETING_ROOM_RECT.y + MEETING_ROOM_RECT.h / 2,
  radius: 130,
  seatGated: true,
};

export const PAVILION_SPOT: VenueSpot = {
  kind: 'pavilion',
  x: PAVILION_CENTER.x,
  y: PAVILION_CENTER.y,
  radius: 90,
  seatGated: true,
};

/** 影厅：坐进任意一张 cinema 座椅即成立，坐标取屏幕下沿（提示与演出同一处） */
export const THEATER_SPOT: VenueSpot = {
  kind: 'theater',
  x: THEATER_SCREEN_RECT.x + THEATER_SCREEN_RECT.w / 2,
  y: THEATER_SCREEN_RECT.y + THEATER_SCREEN_RECT.h,
  radius: 0,
  seatGated: true,
};

/**
 * 游乐园打卡点：五处器械旁各一个，半径 56。
 * 与园内两处长椅的坐点保持 ≥150px，保证「按 F 拍照」永远不会顶掉「按 Z 坐下」。
 */
export const PARK_PHOTO_SPOTS: ReadonlyArray<VenueSpot> = [
  ...PARK_RIDES.map(
    (ride): VenueSpot => ({ kind: 'parkPhoto', x: ride.x, y: ride.y, radius: 56, seatGated: false }),
  ),
  ...PARK_ATTRACTIONS.filter((item) => item.kind === 'sandpit' || item.kind === 'fountain').map(
    (item): VenueSpot => ({
      kind: 'parkPhoto',
      x: item.x,
      y: item.y + item.h / 4,
      radius: 56,
      seatGated: false,
    }),
  ),
];

/** 顺序即优先级：坐姿类先命中，站着时落到打卡点 */
const SPOTS: ReadonlyArray<VenueSpot> = [MEETING_SPOT, PAVILION_SPOT, THEATER_SPOT, ...PARK_PHOTO_SPOTS];

function withinSpot(spot: VenueSpot, x: number, y: number): boolean {
  const dx = spot.x - x;
  const dy = spot.y - y;
  return dx * dx + dy * dy <= spot.radius * spot.radius;
}

/**
 * 当前站位该给哪一条本地点。
 *
 * 坐姿类只看 `seatId`（入座即代表位置），站位类才做距离判定；
 * `seatId = 0` 表示没坐下。
 */
export function venueSpotAt(x: number, y: number, seatId: number): VenueSpot | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const spot of SPOTS) {
    if (!spot.seatGated) continue;
    if (spot.kind === 'meeting' && isMeetingSeat(seatId)) return spot;
    if (spot.kind === 'theater' && isTheaterSeat(seatId)) return spot;
    if (spot.kind === 'pavilion' && isPavilionSeat(seatId)) return spot;
  }
  for (const spot of SPOTS) {
    if (spot.seatGated) continue;
    if (withinSpot(spot, x, y)) return spot;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 台词：按次数轮转，同一计数永远同一句（便于单测与复现）
 * ------------------------------------------------------------------ */

/** 会议专属气泡：职场黑话，只做情绪表达，不带数值 */
export const MEETING_LINES: ReadonlyArray<string> = [
  '💼 赋能一下底层逻辑',
  '📋 这个需求很简单',
  '🗓️ 先拉个对齐会',
  '🔍 对齐一下颗粒度',
  '📈 这个排期没问题吧',
  '🚀 先做个 MVP，下周上线',
  '✍️ 记笔记：点头.gif',
  '🧩 闭环了，散会',
];

/** 摸鱼亭禅意气泡 */
export const ZEN_LINES: ReadonlyArray<string> = [
  '🎣 摸鱼发呆中…',
  '🌊 看着水面思考牛马生',
  '🍃 风把 KPI 吹走了',
  '💭 水面比需求清楚',
  '☕ 再坐一会儿，反正也没人找',
];

/** 游乐园打卡台词：F 拍照用 */
export const PHOTO_LINES: ReadonlyArray<string> = [
  '📸 咔！童年回忆 +1',
  '😌 小时候的秋千还在这儿',
  '🎠 旋转木马转了二十年还没停',
  '🪙 那时候一包辣条就很快乐',
];

/** 园内长椅上的怀旧感叹：静置自动冒 */
export const RETRO_LINES: ReadonlyArray<string> = [
  '🎡 当年排队坐摩天轮排了一下午',
  '🍦 冰淇淋化在手上也舍不得扔',
  '🎈 现在听着广播都觉得回到小时候',
  '🌤️ 坐着就好，不用长大',
];

/** 按次数取台词：与设施台词同一套轮转口径 */
export function pickVenueLine(lines: ReadonlyArray<string>, counter: number): string {
  const index = Number.isFinite(counter) ? Math.abs(Math.trunc(counter)) % lines.length : 0;
  return lines[index]!;
}

/* ------------------------------------------------------------------ *
 * 静置气泡节流：与 `snoreDue` 同构（躺床打呼的现成范式）
 * ------------------------------------------------------------------ */

export type VenueIdleKind = 'meeting' | 'pavilion' | 'parkBench';

interface IdleTiming {
  /** 入座后第一条气泡要静置多久 */
  readonly firstMs: number;
  /** 之后每隔多久再来一条 */
  readonly intervalMs: number;
}

export const VENUE_IDLE_TIMING: Readonly<Record<VenueIdleKind, IdleTiming>> = {
  meeting: { firstMs: 6000, intervalMs: 11000 },
  pavilion: { firstMs: 7000, intervalMs: 13000 },
  parkBench: { firstMs: 8000, intervalMs: 15000 },
};

/**
 * 这一刻该不该自动冒气泡。
 * `idleMs` 是坐下来后经过的时间（起身 / 移动会把它清零），`sinceMs` 是距上一条的时间。
 */
export function venueBubbleDue(kind: VenueIdleKind, idleMs: number, sinceMs: number): boolean {
  const timing = VENUE_IDLE_TIMING[kind];
  if (!timing) return false;
  if (!Number.isFinite(idleMs) || !Number.isFinite(sinceMs)) return false;
  if (idleMs < timing.firstMs) return false;
  return sinceMs >= timing.intervalMs;
}

/** 入座座位 → 静置气泡种类（不是这三处返回 null） */
export function idleKindOfSeat(seatId: number): VenueIdleKind | null {
  if (isMeetingSeat(seatId)) return 'meeting';
  if (isPavilionSeat(seatId)) return 'pavilion';
  if (isParkBenchSeat(seatId)) return 'parkBench';
  return null;
}

/** 静置气泡种类 → 台词表：自动冒的那一句走这里，不另写一份 */
export function linesOfIdleKind(kind: VenueIdleKind): ReadonlyArray<string> {
  switch (kind) {
    case 'meeting':
      return MEETING_LINES;
    case 'pavilion':
      return ZEN_LINES;
    default:
      return RETRO_LINES;
  }
}
