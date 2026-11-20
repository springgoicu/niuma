'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Fish, Ghost, HeartPulse, X } from 'lucide-react';
import {
  FISHING_ACTION,
  FISHING_STATE,
  GHOST_MODE,
  GIG_ACTION,
  GIG_KIND,
  GIG_STATE,
} from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { serverNow } from '@/lib/game/server-clock';

interface GigAndStatusHUDProps {
  onFishing: (action: number, spotId: number) => void;
  onGig: (action: number, targetId?: number) => void;
  onCprSelf: () => void;
}

/**
 * GTA 零工 / 摸鱼钓鱼 / 濒死幽灵态 HUD 条（Warm NiomaOS 95）。
 */
export function GigAndStatusHUD({ onFishing, onGig, onCprSelf }: GigAndStatusHUDProps) {
  const gig = useGameUi((state) => state.gig);
  const fishing = useGameUi((state) => state.fishing);
  const ghost = useGameUi((state) => state.ghost);
  const [, setTick] = useState(0);

  const gigActive = gig !== null && gig.state === GIG_STATE.Active;
  const fishingActive =
    fishing.state === FISHING_STATE.Waiting || fishing.state === FISHING_STATE.Biting;
  const ghostActive = ghost.mode !== GHOST_MODE.Alive;

  const gigLeftSec =
    gigActive && gig
      ? Math.max(0, Math.ceil((gig.receivedAt + gig.timeLeftSec * 1000 - serverNow()) / 1000))
      : 0;
  const ghostLeftSec =
    ghostActive && ghost.updatedAt > 0
      ? Math.max(0, Math.ceil((ghost.updatedAt + ghost.leftMs - serverNow()) / 1000))
      : 0;

  useEffect(() => {
    if (!gigActive && !ghostActive) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [gigActive, ghostActive]);

  if (!gigActive && !fishingActive && !ghostActive) return null;

  return (
    <div className="pointer-events-auto flex flex-col gap-2 font-mono">
      {ghostActive && (
        <div
          role="status"
          className="border-2 border-[#6fb6c9] bg-[#1e2636]/95 px-3 py-2 text-[#e8f6fa] shadow-[3px_3px_0_rgba(24,32,44,0.8)]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#7ee3f0]">
              {ghost.mode === GHOST_MODE.Ghost ? (
                <Ghost className="h-3.5 w-3.5 animate-pulse" aria-hidden />
              ) : (
                <HeartPulse className="h-3.5 w-3.5 text-[#ff7b7b]" aria-hidden />
              )}
              {ghost.mode === GHOST_MODE.Ghost
                ? '灵魂出窍 · 可自由穿墙游荡'
                : `街头倒地待救 · CPR ${ghost.cprProgress}%`}
            </span>
            <span className="text-[10px] text-[#f2c879]">{ghostLeftSec}s</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="h-1.5 flex-1 bg-[#2a3142]">
              <div
                className="h-full bg-[#4fe3c1] transition-all"
                style={{ width: `${Math.min(100, Math.max(0, ghost.cprProgress))}%` }}
              />
            </div>
            {ghost.mode === GHOST_MODE.Flatline && (
              <button
                type="button"
                onClick={onCprSelf}
                className="cursor-pointer border border-[#4fe3c1] bg-[#2a3142] px-2 py-0.5 text-[10px] font-bold text-[#4fe3c1] hover:bg-[#364258]"
              >
                [H] 灵魂出窍
              </button>
            )}
          </div>
        </div>
      )}

      {fishingActive && (
        <div
          role="status"
          className={`border-2 px-3 py-2 shadow-[3px_3px_0_rgba(24,32,44,0.8)] ${
            fishing.state === FISHING_STATE.Biting
              ? 'border-[#f2c879] bg-[#364258]/95 text-[#f4ede1]'
              : 'border-[#2a3142] bg-[#e8dfcf]/95 text-[#2a3142]'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px] font-bold">
              <Fish className="h-3.5 w-3.5" aria-hidden />
              {fishing.state === FISHING_STATE.Biting
                ? '🔥 鱼咬钩了！快按 [F] 收竿！'
                : `摸鱼抛竿中（栈桥 #${fishing.spotId + 1}）…`}
            </span>
            <div className="flex items-center gap-1.5">
              {fishing.state === FISHING_STATE.Biting && (
                <button
                  type="button"
                  onClick={() => onFishing(FISHING_ACTION.Reel, fishing.spotId)}
                  className="cursor-pointer border border-[#2a3142] bg-[#f2c879] px-2 py-0.5 text-[10px] font-bold text-[#2a3142] hover:bg-[#ffe08a]"
                >
                  提竿
                </button>
              )}
              <button
                type="button"
                onClick={() => onFishing(FISHING_ACTION.Cancel, fishing.spotId)}
                className="cursor-pointer border border-[#2a3142] bg-[#c9c1b0] px-1.5 py-0.5 text-[10px] text-[#2a3142]"
              >
                收线
              </button>
            </div>
          </div>
        </div>
      )}

      {gigActive && gig && (
        <div className="border-2 border-[#2a3142] bg-[#e8dfcf]/95 px-3 py-2 text-[#2a3142] shadow-[3px_3px_0_rgba(24,32,44,0.8)]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold">
              <Briefcase className="h-3.5 w-3.5 text-[#8c5a18]" aria-hidden />
              {gig.kind === GIG_KIND.PatrolAssist ? '零工 · 协助巡逻抓捕' : '零工 · 外卖极速跑腿'}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="border border-[#2a3142] bg-[#f2c879] px-1.5 py-0.5 text-[10px] font-bold">
                +¥{gig.reward} · {gigLeftSec}s
              </span>
              <button
                type="button"
                aria-label="放弃零工"
                onClick={() => onGig(GIG_ACTION.Abandon, gig.targetId)}
                className="cursor-pointer border border-[#2a3142] bg-[#d9d2c3] p-0.5 text-[#2a3142] hover:bg-[#c85c5c] hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-[#5c6678]">
            前往小地图金色目标标点（{Math.round(gig.targetX)}, {Math.round(gig.targetY)}）按 [G] 或 [F] 交付
          </p>
        </div>
      )}
    </div>
  );
}
