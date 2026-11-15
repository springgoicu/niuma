'use client';

import { ShoppingCart } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { hudButtonClassName } from './Hud';

/**
 * HUD 上的「摸鱼百宝箱」入口（ADR-0085）。
 *
 * 与金币徽标分工：徽标看余额、顺手进属性页；这个按钮是「随时买消耗品」的快捷入口，
 * 直接落到消耗品页。两个入口共用同一个抽屉，不存在两份购物车状态。
 */
export function ShopButton({ compact = false }: { compact?: boolean }) {
  const setShopOpen = useGameUi((state) => state.setShopOpen);
  const shoutOpen = useGameUi((state) => state.shoutOpen);

  return (
    <button
      type="button"
      onClick={() => setShopOpen(true, 'items')}
      disabled={shoutOpen}
      aria-label="打开摸鱼百宝箱"
      title="摸鱼百宝箱：冰美式 / 护盾 / 整蛊道具"
      className={hudButtonClassName({ compact, active: shoutOpen })}
    >
      <ShoppingCart className="h-4 w-4" aria-hidden />
    </button>
  );
}
