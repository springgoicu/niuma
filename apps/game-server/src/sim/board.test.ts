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
import { buildBoardSnapshot, canQueryBoard, hasCareerReport, sessionSecOf } from './board';
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
  it('在岗榜按服务端会话秒数排序，并统计在岗 / 摸鱼人数', () => {
    const players = [
      makePlayer(1, '早班牛', 10),
      makePlayer(2, '夜班马', 30, { pose: POSE.Sit }),
      makePlayer(3, '实习生', 20, { pose: POSE.Lie }),
    ];
    const board = buildBoardSnapshot(players, BOARD_METRIC.Duty, NOW, 1);
    expect(board.rows.map((row) => [row.id, row.value])).toEqual([
      [2, 30],
      [3, 20],
      [1, 10],
    ]);
    expect(board.online).toBe(3);
    // 坐和躺都算摸鱼；Idle 不算
    expect(board.slacking).toBe(2);
    expect(board.selfRank).toBe(3);
    expect(board.selfValue).toBe(10);
  });

  it('本周工时把上报后的会话增量算进去，且只统计已上报的人', () => {
    const reported = makePlayer(1, '老牛', 3_600, { career: { weekMinutes: 100, reportedOnlineSec: 0 } });
    const fresh = makePlayer(2, '新马', 120, { career: { weekMinutes: 50, reportedOnlineSec: 60 } });
    const unreported = makePlayer(3, '没上报', 900, { reported: false });
    const board = buildBoardSnapshot([reported, fresh, unreported], BOARD_METRIC.Week, NOW, 3);
    expect(board.rows.map((row) => [row.id, row.value])).toEqual([
      [1, 160],
      [2, 51],
    ]);
    // 未上报者在工时榜没有名次，但仍算在岗人数
    expect(board.selfRank).toBe(0);
    expect(board.selfValue).toBe(0);
    expect(board.online).toBe(3);
  });

  it('其余三项直接读本人自报的累计值', () => {
    const players = [
      makePlayer(1, '摸鱼王', 10, { career: { slackCount: 99 } }),
      makePlayer(2, '击倒王', 10, { career: { knockdownCount: 12 } }),
      makePlayer(3, '步数王', 10, { career: { steps: 8_888 } }),
    ];
    expect(buildBoardSnapshot(players, BOARD_METRIC.Slack, NOW, 1).rows[0]?.id).toBe(1);
    expect(buildBoardSnapshot(players, BOARD_METRIC.Knockdown, NOW, 1).rows[0]?.id).toBe(2);
    expect(buildBoardSnapshot(players, BOARD_METRIC.Steps, NOW, 1).rows[0]?.id).toBe(3);
  });

  it('人气榜读服务端点赞数：0 赞也入榜，未上报 career 不影响', () => {
    const star = makePlayer(1, '人气王', 10, { reported: false });
    star.likes = 9;
    const fresh = makePlayer(2, '新来的', 20, { reported: false });
    const middle = makePlayer(3, '中间人', 30, { reported: false });
    middle.likes = 3;
    const board = buildBoardSnapshot([star, fresh, middle], BOARD_METRIC.Likes, NOW, 2);
    expect(board.rows.map((row) => [row.id, row.value])).toEqual([
      [1, 9],
      [3, 3],
      [2, 0],
    ]);
    expect(board.selfRank).toBe(3);
    expect(board.selfValue).toBe(0);
    expect(board.online).toBe(3);
  });

  it('并列时先来的靠前，再按 id 升序，结果稳定', () => {
    const players = [
      makePlayer(9, '后到', 10, { career: { steps: 100 } }),
      makePlayer(4, '先到', 30, { career: { steps: 100 } }),
      makePlayer(2, '同刻', 30, { career: { steps: 100 } }),
    ];
    // 4 与 2 同一入场时刻：id 小的先
    const board = buildBoardSnapshot(players, BOARD_METRIC.Steps, NOW, 9);
    expect(board.rows.map((row) => row.id)).toEqual([2, 4, 9]);
    expect(buildBoardSnapshot(players, BOARD_METRIC.Steps, NOW, 9).rows.map((row) => row.id)).toEqual([2, 4, 9]);
  });

  it('自己排在前十之外时仍给出真实名次与数值', () => {
    const players = Array.from({ length: 12 }, (_, index) =>
      makePlayer(index + 1, `牛马${index + 1}`, index + 1, { career: { steps: (index + 1) * 10 } }),
    );
    const board = buildBoardSnapshot(players, BOARD_METRIC.Steps, NOW, 2, 3);
    expect(board.rows.map((row) => row.id)).toEqual([12, 11, 10]);
    expect(board.selfRank).toBe(11);
    expect(board.selfValue).toBe(20);
  });

  it('未上报判定：有入职日期或服务端写入过会话基线都算上报过', () => {
    expect(hasCareerReport(makePlayer(1, 'a', 10))).toBe(true);
    expect(hasCareerReport(makePlayer(2, 'b', 10, { reported: false }))).toBe(false);
    expect(
      hasCareerReport(makePlayer(3, 'c', 10, { reported: false, career: { reportedOnlineSec: 30 } })),
    ).toBe(true);
  });

  it('会话秒数不为负；未入场的玩家按 0 计', () => {
    const player = makePlayer(1, 'a', 10);
    expect(sessionSecOf(player, NOW)).toBe(10);
    // 时钟回拨 / 早于入场时刻：不能算出负数
    expect(sessionSecOf(player, NOW - 20_000)).toBe(0);
    player.joinedAt = 0;
    expect(sessionSecOf(player, NOW)).toBe(0);
  });
});
