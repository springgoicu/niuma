import { describe, expect, it } from 'bun:test';
import {
  BOARD_METRIC,
  BOARD_QUERY_COOLDOWN_MS,
  BOARD_QUERY_RANGE,
  EMPTY_CAREER,
  POSE,
  WELCOME_LANDMARKS,
  type CareerSummary,
} from '@niuma/shared-types';
import {
  boardValueOf,
  buildBoardSnapshot,
  canQueryBoard,
  hasCareerReport,
  sessionSecOf,
} from './board';
import { Player } from './world';

const NOW = 1_700_000_000_000;

function makePlayer(
  id: number,
  name: string,
  onlineSec: number,
  options: { pose?: number; reported?: boolean; career?: Partial<CareerSummary> } = {},
): Player {
  const player = new Player();
  player.id = id;
  player.name = name;
  player.joinedAt = NOW - onlineSec * 1000;
  player.pose = (options.pose ?? POSE.Idle) as Player['pose'];
  player.career = {
    ...EMPTY_CAREER,
    firstJoinDate: options.reported === false ? '' : '2026-01-01',
    ...options.career,
  };
  return player;
}

describe('榜单请求门', () => {
  const board = WELCOME_LANDMARKS.rankBoard;

  it('站在公告栏 240px 内才放行；出生点在门外', () => {
    const near = makePlayer(1, '看榜的', 10);
    near.x = board.x;
    near.y = board.y + BOARD_QUERY_RANGE;
    expect(canQueryBoard(near, NOW)).toBe(true);

    const spawn = makePlayer(2, '路过的', 10);
    spawn.x = 4096;
    spawn.y = 4096;
    expect(canQueryBoard(spawn, NOW)).toBe(false);
  });

  it('两次查询至少隔 1.5 秒，边界那一毫秒放行', () => {
    const player = makePlayer(1, '看榜的', 10);
    player.x = board.x;
    player.y = board.y;
    player.lastBoardAt = NOW - BOARD_QUERY_COOLDOWN_MS + 1;
    expect(canQueryBoard(player, NOW)).toBe(false);
    player.lastBoardAt = NOW - BOARD_QUERY_COOLDOWN_MS;
    expect(canQueryBoard(player, NOW)).toBe(true);
  });

  it('坏坐标直接拒绝，不把 NaN 当成「距离为 0」', () => {
    const player = makePlayer(1, '看榜的', 10);
    player.x = Number.NaN;
    player.y = board.y;
    expect(canQueryBoard(player, NOW)).toBe(false);
    player.x = board.x;
    expect(canQueryBoard(player, Number.NaN)).toBe(false);
  });
});

describe('牛马榜聚合', () => {
  it('今日工时只读本地自报值，不再补会话增量', () => {
    const players = [
      makePlayer(1, '早班牛', 10, { career: { todayMinutes: 60 } }),
      makePlayer(2, '夜班马', 30, { career: { todayMinutes: 90 } }),
      makePlayer(3, '实习生', 20, { career: { todayMinutes: 30 }, pose: POSE.Sit }),
    ];
    const board = buildBoardSnapshot(players, BOARD_METRIC.TodayMinutes, 1, 2);
    expect(board.rows.map((row) => [row.id, row.value])).toEqual([
      [2, 90],
      [1, 60],
    ]);
    expect(board.online).toBe(3);
    // 坐和躺都算摸鱼；Idle 不算
    expect(board.slacking).toBe(1);
    expect(board.selfRank).toBe(2);
    expect(board.selfValue).toBe(60);
  });

  it('今日如厕、击倒、被创、步数各读各的今日字段，且只统计已上报的人', () => {
    const players = [
      makePlayer(1, '如厕王', 10, { career: { todayToiletMinutes: 70, todayMinutes: 120 } }),
      makePlayer(2, '击倒王', 20, { career: { todayKnockdown: 12 } }),
      makePlayer(3, '被创王', 30, { career: { todayVented: 9 } }),
      makePlayer(4, '步数王', 40, { career: { todaySteps: 20_000 } }),
      makePlayer(5, '没上报', 50, { reported: false }),
    ];
    expect(buildBoardSnapshot(players, BOARD_METRIC.TodayToilet, 1).rows.map((row) => [row.id, row.value])).toEqual([
      [1, 70],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
    expect(buildBoardSnapshot(players, BOARD_METRIC.TodayKnockdown, 2).rows[0]?.id).toBe(2);
    expect(buildBoardSnapshot(players, BOARD_METRIC.TodayVented, 3).rows[0]?.id).toBe(3);
    expect(buildBoardSnapshot(players, BOARD_METRIC.TodaySteps, 4).rows[0]?.id).toBe(4);
    expect(boardValueOf(players[3]!, BOARD_METRIC.TodaySteps)).toBe(20_000);
    expect(hasCareerReport(players[4]!.career)).toBe(false);
  });

  it('并列时按 id 升序，结果稳定；先后入场不再影响名次', () => {
    const players = [
      makePlayer(9, '后到', 10, { career: { todaySteps: 100 } }),
      makePlayer(4, '先到', 30, { career: { todaySteps: 100 } }),
      makePlayer(2, '同刻', 20, { career: { todaySteps: 100 } }),
    ];
    const board = buildBoardSnapshot(players, BOARD_METRIC.TodaySteps, 9);
    expect(board.rows.map((row) => row.id)).toEqual([2, 4, 9]);
    expect(buildBoardSnapshot(players, BOARD_METRIC.TodaySteps, 9).rows.map((row) => row.id)).toEqual([2, 4, 9]);
  });

  it('自己排在前十之外时仍给出真实名次与数值', () => {
    const players = Array.from({ length: 12 }, (_, index) =>
      makePlayer(index + 1, `牛马${index + 1}`, index + 1, { career: { todaySteps: (index + 1) * 10 } }),
    );
    const board = buildBoardSnapshot(players, BOARD_METRIC.TodaySteps, 2, 3);
    expect(board.rows.map((row) => row.id)).toEqual([12, 11, 10]);
    expect(board.selfRank).toBe(11);
    expect(board.selfValue).toBe(20);
  });

  it('NPC 不进任何榜单，也不计入在岗人数与自己的名次', () => {
    const human = makePlayer(1, '真牛', 10, { career: { todaySteps: 10 } });
    const npc = makePlayer(2, '假马', 9_999, { career: { todaySteps: 99_999 } });
    npc.isNpc = true;
    for (const metric of [
      BOARD_METRIC.TodayMinutes,
      BOARD_METRIC.TodayToilet,
      BOARD_METRIC.TodaySteps,
    ]) {
      const board = buildBoardSnapshot([human, npc], metric, 2);
      expect(board.rows.map((row) => row.id)).toEqual([1]);
      expect(board.online).toBe(1);
      expect(board.selfRank).toBe(0);
      expect(board.selfValue).toBe(0);
    }
  });

  it('未上报判定只看入职日期，不再依赖服务端会话基线', () => {
    expect(hasCareerReport(makePlayer(1, 'a', 10).career)).toBe(true);
    expect(hasCareerReport(makePlayer(2, 'b', 10, { reported: false }).career)).toBe(false);
  });

  it('会话秒数只用于在线状态：不为负；未入场按 0 计', () => {
    const player = makePlayer(1, 'a', 10);
    expect(sessionSecOf(player, NOW)).toBe(10);
    // 时钟回拨 / 早于入场时刻：不能算出负数
    expect(sessionSecOf(player, NOW - 20_000)).toBe(0);
    player.joinedAt = 0;
    expect(sessionSecOf(player, NOW)).toBe(0);
  });
});
