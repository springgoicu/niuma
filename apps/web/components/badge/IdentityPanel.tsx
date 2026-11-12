'use client';

import type { BadgeArchive } from '@/lib/game/archive';
import { Barcode, Chip, FakeQr } from './BadgeArt';
import { FieldRow } from './ArchiveFields';
import { StampSeal } from './StampSeal';

/**
 * 证件页：工牌正面。
 *
 * 条码、二维码、芯片与印章都留在这里，让「证件」这一页真的像一张实体卡，
 * 而不是另一列字段。
 */
export function IdentityPanel({ archive }: { archive: BadgeArchive }) {
  return (
    <div className="animate-archive-panel-in">
      <dl className="grid gap-2 px-4 pt-3.5 font-mono text-[10px] sm:text-[11px]">
        <FieldRow label="固定工号" value={archive.employeeNo} accent />
        <FieldRow label="部门 / 班次" value={`${archive.department} · ${archive.shift}`} />
        <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-ink-600/80 pb-2">
          <dt className="shrink-0 text-mist-500">职级称谓</dt>
          <dd className="min-w-0 text-right">
            <span className={`block truncate font-semibold ${archive.jobColor}`}>
              {archive.jobTitle}
            </span>
            {archive.jobWarning && (
              <span
                role="status"
                className="mt-0.5 block animate-blink font-mono text-[10px] text-rose-400"
              >
                {archive.jobWarning}
              </span>
            )}
          </dd>
        </div>
        <FieldRow label="首次入职" value={archive.firstJoinDate} />
        <FieldRow label="出勤地点" value={archive.location} />
        <FieldRow label="园区区域" value={archive.region} />
      </dl>

      <div className="flex items-end gap-3 border-t-2 border-ink-600 px-4 py-3">
        <div className="min-w-0 flex-1">
          <Barcode value={archive.employeeNo} />
          <p className="mt-1 font-mono text-[9px] tracking-[0.18em] text-mist-500">
            {archive.employeeNo} · 仅供自嘲
          </p>
        </div>
        <FakeQr value={archive.employeeNo} />
        <Chip />
      </div>

      {/* 成就戳印：与主章分开，告诉玩家这里的小章是可以一枚枚攒的 */}
      {archive.achievements.length > 0 && (
        <div className="border-t-2 border-ink-600 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">已解锁成就</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {archive.achievements.map((achievement) => (
              <span
                key={achievement}
                className="rotate-[-4deg] border-2 border-amber-400/70 px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.1em] text-amber-400"
              >
                {achievement}
              </span>
            ))}
          </div>
          <p className="mt-1.5 font-mono text-[8px] leading-relaxed text-mist-500">
            在广场北侧的放假告示板敲满 20 下木鱼即可盖上，记录只存在这台设备。
          </p>
        </div>
      )}

      <StampSeal stamp={archive.stamp} stampRed={archive.stampRed} isSelf={archive.isSelf} />
    </div>
  );
}
