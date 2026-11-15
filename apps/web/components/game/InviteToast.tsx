'use client';

import { Swords } from 'lucide-react';
import { useEffect, useState } from 'react';
import { P2P_GAME_NAME, P2P_GAME_TYPE } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { serverNow } from '@/lib/game/server-clock';

const GAME_RULE: Record<number, string> = {
  [P2P_GAME_TYPE.Dice]: '3 颗骰子 · 赢家拿 95%',
  [P2P_GAME_TYPE.Rps]: '5 秒盲选 · 平局加赛',
  [P2P_GAME_TYPE.Duel]: '100 HP · 30 秒 · 出圈判负',
};

interface InviteToastProps {
  onRespond: (inviteId: number, accept: boolean) => void;
}

/** 右上角邀请浮窗：15 秒 TTL 与服务器时钟对齐，最后 3 秒边框转红。 */
export function InviteToast({ onRespond }: InviteToastProps) {
  const invite = useGameUi((state) => state.invite);
  const setInvite = useGameUi((state) => state.setInvite);
  const [leftMs, setLeftMs] = useState(0);

  useEffect(() => {
    if (!invite) return;
    const update = () => setLeftMs(Math.max(0, invite.expiresAt - serverNow()));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [invite]);

  useEffect(() => {
    if (!invite || leftMs > 0) return;
    // 到点先本地收起：服务端也会推一条 Expired，这里只负责视觉不残留
    setInvite(null);
  }, [invite, leftMs, setInvite]);

  if (!invite) return null;
  const seconds = Math.ceil(leftMs / 1000);
  const urgent = leftMs <= 3000;

  return (
    <div
      className={`pointer-events-auto fixed right-3 top-28 z-50 w-[248px] border-2 bg-ink-900/95 p-3 backdrop-blur-sm ${
        urgent ? 'border-signal-500 animate-pulse' : 'border-ink-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <Swords className="h-4 w-4 text-mint-400" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-mist-100">
          {invite.packet.fromName} 邀你对战
        </p>
        <span className={`font-mono text-[12px] ${urgent ? 'text-signal-500' : 'text-[#F2C879]'}`}>
          {seconds}s
        </span>
      </div>
      <p className="mt-1 text-[11px] text-mist-400">
        {P2P_GAME_NAME[invite.packet.gameType] ?? '互动'} · 押注{' '}
        <span className="font-mono text-[#F2C879]">{invite.packet.wager}</span> 币
      </p>
      <p className="mt-0.5 font-mono text-[9px] text-mist-500">
        {GAME_RULE[invite.packet.gameType] ?? '服务端裁决'}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => onRespond(invite.packet.inviteId, true)}
          className="border-2 border-mint-500 bg-mint-500/15 py-1.5 text-[12px] font-semibold text-mint-400 hover:bg-mint-500/25"
        >
          接受
        </button>
        <button
          type="button"
          onClick={() => onRespond(invite.packet.inviteId, false)}
          className="border-2 border-ink-600 py-1.5 text-[12px] text-mist-300 hover:border-signal-500 hover:text-signal-500"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
