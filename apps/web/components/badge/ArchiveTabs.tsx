'use client';

import { Activity, Clock3, IdCard } from 'lucide-react';

export type ArchiveTabId = 'identity' | 'attendance' | 'activity';

interface ArchiveTabDef {
  id: ArchiveTabId;
  label: string;
  icon: typeof IdCard;
}

export const ARCHIVE_TABS: readonly ArchiveTabDef[] = [
  { id: 'identity', label: '证件', icon: IdCard },
  { id: 'attendance', label: '考勤', icon: Clock3 },
  { id: 'activity', label: '行为', icon: Activity },
];

/**
 * 档案夹页签。
 *
 * 激活页签用 mint 顶边与内容区咬合，未激活页签后退；不使用药丸/圆角。
 * 方向键导航由弹窗的 capture 处理器完成（游戏键也在那里被吞），
 * 这里只负责焦点进入时把对应页设为激活。
 */
export function ArchiveTabs({
  active,
  onChange,
}: {
  active: ArchiveTabId;
  onChange: (id: ArchiveTabId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="档案分类"
      className="flex shrink-0 items-end gap-1 bg-ink-900 px-2 pt-1.5"
    >
      {ARCHIVE_TABS.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`archive-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls="archive-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onFocus={() => onChange(tab.id)}
            className={`relative flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 border-x-2 border-b-2 border-t-2 border-t-transparent px-2 font-mono text-[10px] tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 focus-visible:ring-inset ${
              selected
                ? 'border-x-ink-500 border-b-ink-900 border-t-mint-400 bg-ink-900 text-mint-400'
                : 'border-x-transparent border-b-ink-600 bg-ink-950/40 text-mist-500 hover:bg-ink-800/70 hover:text-mist-300'
            }`}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
