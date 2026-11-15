'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  FURNITURE_SKUS,
  HOUSE_TIERS,
  ROOM_CELL_COUNT,
  ROOM_GRID_COLS,
  SHOP_KIND,
  doorNoOf,
  houseTierSpec,
  type FurniturePlacement,
  type RoomStatePacket,
} from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';

interface ApartmentDialogProps {
  room: RoomStatePacket | null;
  coins: number;
  onClose: () => void;
  onAction: (action: number) => void;
  onBuy: (kind: number, id: number, count?: number) => void;
  onInvite: (targetId: number) => void;
  onSaveLayout: (placements: FurniturePlacement[]) => void;
}

/**
 * 牛马公寓面板（ADR-0087）。
 *
 * 左栏户型与升级价、中间 8×6 家具网格、右栏门牌号与串门邀请。
 * 家具买过就永久拥有（记在 `unlockedCosmetics` 的 `furn:<id>` 上），
 * 摆放只受户型档位的槽位数限制；保存后由服务端广播给同频道的室友与访客。
 */
export function ApartmentDialog({
  room,
  coins,
  onClose,
  onAction,
  onBuy,
  onInvite,
  onSaveLayout,
}: ApartmentDialogProps) {
  const wallet = useGameUi((state) => state.wallet);
  const tier = Math.max(0, Math.min(HOUSE_TIERS.length - 1, wallet.houseTier));
  const spec = houseTierSpec(tier);
  const next = HOUSE_TIERS[tier + 1] ?? null;
  const [selected, setSelected] = useState<number>(FURNITURE_SKUS[0]!.id);
  const [placements, setPlacements] = useState<FurniturePlacement[]>(room?.placements ?? []);
  const [inviteId, setInviteId] = useState('');

  useEffect(() => {
    if (room) setPlacements(room.placements);
  }, [room]);

  const owned = new Set(wallet.unlockedCosmetics);
  const doorNo = room?.doorNo ?? doorNoOf(0);

  const toggleCell = (cell: number): void => {
    const existing = placements.find((entry) => entry.cell === cell);
    if (existing) {
      setPlacements(placements.filter((entry) => entry.cell !== cell));
      return;
    }
    if (placements.length >= spec.slots) return;
    setPlacements([...placements, { id: selected, cell }]);
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-4 pb-24 sm:items-center sm:pb-0">
      <div className="w-full max-w-[420px] border-2 border-ink-600 bg-ink-900/95 p-3 shadow-[4px_4px_0_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-mist-100">
            牛马公寓 · <span className="text-mint-400">{doorNo}</span>
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

        {/* 户型：0 纸箱 / 1 隔断 / 2 一居室 / 3 大平层 */}
        <div className="mt-2 grid grid-cols-4 gap-1">
          {HOUSE_TIERS.map((item) => (
            <div
              key={item.tier}
              className={`border-2 px-1 py-1 text-center ${
                item.tier === tier ? 'border-mint-500 bg-mint-500/10' : 'border-ink-700'
              }`}
            >
              <p className={`text-[11px] font-semibold ${item.tier === tier ? 'text-mint-300' : 'text-mist-300'}`}>
                {item.name}
              </p>
              <p className="font-mono text-[8px] text-mist-500">{item.slots} 格</p>
            </div>
          ))}
        </div>
        <p className="mt-1 px-1 text-[10px] text-mist-400">
          {spec.floor} · 已摆 {placements.length}/{spec.slots} 件
          {next && (
            <span className="ml-2 text-[#F2C879]">
              升级到「{next.name}」需要 {next.price} 币
            </span>
          )}
        </p>
        {next && (
          <button
            type="button"
            disabled={coins < next.price}
            onClick={() => onAction(2)}
            className={`mt-1 w-full border-2 py-1.5 text-[11px] font-semibold ${
              coins >= next.price
                ? 'border-[#F2C879] bg-[#F2C879]/10 text-[#F2C879] hover:bg-[#F2C879]/20'
                : 'cursor-not-allowed border-ink-700 text-mist-500'
            }`}
          >
            {coins >= next.price ? `升级户型 · ${next.price} 币` : '余额不足，先去搬砖'}
          </button>
        )}

        {/* 家具货架 */}
        <div className="mt-2 grid grid-cols-4 gap-1">
          {FURNITURE_SKUS.map((sku) => {
            const unlocked = sku.price <= 0 || owned.has(`furn:${sku.id}`);
            return (
              <button
                key={sku.id}
                type="button"
                onClick={() => setSelected(sku.id)}
                className={`border-2 px-1 py-1 text-left ${
                  selected === sku.id ? 'border-mint-500 bg-mint-500/10' : 'border-ink-700'
                }`}
              >
                <span className="block truncate text-[10px] text-mist-200">{sku.name}</span>
                <span className="block font-mono text-[8px] text-mist-500">
                  {unlocked ? `${sku.cells} 格` : `${sku.price} 币`}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <span className="font-mono text-[9px] text-mist-500">
            选中的家具若未解锁，点右侧购买（买一次永久拥有）
          </span>
          <button
            type="button"
            onClick={() => onBuy(SHOP_KIND.Furniture, selected, 1)}
            className="ml-auto border-2 border-ink-700 px-2 py-1 font-mono text-[9px] text-mist-300 hover:bg-ink-800"
          >
            购买选中
          </button>
        </div>

        {/* 8×6 网格 */}
        <div className="mt-2 grid grid-cols-8 gap-[2px] border-2 border-ink-700 bg-ink-950 p-1">
          {Array.from({ length: ROOM_CELL_COUNT }, (_, cell) => {
            const placed = placements.find((entry) => entry.cell === cell);
            const sku = placed ? FURNITURE_SKUS.find((item) => item.id === placed.id) : null;
            const col = cell % ROOM_GRID_COLS;
            const row = Math.floor(cell / ROOM_GRID_COLS);
            return (
              <button
                key={cell}
                type="button"
                onClick={() => toggleCell(cell)}
                aria-label={`格子 ${row + 1}-${col + 1}`}
                className={`h-6 border ${
                  placed
                    ? 'border-mint-500 bg-mint-500/25 text-mint-200'
                    : 'border-ink-700 bg-ink-900 hover:bg-ink-800'
                } flex items-center justify-center font-mono text-[7px]`}
              >
                {sku ? sku.name.slice(0, 1) : ''}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={() => onSaveLayout(placements)}
            className="flex-1 border-2 border-mint-500 bg-mint-500/10 py-2 text-[12px] font-semibold text-mint-300 hover:bg-mint-500/20"
          >
            保存布局
          </button>
          <button
            type="button"
            onClick={() => onAction(1)}
            className="border-2 border-ink-700 px-3 py-2 text-[12px] text-mist-200 hover:bg-ink-800"
          >
            出门
          </button>
        </div>

        {/* 串门邀请 */}
        <div className="mt-2 border-2 border-ink-700 bg-ink-800/50 p-2">
          <p className="text-[10px] text-mist-400">
            门牌 <span className="font-mono text-[#F2C879]">{doorNo}</span> · 邀请同园区好友来串门（两分钟内到公寓门口按 F）
          </p>
          <div className="mt-1 flex gap-1">
            <input
              value={inviteId}
              inputMode="numeric"
              placeholder="好友的工牌编号"
              onChange={(event) => setInviteId(event.target.value.replace(/[^\d]/g, ''))}
              className="min-w-0 flex-1 border-2 border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-mist-100 outline-none focus:border-mint-500"
            />
            <button
              type="button"
              disabled={inviteId.length === 0}
              onClick={() => onInvite(Number(inviteId))}
              className="border-2 border-ink-700 px-2 py-1 text-[10px] text-mist-200 hover:bg-ink-800 disabled:cursor-not-allowed disabled:text-mist-500"
            >
              邀请
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
