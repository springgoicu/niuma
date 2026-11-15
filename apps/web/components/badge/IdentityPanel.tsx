'use client';

import type { BadgeArchive } from '@/lib/game/archive';
import { FISH_UNLOCK_COUNT } from '@/lib/game/almanac-store';
import { FieldRow } from './ArchiveFields';
import { StampSeal } from './StampSeal';

/**
 * 证件页：工牌正面。
 *
 * 只写有数据来源的字段：职级称谓、首次入职、出勤地点、园区区域与已解锁成就。
 * 工号、部门、班次与条码 / 二维码 / 芯片都已删除——它们没有真实来源，
 * 只是用昵称哈希编出来的身份证件观感。
 */
export function IdentityPanel({ archive }: { archive: BadgeArchive }) {
  return (
    <div className="animate-archive-panel-in">
      <dl className="grid gap-2 px-4 pt-3.5 font-mono text-[10px] sm:text-[11px]">
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
            在广场北侧的放假告示板敲满 {FISH_UNLOCK_COUNT} 下木鱼即可盖上，记录只存在这台设备。
          </p>
        </div>
      )}

      <StampSeal stamp={archive.stamp} stampRed={archive.stampRed} isSelf={archive.isSelf} />
    </div>
  );
}
