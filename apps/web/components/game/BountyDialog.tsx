'use client';

import { QUEST_DEFS, findQuestDef, type QuestEntry } from '@niuma/shared-types';
import { useGameUi } from '../../lib/game-ui';

interface BountyDialogProps {
  onClaim: (questId: number) => void;
  onClose: () => void;
}

/** 悬赏图标：三个任务各一只，纯装饰、不用位图，跟着像素边框走 */
const QUEST_ICON: Record<number, string> = {
  1: '🦶',
  2: '🎲',
  3: '🧱',
};

/**
 * 每日悬赏面板（ADR-0088）。
 *
 * 进度与服务端 `S2C_QUEST_STATE` 一一对应，客户端不做任何本地累计：
 * 面板里看到的「6/10」就是服务端认的那个数，点领取也只是把 questId 发上去。
 */
export function BountyDialog({ onClaim, onClose }: BountyDialogProps) {
  const quests = useGameUi((state) => state.quests);
  const entries: QuestEntry[] = quests?.entries ?? QUEST_DEFS.map((def) => ({
    id: def.id,
    progress: 0,
    target: def.target,
    claimed: false,
  }));
  const total = entries.length;
  const claimedCount = entries.filter((entry) => entry.claimed).length;
  const ready = entries.filter((entry) => !entry.claimed && entry.progress >= entry.target);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="关闭悬赏面板"
        className="pointer-events-auto absolute inset-0 cursor-default bg-[#0b1020]/55"
        onClick={onClose}
      />
      <section className="animate-board-in pointer-events-auto relative m-3 flex w-[min(420px,92vw)] flex-col overflow-hidden rounded-xl border-2 border-[#7cf5b0]/50 bg-[#0b1020]/96 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
        <header className="flex items-start justify-between border-b border-white/10 px-4 py-3">
          <div>
            <h2 className="text-base font-bold tracking-wide text-[#f2f5ff]">今日悬赏</h2>
            <p className="mt-0.5 font-mono text-[11px] text-[#9aa7c7]">
              {quests?.day || '今日'} · 已完成 {claimedCount}/{total}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/15 px-2 py-1 text-xs text-[#9aa7c7] transition-colors hover:border-[#7cf5b0]/60 hover:text-[#7cf5b0]"
          >
            关闭
          </button>
        </header>

        <div className="flex flex-col gap-2 px-3 py-3">
          {entries.map((entry) => {
            const def = findQuestDef(entry.id);
            if (!def) return null;
            const done = entry.progress >= entry.target;
            const claimable = !entry.claimed && done;
            const ratio = Math.min(1, entry.progress / Math.max(1, entry.target));
            return (
              <article
                key={entry.id}
                className={`rounded-lg border px-3 py-2 transition-[border-color,background-color,box-shadow] duration-200 ${
                  entry.claimed
                    ? 'border-[#f5c451]/40 bg-[#f5c451]/5'
                    : claimable
                      ? 'animate-bounty-ready border-[#7cf5b0]/60 bg-[#7cf5b0]/10'
                      : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-lg transition-transform duration-200 ${claimable ? 'scale-110' : ''}`}
                    aria-hidden="true"
                  >
                    {QUEST_ICON[entry.id] ?? '📌'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[#f2f5ff]">{def.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-[#9aa7c7]">
                        {entry.progress}/{entry.target}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-[#9aa7c7]">{def.blurb}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!claimable}
                    onClick={() => onClaim(entry.id)}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold transition-[transform,colors] duration-150 ${
                      entry.claimed
                        ? 'cursor-default border-[#f5c451]/40 text-[#f5c451]'
                        : claimable
                          ? 'cursor-pointer border-[#f5c451] bg-[#f5c451]/15 text-[#f5c451] hover:bg-[#f5c451]/25 active:scale-95'
                          : 'cursor-not-allowed border-white/10 text-[#5c6b8a]'
                    }`}
                  >
                    {entry.claimed ? '已领' : `领取 ${def.reward}`}
                  </button>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                      entry.claimed ? 'bg-[#f5c451]' : 'bg-[#7cf5b0]'
                    }`}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
              </article>
            );
          })}
        </div>

        <footer className="border-t border-white/10 px-3 py-3">
          <button
            type="button"
            disabled={ready.length === 0}
            onClick={() => ready.forEach((entry) => onClaim(entry.id))}
            className={`w-full rounded-md border-2 px-3 py-2 text-sm font-bold tracking-wide transition-[transform,colors] duration-150 ${
              ready.length === 0
                ? 'cursor-not-allowed border-white/10 text-[#5c6b8a]'
                : 'animate-bounty-ready cursor-pointer border-[#f5c451] bg-[#f5c451]/15 text-[#f5c451] hover:bg-[#f5c451]/25 active:scale-[0.98]'
            }`}
          >
            {ready.length === 0 ? '没有可领取的悬赏' : `一键领取全部（${ready.length}）`}
          </button>
        </footer>
      </section>
    </div>
  );
}
