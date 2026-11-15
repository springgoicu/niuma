'use client';

import { X } from 'lucide-react';
import {
  VILLA_ACTION,
  VILLA_INCOME,
  VILLA_PRICE,
  VILLA_SPECS,
  type VillaStatePacket,
} from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

interface VillaDialogProps {
  villa: number;
  villas: VillaStatePacket | null;
  coins: number;
  onClose: () => void;
  onAction: (villa: number, action: number) => void;
}

/**
 * 豪宅小院卡片（ADR-0087）。
 *
 * 三态：无主（标价 1000）→ 已拥有（可锁门 / 收币）→ 已锁门（门栅挡客）。
 * 冠名权只在本运行周期有效，重启园区重新挂牌；牌匾上的名字由服务端随包下发。
 */
export function VillaDialog({ villa, villas, coins, onClose, onAction }: VillaDialogProps) {
  const selfId = useGameUi((state) => state.selfId);
  const spec = VILLA_SPECS.find((item) => item.id === villa) ?? VILLA_SPECS[0]!;
  const info = villas?.villas.find((item) => item.id === villa) ?? null;
  const owned = (info?.ownerId ?? 0) !== 0;
  const mine = owned && info?.ownerId === selfId;
  const affordable = coins >= VILLA_PRICE;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-4 pb-24 sm:items-center sm:pb-0">
      <div className="w-full max-w-[360px] border-2 border-ink-600 bg-ink-900/95 p-3 shadow-[4px_4px_0_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-mist-100">
            豪宅小院 · <span className="text-mint-400">{spec.name}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink-700 p-1 text-mist-400 hover:text-signal-500"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-2 border-2 border-ink-700 bg-ink-950/60 px-3 py-2 text-center">
          <p className="font-mono text-[10px] text-mist-500">门口牌匾</p>
          <p className="mt-1 text-[14px] font-semibold text-[#F2C879]">
            {owned ? info!.ownerName || '神秘房主' : `待售 ${VILLA_PRICE} 币`}
          </p>
          {owned && (
            <p className="mt-1 font-mono text-[9px] text-mist-400">
              {info!.locked ? '已锁门 · 门栅挡客' : '院门开放'}
            </p>
          )}
        </div>

        <p className="mt-2 px-1 text-[10px] leading-relaxed text-mist-400">
          买下即可在本运行周期冠名；院内摇钱树每 60 秒结 {VILLA_INCOME} 币，最多囤 10 分钟。
          锁门后门栅变成碰撞，只有你自己（同设备）再按 F 可以开门。
        </p>

        {!owned && (
          <button
            type="button"
            disabled={!affordable}
            onClick={() => onAction(villa, VILLA_ACTION.Buy)}
            className={`mt-2 w-full border-2 py-2 text-[12px] font-semibold ${
              affordable
                ? 'border-[#F2C879] bg-[#F2C879]/15 text-[#F2C879] hover:bg-[#F2C879]/25'
                : 'cursor-not-allowed border-ink-700 text-mist-500'
            }`}
          >
            {affordable ? `买下冠名权 · ${VILLA_PRICE} 币` : '余额不足'}
          </button>
        )}

        {owned && mine && (
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => onAction(villa, VILLA_ACTION.ToggleLock)}
              className="border-2 border-ink-700 py-2 text-[12px] text-mist-200 hover:bg-ink-800"
            >
              {info!.locked ? '开门迎客' : '锁门'}
            </button>
            <button
              type="button"
              onClick={() => onAction(villa, VILLA_ACTION.Collect)}
              className="border-2 border-mint-500 bg-mint-500/10 py-2 text-[12px] text-mint-300 hover:bg-mint-500/20"
            >
              收币 {info?.pending ?? 0}
            </button>
          </div>
        )}

        {owned && !mine && (
          <p className="mt-2 text-center font-mono text-[10px] text-mist-500">
            这是别人的院子，摇钱树只认房主
          </p>
        )}
      </div>
    </div>
  );
}
