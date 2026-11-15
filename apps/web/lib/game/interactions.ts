'use client';

import {
  BULLETIN_BOARD,
  DIRECTION,
  HOTSPOT_PRIORITY,
  POSE,
  SIT_RANGE,
  WORLD_LAYOUT,
  bossHitPoint,
  findNearestSeat,
  hotspotById,
  isWithinHotspot,
  nearestHotspotOfKinds,
  type Direction,
  type HotspotDef,
  type Pose,
  type PropKind,
  type SeatKind,
} from '@niuma/shared-types';
import { HINT } from './hint-copy';

/**
 * 轻互动：售货机、饮水机、咖啡机的一次性反馈，与躺床打呼。
 *
 * 全部留在客户端：不新增协议、不进服务端状态机（取舍见 ADR-0024）。
 * 这里是纯函数，`GameSession` 只负责「按键 → 查最近设施 → 冒气泡」。
 */

/** 互动判定半径：比入座半径小一档，站在机器旁边才触发 */
export const INTERACT_RANGE = 56;

/**
 * 牛马榜公告栏的互动半径（ADR-0054）。
 *
 * 牌面 128px 宽，站在正中或两侧都能按 F；与设施 56px 分开，
 * 是因为公告栏是「走过去看」的地标，不该要求玩家贴着底座站。
 * 服务端另有 240px 距离门，只负责挡住离开后仍刷请求的伪造包。
 */
export const BOARD_INTERACT_RANGE = 96;

/**
 * 热区查表：所有 F 类判定现在都只认 `WORLD_HOTSPOTS`。
 *
 * 半径可在调用侧覆盖（老测试会传自定义 range），坐标永远来自热区表，
 * 不再出现「提示按一套坐标、服务端校验按另一套」的漂移。
 */
function nearHotspotId(id: string, x: number, y: number, range?: number): boolean {
  const def = hotspotById(id);
  if (!def) return false;
  if (range === undefined) return isWithinHotspot(def, x, y);
  return isWithinHotspot({ ...def, radius: range }, x, y);
}

/** 是否站在公告栏旁边：坐标取地标底座中心，与碰撞盒同一份真相 */
export function isNearRankBoard(x: number, y: number, range: number = BOARD_INTERACT_RANGE): boolean {
  return nearHotspotId('rank-board', x, y, range);
}

/**
 * 牛马放假告示板（ADR-0059）。
 *
 * 感应区只有 64px：比牛马榜的 96px 更贴身，玩家得真的「走过去抬头看」。
 * 提示要求「在范围内且面朝板面」，但按键与点击只判距离——站在板侧读字的人
 * 不该因为朝向差一格就按不出面板。
 */
export const BULLETIN_INTERACT_RANGE = 64;

/** 是否站在放假告示板周围：坐标取地标底边中心，与碰撞盒同一份真相 */
export function isNearBulletin(x: number, y: number, range: number = BULLETIN_INTERACT_RANGE): boolean {
  return nearHotspotId('bulletin', x, y, range);
}

/**
 * 发泄区老板（ADR-0070）。
 *
 * 感应区不是「到中心点的距离」：老板 200×256，中心点在肚子里面，
 * 玩家站到脚底南侧时离中心还有 100 多 px，那样提示永远不出现。
 * 这里量的是「到受击矩形的最近点」——和 `withinVentCone` 用的同一个折算点，
 * 提示范围与服务端判定范围不会一个够得着、一个够不着。
 */
export const BOSS_INTERACT_RANGE = 72;

/** 是否站在老板脚边、正面能踹到肚子 */
export function isNearBoss(x: number, y: number, range: number = BOSS_INTERACT_RANGE): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(range)) return false;
  const hit = bossHitPoint(x, y);
  const dx = x - hit.x;
  const dy = y - hit.y;
  return dx * dx + dy * dy <= range * range;
}

/**
 * 赛博财神供案（ADR-0061）。
 *
 * 感应区 72px：供案有案面与香炉，人不该贴着香炉站；比设施 56px 宽一档，
 * 又比牛马榜 96px 窄，保证「走到案前」而不是「路过就能拜」。
 */
export const SHRINE_INTERACT_RANGE = 72;

/** 是否站在供案前：坐标取案面底边中心，与碰撞盒同一份真相 */
export function isNearShrine(x: number, y: number, range: number = SHRINE_INTERACT_RANGE): boolean {
  return nearHotspotId('shrine', x, y, range);
}

/**
 * 老干部紫砂茶台（ADR-0061）：矮家具，48px 够得着杯沿。
 *
 * 这个数字同时承担「别抢饮水机」的职责：茶台离 cooler 只有 34px，
 * 感应区再大一圈，站在饮水机前按 F 也会被茶台截走。
 */
export const TEA_INTERACT_RANGE = 48;

/** 是否站在茶台旁：坐标取桌面底边中心 */
export function isNearTeaStation(x: number, y: number, range: number = TEA_INTERACT_RANGE): boolean {
  return nearHotspotId('tea-station', x, y, range);
}

/** 四向朝向向量（屏幕坐标：+x 向右、+y 向下），下标与 DIRECTION 一致 */
const FACING_VECTOR: Readonly<Record<Direction, { x: number; y: number }>> = {
  [DIRECTION.Down]: { x: 0, y: 1 },
  [DIRECTION.Left]: { x: -1, y: 0 },
  [DIRECTION.Right]: { x: 1, y: 0 },
  [DIRECTION.Up]: { x: 0, y: -1 },
};

/** 面朝阈值：点积 / 距离 > 0.35，约 ±69°，四向朝向下一格斜角也算「对着」 */
const FACING_DOT = 0.35;

/**
 * 玩家是否面朝公告板：拿朝向向量与「指向牌面中心」的单位向量做点积。
 * 牌面中心取板面几何中心（不是底座），站得高一点低一点都不会误判。
 */
export function facesBulletin(x: number, y: number, direction: Direction): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const dx = BULLETIN_BOARD.x - x;
  const dy = BULLETIN_BOARD.y - BULLETIN_BOARD.height / 2 - y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;
  const facing = FACING_VECTOR[direction];
  if (!facing) return false;
  return (facing.x * dx + facing.y * dy) / distance > FACING_DOT;
}

/** 点击命中：牌面 80×48 的整块矩形，不含底座以外的空白 */
export function isBulletinHit(x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const left = BULLETIN_BOARD.x - BULLETIN_BOARD.width / 2;
  const top = BULLETIN_BOARD.y - BULLETIN_BOARD.height;
  return x >= left && x <= left + BULLETIN_BOARD.width && y >= top && y <= BULLETIN_BOARD.y;
}

const INTERACTIVE_KINDS = ['vending', 'cooler', 'coffee'] as const;
export type InteractiveKind = (typeof INTERACTIVE_KINDS)[number];

const INTERACTIVE_SET: ReadonlySet<PropKind> = new Set(INTERACTIVE_KINDS);

export function isInteractiveKind(kind: PropKind): kind is InteractiveKind {
  return INTERACTIVE_SET.has(kind);
}

/**
 * 台词：每类设施三句，按互动次数轮转，连按同一台机器会换话，不会卡在同一句。
 * 语气保持「加班园区」的生活化吐槽，不引入数值或任务。
 */
const LINES: Record<InteractiveKind, readonly string[]> = {
  vending: ['咔哒——冰可乐到手', '再来一罐，明天再说', '零钱没找开，快乐到位'],
  cooler: ['咕嘟咕嘟，续一口', '接满一杯，继续牛马', '水温刚好，气也顺了'],
  coffee: ['美式，苦得像周一', '加两包糖，甜一点', '第三杯了，心还在跳'],
};

/** 最近设施的输出槽：按键栈里复用同一个对象，避免每次互动造一份短命字面量 */
export interface InteractiveTarget {
  kind: InteractiveKind;
  x: number;
  y: number;
}

/** 写入调用方槽位的版本：返回 false 时槽位内容无意义 */
export function nearestInteractivePropInto(
  out: InteractiveTarget,
  x: number,
  y: number,
  range: number = INTERACT_RANGE,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(range)) return false;
  let found = false;
  let bestDistance = range * range;
  for (const prop of WORLD_LAYOUT.props) {
    if (!isInteractiveKind(prop.kind)) continue;
    const dx = prop.x - x;
    const dy = prop.y - y;
    const distance = dx * dx + dy * dy;
    if (distance > bestDistance) continue;
    out.kind = prop.kind;
    out.x = prop.x;
    out.y = prop.y;
    bestDistance = distance;
    found = true;
  }
  return found;
}

/** 最近的可互动设施：范围外或附近没有时返回 null（保留给调用方不需要零分配的场合） */
export function nearestInteractiveProp(
  x: number,
  y: number,
  range: number = INTERACT_RANGE,
): { kind: InteractiveKind; x: number; y: number } | null {
  const out: InteractiveTarget = { kind: 'vending', x: 0, y: 0 };
  return nearestInteractivePropInto(out, x, y, range) ? out : null;
}

/** `selectContextHint` 的输入：座位是否空闲由调用方提供（客户端查本地占用镜像） */
export interface ContextHintOptions {
  isFreeSeat: (seatId: number) => boolean;
  /** 复用调用方的设施查询槽，避免每拍造一份短命字面量 */
  propOut?: InteractiveTarget;
  sitRange?: number;
  /** 当前坐着的座位组：观战长椅押注提示只在「坐在 arena-bench 上」时出现 */
  seatedGroup?: string | null;
  /** 当前所在房间频道：0 = 园区，非 0 = 公寓屋内 */
  roomId?: number;
}

/** 热区 → 提示文案：label 已在共享表里声明，这里只做一次映射 */
export function hintForHotspot(def: HotspotDef): string {
  switch (def.kind) {
    case 'bulletin':
      return HINT.bulletin;
    case 'board':
      return HINT.board;
    case 'shrine':
      return HINT.shrine;
    case 'tea':
      return HINT.tea;
    case 'diceTable':
      return HINT.dice;
    case 'arenaSeat':
      return HINT.arenaBet;
    case 'villaGate':
      return HINT.villa;
    case 'villaTree':
      return HINT.villaTree;
    case 'apartmentDoor':
      return HINT.apartment;
    case 'apartmentExit':
      return HINT.apartmentExit;
    default:
      return HINT.interact;
  }
}

/**
 * 当前站位该显示哪一条环境提示；不在任何感应区时返回 null。
 *
 * 判定全部走 `WORLD_HOTSPOTS`（按 `HOTSPOT_PRIORITY` 逐级取最近命中），
 * 与 `GameSession.interact()` 用同一张表、同一个优先级，
 * 不会出现「提示说续杯、按下去却在接水」。
 *
 * 三类需要运行时状态的热区在这里过滤：
 * - 告示板要面朝牌面；
 * - 观战长椅要真的坐在 `arena-bench` 组上；
 * - 公寓门口 / 屋内出口按 `roomId` 二选一。
 * 擂台报名提示由会话层负责（要读阶段与名额）。
 */
export function selectContextHint(
  x: number,
  y: number,
  direction: Direction,
  options: ContextHintOptions,
): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const roomId = options.roomId ?? 0;
  const def = nearestHotspotOfKinds(x, y, HOTSPOT_PRIORITY, (candidate) => {
    if (candidate.kind === 'bulletin') return facesBulletin(x, y, direction);
    if (candidate.kind === 'ring') return false;
    if (candidate.kind === 'arenaSeat') return options.seatedGroup === 'arena-bench';
    if (candidate.kind === 'apartmentDoor') return roomId === 0;
    if (candidate.kind === 'apartmentExit') return roomId !== 0;
    return true;
  });
  if (def) return hintForHotspot(def);
  if (isNearBoss(x, y)) return HINT.boss;
  const prop = options.propOut ?? { kind: 'vending', x: 0, y: 0 };
  if (nearestInteractivePropInto(prop, x, y)) return HINT.interact;
  const range = options.sitRange ?? SIT_RANGE;
  const seat = findNearestSeat(x, y, options.isFreeSeat, range, (item) => item.kind !== 'bed');
  if (seat) return seat.kind === 'toilet' ? HINT.toilet : HINT.seat;
  const bed = findNearestSeat(x, y, options.isFreeSeat, range, (item) => item.kind === 'bed');
  return bed ? HINT.bed : null;
}

/** 按互动次数取台词：同一个 counter 永远同一句，便于单测与复现 */
export function pickLine(kind: InteractiveKind, counter: number): string {
  const lines = LINES[kind];
  const index = Number.isFinite(counter) ? Math.abs(Math.trunc(counter)) % lines.length : 0;
  return lines[index]!;
}

/**
 * 发泄的台词：出招者三句、被创飞者三句。
 *
 * 与设施台词的关键区别是**按 netId 取值而不是按次数轮转**：
 * 这些气泡由每个客户端各自根据广播出来的 state 位渲染，用本地计数器轮转的话，
 * 双开窗口看到的会是两句不同的话。用实体 id 取模，全场的第 N 号玩家永远是同一句。
 */
const VENT_LINES = ['💢 发泄！', '退！退！退！', '吃我一记牛马冲撞！'] as const;
const VENT_VICTIM_LINES = ['💫 哎哟被创飞了！', '💥 判定为工伤！', '😵 倒地装死中...'] as const;

function lineBySeed(lines: readonly string[], seed: number): string {
  const index = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % lines.length : 0;
  return lines[index]!;
}

/** 出招者头顶的台词 */
export function pickVentLine(seed: number): string {
  return lineBySeed(VENT_LINES, seed);
}

/** 被创飞者头顶的台词 */
export function pickVentVictimLine(seed: number): string {
  return lineBySeed(VENT_VICTIM_LINES, seed);
}

/** 躺床打呼：躺下静置 5s 后第一次，之后每 9s 一次 */
export const SNORE_FIRST_MS = 5000;
export const SNORE_INTERVAL_MS = 9000;

/**
 * 这一刻该不该冒「Zzz…」。
 * `idleMs` 是躺下后经过的时间（行走 / 起身会把它清零），`sinceSnoreMs` 是距上次打呼的时间。
 */
export function snoreDue(
  pose: Pose,
  seatKind: SeatKind | null,
  idleMs: number,
  sinceSnoreMs: number,
): boolean {
  if (pose !== POSE.Lie || seatKind !== 'bed') return false;
  if (!Number.isFinite(idleMs) || !Number.isFinite(sinceSnoreMs)) return false;
  if (idleMs < SNORE_FIRST_MS) return false;
  return sinceSnoreMs >= SNORE_INTERVAL_MS;
}
