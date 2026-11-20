'use client';

import { useEffect, useState } from 'react';
import { Phone, ShieldAlert, Shirt, Siren } from 'lucide-react';
import { CLEAR_STAR_METHOD, ECONOMY_REWARD } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { serverNow } from '@/lib/game/server-clock';

interface WantedStarsHUDProps {
  onClearStar: (method: number, param?: number) => void;
  onNavigateBooth: () => void;
  onNavigatePayphone: () => void;
}

const STAR_ITEMS = [0, 1, 2, 3, 4] as const;

/**
 * 1★~5★ 像素职场通缉星级 HUD（Warm NiomaOS 95 档案框）：
 * 仅在 stars > 0 时渲染；3★+ 进入高危警笛脉冲提示，5★ 提示老板黄金压路机围剿。
 */
export function WantedStarsHUD({
  onClearStar,
  onNavigateBooth,
  onNavigatePayphone,
}: WantedStarsHUDProps) {
  const wanted = useGameUi((state) => state.wanted);
  const [, setTick] = useState(0);

  const cdLeft =
    wanted.clearCdSec > 0 && wanted.updatedAt > 0
      ? Math.max(0, Math.ceil((wanted.updatedAt + wanted.clearCdSec * 1000 - serverNow()) / 1000))
      : wanted.clearCdSec;

  useEffect(() => {
    if (wanted.stars <= 0 || cdLeft <= 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [wanted.stars, cdLeft]);

  if (wanted.stars <= 0) return null;

  const highHeat = wanted.stars >= 3;
  const extreme = wanted.stars >= 5;

  return (
    <div
      role="status"
      aria-label={`通缉 ${wanted.stars} 星`}
      className={`pointer-events-auto border-2 px-3 py-2 font-mono shadow-[4px_4px_0_rgba(24,32,44,0.85)] ${
        highHeat
          ? 'border-[#e05252] bg-[#2a1c20]/95 text-[#f4ede1]'
          : 'border-[#2a3142] bg-[#364258]/95 text-[#f4efe6]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Siren
            className={`h-4 w-4 ${highHeat ? 'animate-pulse text-[#e05252]' : 'text-[#f2c879]'}`}
            aria-hidden
          />
          <div className="flex items-center gap-0.5" aria-hidden>
            {STAR_ITEMS.map((idx) => (
              <span
                key={idx}
                className={`text-[15px] leading-none ${
                  idx < wanted.stars
                    ? idx >= 3
                      ? 'text-[#ff6b6b] drop-shadow-[0_0_4px_rgba(224,82,82,0.75)]'
                      : 'text-[#f2c879]'
                    : 'text-[#5c6678]/45'
                }`}
              >
                ★
              </span>
            ))}
          </div>
        </div>
        <span className="border border-[#2a3142] bg-[#23293b] px-1.5 py-0.5 text-[10px] font-bold text-[#f2c879]">
          赏金 ¥{wanted.bounty}
        </span>
      </div>

      <p className="mt-1 text-[10px] tracking-wide text-[#d9d2c3]">
        {extreme
          ? '5★ 终极围剿：老板黄金压路机 & 机械杜宾犬出动！'
          : wanted.stars === 4
            ? '4★ 警戒：HR 机械杜宾犬已锁定你的位置！'
            : '躲进换装亭/电话亭洗白，或点击自首从轻发落'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onNavigateBooth}
          disabled={cdLeft > 0}
          className="inline-flex cursor-pointer items-center gap-1 border border-[#2a3142] bg-[#e8dfcf] px-2 py-0.5 text-[10px] font-bold text-[#2a3142] hover:bg-[#f4ede1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Shirt className="h-3 w-3" aria-hidden />
          {cdLeft > 0 ? `冷却 ${cdLeft}s` : `去换装亭 (${ECONOMY_REWARD.ClearStarBoothCost}币)`}
        </button>
        <button
          type="button"
          onClick={onNavigatePayphone}
          disabled={cdLeft > 0}
          className="inline-flex cursor-pointer items-center gap-1 border border-[#2a3142] bg-[#ebe4d5] px-2 py-0.5 text-[10px] font-bold text-[#2a3142] hover:bg-[#f4ede1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Phone className="h-3 w-3" aria-hidden />
          去公用电话 ({ECONOMY_REWARD.ClearStarPayphoneCost}币)
        </button>
        <button
          type="button"
          onClick={() => onClearStar(CLEAR_STAR_METHOD.Surrender, 0)}
          className="inline-flex cursor-pointer items-center gap-1 border border-[#2a3142] bg-[#c85c5c] px-2 py-0.5 text-[10px] font-bold text-[#fff5f5] hover:bg-[#d96b6b]"
        >
          <ShieldAlert className="h-3 w-3" aria-hidden />
          当场自首
        </button>
      </div>
    </div>
  );
}
