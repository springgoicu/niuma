'use client';

/** 手机端的三段工作台：一次只展开一块面板，预览台不必让位 */
export type CreatorTab = 'species' | 'parts' | 'color';

const TABS: Array<{ id: CreatorTab; label: string; hint: string }> = [
  { id: 'species', label: '工种', hint: 'SPECIES' },
  { id: 'parts', label: '配件', hint: 'PARTS' },
  { id: 'color', label: '调色', hint: 'RGB565' },
];

const TAB_ACTIVE = 'bg-mint-400/[0.07] text-mint-400 shadow-[inset_0_-2px_0_0_var(--color-mint-400)]';
const TAB_IDLE = 'text-mist-300 hover:bg-ink-800/60 hover:text-mist-100';

export function CreatorTabs({
  value,
  onChange,
  className = '',
}: {
  value: CreatorTab;
  onChange: (tab: CreatorTab) => void;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-3 border border-ink-700 bg-ink-950/85 ${className}`}>
      {TABS.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.id)}
            className={`flex h-11 cursor-pointer items-center justify-center gap-2 border-l border-ink-700 text-[13px] leading-none transition-colors duration-150 first:border-l-0 ${
              active ? TAB_ACTIVE : TAB_IDLE
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`hidden font-mono text-[9px] uppercase tracking-[0.14em] min-[380px]:inline ${
                active ? 'text-mint-400/80' : 'text-mist-500'
              }`}
            >
              {tab.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
