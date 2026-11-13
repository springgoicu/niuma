'use client';

import type { BadgeArchive } from '@/lib/game/archive';
import { formatMinutes } from '@/lib/game/leaderboard';
import { StatCell } from './ArchiveFields';

/** 行为统计：今日口径，不拿 0 冒充「未上报」。 */
function ActivityGrid({ archive }: { archive: BadgeArchive }) {
  const activity = archive.activity;
  const value = (n: number, suffix: string) =>
    archive.hasCareer ? `${n.toLocaleString('zh-CN')} ${suffix}` : '未上报';

  return (
    <section className="px-4 pt-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">ACTIVITY</p>
        <p className="font-mono text-[8px] tracking-[0.08em] text-mist-500">今日口径</p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <StatCell label="步数" value={value(activity.steps, '步')} />
        <StatCell label="里程" value={value(activity.distanceM, '米')} />
        <StatCell label="击倒" value={value(activity.knockdownCount, '次')} />
        <StatCell
          label="如厕"
          value={archive.hasCareer ? `${archive.todayToiletMinutes} 分钟` : '未上报'}
        />
        <StatCell label="被创" value={value(activity.ventedCount, '次')} />
        <StatCell label="加班" value={value(activity.overtimeCount, '次')} />
        <StatCell
          label="名次"
          value={archive.rank ? `第 ${archive.rank} 名` : '未上榜'}
          hint="今日工时 · 视野内"
          accent={archive.rank === 1}
          className="col-span-3"
        />
      </div>
    </section>
  );
}

/** 同屏劳模榜：零持久化下只统计当前视野内、且已上报今日工时的人。 */
function BoardList({ archive }: { archive: BadgeArchive }) {
  return (
    <section className="mt-3 border-t-2 border-ink-600 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">同屏劳模榜</p>
        <p className="font-mono text-[8px] tracking-[0.08em] text-mist-500">
          今日工时 · 视野内前 {archive.board.length} 名
        </p>
      </div>
      {archive.board.length === 0 ? (
        <p className="mt-2 border border-dashed border-ink-600 px-2 py-2 font-mono text-[9px] text-mist-500">
          视野内还没有人上报今日工时。
        </p>
      ) : (
        <ol className="mt-2 grid gap-1">
          {archive.board.map((entry, index) => {
            const active = entry.self;
            return (
              <li
                key={entry.id}
                className={`flex items-center gap-2 border px-2 py-1 font-mono text-[10px] ${
                  active
                    ? 'border-mint-400/60 bg-mint-400/10 text-mint-400'
                    : 'border-ink-600/80 text-mist-300'
                }`}
              >
                <span className="w-4 shrink-0 text-center text-mist-500">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 tabular-nums">{formatMinutes(entry.todayMinutes)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** 行为页：今日统计格、同屏榜与数据口径。 */
export function ActivityPanel({ archive }: { archive: BadgeArchive }) {
  return (
    <div className="animate-archive-panel-in">
      <ActivityGrid archive={archive} />
      <BoardList archive={archive} />
      <p className="border-t border-ink-700/80 px-4 py-2 font-mono text-[8px] leading-relaxed text-mist-500">
        {archive.isSelf
          ? '今日数据由本人浏览器计时，30 秒批量落盘；部署重启也不会清零。'
          : '今日数据由本人客户端自报；他人工牌显示截至上次上报的今日值。'}
      </p>
    </div>
  );
}
