'use client';

import { useCallback } from 'react';
import { Coins, Lock, ShoppingBag, Sparkles, Swords, X } from 'lucide-react';
import {
  COSMETIC_SKUS,
  ITEM_SKUS,
  ITEM_TARGET,
  MAX_STAT_LEVEL,
  SHOP_KIND,
  STAT_SKUS,
  statUpgradePrice,
  type ItemSku,
} from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { useModalKeys } from '@/lib/game/use-modal-keys';

interface CoinShopDialogProps {
  onBuy: (kind: number, id: number, count?: number) => void;
  /** 自用道具：点「使用」等价于对自己投放（targetId 由宿主补上） */
  onUse: (itemId: number) => void;
  /** 大喇叭没有目标，买下后打开输入面板 */
  onShout: () => void;
}

/**
 * 摸鱼百宝箱（ADR-0085）：右侧抽屉，拆成「属性 / 消耗品」两个页签。
 *
 * 价格、目录、等级上限全部读 shared-types，客户端不另造一份价目表；
 * 页签状态放在 `useGameUi.shopTab`，茶台 F 与购物车按钮因此能直接落到对应页。
 */
export function CoinShopDialog({ onBuy, onUse, onShout }: CoinShopDialogProps) {
  const open = useGameUi((state) => state.shopOpen);
  const tab = useGameUi((state) => state.shopTab);
  const wallet = useGameUi((state) => state.wallet);
  const setOpen = useGameUi((state) => state.setShopOpen);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useModalKeys(open, close);
  if (!open) return null;

  const selfItems = ITEM_SKUS.filter((sku) => sku.target === ITEM_TARGET.Self);
  const trickItems = ITEM_SKUS.filter((sku) => sku.target === ITEM_TARGET.Other);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex justify-end bg-ink-950/60 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="关闭商店"
        className="absolute inset-0 cursor-default"
        onClick={() => setOpen(false)}
      />
      <aside className="relative flex h-full w-full max-w-[380px] flex-col border-l-2 border-ink-600 bg-ink-900/95 shadow-[-8px_0_0_rgba(0,0,0,0.35)]">
        <header className="flex items-center justify-between border-b-2 border-ink-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-mint-400" aria-hidden />
            <h2 className="text-[15px] font-bold tracking-wide text-mist-100">摸鱼百宝箱</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="关闭"
            className="grid h-8 w-8 place-items-center border-2 border-ink-600 text-mist-300 hover:border-mint-400 hover:text-mint-400"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex items-center justify-between border-b-2 border-ink-700 bg-ink-950/60 px-4 py-2">
          <span className="text-[11px] tracking-widest text-mist-400">当前余额</span>
          <span className="flex items-center gap-1 font-mono text-[16px] text-[#F2C879]">
            <Coins className="h-4 w-4" aria-hidden />
            {wallet.coins}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 border-b-2 border-ink-700 px-4 py-2">
          <TabButton
            active={tab === 'stats'}
            label="属性强化"
            onClick={() => setOpen(true, 'stats')}
          />
          <TabButton
            active={tab === 'items'}
            label="消耗品"
            onClick={() => setOpen(true, 'items')}
          />
          {/* 赛博茶水强化站的装扮货架（ADR-0087）：买下即解锁，捏人界面可直接换 */}
          <TabButton
            active={tab === 'cosmetics'}
            label="装扮"
            onClick={() => setOpen(true, 'cosmetics')}
          />
        </div>

        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === 'stats' ? (
            <div className="flex flex-col gap-2">
              {STAT_SKUS.map((sku, statIndex) => {
                const level = wallet.stats[sku.key];
                const price = statUpgradePrice(sku.key, level);
                const maxed = level >= MAX_STAT_LEVEL;
                const short = price > wallet.coins;
                return (
                  <div key={sku.key} className="border-2 border-ink-700 bg-ink-950/50 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-mist-100">{sku.name}</p>
                        <p className="text-[11px] leading-snug text-mist-400">{sku.blurb}</p>
                      </div>
                      <button
                        type="button"
                        disabled={maxed || short}
                        onClick={() => onBuy(0, statIndex, 1)}
                        className={`shrink-0 border-2 px-2 py-1 font-mono text-[11px] tracking-wide ${
                          maxed
                            ? 'cursor-not-allowed border-ink-700 text-mist-500'
                            : short
                              ? 'cursor-not-allowed border-signal-500/60 text-signal-500'
                              : 'border-mint-500 text-mint-400 hover:bg-mint-500/15 active:translate-y-px'
                        }`}
                      >
                        {maxed ? (
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" /> 满级
                          </span>
                        ) : short ? (
                          `${price} 币`
                        ) : (
                          `升级 ${price}`
                        )}
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1" aria-label={`${sku.name}等级 ${level}`}>
                      {Array.from({ length: MAX_STAT_LEVEL }, (_, index) => (
                        <span
                          key={index}
                          className={`h-1.5 flex-1 ${index < level ? 'bg-mint-400' : 'bg-ink-700'}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : tab === 'items' ? (
            <>
              <h3 className="mb-3 flex items-center gap-1 text-[11px] tracking-[0.2em] text-mist-400">
                <Sparkles className="h-3 w-3" aria-hidden /> 自用
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {selfItems.map((sku) => (
                  <ItemCard
                    key={sku.id}
                    sku={sku}
                    coins={wallet.coins}
                    owned={wallet.inventory[sku.key] ?? 0}
                    onBuy={onBuy}
                    onUse={onUse}
                    onShout={onShout}
                  />
                ))}
              </div>

              <h3 className="mb-3 mt-5 flex items-center gap-1 text-[11px] tracking-[0.2em] text-mist-400">
                <Swords className="h-3 w-3" aria-hidden /> 整蛊 · 点人释放
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {trickItems.map((sku) => (
                  <ItemCard
                    key={sku.id}
                    sku={sku}
                    coins={wallet.coins}
                    owned={wallet.inventory[sku.key] ?? 0}
                    onBuy={onBuy}
                    onUse={onUse}
                    onShout={onShout}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1 text-[11px] tracking-[0.2em] text-mist-400">
                <Sparkles className="h-3 w-3" aria-hidden /> 赛博茶水强化站
              </h3>
              {COSMETIC_SKUS.map((sku) => {
                const unlocked = wallet.unlockedCosmetics.includes(sku.key);
                const short = sku.price > wallet.coins;
                return (
                  <div
                    key={sku.id}
                    className="flex items-center justify-between gap-3 border-2 border-ink-700 bg-ink-950/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-mist-100">{sku.name}</p>
                      <p className="text-[11px] leading-snug text-mist-400">
                        槽位 {sku.slot} · 买下后可在捏人界面直接佩戴
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={unlocked || short}
                      onClick={() => onBuy(SHOP_KIND.Cosmetic, sku.id, 1)}
                      className={`shrink-0 border-2 px-2 py-1 font-mono text-[11px] ${
                        unlocked
                          ? 'cursor-default border-ink-700 text-mist-500'
                          : short
                            ? 'cursor-not-allowed border-signal-500/60 text-signal-500'
                            : 'border-mint-500 text-mint-400 hover:bg-mint-500/15 active:translate-y-px'
                      }`}
                    >
                      {unlocked ? '已解锁' : `${sku.price} 币`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <footer className="border-t-2 border-ink-700 px-4 py-2 text-[11px] leading-snug text-mist-500">
          余额变动实时同步；整蛊道具从点人菜单释放，同一目标 60 秒内只会吃一次控制。
        </footer>
      </aside>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`border-2 py-1.5 text-[12px] font-semibold ${
        active
          ? 'border-mint-500 bg-mint-500/15 text-mint-400'
          : 'border-ink-700 text-mist-400 hover:text-mist-200'
      }`}
    >
      {label}
    </button>
  );
}

function ItemCard({
  sku,
  coins,
  owned,
  onBuy,
  onUse,
  onShout,
}: {
  sku: ItemSku;
  coins: number;
  owned: number;
  onBuy: (kind: number, id: number, count?: number) => void;
  onUse: (itemId: number) => void;
  onShout: () => void;
}) {
  const short = sku.price > coins;
  const selfUse = sku.target === ITEM_TARGET.Self;
  const isShout = sku.key === 'loudspeaker';

  return (
    <div className="flex flex-col justify-between border-2 border-ink-700 bg-ink-950/50 p-3">
      <div>
        <p className="flex items-center justify-between gap-2 text-[13px] font-semibold text-mist-100">
          <span>{sku.name}</span>
          <span className="font-mono text-[10px] font-normal text-mist-500">持有 {owned}</span>
        </p>
        <p className="mt-1 text-[11px] leading-snug text-mist-400">{sku.blurb}</p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={short}
          onClick={() => onBuy(1, sku.id, 1)}
          className={`border-2 px-2 py-1 font-mono text-[11px] ${
            short
              ? 'cursor-not-allowed border-signal-500/60 text-signal-500'
              : 'border-mint-500 text-mint-400 hover:bg-mint-500/15 active:translate-y-px'
          }`}
        >
          {sku.price} 币
        </button>
        {selfUse && (
          <button
            type="button"
            disabled={owned <= 0}
            onClick={() => (isShout ? onShout() : onUse(sku.id))}
            className={`border-2 px-2 py-1 text-[11px] ${
              owned <= 0
                ? 'cursor-not-allowed border-ink-700 text-mist-500'
                : 'border-[#F2C879]/70 text-[#F2C879] hover:bg-[#F2C879]/15 active:translate-y-px'
            }`}
          >
            {isShout ? '喊一嗓子' : '使用'}
          </button>
        )}
      </div>
    </div>
  );
}
