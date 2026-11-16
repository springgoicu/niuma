import {
  QUEST_DEFS,
  QUEST_PROGRESS_MAX,
  WALLET_REASON,
  encodeQuestState,
  findQuestDef,
  type QuestEntry,
  type QuestStatePacket,
} from '@niuma/shared-types';
import { serverDayKey } from '../clock';
import type { EconomyService } from '../economy/service';
import type { Player } from './world';

/** 发包入口：与经济服务同一个 `transport.send`，测试可注入只记录的桩 */
export type QuestSender = (wsId: number, packet: Uint8Array) => void;

/** 领取结果：`ok` 才发钱，其余三种都由分发层变成互动回执 */
export type QuestClaimResult = 'ok' | 'invalid' | 'claimed' | 'notReady';

/**
 * 每日悬赏（ADR-0088）。
 *
 * 进度只在服务端累计：打老板、赢对局、搬砖三件事服务端都亲眼看见过，
 * 客户端上报的进度一律不采信。跨园区零点由 `serverDayKey` 整表清零，
 * 与老板回满、考勤「今日」字段共用同一个时区偏移。
 *
 * 断线即回收：换浏览器回到本地存档的余额，但今日进度重新从 0 开始——
 * 与「服务端不记得你是谁」同一条口径，不做跨会话身份。
 */
export class DailyQuestRuntime {
  constructor(
    private readonly economy: EconomyService,
    private readonly send: QuestSender,
    private readonly tzOffsetMin: number,
  ) {}

  /** 换日清空：只改内存，下一次 `push` 会把新状态同步给客户端 */
  private syncDay(player: Player, now: number): boolean {
    const day = serverDayKey(now, this.tzOffsetMin);
    if (player.questDay === day) return false;
    player.questDay = day;
    player.questProgress = {};
    player.questClaimed.clear();
    return true;
  }

  snapshot(player: Player, now: number): QuestStatePacket {
    this.syncDay(player, now);
    const entries: QuestEntry[] = QUEST_DEFS.map((def) => ({
      id: def.id,
      progress: Math.min(def.target, player.questProgress[def.id] ?? 0),
      target: def.target,
      claimed: player.questClaimed.has(def.id),
    }));
    return { day: player.questDay, entries };
  }

  /** 只发给本人：悬赏是私事，不进视野广播 */
  push(player: Player, now: number): void {
    if (player.wsId === 0) return;
    this.send(player.wsId, encodeQuestState(this.snapshot(player, now)));
  }

  /**
   * 进度 +1（或 +n）。返回 true 表示真的变化了，调用方据此决定要不要广播。
   *
   * 进度封顶在 `target`：既避免「打了 300 脚老板」把 u16 撑到边界，
   * 也让客户端的进度条不会画出 300/10 这种怪值。
   */
  note(player: Player, questId: number, amount: number, now: number): boolean {
    const def = findQuestDef(questId);
    if (!def) return false;
    this.syncDay(player, now);
    const current = player.questProgress[def.id] ?? 0;
    if (current >= def.target) return false;
    const next = Math.min(def.target, current + Math.max(1, Math.floor(amount) || 1));
    if (next === current) return false;
    player.questProgress[def.id] = Math.min(QUEST_PROGRESS_MAX, next);
    this.push(player, now);
    return true;
  }

  /**
   * 领取：达标、当日未领、id 合法三条同时成立才发钱。
   *
   * 先落 `claimed` 再发币：`grantCoins` 内部有钳制，但「已领」标记必须先写，
   * 否则重发包在同一毫秒内可能挤进第二次发币。
   *
   * 返回原因而不是布尔值：分发层要把「没达标 / 今天领过 / 编号非法」
   * 变成玩家能看懂的回执，而不是点了没反应。
   */
  claim(player: Player, questId: number, now: number): QuestClaimResult {
    const def = findQuestDef(questId);
    if (!def) return 'invalid';
    this.syncDay(player, now);
    if (player.questClaimed.has(def.id)) return 'claimed';
    if ((player.questProgress[def.id] ?? 0) < def.target) return 'notReady';
    player.questClaimed.add(def.id);
    this.economy.grantCoins(player, def.reward, WALLET_REASON.QuestReward);
    this.push(player, now);
    return 'ok';
  }
}
