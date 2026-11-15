'use client';

import { Coins } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { hudButtonClassName } from './Hud';

/**
 * 右上角牛马币徽标：数字用金色等宽体，变动时从余额上方飘一行 `+N / −N`。
 * 点击整块打开商店，因此它不是一个只读数字，而是商店的唯一入口。
 */
export function WalletBadge({ compact = false }: { compact?: boolean }) {
  const coins = useGameUi((state) => state.wallet.coins);
  const latestPop = useGameUi((state) => state.coinPops[state.coinPops.length - 1]);
  const setShopOpen = useGameUi((state) => state.setShopOpen);

  return (
    <button
      type="button"
      onClick={() => setShopOpen(true, 'stats')}
      aria-label="打开牛马币商店"
      title="牛马币：升级属性、购买道具"
      className={`${hudButtonClassName({ compact })} relative min-w-[64px] gap-1 px-2`}
    >
      <Coins className="h-4 w-4 text-[#F2C879]" aria-hidden />
      <span className="font-mono text-[13px] tabular-nums tracking-tight text-[#F2C879]">
        {coins}
      </span>
      {latestPop && (
        <span
          key={latestPop.key}
          className={`coin-pop pointer-events-none absolute -top-1 right-1 font-mono text-[11px] ${
            latestPop.amount >= 0 ? 'text-[#F2C879]' : 'text-signal-500'
          }`}
        >
          {latestPop.amount >= 0 ? '+' : ''}
          {latestPop.amount}
        </span>
      )}
    </button>
  );
}
