'use client';

/**
 * 档案里的两个基础展示原语。
 *
 * 字段行与统计格只负责排版，不读 store、不解析协议；
 * 三个页签各自组合它们，避免每个面板再写一套边框与字重。
 */
export function FieldRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-ink-600/80 pb-2 last:border-0 last:pb-0">
      <dt className="shrink-0 text-mist-500">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${accent ? 'tabular-nums text-mint-400' : 'text-mist-100'}`}>
        {value}
      </dd>
    </div>
  );
}

export function StatCell({
  label,
  value,
  hint,
  accent = false,
  className = '',
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`border border-ink-600/80 bg-ink-950/50 px-2 py-1.5 ${className}`}>
      <p className="font-mono text-[8px] uppercase tracking-[0.16em] text-mist-500">{label}</p>
      <p
        className={`mt-0.5 truncate font-mono text-[11px] tabular-nums ${
          accent ? 'text-mint-400' : 'text-mist-100'
        }`}
      >
        {value}
      </p>
      {hint && <p className="truncate font-mono text-[8px] text-mist-500">{hint}</p>}
    </div>
  );
}
