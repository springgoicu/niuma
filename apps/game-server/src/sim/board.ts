import {
  BOARD_METRIC,
  BOARD_QUERY_COOLDOWN_MS,
  BOARD_QUERY_RANGE,
  BOARD_TOP_N,
  POSE,
  WELCOME_LANDMARKS,
  careerSessionDeltaMinutes,
  type BoardMetric,
  type BoardPacket,
} from '@niuma/shared-types';
import type { Player } from './world';

/**
 * 牛马榜聚合（ADR-0054）。
 *
 * 输入是当前园区内存里的玩家集合，输出一条可直接编码的快照；
 * 只在收到 `C2S_BOARD` 时调用，不进 Tick 循环。零持久化：
 * 进程重启、玩家掉线，榜单自然清空。
 */

/** 本次会话在线秒数：与 SPAWN / 工牌的 onlineSec 同一口径 */
export function sessionSecOf(player: Player, now: number): number {
  if (!(player.joinedAt > 0)) return 0;
  return Math.max(0, Math.floor((now - player.joinedAt) / 1000));
}

/**
 * 是否已上报考勤摘要。
 *
 * `firstJoinDate` 为空表示还没上报过；但服务端补报时会把 `reportedOnlineSec`
 * 写成会话秒数，因此它大于 0 同样说明「报过」——新玩家刚入园、日期还没落盘时
 * 也不会被误判成未上报。
 */
export function hasCareerReport(player: Player): boolean {
  return player.career.firstJoinDate.length > 0 || player.career.reportedOnlineSec > 0;
}

/** 单项数值：在岗用服务端会话时长，其余只读本人自报的展示字段 */
export function boardValueOf(player: Player, metric: BoardMetric, now: number): number {
  const onlineSec = sessionSecOf(player, now);
  switch (metric) {
    case BOARD_METRIC.Duty:
      return onlineSec;
    case BOARD_METRIC.Week:
      return player.career.weekMinutes + careerSessionDeltaMinutes(player.career, onlineSec);
    case BOARD_METRIC.Slack:
      return player.career.slackCount;
    case BOARD_METRIC.Knockdown:
      return player.career.knockdownCount;
    case BOARD_METRIC.Steps:
      return player.career.steps;
    case BOARD_METRIC.Likes:
      return player.likes;
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
  joinedAt: number;
}

/**
 * 按指标生成一条榜单快照。
 *
 * - 在岗榜与 人气榜包含全部在线玩家；其余四榜只含已上报摘要的人，未上报显示「未上报」而不是 0；
 * - 排序：数值降序 → 入场时刻升序（先来的靠前）→ id 升序，结果稳定可复现；
 * - `selfRank` 在切片前算出，因此第 20 名也能看到自己的位置。
 */
export function buildBoardSnapshot(
  players: Iterable<Player>,
  metric: BoardMetric,
  now: number,
  selfId: number,
  limit: number = BOARD_TOP_N,
): BoardPacket {
  let online = 0;
  let slacking = 0;
  const ranked: RankedRow[] = [];

  for (const player of players) {
    // NPC 不进榜：在岗榜、人气榜与其余四榜都只排真人，避免 10 个常驻实体挤占名次
    if (player.isNpc) continue;
    online += 1;
    if (player.pose === POSE.Sit || player.pose === POSE.Lie) slacking += 1;
    if (metric !== BOARD_METRIC.Duty && metric !== BOARD_METRIC.Likes && !hasCareerReport(player)) continue;
    ranked.push({
      id: player.id,
      name: player.name,
      value: boardValueOf(player, metric, now),
      joinedAt: player.joinedAt,
    });
  }

  ranked.sort((a, b) => b.value - a.value || a.joinedAt - b.joinedAt || a.id - b.id);

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
