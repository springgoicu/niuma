'use client';

import { useState } from 'react';
import { KeyRound, Lock, Palette, Unlock, X } from 'lucide-react';
import { useModalKeys } from '@/lib/game/use-modal-keys';
import {
  PROPERTY_TIER_LABEL,
  VILLA_ACTION,
  VILLA_SPECS,
  VILLA_THEME,
  villaBuyPrice,
  villaBuyoutRefund,
  type VillaStatePacket,
} from '@niuma/shared-types';

interface VillaDialogProps {
  villa: number;
  villas: VillaStatePacket | null;
  coins: number;
  onClose: () => void;
  onAction: (villa: number, action: number) => void;
  onCustomize?: (villa: number, theme: number, tagline: string) => void;
}

const THEME_OPTIONS: ReadonlyArray<{ id: number; label: string; color: string }> = [
  { id: VILLA_THEME.WarmGold, label: '暖阳金', color: 'bg-[#f2c879]' },
  { id: VILLA_THEME.CyberNeon, label: '赛博粉', color: 'bg-[#f06595]' },
  { id: VILLA_THEME.EmeraldOasis, label: '翡翠森', color: 'bg-[#4fbf85]' },
];

/**
 * 街区冠名房产地契卡片（NiomaOS 95 档案卡风）：
 *
 * 三态：无主（原价挂牌）→ 已拥有开放（1.5× 溢价收购 / 房主收币）→ 已锁门（门栅挡客）。
 * 冠名权写入服务端共享运行态，原房主在线或离线时被买断均获赔 1.2× 本金 + 未结算摇钱树收益。
 */
export function VillaDialog({ villa, villas, coins, onClose, onAction, onCustomize }: VillaDialogProps) {
  useModalKeys(true, onClose);
  const spec = VILLA_SPECS.find((item) => item.id === villa) ?? VILLA_SPECS[0]!;
  const info = villas?.villas.find((item) => item.id === villa) ?? null;
  const owned = info?.owned ?? false;
  const mine = info?.mine ?? false;
  const online = (info?.ownerId ?? 0) !== 0;
  const [themeDraft, setThemeDraft] = useState<number>(info?.theme ?? VILLA_THEME.WarmGold);
  const [taglineDraft, setTaglineDraft] = useState<string>(info?.tagline ?? '');
  const buyPrice = villaBuyPrice(spec, owned);
  const refund = villaBuyoutRefund(spec);
  const affordable = coins >= buyPrice;
  const tierLabel = PROPERTY_TIER_LABEL[spec.tier];

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-[#18202c]/55 px-4 pb-24 sm:items-center sm:pb-0">
      <div className="pixel-panel w-full max-w-[384px] p-0">
        {/* NiomaOS 95 标题栏 */}
        <div className="flex items-center justify-between border-b-2 border-[#2a3142] bg-[#364258] px-3 py-2 text-[#f4efe6]">
          <div className="flex min-w-0 items-center gap-2">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-[#f2c879]" aria-hidden />
            <p className="truncate font-mono text-[12px] font-bold tracking-wide">
              地契 · {spec.name}
            </p>
            <span className="shrink-0 border border-[#f2c879] bg-[#2a3142] px-1.5 py-0.5 font-mono text-[10px] text-[#f2c879]">
              {tierLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#6c7891] bg-[#2a3142] p-0.5 text-[#f4efe6] hover:bg-[#c85c5c]"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-3">
          {/* 门前牌匾预览区 */}
          <div className="border-2 border-[#2a3142] bg-[#e8dfcf] px-3 py-2.5 text-center shadow-[inset_2px_2px_0_rgba(42,49,66,0.12)]">
            <div className="flex items-center justify-between font-mono text-[10px] text-[#5c6678]">
              <span>门口牌匾 · #{spec.id + 1}</span>
              <span className="font-semibold text-[#8c5a18]">{spec.income} 币/分</span>
            </div>

            <div className="mt-1.5 flex items-center justify-center gap-2">
              {owned && (
                <span
                  title={online ? '房主在线' : '房主离线'}
                  className={`inline-flex items-center gap-1 border border-[#2a3142] px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                    online ? 'bg-[#63c778] text-[#17281d]' : 'bg-[#c9c1b0] text-[#4d5565]'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-none ${
                      online ? 'bg-[#17281d]' : 'bg-[#687080]'
                    }`}
                  />
                  {online ? '在线' : '离线'}
                </span>
              )}
              <p className="text-[15px] font-bold text-[#2a3142]">
                {owned ? info!.ownerName || '神秘房主' : `待售 ${spec.price} 币`}
              </p>
            </div>

            <p className="mt-1 font-mono text-[10px] text-[#5c6678]">
              {owned
                ? info!.locked
                  ? '已锁门 · 门栅挡客（仅本人可进）'
                  : '院门开放 · 路人可参观打卡'
                : spec.tagline}
            </p>
          </div>

          <p className="mt-2.5 border-l-2 border-[#2a3142] bg-[#ebe4d5] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#3e4656]">
            {spec.tagline}。院内摇钱树每 60 秒结 <strong className="font-mono">{spec.income}</strong> 币（最多囤 10 分钟）；
            锁门后门栅变为实体碰撞。
          </p>

          {!owned && (
            <button
              type="button"
              disabled={!affordable}
              onClick={() => onAction(villa, VILLA_ACTION.Buy)}
              className={`pixel-btn mt-3 w-full py-2 text-[12px] font-bold ${
                affordable
                  ? 'bg-[#f2c879] text-[#2a3142] hover:bg-[#f7d794]'
                  : 'cursor-not-allowed bg-[#d9d2c3] text-[#7a8291]'
              }`}
            >
              {affordable ? `买下冠名权 · ${buyPrice} 币` : `余额不足 · 需 ${buyPrice} 币`}
            </button>
          )}

          {owned && mine && (
            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onAction(villa, VILLA_ACTION.ToggleLock)}
                  className="pixel-btn flex items-center justify-center gap-1.5 bg-[#ebe4d5] py-2 text-[12px] font-bold text-[#2a3142] hover:bg-[#e1d7c3]"
                >
                  {info!.locked ? (
                    <>
                      <Unlock className="h-3.5 w-3.5" aria-hidden />
                      开门迎客
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" aria-hidden />
                      锁门
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onAction(villa, VILLA_ACTION.Collect)}
                  className="pixel-btn bg-[#63c778] py-2 text-[12px] font-bold text-[#17281d] hover:bg-[#74d689]"
                >
                  收币 {info?.pending ?? 0}
                </button>
              </div>

              {onCustomize && (
                <div className="border-2 border-[#2a3142] bg-[#e8dfcf] p-2">
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold text-[#2a3142]">
                    <span className="flex items-center gap-1">
                      <Palette className="h-3 w-3" aria-hidden />
                      主题与牌匾宣言
                    </span>
                    <div className="flex items-center gap-1">
                      {THEME_OPTIONS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setThemeDraft(t.id)}
                          aria-pressed={themeDraft === t.id}
                          className={`inline-flex cursor-pointer items-center gap-1 border border-[#2a3142] px-1.5 py-0.5 text-[9px] ${
                            themeDraft === t.id
                              ? 'bg-[#364258] text-[#f4ede1]'
                              : 'bg-[#f4ede1] text-[#2a3142]'
                          }`}
                        >
                          <span className={`inline-block h-2 w-2 border border-[#2a3142] ${t.color}`} />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <input
                      type="text"
                      maxLength={12}
                      value={taglineDraft}
                      onChange={(e) => setTaglineDraft(e.target.value)}
                      placeholder="门匾宣言（最多 12 字）"
                      className="min-w-0 flex-1 border border-[#2a3142] bg-[#f4ede1] px-2 py-1 font-mono text-[11px] text-[#2a3142] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onCustomize(villa, themeDraft, taglineDraft)}
                      className="pixel-btn shrink-0 bg-[#f2c879] px-2.5 py-1 font-mono text-[11px] font-bold text-[#2a3142] hover:bg-[#ffe08a]"
                    >
                      保存装修
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {owned && !mine && (
            <div className="mt-3 space-y-2">
              <p className="text-center font-mono text-[10px] text-[#5c6678]">
                支持 1.5× 溢价强买冠名权 · 原房主获赔 1.2×（{refund} 币）+ 未收收益
              </p>
              <button
                type="button"
                disabled={!affordable}
                onClick={() => onAction(villa, VILLA_ACTION.Buy)}
                className={`pixel-btn w-full py-2 text-[12px] font-bold ${
                  affordable
                    ? 'bg-[#f29b6e] text-[#2a3142] hover:bg-[#f5ad87]'
                    : 'cursor-not-allowed bg-[#d9d2c3] text-[#7a8291]'
                }`}
              >
                {affordable ? `溢价收购 · ${buyPrice} 币` : `余额不足 · 需 ${buyPrice} 币`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
