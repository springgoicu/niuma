'use client';

import { Building2, Compass, KeyRound, X } from 'lucide-react';
import {
  PROPERTY_TIER_LABEL,
  VILLA_SPECS,
  villaBuyPrice,
  type VillaStatePacket,
} from '@niuma/shared-types';
import { useModalKeys } from '@/lib/game/use-modal-keys';

interface EstateBoardDialogProps {
  open: boolean;
  villas: VillaStatePacket | null;
  onClose: () => void;
  onInspectVilla: (villaId: number) => void;
  onNavigateVilla: (villaId: number) => void;
}

/**
 * 全园 8 处分阶地产总览公告牌（Warm NiomaOS 95）。
 */
export function EstateBoardDialog({
  open,
  villas,
  onClose,
  onInspectVilla,
  onNavigateVilla,
}: EstateBoardDialogProps) {
  useModalKeys(open, onClose);
  if (!open) return null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-[#18202c]/60 px-4">
      <div className="pixel-panel w-full max-w-[540px] p-0">
        <div className="flex items-center justify-between border-b-2 border-[#2a3142] bg-[#364258] px-3 py-2 text-[#f4efe6]">
          <div className="flex items-center gap-2 font-mono text-[12px] font-bold">
            <Building2 className="h-4 w-4 text-[#f2c879]" aria-hidden />
            <span>全园地产交易总览（8 处分阶产业）</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭地产总览"
            className="cursor-pointer border border-[#6c7891] bg-[#2a3142] p-0.5 text-[#f4efe6] hover:bg-[#c85c5c]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {VILLA_SPECS.map((spec) => {
              const info = villas?.villas.find((v) => v.id === spec.id) ?? null;
              const owned = info?.owned ?? false;
              const mine = info?.mine ?? false;
              const price = villaBuyPrice(spec, owned);
              const tierLabel = PROPERTY_TIER_LABEL[spec.tier];

              return (
                <div
                  key={spec.id}
                  className={`border-2 border-[#2a3142] p-2.5 ${
                    mine ? 'bg-[#f7edd2]' : owned ? 'bg-[#e8dfcf]' : 'bg-[#f4ede1]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[12px] font-bold text-[#2a3142]">
                      {spec.name}
                    </span>
                    <span className="shrink-0 border border-[#2a3142] bg-[#364258] px-1.5 py-0.5 font-mono text-[9px] text-[#f2c879]">
                      {tierLabel}
                    </span>
                  </div>

                  <p className="mt-1 truncate font-mono text-[10px] text-[#5c6678]">
                    {owned
                      ? info?.tagline
                        ? `「${info.tagline}」· ${info.ownerName || '神秘房主'}`
                        : `房主：${mine ? '本人' : info?.ownerName || '神秘房主'}${info?.locked ? ' (已锁门)' : ''}`
                      : spec.tagline}
                  </p>

                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] font-bold">
                    <span className="text-[#8c5a18]">
                      +{spec.income}/分 · {owned ? `收购 ¥${price}` : `挂牌 ¥${price}`}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onNavigateVilla(spec.id);
                        }}
                        className="inline-flex cursor-pointer items-center gap-0.5 border border-[#2a3142] bg-[#ebe4d5] px-1.5 py-0.5 text-[9px] text-[#2a3142] hover:bg-[#e1d7c3]"
                      >
                        <Compass className="h-2.5 w-2.5" aria-hidden />
                        带路前往
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onInspectVilla(spec.id);
                        }}
                        className="inline-flex cursor-pointer items-center gap-0.5 border border-[#2a3142] bg-[#f2c879] px-1.5 py-0.5 text-[9px] text-[#2a3142] hover:bg-[#ffe08a]"
                      >
                        <KeyRound className="h-2.5 w-2.5" aria-hidden />
                        地契
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
