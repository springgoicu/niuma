import { randomInt } from 'node:crypto';
import {
  P2P_DICE_SETTLE_MS,
  P2P_GAME_TYPE,
  P2P_MATCH_END,
  P2P_SHOWDOWN_FLAG_FINAL,
  P2P_SHOWDOWN_FLAG_TIE,
  P2P_SHOWDOWN_MS,
  P2P_TAX_BPS,
} from '@niuma/shared-types';
import type { ActiveMatch, ChallengeContext, ChallengeHandler } from '../types';

/** 三颗骰子：豹子 > 顺子 > 总点数，同档再比总点数 */
function score(dice: readonly number[]): number {
  const sorted = [...dice].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const triple = sorted[0] === sorted[2];
  const straight = sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
  if (triple) return 2_000 + total;
  if (straight) return 1_000 + total;
  return total;
}

function roll(): number[] {
  return [randomInt(1, 7), randomInt(1, 7), randomInt(1, 7)];
}

function diceOf(match: ActiveMatch): { a: number[]; b: number[]; winnerId: number } {
  return match.data.dice as { a: number[]; b: number[]; winnerId: number };
}

/**
 * `gameType = 1`：街头摇骰子。
 *
 * 服务端在开局时一次掷出双方各 3 颗骰子并算好胜负，立刻下发亮牌包，
 * 客户端用 1.5s 翻滚动画演完；1.8s 后才真正结算，动画与到账共用同一份结果。
 */
export const diceHandler: ChallengeHandler = {
  gameType: P2P_GAME_TYPE.Dice,
  name: '街头摇骰子',
  durationMs: P2P_DICE_SETTLE_MS,
  payoutBps: 10_000 - P2P_TAX_BPS,
  onStart(match, ctx): void {
    const a = roll();
    const b = roll();
    const scoreA = score(a);
    const scoreB = score(b);
    const winnerId = scoreA === scoreB ? 0 : scoreA > scoreB ? match.a.id : match.b.id;
    match.data.dice = { a, b, winnerId };
    ctx.showdown({
      round: 1,
      winnerId,
      flags: P2P_SHOWDOWN_FLAG_FINAL | (winnerId === 0 ? P2P_SHOWDOWN_FLAG_TIE : 0),
      dice: [...a, ...b],
      durationMs: P2P_SHOWDOWN_MS,
    });
  },
  onTick(match, ctx: ChallengeContext): void {
    if (ctx.now < match.endsAt) return;
    ctx.finish(diceOf(match).winnerId, P2P_MATCH_END.Normal);
  },
};
