'use client';

import { Coins, Swords, X } from 'lucide-react';
import { ITEM_SKUS, ITEM_TARGET } from '@niuma/shared-types';
import { useState } from 'react';
import { useGameUi } from '@/lib/game-ui';

interface PlayerActionDialogProps {
  onTip: (targetId: number, amount: number) => void;
  onUseItem: (targetId: number, itemId: number) => void;
}

const TIP_PRESETS = [10, 50, 100];

/** 打赏 / 道具共用一个目标面板：切换页签不会丢目标，确认后立即关闭。 */
export function PlayerActionDialog({ onTip, onUseItem }: PlayerActionDialogProps) {
  const target = useGameUi((state) => state.actionTarget);
  const wallet = useGameUi((state) => state.wallet);
  const setTarget = useGameUi((state) => state.setActionTarget);
  const [custom, setCustom] = useState('');
  if (!target) return null;
  const mode = target.mode;

  // 点人面板只列「整蛊」类：自用道具从这里放出去只会被服务端拒绝
  const owned = ITEM_SKUS.filter(
    (sku) => sku.target === ITEM_TARGET.Other && (wallet.inventory[sku.key] ?? 0) > 0,
  );
  const amount = Number.parseInt(custom, 10);
  const canTip = Number.isFinite(amount) && amount > 0 && amount <= wallet.coins;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 px-3 pb-24 sm:items-center sm:pb-0">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 cursor-default"
        onClick={() => setTarget(null)}
      />
      <div className="relative w-full max-w-[340px] border-2 border-ink-600 bg-ink-900/95 p-4 shadow-[6px_6px_0_rgba(0,0,0,0.45)]">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-bold text-mist-100">{target.name}</h2>
            <p className="flex items-center gap-1 font-mono text-[11px] text-[#F2C879]">
              <Coins className="h-3 w-3" /> {wallet.coins}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTarget(null)}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center border-2 border-ink-600 text-mist-300 hover:border-mint-400 hover:text-mint-400"
          >
            <X className="h-3 w-3" />
          </button>
        </header>

        <div className="mb-3 grid grid-cols-2 gap-1">
          <TabButton
            active={mode === 'tip'}
            onClick={() => setTarget({ ...target, mode: 'tip' })}
            icon={<Coins className="h-3 w-3" />}
            label="打赏"
          />
          <TabButton
            active={mode === 'item'}
            onClick={() => setTarget({ ...target, mode: 'item' })}
            icon={<Swords className="h-3 w-3" />}
            label="整蛊"
          />
        </div>

        {mode === 'tip' ? (
          <div>
            <div className="grid grid-cols-3 gap-1">
              {TIP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={preset > wallet.coins}
                  onClick={() => {
                    onTip(target.id, preset);
                    setTarget(null);
                  }}
                  className={`border-2 py-2 font-mono text-[12px] ${
                    preset > wallet.coins
                      ? 'cursor-not-allowed border-ink-700 text-mist-500'
                      : 'border-[#F2C879]/60 text-[#F2C879] hover:bg-[#F2C879]/15'
                  }`}
                >
                  {preset} 币
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1">
              <input
                value={custom}
                onChange={(event) => setCustom(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="自定义金额"
                className="min-w-0 flex-1 border-2 border-ink-700 bg-ink-950 px-2 py-1.5 font-mono text-[12px] text-mist-100 outline-none placeholder:text-mist-600 focus:border-mint-500"
              />
              <button
                type="button"
                disabled={!canTip}
                onClick={() => {
                  onTip(target.id, amount);
                  setTarget(null);
                }}
                className={`border-2 px-3 py-1.5 text-[12px] ${
                  canTip
                    ? 'border-mint-500 text-mint-400 hover:bg-mint-500/15'
                    : 'cursor-not-allowed border-ink-700 text-mist-500'
                }`}
              >
                转币
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {owned.length === 0 && (
              <p className="border-2 border-dashed border-ink-700 px-3 py-6 text-center text-[12px] leading-relaxed text-mist-500">
                还没有整蛊道具。
                <br />
                去「摸鱼百宝箱」买香蕉皮 / 降薪贴 / 保安卡。
              </p>
            )}
            {owned.map((sku) => (
              <button
                key={sku.key}
                type="button"
                onClick={() => {
                  onUseItem(target.id, sku.id);
                  setTarget(null);
                }}
                className="flex items-center justify-between gap-2 border-2 border-ink-700 px-3 py-2 text-left hover:border-mint-500"
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-mist-100">{sku.name}</p>
                  <p className="truncate text-[10px] text-mist-400">{sku.blurb}</p>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-mint-400">
                  x{wallet.inventory[sku.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1 border-2 py-1.5 text-[12px] ${
        active
          ? 'border-mint-500 bg-mint-500/15 text-mint-400'
          : 'border-ink-700 text-mist-400 hover:text-mist-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
