'use client';

import type { BadgeArchive } from '@/lib/game/archive';
import { FieldRow } from './ArchiveFields';

/**
 * 今日如厕占比条：如厕本来就是工时的一部分，所以不画「目标」，只画「占了多少」。
 *
 * 100% 轨道用同一套纸张刻度；超过一半转琥珀色——不是报警，是给「今天在马桶座上
 * 住了一天」一个能看出来的视觉反馈。未上报时轨道留空，不拿 0% 冒充真实数据。
 */
function ToiletRatio({ archive }: { archive: BadgeArchive }) {
  const reported = archive.hasCareer;
  const percent = reported ? Math.round(archive.todayToiletRatio * 100) : 0;
  const heavy = percent >= 50;
  const tone = !reported ? 'text-mist-500' : heavy ? 'text-amber-400' : 'text-mint-400';
  const hint = !reported
    ? '未上报'
    : archive.todayToiletMinutes <= 0
      ? '今天还没坐过马桶座'
      : `如厕占今日工时 ${percent}%`;

  return (
    <div className="border border-ink-600/80 bg-ink-950/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
        <span>今日如厕</span>
        <span className={`tabular-nums ${tone}`}>
          {reported ? `${archive.todayToiletMinutes} 分钟` : '未上报'}
        </span>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden border border-ink-500 bg-ink-900">
        <div
          className={`h-full transition-[width] duration-300 ${heavy ? 'bg-amber-400' : 'bg-mint-400'}`}
          style={{ width: `${percent}%` }}
        />
        {[25, 50, 75].map((tick) => (
          <span
            key={tick}
            className="pointer-events-none absolute inset-y-0 w-px bg-ink-600/90"
            style={{ left: `${tick}%` }}
            aria-hidden
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between font-mono text-[8px] text-mist-500">
        <span>0%</span>
        <span className={heavy ? 'text-amber-400/90' : undefined}>{hint}</span>
        <span>100%</span>
      </div>
    </div>
  );
}

/** 考勤页：今日工时、今日如厕占比与当前姿态；没有任何累计 / 工龄 / 连续维度。 */
export function AttendancePanel({ archive }: { archive: BadgeArchive }) {
  const reported = archive.hasCareer;
  return (
    <div className="animate-archive-panel-in px-4 py-3.5 font-mono text-[10px] sm:text-[11px]">
      <ToiletRatio archive={archive} />

      <dl className="mt-3 grid gap-2">
        <FieldRow label="今日工时" value={reported ? archive.todayDuration : '未上报'} accent />
        <FieldRow
          label="今日如厕"
          value={
            reported
              ? `${archive.todayToiletMinutes} 分钟 · 占工时 ${Math.round(archive.todayToiletRatio * 100)}%`
              : '未上报'
          }
        />
        <FieldRow label="当前姿态" value={archive.pose} />
        <FieldRow label="入座" value={archive.seat} />
        <FieldRow label="入职日期" value={archive.firstJoinDate} />
      </dl>
    </div>
  );
}
