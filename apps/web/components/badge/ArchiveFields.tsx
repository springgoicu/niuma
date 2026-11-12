'use client';

import type { BadgeArchive } from '@/lib/game/archive';

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
    <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-neutral-700/80 pb-2 last:border-0 last:pb-0">
      <dt className="shrink-0 text-mist-500">{label}</dt>
      <dd className={`min-w-0 truncate text-right ${accent ? 'tabular-nums text-mint-400' : 'text-mist-100'}`}>
        {value}
      </dd>
    </div>
  );
}

function StatCell({
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
    <div className={`border border-neutral-700/80 bg-neutral-900/50 px-2 py-1.5 ${className}`}>
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

/** 考勤字段：一列到底，标签与值同一行，长值右对齐截断。 */
export function ArchiveFields({ archive }: { archive: BadgeArchive }) {
  const career = (value: string) => (archive.hasCareer ? value : '未上报');
  return (
    <dl className="grid gap-2 px-4 py-3.5 font-mono text-[10px] sm:text-[11px]">
      <FieldRow label="固定工号" value={archive.employeeNo} accent />
      <FieldRow label="部门 / 班次" value={`${archive.department} · ${archive.shift}`} />
      <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-neutral-700/80 pb-2">
        <dt className="shrink-0 text-mist-500">职级称谓</dt>
        <dd className="min-w-0 text-right">
          <span className={`block truncate font-semibold ${archive.jobColor}`}>{archive.jobTitle}</span>
          {archive.jobWarning && (
            <span role="status" className="mt-0.5 block animate-blink font-mono text-[10px] text-rose-400">
              {archive.jobWarning}
            </span>
          )}
        </dd>
      </div>
      <FieldRow label="本次在岗" value={archive.sessionDuration} accent />
      <FieldRow label="今日累计" value={career(archive.todayDuration)} />
      <FieldRow
        label="本周工时"
        value={archive.hasCareer ? `${archive.weekHours.toFixed(1)} 小时` : '未上报'}
      />
      <FieldRow
        label="日均在线"
        value={archive.hasCareer ? `${archive.dailyAverageHours.toFixed(1)} 小时 / 天` : '未上报'}
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
      <FieldRow label="首次入职" value={archive.firstJoinDate} />
      <FieldRow label="出勤地点" value={archive.location} />
      <FieldRow label="园区区域" value={archive.region} />
      <FieldRow label="当前姿态" value={archive.pose} />
      <FieldRow label="入座" value={archive.seat} />
    </dl>
  );
}

/** 行为统计：累计口径，不拿 0 冒充「本会话还没走一步」。 */
export function ActivityGrid({ archive }: { archive: BadgeArchive }) {
  const activity = archive.activity;
  const value = (n: number, suffix: string) =>
    archive.hasCareer ? `${n.toLocaleString('zh-CN')} ${suffix}` : '未上报';
  return (
    <section className="border-t-2 border-neutral-700 px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">ACTIVITY</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <StatCell label="步数" value={value(activity.steps, '步')} />
        <StatCell label="里程" value={value(activity.distanceM, '米')} />
        <StatCell label="击倒" value={value(activity.knockdownCount, '次')} />
        <StatCell label="摸鱼" value={value(activity.slackCount, '次')} />
        <StatCell label="被喷" value={value(activity.ventedCount, '次')} />
        <StatCell label="加班" value={value(activity.overtimeCount, '次')} />
        <StatCell
          label="名次"
          value={archive.rank ? `第 ${archive.rank} 名` : '未上榜'}
          hint="视野内"
          accent={archive.rank === 1}
          className="col-span-3"
        />
      </div>
    </section>
  );
}

/** 同屏劳模榜：零持久化下只统计当前视野内、且已上报的人。 */
export function BoardList({ archive }: { archive: BadgeArchive }) {
  return (
    <section className="border-t-2 border-neutral-700 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">
          同屏劳模榜
        </p>
        <p className="font-mono text-[8px] tracking-[0.08em] text-mist-500">
          本周工时 · 视野内前 {archive.board.length} 名
        </p>
      </div>
      {archive.board.length === 0 ? (
        <p className="mt-2 border border-dashed border-neutral-700 px-2 py-2 font-mono text-[9px] text-mist-500">
          视野内还没有人上报工时。
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
                    : 'border-neutral-700/80 text-mist-300'
                }`}
              >
                <span className="w-4 shrink-0 text-center text-mist-500">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 tabular-nums">{(entry.weekMinutes / 60).toFixed(1)}h</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
