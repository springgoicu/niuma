'use client';

import { useEffect } from 'react';
import { useGameUi } from '@/lib/game-ui';

/** 金币飘字：最多保留 5 条，每条 1.1 秒后由组件自己清出 store。 */
export function CoinPops() {
  const pops = useGameUi((state) => state.coinPops);
  const clear = useGameUi((state) => state.clearCoinPop);

  useEffect(() => {
    if (pops.length === 0) return;
    const timers = pops.map((pop) => setTimeout(() => clear(pop.key), 1100));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [pops, clear]);

  if (pops.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-40 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1">
      {pops.map((pop, index) => (
        <span
          key={pop.key}
          className={`coin-float font-mono text-[13px] ${
            pop.amount >= 0 ? 'text-[#F2C879]' : 'text-signal-500'
          }`}
          style={{ animationDelay: `${index * 40}ms` }}
        >
          {pop.amount >= 0 ? '+' : ''}
          {pop.amount} 牛马币
        </span>
      ))}
    </div>
  );
}
