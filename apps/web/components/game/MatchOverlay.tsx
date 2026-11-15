'use client';

import { Dices, Scissors, Swords } from 'lucide-react';
import {
  P2P_ACTION,
  P2P_ACTION_LABEL,
  P2P_DUEL_HP,
  P2P_GAME_NAME,
  P2P_GAME_TYPE,
  P2P_MATCH_END,
  P2P_MATCH_PHASE,
  P2P_RPS_MAX_ROUNDS,
  P2P_RPS_ROUND_MS,
  P2P_SHOWDOWN_FLAG_FINAL,
  P2P_SHOWDOWN_FLAG_TIE,
} from '@niuma/shared-types';
import { useEffect, useState } from 'react';
import { useGameUi } from '@/lib/game-ui';
import { serverNow } from '@/lib/game/server-clock';

const END_LABEL: Record<number, string> = {
  [P2P_MATCH_END.Normal]: '正常结算',
  [P2P_MATCH_END.Cancelled]: '对局取消',
  [P2P_MATCH_END.Timeout]: '超时结算',
  [P2P_MATCH_END.OpponentLeft]: '对手掉线，判你获胜',
  [P2P_MATCH_END.Fled]: '跑出约定范围，判负',
};

const GAME_ICON = {
  [P2P_GAME_TYPE.Dice]: Dices,
  [P2P_GAME_TYPE.Rps]: Scissors,
  [P2P_GAME_TYPE.Duel]: Swords,
} as const;

interface MatchOverlayProps {
  onAction: (matchId: number, action: number) => void;
}

/** 顶部对局条、猜拳盲选与结算卡片：Started 走倒计时，Finished 3 秒后自动淡出。 */
export function MatchOverlay({ onAction }: MatchOverlayProps) {
  const match = useGameUi((state) => state.match);
  const showdown = useGameUi((state) => state.showdown);
  const duel = useGameUi((state) => state.duel);
  const wallet = useGameUi((state) => state.wallet);
  const setMatch = useGameUi((state) => state.setMatch);
  const [leftMs, setLeftMs] = useState(0);
  const [round, setRound] = useState(1);
  const [picked, setPicked] = useState(0);
  const [roundEndsAt, setRoundEndsAt] = useState(0);

  // 新对局：猜拳回到第 1 轮；服务端不额外发回合包，靠 matchId 变更区分
  useEffect(() => {
    setRound(1);
    setPicked(0);
    if (match?.gameType === P2P_GAME_TYPE.Rps) setRoundEndsAt(serverNow() + match.remainingMs);
  }, [match?.matchId, match?.gameType, match?.remainingMs]);

  // 猜拳平局加赛：showdown 先到、match 仍是 Started，下一轮 5 秒从此刻重新计
  useEffect(() => {
    if (!showdown || showdown.packet.gameType !== P2P_GAME_TYPE.Rps) return;
    const tie = (showdown.packet.flags & P2P_SHOWDOWN_FLAG_TIE) !== 0;
    const final = (showdown.packet.flags & P2P_SHOWDOWN_FLAG_FINAL) !== 0;
    if (!tie || final) return;
    setRound(showdown.packet.round + 1);
    setPicked(0);
    setRoundEndsAt(serverNow() + P2P_RPS_ROUND_MS);
  }, [showdown?.receivedAt, showdown]);

  useEffect(() => {
    if (!match || match.phase !== P2P_MATCH_PHASE.Started) return;
    if (match.gameType === P2P_GAME_TYPE.Rps && roundEndsAt > 0) {
      const update = () => setLeftMs(Math.max(0, roundEndsAt - serverNow()));
      update();
      const timer = setInterval(update, 100);
      return () => clearInterval(timer);
    }
    const endsAt = serverNow() + match.remainingMs;
    const update = () => setLeftMs(Math.max(0, endsAt - serverNow()));
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [match, roundEndsAt]);

  useEffect(() => {
    if (!match || match.phase !== P2P_MATCH_PHASE.Finished) return;
    const timer = setTimeout(() => setMatch(null), 3000);
    return () => clearTimeout(timer);
  }, [match, setMatch]);

  if (!match) return null;
  const finished = match.phase === P2P_MATCH_PHASE.Finished;
  const won = finished && match.winnerId === match.selfId;
  const name = P2P_GAME_NAME[match.gameType] ?? '互动';
  const Icon = GAME_ICON[match.gameType as keyof typeof GAME_ICON] ?? Swords;
  const selfHp =
    duel && duel.packet.matchId === match.matchId
      ? duel.packet.aId === match.selfId
        ? duel.packet.hpA
        : duel.packet.hpB
      : P2P_DUEL_HP;
  const opponentHp =
    duel && duel.packet.matchId === match.matchId
      ? duel.packet.aId === match.selfId
        ? duel.packet.hpB
        : duel.packet.hpA
      : P2P_DUEL_HP;
  const showPicker = !finished && match.gameType === P2P_GAME_TYPE.Rps;
  const tie =
    showdown !== null &&
    showdown.packet.matchId === match.matchId &&
    showdown.packet.round === round &&
    (showdown.packet.flags & P2P_SHOWDOWN_FLAG_TIE) !== 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-40 flex flex-col items-center gap-1 px-3">
      {finished ? (
        <div className="pointer-events-auto w-full max-w-[360px] border-2 border-ink-600 bg-ink-900/95 px-4 py-3 text-center shadow-[4px_4px_0_rgba(0,0,0,0.4)]">
          <p className={`text-[15px] font-bold ${won ? 'text-mint-400' : 'text-signal-500'}`}>
            {match.winnerId === 0 ? '平局退款' : won ? '你赢了' : '你输了'}
          </p>
          <p className="mt-1 text-[11px] text-mist-400">
            {name} · 对手 {match.opponentName} · 押注 {match.wager} 币 ·{' '}
            {END_LABEL[match.endReason] ?? '已结算'}
          </p>
          <p className="mt-1 font-mono text-[12px] text-[#F2C879]">余额 {wallet.coins}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-2 border-ink-600 bg-ink-900/95 px-3 py-1.5">
            <Icon className="h-3.5 w-3.5 text-mint-400" aria-hidden />
            <span className="text-[12px] text-mist-200">{name}</span>
            <span className="max-w-[110px] truncate text-[11px] text-mist-400">
              {match.opponentName}
            </span>
            {match.gameType === P2P_GAME_TYPE.Duel && (
              <span className="font-mono text-[10px] text-signal-500">
                HP {selfHp}/{opponentHp}
              </span>
            )}
            {match.gameType === P2P_GAME_TYPE.Rps && (
              <span className="font-mono text-[10px] text-mist-400">
                第 {round}/{P2P_RPS_MAX_ROUNDS} 轮
              </span>
            )}
            <span className="font-mono text-[12px] tabular-nums text-[#F2C879]">
              {Math.ceil(leftMs / 1000)}s
            </span>
          </div>

          {showPicker && (
            <div className="pointer-events-auto mt-1 w-full max-w-[360px] border-2 border-ink-600 bg-ink-900/95 p-2">
              <p className="mb-1.5 text-center text-[11px] text-mist-300">
                {picked === 0 ? '极速盲选 · 5 秒内出拳' : `已出 ${P2P_ACTION_LABEL[picked]}`}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {[P2P_ACTION.Rock, P2P_ACTION.Scissors, P2P_ACTION.Paper].map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={picked !== 0}
                    onClick={() => {
                      setPicked(action);
                      onAction(match.matchId, action);
                    }}
                    className={`border-2 py-3 text-[15px] font-bold ${
                      picked === action
                        ? 'border-[#F2C879] bg-[#F2C879]/20 text-[#F2C879]'
                        : picked !== 0
                          ? 'cursor-not-allowed border-ink-700 text-mist-500'
                          : 'border-mint-500 bg-mint-500/10 text-mint-300 hover:bg-mint-500/20'
                    }`}
                  >
                    {P2P_ACTION_LABEL[action]}
                  </button>
                ))}
              </div>
              {tie && (
                <p className="mt-1 text-center font-mono text-[10px] text-[#F2C879]">
                  平局，自动加赛…
                </p>
              )}
            </div>
          )}

          {!showPicker && match.gameType === P2P_GAME_TYPE.Dice && (
            <p className="font-mono text-[10px] text-mist-400">骰子滚动中，1.8 秒后结算</p>
          )}
          {!showPicker && match.gameType === P2P_GAME_TYPE.Duel && (
            <p className="font-mono text-[10px] text-mist-400">
              距中心 220px 内 · E 头槌 · Space 跳跃闪避
            </p>
          )}
        </>
      )}
    </div>
  );
}
