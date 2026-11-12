'use client';

/** 证件页底部的盖章区：给印章留一块独立纸面，不压住任何一条字段。 */
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
    <div className="relative h-[88px] shrink-0 border-t-2 border-dashed border-ink-600 px-4">
      <p className="pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">APPROVAL</p>
      <p className="mt-1.5 max-w-[168px] font-sans text-[9px] leading-relaxed text-mist-500">
        {isSelf
          ? '本卡由园区工位系统自动签发，无需主管签字。'
          : '本卡为代打存档，工龄与行为数据由本人客户端自报。'}
      </p>
      <div
        className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-[15deg] border-[3px] px-1.5 py-1 ${
          stampRed ? 'border-rose-500/85' : 'border-amber-400/85'
        }`}
      >
        <div
          className={`border px-2.5 py-1.5 text-center ${
            stampRed ? 'border-rose-500/70' : 'border-amber-400/70'
          }`}
        >
          <p
            className="font-mono text-[12px] font-bold tracking-[0.16em] text-transparent"
            style={{ WebkitTextStroke: `1px ${stampRed ? '#fb7185' : '#f2c879'}` }}
          >
            {stamp}
          </p>
          <p
            className={`mt-0.5 font-mono text-[7px] tracking-[0.18em] ${
              stampRed ? 'text-rose-400/80' : 'text-amber-400/80'
            }`}
          >
            NIOMA HR · VERIFIED
          </p>
        </div>
      </div>
    </div>
  );
}
