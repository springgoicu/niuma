'use client';

import { useState } from 'react';
import { RING_BENCH_SEAT_GROUP } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { ArenaBetDialog } from './ArenaBetDialog';
import { ChallengeDialog } from './ChallengeDialog';
import { CoinPops } from './CoinPops';
import { CoinShopDialog } from './CoinShopDialog';
import { DiceHallDialog } from './DiceHallDialog';
import { InteractionMenu } from './InteractionMenu';
import { InviteToast } from './InviteToast';
import { LoudspeakerBanner } from './LoudspeakerBanner';
import { LoudspeakerDialog } from './LoudspeakerDialog';
import { MatchOverlay } from './MatchOverlay';
import { PlayerActionDialog } from './PlayerActionDialog';
import { VillaDialog } from './VillaDialog';

export interface EconomyLayerProps {
  /** 发起挑战：玩法与押注由 ChallengeDialog 选择，总线再复核距离 / 余额 */
  onChallenge: (id: number, gameType: number, wager: number) => void;
  /** 快捷菜单里的直接打赏 */
  onQuickTip: (targetId: number) => void;
  onInspect: (id: number) => void;
  onTip: (targetId: number, amount: number) => void;
  onUseItem: (targetId: number, itemId: number) => void;
  /** 自用道具：宿主知道自己的 netId，面板不读会话状态 */
  onUseSelf: (itemId: number) => void;
  onBuy: (kind: number, id: number, count?: number) => void;
  onRespond: (inviteId: number, accept: boolean) => void;
  onP2PAction: (matchId: number, action: number) => void;
  /** 全服大喇叭：审核与扣道具都在服务端（ADR-0085） */
  onShout: (text: string) => void;
  // ---- 热区建筑（ADR-0087）：上行只带意图，金额与资格由服务端复核 ----
  onDiceBet: (table: number, side: number, amount: number) => void;
  onArenaBet: (side: number, amount: number) => void;
  onVilla: (villa: number, action: number) => void;
}

/** 默认押注：新玩家先看到 50，仍可在浮层里改成 0 / 10 / 200 或自定义 */
const DEFAULT_WAGER = 50;

/**
 * 互动 HUD 的单一挂载点：菜单、邀请、对局、商店、大喇叭、飘字共享同一层 z-index，
 * GameViewport 只负责把客户端方法绑进来，不再各自散落一层浮层。
 */
export function EconomyLayer({
  onChallenge,
  onQuickTip,
  onInspect,
  onTip,
  onUseItem,
  onUseSelf,
  onBuy,
  onRespond,
  onP2PAction,
  onShout,
  onDiceBet,
  onArenaBet,
  onVilla,
}: EconomyLayerProps) {
  const [challengeTarget, setChallengeTarget] = useState<{ id: number; name: string } | null>(null);
  const wallet = useGameUi((state) => state.wallet);
  const setShopOpen = useGameUi((state) => state.setShopOpen);
  const setShoutOpen = useGameUi((state) => state.setShoutOpen);
  // 热区建筑的面板开关与快照都放在 store 里：Worker 里算出来的意图只带一个 id
  const diceOpen = useGameUi((state) => state.diceOpen);
  const dice = useGameUi((state) => state.dice);
  const setDiceOpen = useGameUi((state) => state.setDiceOpen);
  const arenaBetOpen = useGameUi((state) => state.arenaBetOpen);
  const setArenaBetOpen = useGameUi((state) => state.setArenaBetOpen);
  const arenaPool = useGameUi((state) => state.arenaPool);
  const ring = useGameUi((state) => state.ring);
  const seatGroup = useGameUi((state) => state.seatGroup);
  const villaOpen = useGameUi((state) => state.villaOpen);
  const setVillaOpen = useGameUi((state) => state.setVillaOpen);
  const villas = useGameUi((state) => state.villas);

  return (
    <>
      <InteractionMenu
        onInspect={onInspect}
        onChallenge={(id, name) => setChallengeTarget({ id, name })}
        onQuickTip={(id) => onQuickTip(id)}
      />
      {challengeTarget && (
        <ChallengeDialog
          target={challengeTarget}
          coins={wallet.coins}
          defaultWager={DEFAULT_WAGER}
          onClose={() => setChallengeTarget(null)}
          onConfirm={onChallenge}
        />
      )}
      <InviteToast onRespond={onRespond} />
      <MatchOverlay onAction={onP2PAction} />
      <PlayerActionDialog onTip={onTip} onUseItem={onUseItem} />
      <CoinShopDialog
        onBuy={onBuy}
        onUse={onUseSelf}
        // 喇叭要输入文案：先收起抽屉，避免两个浮层叠在一起
        onShout={() => {
          setShopOpen(false);
          setShoutOpen(true);
        }}
      />
      <LoudspeakerDialog onSend={onShout} />
      <LoudspeakerBanner />

      {/* 热区建筑（ADR-0087）：面板开关存在 store 里，Worker 只负责发意图 */}
      {diceOpen !== null && (
        <DiceHallDialog
          table={diceOpen}
          dice={dice}
          coins={wallet.coins}
          onClose={() => setDiceOpen(null)}
          onBet={onDiceBet}
        />
      )}
      {arenaBetOpen && (
        <ArenaBetDialog
          pool={arenaPool}
          ring={ring?.packet ?? null}
          coins={wallet.coins}
          seated={seatGroup === RING_BENCH_SEAT_GROUP}
          onClose={() => setArenaBetOpen(false)}
          onBet={onArenaBet}
        />
      )}
      {villaOpen !== null && (
        <VillaDialog
          villa={villaOpen}
          villas={villas}
          coins={wallet.coins}
          onClose={() => setVillaOpen(null)}
          onAction={onVilla}
        />
      )}
      <CoinPops />
    </>
  );
}
