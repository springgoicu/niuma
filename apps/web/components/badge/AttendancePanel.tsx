'use client';

import type { BadgeArchive } from '@/lib/game/archive';
import { WEEK_METER_BASELINE_HOURS, weekMeterState } from '@/lib/game/week-meter';
import { FieldRow } from './ArchiveFields';

/** 本周工时仪表：40h 基线，正常薄荷、超时琥珀；未上报时轨道为空。 */
function WeekMeter({ archive }: { archive: BadgeArchive }) {
  const meter = weekMeterState(archive.weekHours, archive.hasCareer);
  const valueLabel =
    meter.tone === 'empty'
      ? '未上报'
      : `${meter.hours.toFixed(1)}h / ${WEEK_METER_BASELINE_HOURS}h`;
  const valueClass =
    meter.tone === 'over'
      ? 'text-amber-400'
      : meter.tone === 'empty'
        ? 'text-mist-500'
        : 'text-mint-400';
  const hint =
    meter.tone === 'empty'
      ? '未上报'
      : meter.tone === 'over'
        ? meter.overHours > 0
          ? `超出 ${meter.overHours.toFixed(1)}h`
          : '略超基线'
        : meter.hours >= WEEK_METER_BASELINE_HOURS
          ? '已满 40h'
          : `还差 ${(WEEK_METER_BASELINE_HOURS - meter.hours).toFixed(1)}h`;

  return (
    <div className="border border-ink-600/80 bg-ink-950/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500">
        <span>本周工时</span>
        <span className={`tabular-nums ${valueClass}`}>{valueLabel}</span>
      </div>

      <div className="relative mt-2 h-2 overflow-hidden border border-ink-500 bg-ink-900">
        <div
          className={`h-full transition-[width] duration-300 ${
            meter.tone === 'over' ? 'bg-amber-400' : 'bg-mint-400'
          }`}
          style={{ width: `${meter.percent}%` }}
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
        <span>0h</span>
        <span className={meter.tone === 'over' ? 'text-amber-400/90' : undefined}>{hint}</span>
        <span>{WEEK_METER_BASELINE_HOURS}h</span>
      </div>
    </div>
  );
}

/** 考勤页：工时仪表 + 在岗/工龄/姿态。 */
export function AttendancePanel({ archive }: { archive: BadgeArchive }) {
  return (
    <div className="animate-archive-panel-in px-4 py-3.5 font-mono text-[10px] sm:text-[11px]">
      <WeekMeter archive={archive} />

      <dl className="mt-3 grid gap-2">
        <FieldRow label="本次在岗" value={archive.sessionDuration} accent />
        <FieldRow
          label="今日累计"
          value={archive.hasCareer ? archive.todayDuration : '未上报'}
        />
        <FieldRow
          label="日均在线"
          value={
            archive.hasCareer ? `${archive.dailyAverageHours.toFixed(1)} 小时 / 天` : '未上报'
          }
        />
        <FieldRow
          label="连续在岗"
          value={archive.hasCareer ? `${archive.streakDays} 天` : '未上报'}
        />
        <FieldRow
          label="累计工龄"
          value={
            archive.hasCareer
              ? `已入职 ${archive.seniorityDays} 天 · 累计在岗 ${archive.totalHours} 小时`
              : '未上报'
          }
        />
        <FieldRow label="当前姿态" value={archive.pose} />
        <FieldRow label="入座" value={archive.seat} />
      </dl>
    </div>
  );
}
