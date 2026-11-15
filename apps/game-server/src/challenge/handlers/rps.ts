import {
  P2P_ACTION,
  P2P_GAME_TYPE,
  P2P_MATCH_END,
  P2P_RPS_MAX_ROUNDS,
  P2P_RPS_ROUND_MS,
  P2P_SHOWDOWN_FLAG_FINAL,
  P2P_SHOWDOWN_FLAG_TIE,
  P2P_SHOWDOWN_MS,
  P2P_TAX_BPS,
} from '@niuma/shared-types';
import type { ActiveMatch, ChallengeContext, ChallengeHandler } from '../types';

interface RpsState {
  round: number;
  /** 0 表示还没出拳 */
  pickA: number;
  pickB: number;
}

function stateOf(match: ActiveMatch): RpsState {
  return match.data.rps as RpsState;
}

function isValidAction(action: number): boolean {
  return (
    action === P2P_ACTION.Rock ||
    action === P2P_ACTION.Scissors ||
    action === P2P_ACTION.Paper
  );
}

/** 1 石头、2 剪刀、3 布：A 胜返回 1，B 胜返回 -1，平局 0 */
function compare(a: number, b: number): number {
  if (a === b) return 0;
  return (a - b + 3) % 3 === 2 ? 1 : -1;
}

function resolveRound(match: ActiveMatch, ctx: ChallengeContext): void {
  const state = stateOf(match);
  // 5 秒没选：服务端补随机，盲选窗口不会被拖住；注入随机源返回 1 时也夹在 1..3
  const randomPick = (): number => 1 + Math.min(2, Math.floor(ctx.random() * 3));
  if (state.pickA === 0) state.pickA = randomPick();
  if (state.pickB === 0) state.pickB = randomPick();
  const result = compare(state.pickA, state.pickB);
  const tie = result === 0;
  const winnerId = tie ? 0 : result > 0 ? match.a.id : match.b.id;
  const finalRound = !tie || state.round >= P2P_RPS_MAX_ROUNDS;

  ctx.showdown({
    round: state.round,
    winnerId,
    flags: (finalRound ? P2P_SHOWDOWN_FLAG_FINAL : 0) | (tie ? P2P_SHOWDOWN_FLAG_TIE : 0),
    aAction: state.pickA,
    bAction: state.pickB,
    durationMs: P2P_SHOWDOWN_MS,
  });

  if (tie && !finalRound) {
    // 平局加赛：清空双方出拳，同一个 match 继续跑下一轮
    state.round += 1;
    state.pickA = 0;
    state.pickB = 0;
    match.endsAt = ctx.now + P2P_RPS_ROUND_MS;
    return;
  }
  // 第 3 轮仍平局：退款；否则赢家拿走税后奖池
  ctx.finish(winnerId, tie ? P2P_MATCH_END.Timeout : P2P_MATCH_END.Normal);
}

/**
 * `gameType = 2`：灵魂猜拳。
 *
 * 每轮 5 秒盲选，收齐或超时即亮牌；平局推进 `endsAt` 加赛，最多 3 轮。
 * 总线硬超时永远以当前 `endsAt + 5s` 兜底，多轮不会把玩家锁死。
 */
export const rpsHandler: ChallengeHandler = {
  gameType: P2P_GAME_TYPE.Rps,
  name: '灵魂猜拳',
  durationMs: P2P_RPS_ROUND_MS,
  payoutBps: 10_000 - P2P_TAX_BPS,
  onStart(match, ctx): void {
    match.data.rps = { round: 1, pickA: 0, pickB: 0 } satisfies RpsState;
    match.endsAt = ctx.now + P2P_RPS_ROUND_MS;
  },
  onAction(match, player, action, ctx): void {
    const state = stateOf(match);
    if (!isValidAction(action)) return;
    if (player.id === match.a.id) {
      if (state.pickA !== 0) return;
      state.pickA = action;
    } else if (player.id === match.b.id) {
      if (state.pickB !== 0) return;
      state.pickB = action;
    } else {
      return;
    }
    // 双方都出了就立刻开牌，不用等满 5 秒
    if (state.pickA !== 0 && state.pickB !== 0) resolveRound(match, ctx);
  },
  onTick(match, ctx): void {
    if (ctx.now < match.endsAt) return;
    resolveRound(match, ctx);
  },
};
