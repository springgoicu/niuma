'use client';

/**
 * 证件页底部的称号区。
 *
 * 称号本身来自真实派生（`attendance.ts` 的 `getStampTitle`：今日工时 / 步数 / 摸鱼次数），
 * 所以只作一行文字展示；不再画成印章，也不写「系统自动签发」「NIOMA HR · VERIFIED」
 * 这类并不存在的认证字样。
 */
export function StampSeal({
  stamp,
  stampRed,
  isSelf,
}: {
  stamp: string;
  stampRed: boolean;
  isSelf: boolean;
}) {
  return (
    <div className="shrink-0 border-t-2 border-ink-600 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">今日称号</p>
        <p
          className={`min-w-0 truncate font-sans text-[12px] font-semibold ${
            stampRed ? 'text-rose-400' : 'text-amber-400'
          }`}
        >
          {stamp}
        </p>
      </div>
      <p className="mt-1.5 font-mono text-[8px] leading-relaxed text-mist-500">
        {isSelf
          ? '按今日工时、步数与摸鱼次数结算，只在这台设备上记录。'
          : '数据由本人客户端自报，园区只做即时转发。'}
      </p>
    </div>
  );
}
