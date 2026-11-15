/**
 * 室内本地交互点（纯数据，不碰 Pixi / DOM / 协议）。
 *
 * 为什么不去 `packages/shared-types` 加 `PropKind` 或 `HotspotKind`：
 * 打印机、零食推车、白板立架、洗手台这些陈设**没有碰撞**，也没有服务端玩法，
 * 加了就要双端一起发版，还会让 `WORLD_HOTSPOTS` 变成「美术清单」。
 * 因此这里只放客户端自己的一份表，按 F 的效果全部留在本地（对齐售货机气泡的做法）。
 *
 * 两条纪律：
 * 1. 坐标一律由共享常量派生（房间矩形 + 与 `interior-art.ts` 共用的落点偏移），
 *    绘制点与交互点不会各写一份 offset；
 * 2. 查询接口是槽位式的（`nearestInteriorSpotInto`），帧循环 / 提示刷新里零分配。
 */

import { JAIL_ANCHOR, WORLD_LAYOUT, type BuildingSpec, type Species, type WorldRect } from '@niuma/shared-types';

/**
 * 感应半径：比设施（`INTERACT_RANGE = 56`）小一档。
 * 工位热区半径 96、座位吸附 90，室内陈设又都贴着桌/墙，
 * 感应圈再大就会把「按 F 开工」抢成「按 F 摸鱼」。
 */
export const INTERIOR_SPOT_RANGE = 56;

export type InteriorSpotKind =
  | 'printer'
  | 'snackCart'
  | 'whiteboard'
  /** 洗手台 + 头顶那面镜子：同一个站位，两种反馈轮换（见 `interiorSpotAction`） */
  | 'vanity'
  | 'dryer'
  | 'wardrobe'
  | 'bookshelf'
  | 'clock'
  | 'snowWindow'
  | 'cellBench';

export interface InteriorSpotDef {
  readonly id: string;
  readonly kind: InteriorSpotKind;
  readonly x: number;
  readonly y: number;
  /** 感应半径：贴柜 / 贴墙的小件给 44，整面镜子 / 雪窗给 52+ */
  readonly radius: number;
}

/**
 * 工作区陈设落点（相对房间左上角）：
 * 绘制（`interior-art.ts` 的 `furnishWorkroom`）与交互点共用这一份，
 * 改一个数字两处同时跟着走。
 */
export const WORK_DECOR = {
  boxes: { dx: 232, dy: 338 },
  printer: { dx: 272, dy: 338 },
  cart: { dx: 318, dy: 338 },
  floorLamp: { dx: 440, dy: 40 },
  standBoard: { dx: 120, dy: 332 },
} as const;

/** 宿舍区陈设落点：窗 / 壁灯 / 挂钟贴北墙，衣柜贴南墙，书架贴东墙 */
export const LOUNGE_DECOR = {
  windowXs: [60, 320] as const,
  /** 窗底距内墙面（房间内沿）多少像素 */
  windowDrop: 12,
  windowW: 64,
  windowH: 18,
  sconceXs: [138, 396] as const,
  clockDx: 170,
  clockDrop: 4,
  wardrobeDx: 352,
  /** 衣柜锚点距房间南沿多少像素 */
  wardrobeLift: 8,
  bookshelfDx: 436,
  bookshelfDy: 120,
} as const;

/** 卫生间洗手台：两个 sink prop 的中点，雷达落在台面前方（房间里侧） */
export const RESTROOM_DECOR = {
  vanityDx: 168,
  /** 台面到南墙的距离：与 `vanity()` 里 counterBottom - 24 同源 */
  vanityLift: 48,
  dryerDx: 320,
  dryerLift: 32,
} as const;

function roomRect(name: string): WorldRect | undefined {
  const building = WORLD_LAYOUT.buildings.find((item: BuildingSpec) => item.name === name);
  return building?.rect;
}

const WORKROOM_RECT = roomRect('工作区');
const LOUNGE_RECT = roomRect('宿舍区');
const RESTROOM_RECT = roomRect('卫生间');

/** 缺房间就整块跳过：布局重构时陈设点自然消失，不会画到 (0,0) 去 */
function collect(): InteriorSpotDef[] {
  const spots: InteriorSpotDef[] = [];

  if (WORKROOM_RECT) {
    const { x, y } = WORKROOM_RECT;
    spots.push(
      {
        id: 'work-printer',
        kind: 'printer',
        x: x + WORK_DECOR.printer.dx,
        // 机身高 18、底边贴 y+338：感应点抬到机身中部，站着按不别扭
        y: y + WORK_DECOR.printer.dy - 8,
        radius: 46,
      },
      {
        id: 'work-snack-cart',
        kind: 'snackCart',
        x: x + WORK_DECOR.cart.dx,
        y: y + WORK_DECOR.cart.dy - 8,
        radius: 46,
      },
      {
        id: 'work-whiteboard',
        kind: 'whiteboard',
        x: x + WORK_DECOR.standBoard.dx,
        y: y + WORK_DECOR.standBoard.dy - 14,
        radius: 46,
      },
    );
  }

  if (LOUNGE_RECT) {
    const { x, y, h } = LOUNGE_RECT;
    LOUNGE_DECOR.windowXs.forEach((dx, index) => {
      spots.push({
        id: `lounge-window-${index}`,
        kind: 'snowWindow',
        x: x + dx + LOUNGE_DECOR.windowW / 2,
        // 贴北墙的窗：感应点向屋内让 30px，站在床尾也够得着
        y: y + LOUNGE_DECOR.windowDrop + 30,
        radius: 52,
      });
    });
    spots.push(
      {
        id: 'lounge-clock',
        kind: 'clock',
        x: x + LOUNGE_DECOR.clockDx + 6,
        y: y + LOUNGE_DECOR.clockDrop + 34,
        radius: 50,
      },
      {
        id: 'lounge-wardrobe',
        kind: 'wardrobe',
        x: x + LOUNGE_DECOR.wardrobeDx,
        y: y + h - LOUNGE_DECOR.wardrobeLift - 54,
        radius: 50,
      },
      {
        id: 'lounge-bookshelf',
        kind: 'bookshelf',
        x: x + LOUNGE_DECOR.bookshelfDx - 34,
        y: y + LOUNGE_DECOR.bookshelfDy,
        radius: 46,
      },
    );
  }

  if (RESTROOM_RECT) {
    const { x, y, h } = RESTROOM_RECT;
    spots.push(
      {
        id: 'restroom-vanity',
        kind: 'vanity',
        x: x + RESTROOM_DECOR.vanityDx,
        y: y + h - RESTROOM_DECOR.vanityLift,
        radius: 48,
      },
      {
        id: 'restroom-dryer',
        kind: 'dryer',
        x: x + RESTROOM_DECOR.dryerDx,
        y: y + h - RESTROOM_DECOR.dryerLift,
        radius: 44,
      },
    );
  }

  // 小黑屋：三个反省位共用一个感应点，蹲哪张凳子都按得出来
  spots.push({
    id: 'cell-bench',
    kind: 'cellBench',
    x: JAIL_ANCHOR.x,
    y: JAIL_ANCHOR.y,
    radius: 60,
  });

  return spots;
}

export const INTERIOR_SPOTS: readonly InteriorSpotDef[] = collect();

/** 台词：每类三句，按互动次数轮转；语气与售货机/咖啡机同一档「生活化吐槽」 */
const SPOT_LINES: Record<Exclude<InteriorSpotKind, 'vanity'>, readonly string[]> = {
  printer: ['又卡纸了，第三张', '它吞了我的报销单', '打印机：今日维护由你负责'],
  snackCart: ['偷拿一包薯片，嘎嘣脆', '推车永远只剩番茄味', '先拿一包，明天再还'],
  whiteboard: ['白板上写着「本周上线」，三个月了', '箭头绕了一圈，又指回需求', '擦了八百遍，字迹刻进木头里'],
  dryer: ['呼——手吹成两片纸', '热风里飘着一股加班味', '三分钟了，还是湿的'],
  wardrobe: ['柜里挂着三件没洗的工服', '衣柜深处压着一封离职信', '门缝透光：柜里也住着人？'],
  bookshelf: ['《牛马自我修养》第五版', '一半是鸡汤，一半是加班', '书脊落灰，只有考勤表常翻'],
  clock: ['挂钟永远停在十点十分', '指针没坏，只是不想走', '十点十分：刚好够摸一次鱼'],
  snowWindow: ['窗外雪一直下，屋里不敢开窗', '雪把园区盖平了，老板还在', '玻璃上呵一口气，写个「休」'],
  cellBench: ['下次不敢了…', '我只是想坐下', '反省完毕，下次还敢'],
};

/** 洗手：水花 + 带薪吐槽 */
const WASH_LINES = ['带薪洗手 30 秒', '水花一响，算工伤时间', '冲一冲，把班味冲掉'] as const;

/** 镜子：按物种自嘲，牛与马各三句（物种来自本地外观，不新增字段） */
const MIRROR_LINES: Record<Species, readonly string[]> = {
  cow: ['镜子里这位，牛角今天挺精神', '牛马一抬头，镜子里多了一对黑眼圈', '看着像在反刍，其实在发呆'],
  horse: ['镜子里这位，鬃毛又翘起来了', '站得笔直，就是不想跑', '一片鬃毛，看不见脸'],
};

export type InteriorSpotAction = 'plain' | 'wash' | 'mirror';

/**
 * 洗手台的动作轮换：奇数拍照镜子、偶数拍洗手。
 *
 * 镜子和水盆在同一面墙上，做两个感应圈只会互相抢 F——
 * 一次洗手、一次照镜子，两种反馈都读得到，也不会出现「按了没反应」。
 */
export function interiorSpotAction(kind: InteriorSpotKind, counter: number): InteriorSpotAction {
  if (kind !== 'vanity') return 'plain';
  return Math.abs(Math.trunc(counter)) % 2 === 0 ? 'wash' : 'mirror';
}

function lineBySeed(lines: readonly string[], seed: number): string {
  const index = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % lines.length : 0;
  return lines[index]!;
}

/** 这一拍该冒哪句话：同一 kind + 同一计数永远同一句，双开窗口与单测都对得上 */
export function pickInteriorLine(
  kind: InteriorSpotKind,
  counter: number,
  species: Species = 'cow',
): string {
  const safe = Number.isFinite(counter) ? Math.abs(Math.trunc(counter)) : 0;
  if (kind === 'vanity') {
    const mirror = interiorSpotAction(kind, safe) === 'mirror';
    const lines = mirror ? MIRROR_LINES[species] ?? MIRROR_LINES.cow : WASH_LINES;
    return lineBySeed(lines, Math.floor(safe / 2));
  }
  return lineBySeed(SPOT_LINES[kind], safe);
}

/** 按键栈里的复用槽位：一次查询不造字面量 */
export interface InteriorSpotTarget {
  id: string;
  kind: InteriorSpotKind;
  index: number;
  x: number;
  y: number;
}

/**
 * 最近命中的室内陈设：写入调用方槽位，返回是否命中。
 * `range` 只用于收敛（默认与单点半径取小），服务端不参与，因此不存在伪造包问题。
 */
export function nearestInteriorSpotInto(
  out: InteriorSpotTarget,
  x: number,
  y: number,
  range: number = INTERIOR_SPOT_RANGE,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < INTERIOR_SPOTS.length; i += 1) {
    const spot = INTERIOR_SPOTS[i]!;
    const reach = Math.min(spot.radius, range);
    if (!Number.isFinite(reach)) continue;
    const dx = spot.x - x;
    const dy = spot.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > reach * reach) continue;
    if (distance >= bestDistance) continue;
    best = i;
    bestDistance = distance;
  }
  if (best < 0) return false;
  const spot = INTERIOR_SPOTS[best]!;
  out.id = spot.id;
  out.kind = spot.kind;
  out.index = best;
  out.x = spot.x;
  out.y = spot.y;
  return true;
}
