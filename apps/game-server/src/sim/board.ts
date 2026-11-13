import {
  BOARD_METRIC,
  BOARD_QUERY_COOLDOWN_MS,
  BOARD_QUERY_RANGE,
  BOARD_TOP_N,
  POSE,
  WELCOME_LANDMARKS,
  hasCareerReport,
  type BoardMetric,
  type BoardPacket,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * 牛马榜聚合（ADR-0054 / 新 ADR 当日化）。
 *
 * 输入是当前园区内存里的玩家集合，输出一条可直接编码的快照；
 * 只在收到 `C2S_BOARD` 时调用，不进 Tick 循环。零持久化：
 * 进程重启、玩家掉线，榜单自然清空；玩家重连后用自己的本地当日摘要补报。
 */

/** 本次会话在线秒数：只用于 SPAWN / 工牌的在线状态，不参与任何榜单数值 */
export function sessionSecOf(player: Player, now: number): number {
  if (!(player.joinedAt > 0)) return 0;
  return Math.max(0, Math.floor((now - player.joinedAt) / 1000));
}

export { hasCareerReport };

/** 单项数值：全部读本人自报的今日字段，服务端不再补会话增量 */
export function boardValueOf(player: Player, metric: BoardMetric): number {
  switch (metric) {
    case BOARD_METRIC.TodayMinutes:
      return player.career.todayMinutes;
    case BOARD_METRIC.TodayToilet:
      return player.career.todayToiletMinutes;
    case BOARD_METRIC.TodayKnockdown:
      return player.career.todayKnockdown;
    case BOARD_METRIC.TodayVented:
      return player.career.todayVented;
    case BOARD_METRIC.TodaySteps:
      return player.career.todaySteps;
  }
}

/**
 * 是否允许这次榜单请求：必须站在公告栏 240px 内，且距离上次查询满 1.5 秒。
 *
 * 两条都是防放大而不是游戏规则：客户端提示半径只有 96px，正常玩家不会在
 * 门外刷请求；限频挡住的是伪造客户端把「按需查询」变成持续下行。
 * 坏坐标一律拒绝，避免 NaN 让距离比较恒为 false。
 */
export function canQueryBoard(player: Player, now: number): boolean {
  if (!Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(now)) return false;
  if (now - player.lastBoardAt < BOARD_QUERY_COOLDOWN_MS) return false;
  const board = WELCOME_LANDMARKS.rankBoard;
  const dx = player.x - board.x;
  const dy = player.y - board.y;
  return dx * dx + dy * dy <= BOARD_QUERY_RANGE * BOARD_QUERY_RANGE;
}

interface RankedRow {
  id: number;
  name: string;
  value: number;
}

/**
 * 按指标生成一条榜单快照。
 *
 * - 五个榜都只含已上报今日摘要的人，未上报显示「未上报」而不是 0；
 * - 排序：数值降序 → id 升序，20s 刷新时同值玩家名次不跳动；
 * - `selfRank` 在切片前算出，因此第 20 名也能看到自己的位置。
 */
export function buildBoardSnapshot(
  players: Iterable<Player>,
  metric: BoardMetric,
  selfId: number,
  limit: number = BOARD_TOP_N,
): BoardPacket {
  let online = 0;
  let slacking = 0;
  const ranked: RankedRow[] = [];

  for (const player of players) {
    // NPC 不进榜：五个榜都只排真人，避免 10 个常驻实体挤占名次
    if (player.isNpc) continue;
    online += 1;
    if (player.pose === POSE.Sit || player.pose === POSE.Lie) slacking += 1;
    if (!hasCareerReport(player.career)) continue;
    ranked.push({
      id: player.id,
      name: player.name,
      value: boardValueOf(player, metric),
    });
  }

  ranked.sort((a, b) => b.value - a.value || a.id - b.id);

  let selfRank = 0;
  let selfValue = 0;
  const selfIndex = ranked.findIndex((row) => row.id === selfId);
  if (selfIndex >= 0) {
    selfRank = selfIndex + 1;
    selfValue = ranked[selfIndex]!.value;
  }

  const rows = ranked.slice(0, Math.max(0, Math.floor(limit))).map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value,
  }));

  return { metric, online, slacking, selfRank, selfValue, rows };
}
