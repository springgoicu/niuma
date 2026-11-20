/**
 * Phase 2-4 像素职场 GTA 全岛新地标、消星点、钓鱼台、涂鸦墙与零工站点。
 *
 * 严格约束：
 * - 所有坐标严格避开湖水、花海（FLOWER_FIELDS）、既定道路走廊、现有建筑与树种碰撞；
 * - 碰撞盒统一使用 `'prop'` / `'wall'`（不占用 `'desk'` 类型以保持工位计数契约）。
 */

import type { SolidRect } from './campus';
import type { WorldRect } from './geometry';

export interface ChangingBoothSpec {
  readonly id: string;
  readonly name: string;
  readonly rect: WorldRect;
  readonly hotspot: { readonly x: number; readonly y: number; readonly radius: number };
}

/** 街头换装亭（2 处）：付费 60 币秒换工牌洗白，解除 1~3★ 巡逻追踪 */
export const CHANGING_BOOTHS: ReadonlyArray<ChangingBoothSpec> = [
  {
    id: 'booth-plaza',
    name: '东广场速换亭',
    rect: { x: 4330, y: 3840, w: 44, h: 44 },
    hotspot: { x: 4352, y: 3902, radius: 68 },
  },
  {
    id: 'booth-neon',
    name: '霓虹街变装亭',
    rect: { x: 3570, y: 2870, w: 44, h: 44 },
    hotspot: { x: 3592, y: 2932, radius: 68 },
  },
];

/** 兼容单亭引用的主换装亭 */
export const CHANGING_BOOTH = CHANGING_BOOTHS[0]!;

/** 全园地产总览公告牌：生活大街北入口旁，按 F 打开实时 8 处产业投资面板 */
export const ESTATE_BOARD = {
  id: 'estate-board',
  name: '地产总览牌',
  rect: { x: 3930, y: 4620, w: 72, h: 38 } as WorldRect,
  hotspot: { x: 3966, y: 4676, radius: 76 },
} as const;

/** 老板私房钱金库牌：企业楼东侧前庭北翼 */
export const BOSS_VAULT = {
  id: 'boss-vault',
  name: '老板保险库',
  rect: { x: 3590, y: 3320, w: 52, h: 44 } as WorldRect,
  hotspot: { x: 3616, y: 3382, radius: 72 },
} as const;

/** 跑腿外卖零工接单台：企业前庭南侧平地（无实体碰撞，可踩上接单） */
export const LOADING_DOCK = {
  id: 'loading-dock',
  name: '快递零工装卸台',
  rect: { x: 3580, y: 3740, w: 80, h: 52 } as WorldRect,
  hotspot: { x: 3620, y: 3766, radius: 72 },
} as const;

/** 保安巡逻亭与警用电动车库：服务区东南角（让开 (5200, 4212) 花箱与东路） */
export const SECURITY_GARAGE = {
  id: 'security-garage',
  name: '保安亭与巡逻车库',
  rect: { x: 5230, y: 4240, w: 180, h: 120 } as WorldRect,
  solidWall: { x: 5230, y: 4240, w: 180, h: 44 } as WorldRect,
  hotspot: { x: 5320, y: 4316, radius: 84 },
} as const;

export interface PayphoneSpec {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** 2 处公用电话亭：按 F 花 90 币拨通神秘内线抹平任意通缉星级 */
export const PAYPHONES: ReadonlyArray<PayphoneSpec> = [
  { id: 'payphone-neon', name: '霓虹街公用电话', x: 3720, y: 2910, radius: 64 },
  { id: 'payphone-service', name: '服务广场公用电话', x: 4610, y: 4180, radius: 64 },
];

export interface FishingPierSpec {
  readonly id: number;
  readonly name: string;
  readonly rect: WorldRect;
  readonly castSpot: { readonly x: number; readonly y: number };
  readonly radius: number;
}

/** 3 处临湖木栈道钓鱼台：摸鱼湖 / 沉思浅塘 / 涟漪湖 */
export const FISHING_PIERS: ReadonlyArray<FishingPierSpec> = [
  {
    id: 0,
    name: '摸鱼湖北栈道',
    rect: { x: 5140, y: 4930, w: 56, h: 44 },
    castSpot: { x: 5168, y: 4952 },
    radius: 76,
  },
  {
    id: 1,
    name: '沉思塘西栈桥',
    rect: { x: 4840, y: 2920, w: 48, h: 52 },
    castSpot: { x: 4862, y: 2946 },
    radius: 76,
  },
  {
    id: 2,
    name: '涟漪湖北栈桥',
    rect: { x: 2780, y: 4576, w: 52, h: 42 },
    castSpot: { x: 2806, y: 4596 },
    radius: 76,
  },
];

export interface GraffitiWallSpec {
  readonly wallId: number;
  readonly name: string;
  readonly district: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** 全园 12 面可抢占街头涂鸦墙：占领即时奖 +35 币，每分钟产生街区涂鸦分红 */
export const GRAFFITI_WALLS: ReadonlyArray<GraffitiWallSpec> = [
  { wallId: 0, name: '夜店霓虹影壁', district: '游乐区', x: 2860, y: 3110, radius: 68 },
  { wallId: 1, name: '游乐园西砖墙', district: '游乐区', x: 3820, y: 2910, radius: 68 },
  { wallId: 2, name: '游乐园东外壁', district: '游乐区', x: 4460, y: 2940, radius: 68 },
  { wallId: 3, name: '沉思石壁画框', district: '景观区', x: 4860, y: 2560, radius: 68 },
  { wallId: 4, name: '企业北墙文化栏', district: '企业区', x: 3120, y: 3180, radius: 68 },
  { wallId: 5, name: '前庭工牌宣言墙', district: '企业区', x: 3680, y: 3560, radius: 68 },
  { wallId: 6, name: '西阙门街头画壁', district: '广场区', x: 3760, y: 3900, radius: 68 },
  { wallId: 7, name: '服务广场涂鸦板', district: '服务区', x: 4600, y: 3960, radius: 68 },
  { wallId: 8, name: '急诊南院墙角', district: '服务区', x: 5360, y: 3890, radius: 68 },
  { wallId: 9, name: '生活大街宣传墙', district: '生活区', x: 4220, y: 5216, radius: 68 },
  { wallId: 10, name: '公寓东侧涂鸦壁', district: '生活区', x: 3780, y: 4760, radius: 68 },
  { wallId: 11, name: '摸鱼东院花砖壁', district: '生活区', x: 4856, y: 5460, radius: 68 },
];

/** 街头零工任务随机交付坐标点（全部落在陆地且可到达的非封闭路段） */
export const GIG_DROP_POINTS: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number }> = [
  { name: '中央迎宾广场北缘', x: 4160, y: 3860 },
  { name: '游乐园南门喷泉前', x: 4096, y: 2940 },
  { name: '不夜城夜店门口', x: 2860, y: 2990 },
  { name: '牛马 301 公寓前阶', x: 3410, y: 4920 },
  { name: '摸鱼一号院院门前', x: 4430, y: 5586 },
  { name: '护士急救站大厅', x: 5176, y: 3746 },
  { name: '翠竹隐士居竹影前', x: 3165, y: 4476 },
  { name: '沉思畔茶院门口', x: 5070, y: 2720 },
];

/** GTA 新增实心地标碰撞盒（不含桌类，全部为 `'prop'` / `'wall'`） */
export const GTA_LANDMARK_SOLIDS: ReadonlyArray<SolidRect> = [
  ...CHANGING_BOOTHS.map((b) => ({ kind: 'prop' as const, x: b.rect.x, y: b.rect.y, w: b.rect.w, h: b.rect.h })),
  { kind: 'prop', ...ESTATE_BOARD.rect },
  { kind: 'prop', ...BOSS_VAULT.rect },
  { kind: 'wall', ...SECURITY_GARAGE.solidWall },
  ...PAYPHONES.map((p) => ({ kind: 'prop' as const, x: p.x - 14, y: p.y - 14, w: 28, h: 16 })),
  ...GRAFFITI_WALLS.map((w) => ({ kind: 'prop' as const, x: w.x - 18, y: w.y - 12, w: 36, h: 12 })),
];

/** 供 `isPlantable` 留白的全部平地与建筑占地 */
export const GTA_EXCLUSION_RECTS: ReadonlyArray<WorldRect> = [
  ...CHANGING_BOOTHS.map((b) => b.rect),
  ESTATE_BOARD.rect,
  BOSS_VAULT.rect,
  LOADING_DOCK.rect,
  SECURITY_GARAGE.rect,
  ...FISHING_PIERS.map((p) => p.rect),
  ...PAYPHONES.map((p) => ({ x: p.x - 20, y: p.y - 20, w: 40, h: 36 })),
  ...GRAFFITI_WALLS.map((w) => ({ x: w.x - 26, y: w.y - 22, w: 52, h: 32 })),
];
