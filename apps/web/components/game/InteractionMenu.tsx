'use client';

import { Bomb, Coins, IdCard, Swords } from 'lucide-react';
import { ITEM_SKUS, ITEM_TARGET } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

interface InteractionMenuProps {
  onInspect: (id: number) => void;
  onChallenge: (id: number, name: string) => void;
  /** 直接打赏：不弹面板、不二次确认，默认 10 币 */
  onQuickTip: (id: number) => void;
}

/** 快捷打赏固定额：与 GameViewport 的 onQuickTip 发包额一致 */
const QUICK_TIP_COINS = 10;

/** 画布点人后的快捷菜单：挑战 / 道具 / 打赏 / 工牌 + 直接打赏，点空白处收起。 */
export function InteractionMenu({ onInspect, onChallenge, onQuickTip }: InteractionMenuProps) {
  const target = useGameUi((state) => state.menuTarget);
  const inventory = useGameUi((state) => state.wallet.inventory);
  const coins = useGameUi((state) => state.wallet.coins);
  const setMenuTarget = useGameUi((state) => state.setMenuTarget);
  const setActionTarget = useGameUi((state) => state.setActionTarget);
  if (!target) return null;

  // 整蛊道具的持有总数：直接写在按钮副标题上，不必点进去才发现背包是空的
  const trickCount = ITEM_SKUS.reduce(
    (sum, sku) =>
      sku.target === ITEM_TARGET.Other ? sum + (inventory[sku.key] ?? 0) : sum,
    0,
  );

  const badges = target.badge;
  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 sm:bottom-28">
      <div className="w-[188px] border-2 border-ink-600 bg-ink-900/95 p-2 shadow-[4px_4px_0_rgba(0,0,0,0.4)] backdrop-blur-sm">
        <p className="mb-2 truncate px-1 text-[11px] text-mist-400">
          {target.name}
          {badges?.status ? ` · ${badges.status}` : ''}
        </p>
        <div className="grid grid-cols-2 gap-1">
          <MenuButton
            label="发起挑战"
            hint="骰子 / 猜拳 / 切磋"
            icon={<Swords className="h-4 w-4" />}
            tone="mint"
            onClick={() => {
              setMenuTarget(null);
              onChallenge(target.id, target.name);
            }}
          />
          <MenuButton
            label="整蛊"
            hint={trickCount > 0 ? `持有 ${trickCount} 件` : '背包为空'}
            icon={<Bomb className="h-4 w-4" />}
            onClick={() => {
              setMenuTarget(null);
              setActionTarget({ id: target.id, name: target.name, mode: 'item' });
            }}
          />
          <MenuButton
            label="打赏"
            hint="牛马币"
            icon={<Coins className="h-4 w-4" />}
            tone="gold"
            onClick={() => {
              setMenuTarget(null);
              setActionTarget({ id: target.id, name: target.name, mode: 'tip' });
            }}
          />
          <MenuButton
            label="查看工牌"
            hint="档案"
            icon={<IdCard className="h-4 w-4" />}
            onClick={() => {
              setMenuTarget(null);
              onInspect(target.id);
            }}
          />
        </div>
        <button
          type="button"
          // 服务端对扣款失败静默 return（无 tip reject 包），快捷打赏若照发就是「点了没反应」；
          // 这里先按余额挡一道，与 PlayerActionDialog 的预设按钮同一口径
          disabled={coins < QUICK_TIP_COINS}
          title={coins < QUICK_TIP_COINS ? '牛马币不足，打赏需要 10 币' : `直接打赏 ${QUICK_TIP_COINS} 币`}
          onClick={() => {
            setMenuTarget(null);
            onQuickTip(target.id);
          }}
          className={`mt-1 flex w-full items-center justify-center gap-1 border-2 py-1.5 text-[11px] font-semibold ${
            coins < QUICK_TIP_COINS
              ? 'cursor-not-allowed border-ink-700 text-mist-500'
              : 'border-[#F2C879]/60 bg-[#F2C879]/10 text-[#F2C879] hover:bg-[#F2C879]/20'
          }`}
        >
          <Coins className="h-3.5 w-3.5" aria-hidden />
          {coins < QUICK_TIP_COINS ? '余额不足 · 打赏需 10 币' : `直接打赏 ${QUICK_TIP_COINS} 币`}
        </button>
      </div>
    </div>
  );
}

function MenuButton({
  label,
  hint,
  icon,
  tone = 'plain',
  onClick,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  tone?: 'plain' | 'mint' | 'gold';
  onClick: () => void;
}) {
  const color =
    tone === 'mint'
      ? 'text-mint-400 hover:bg-mint-500/15'
      : tone === 'gold'
        ? 'text-[#F2C879] hover:bg-[#F2C879]/15'
        : 'text-mist-200 hover:bg-ink-800';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 border-2 border-ink-700 px-2 py-1.5 text-left ${color}`}
    >
      {icon}
      <span className="text-[11px] font-semibold leading-none">{label}</span>
      <span className="font-mono text-[9px] text-mist-500">{hint}</span>
    </button>
  );
}
