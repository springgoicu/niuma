import {
  P2P_DUEL_ARMOR_PER_LEVEL,
  P2P_DUEL_BASE_DAMAGE,
  P2P_DUEL_CRIT_PER_LEVEL,
  P2P_DUEL_DURATION_MS,
  P2P_DUEL_ESCAPE_PX,
  P2P_DUEL_FLAG_FINISHED,
  P2P_DUEL_HP,
  P2P_GAME_TYPE,
  P2P_MATCH_END,
  P2P_SHOWDOWN_FLAG_FINAL,
  P2P_SHOWDOWN_FLAG_TIE,
  P2P_SHOWDOWN_MS,
  P2P_TAX_BPS,
} from '@niuma/shared-types';
import type {
  ActiveMatch,
  ChallengeContext,
  ChallengeHandler,
  DuelVentResolution,
} from '../types';
import type { Player } from '../../sim/world';

interface DuelState {
  hpA: number;
  hpB: number;
  centerX: number;
  centerY: number;
  lastStateAt: number;
  finished: boolean;
}

function stateOf(match: ActiveMatch): DuelState {
  return match.data.duel as DuelState;
}

function hpOf(state: DuelState, match: ActiveMatch, player: Player): number {
  return player.id === match.a.id ? state.hpA : state.hpB;
}

function damageOf(attacker: Player, target: Player): number {
  const crit = 1 + attacker.stats.critLv * P2P_DUEL_CRIT_PER_LEVEL;
  const armor = 1 + target.stats.armorLv * P2P_DUEL_ARMOR_PER_LEVEL;
  return Math.max(1, Math.round((P2P_DUEL_BASE_DAMAGE * crit) / armor));
}

function settleWith(
  match: ActiveMatch,
  state: DuelState,
  winnerId: number,
  endReason: number,
  ctx: ChallengeContext,
): void {
  if (state.finished) return;
  state.finished = true;
  ctx.duelState(state.hpA, state.hpB, P2P_DUEL_FLAG_FINISHED);
  ctx.showdown({
    round: 1,
    winnerId,
    flags: P2P_SHOWDOWN_FLAG_FINAL | (winnerId === 0 ? P2P_SHOWDOWN_FLAG_TIE : 0),
    dice: [state.hpA, state.hpB],
    durationMs: P2P_SHOWDOWN_MS,
  });
  ctx.finish(winnerId, endReason);
}

/**
 * `gameType = 3`：野外单挑切磋。
 *
 * 不依赖擂台：接受时双方中点作为约定中心，220px 外判负；30 秒超时按剩余 HP 裁决。
 * 伤害由头槌触发，`resolveVents` 只负责几何与击退，血量与结算都留在这里。
 */
export const duelHandler: ChallengeHandler = {
  gameType: P2P_GAME_TYPE.Duel,
  name: '野外切磋',
  durationMs: P2P_DUEL_DURATION_MS,
  payoutBps: 10_000 - P2P_TAX_BPS,
  onStart(match, ctx): void {
    match.data.duel = {
      hpA: P2P_DUEL_HP,
      hpB: P2P_DUEL_HP,
      centerX: (match.a.x + match.b.x) / 2,
      centerY: (match.a.y + match.b.y) / 2,
      lastStateAt: ctx.now,
      finished: false,
    } satisfies DuelState;
    match.endsAt = ctx.now + P2P_DUEL_DURATION_MS;
    ctx.duelState(P2P_DUEL_HP, P2P_DUEL_HP, 0);
  },
  onVentHit(match, attacker, target, ctx): DuelVentResolution | null {
    const state = stateOf(match);
    if (state.finished) return null;
    const targetHp = hpOf(state, match, target);
    // Space 起跳的 0.4s 无敌帧：这一下按空放处理，不扣血也不击退
    if (ctx.now < target.jumpUntilMs) {
      return { hit: false, damage: 0, hp: targetHp, ended: false };
    }
    const damage = damageOf(attacker, target);
    const nextHp = Math.max(0, targetHp - damage);
    if (target.id === match.a.id) state.hpA = nextHp;
    else state.hpB = nextHp;
    if (nextHp === 0) {
      // settleWith 统一广播 FINISHED 状态与亮牌，这里不再重复发一条
      settleWith(match, state, attacker.id, P2P_MATCH_END.Normal, ctx);
      return { hit: true, damage, hp: 0, ended: true };
    }
    ctx.duelState(state.hpA, state.hpB, 0);
    return { hit: true, damage, hp: nextHp, ended: false };
  },
  onTick(match, ctx): void {
    const state = stateOf(match);
    if (state.finished) return;

    const outA = Math.hypot(match.a.x - state.centerX, match.a.y - state.centerY) > P2P_DUEL_ESCAPE_PX;
    const outB = Math.hypot(match.b.x - state.centerX, match.b.y - state.centerY) > P2P_DUEL_ESCAPE_PX;
    if (outA || outB) {
      const winnerId = outA && outB ? 0 : outA ? match.b.id : match.a.id;
      settleWith(match, state, winnerId, P2P_MATCH_END.Fled, ctx);
      return;
    }

    if (ctx.now >= match.endsAt) {
      const winnerId =
        state.hpA === state.hpB ? 0 : state.hpA > state.hpB ? match.a.id : match.b.id;
      settleWith(match, state, winnerId, P2P_MATCH_END.Timeout, ctx);
      return;
    }

    // 1Hz 心跳：没掉血也要让围观者看到倒计时在走
    if (ctx.now - state.lastStateAt >= 1_000) {
      state.lastStateAt = ctx.now;
      ctx.duelState(state.hpA, state.hpB, 0);
    }
  },
};
