/**
 * 摸鱼大赌场（DICE_HALL）：游乐区西端的开放式豪华亭子 + 两张 6 人绿绒赌桌。
 *
 * 与 layout.ts 同一条纪律：坐标全部手写，不依赖 Math.random / Math.sin / Math.cos，
 * 服务端裁决、客户端渲染与布局测试共用这一份真相。
 *
 * ADR-0097 把赌场从西侧草地搬进游乐区：占游乐大街西端（x 2600–3020 / y 2620–3020），
 * 南侧铺装直接落在街面上，往东一条街就是游乐园南门与八角笼。
 */

import { DIRECTION } from '../constants';
import type { SeatInstance, SolidRect } from './campus';
import type { WorldRect } from './geometry';

/** 亭子整体占地：也是小地图上的建筑填色块 */
export const DICE_HALL: WorldRect = { x: 2600, y: 2620, w: 420, h: 400 };

/** 亭心：招牌与灯串围绕它对称摆放 */
export const DICE_HALL_CENTER = { x: DICE_HALL.x + DICE_HALL.w / 2, y: DICE_HALL.y + 190 } as const;

/** 南侧迎宾铺装：把亭子接到游乐大街 */
export const DICE_HALL_APRON: WorldRect = {
  x: DICE_HALL.x + 118,
  y: DICE_HALL.y + 380,
  w: 184,
  h: 76,
};

/** 北侧吧台与霓虹招牌底座：只挡柜台那一截，人在柜前点单 */
export const DICE_HALL_BAR: WorldRect = {
  x: DICE_HALL.x + 80,
  y: DICE_HALL.y + 34,
  w: 260,
  h: 30,
};

/** 六根朱红廊柱：南北各两根，东西居中各一根，中间留空让人走向赌桌 */
export const DICE_HALL_COLUMNS: ReadonlyArray<{ x: number; y: number }> = [
  { x: DICE_HALL.x + 28, y: DICE_HALL.y + 36 },
  { x: DICE_HALL.x + 392, y: DICE_HALL.y + 36 },
  { x: DICE_HALL.x + 28, y: DICE_HALL.y + 320 },
  { x: DICE_HALL.x + 392, y: DICE_HALL.y + 320 },
  { x: DICE_HALL.x + 28, y: DICE_HALL.y + 178 },
  { x: DICE_HALL.x + 392, y: DICE_HALL.y + 178 },
];

export const DICE_HALL_SOLIDS: ReadonlyArray<SolidRect> = [
  { kind: 'prop', ...DICE_HALL_BAR },
  ...DICE_HALL_COLUMNS.map((column) => ({
    kind: 'prop' as const,
    x: column.x - 7,
    y: column.y - 7,
    w: 14,
    h: 14,
  })),
];

/** 一张赌桌：id / 座位组 / 显示名 / 桌面矩形（中心点 + 尺寸） */
export interface DiceTableSpec {
  readonly id: number;
  readonly group: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 两张桌横向并排，桌心相距 180：6 人一圈坐下不会和邻桌挤在一起。
 *
 * 桌心离亭子东西边各留 120，把左右两张圆凳从「东西居中廊柱」的 14px 柱脚外侧让开
 * （廊柱在 x+28 / x+392，柱脚半宽 7）：旧值 105/315 会让最外侧凳子压进柱脚。
 */
export const DICE_TABLES: ReadonlyArray<DiceTableSpec> = [
  { id: 0, group: 'dice-a', name: '翡翠桌', x: DICE_HALL.x + 120, y: DICE_HALL_CENTER.y, w: 100, h: 68 },
  { id: 1, group: 'dice-b', name: '鎏金桌', x: DICE_HALL.x + 300, y: DICE_HALL_CENTER.y, w: 100, h: 68 },
];

/** 桌面碰撞：两张桌各自一块，桌沿外留出座位的落地空间 */
export const DICE_TABLE_SOLIDS: ReadonlyArray<SolidRect> = DICE_TABLES.map((table) => ({
  kind: 'desk' as const,
  x: table.x - table.w / 2,
  y: table.y - table.h / 2,
  w: table.w,
  h: table.h,
}));

/** 每桌 6 个座位（左 / 右 / 上二 / 下二），全部是圆凳 */
export const DICE_SEATS_PER_TABLE = 6;

function tableSeats(table: DiceTableSpec): Array<Omit<SeatInstance, 'id' | 'desk'>> {
  const { x, y, group } = table;
  return [
    { x: x - 66, y, facing: DIRECTION.Right, kind: 'stool', group },
    { x: x + 66, y, facing: DIRECTION.Left, kind: 'stool', group },
    { x: x - 30, y: y - 58, facing: DIRECTION.Down, kind: 'stool', group },
    { x: x + 30, y: y - 58, facing: DIRECTION.Down, kind: 'stool', group },
    { x: x - 30, y: y + 58, facing: DIRECTION.Up, kind: 'stool', group },
    { x: x + 30, y: y + 58, facing: DIRECTION.Up, kind: 'stool', group },
  ];
}

/** 12 个赌桌座位：接在既有座位表末尾，id 由 layout.ts 统一分配 */
export const DICE_HALL_SEAT_DRAFTS: ReadonlyArray<Omit<SeatInstance, 'id' | 'desk'>> =
  DICE_TABLES.flatMap(tableSeats);

/** 按 id 取赌桌；越界返回 undefined */
export function diceTableById(id: number): DiceTableSpec | undefined {
  return DICE_TABLES.find((table) => table.id === id);
}

/** 按座位组取赌桌 */
export function diceTableByGroup(group: string): DiceTableSpec | undefined {
  return DICE_TABLES.find((table) => table.group === group);
}

/* ------------------------------------------------------------------ *
 * 公共局规则（服务端权威）
 *
 * 每局三段：10 秒下注 → 1.5 秒摇骰演出 → 4 秒亮牌结算。
 * 结算用彩池：命中档位按注额比例分走全池，0% 抽水，货币不增发；
 * 命中档位无人下注时全额退款（不算赢也不算输）。
 * 每局 5% 概率触发保安查岗彩蛋：命中者分到的彩池再被抽走 5%。
 * ------------------------------------------------------------------ */

export const DICE_BET_MS = 10_000;
export const DICE_ROLL_MS = 1_500;
export const DICE_REVEAL_MS = 4_000;
export const DICE_MIN_BET = 10;
export const DICE_MAX_BET = 500;
/** 保安查岗概率（每局独立掷一次） */
export const DICE_GUARD_RAID_CHANCE = 0.05;
/** 查岗抽水比例 */
export const DICE_RAID_TAKE = 0.05;

/** 押注档位：线协议 u8 */
export const DICE_SIDE = {
  Big: 0,
  Small: 1,
  Leopard: 2,
} as const;
export type DiceSide = (typeof DICE_SIDE)[keyof typeof DICE_SIDE];

export const DICE_SIDE_NAME: Record<number, string> = {
  [DICE_SIDE.Big]: '大',
  [DICE_SIDE.Small]: '小',
  [DICE_SIDE.Leopard]: '豹子',
};

/** 局内阶段：0 等待开局 / 1 下注 / 2 摇骰 / 3 亮牌 */
export const DICE_PHASE = {
  Idle: 0,
  Betting: 1,
  Rolling: 2,
  Reveal: 3,
} as const;
export type DicePhase = (typeof DICE_PHASE)[keyof typeof DICE_PHASE];

/** 三颗骰子：豹子优先，其余按点数和 11 以上为大、10 以下为小 */
export function classifyDice(a: number, b: number, c: number): DiceSide {
  if (a === b && b === c) return DICE_SIDE.Leopard;
  return a + b + c >= 11 ? DICE_SIDE.Big : DICE_SIDE.Small;
}

/**
 * 确定性摇骰：给定种子得到三颗 1–6。
 *
 * **只给单测与确定性回放用，运行时不再调用**（ADR-0104）：局号会随
 * `S2C_DICE_STATE` 下发，用局号推导骰面等于把答案提前告诉改包客户端。
 * 正式开局由 `DiceHallRuntime` 注入服务端随机源。
 */
export function rollDice(seed: number): [number, number, number] {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x51ed270b) >>> 0;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state % 6) + 1;
  };
  return [next(), next(), next()];
}

/** 把「命中档位 + 总池」拆成每人应得：整数余数按注额降序、id 升序兜底，保证确定性 */
export function splitPool(
  winners: ReadonlyArray<{ id: number; amount: number }>,
  pool: number,
): Array<{ id: number; amount: number }> {
  const total = Math.max(0, Math.floor(pool));
  const stake = winners.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.amount)), 0);
  if (stake <= 0 || total <= 0) return [];
  const sorted = [...winners].sort((a, b) => b.amount - a.amount || a.id - b.id);
  const out = sorted.map((entry) => ({
    id: entry.id,
    amount: Math.floor((total * Math.max(0, Math.floor(entry.amount))) / stake),
  }));
  let assigned = out.reduce((sum, entry) => sum + entry.amount, 0);
  for (const entry of out) {
    if (assigned >= total) break;
    entry.amount += 1;
    assigned += 1;
  }
  return out;
}
