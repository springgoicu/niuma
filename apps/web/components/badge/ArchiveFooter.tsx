'use client';

import { Camera, Download, ReceiptText } from 'lucide-react';
import type { BadgeArchive } from '@/lib/game/archive';

export type ArchiveBusy = 'copy' | 'download' | 'timesheet' | null;

/**
 * 档案底栏：分享动作常驻，不占页签。
 *
 * 本人与代打只改文案与 aria-label；按钮位置、层级和忙碌态保持一致。
 */
export function ArchiveFooter({
  archive,
  busy,
  onCopy,
  onDownload,
  onTimesheet,
}: {
  archive: BadgeArchive;
  busy: ArchiveBusy;
  onCopy: () => void;
  onDownload: () => void;
  onTimesheet: () => void;
}) {
  const copyLabel = archive.isSelf ? '复制工卡' : '复制 TA';
  const downloadLabel = archive.isSelf ? '下载工卡' : '下载 TA';
  const disabled = busy !== null;

  return (
    <>
      <div className="grid shrink-0 grid-cols-3 gap-2 border-t-2 border-ink-600 bg-ink-900 p-3">
        <button
          type="button"
          onClick={onCopy}
          disabled={disabled}
          aria-label={archive.isSelf ? '复制工卡图片' : '复制 TA 的工卡图片'}
          title={archive.isSelf ? '复制工卡图片' : '复制 TA 的工卡图片'}
          className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-mint-400/80 bg-mint-400/10 px-2 font-mono text-[10px] tracking-[0.04em] text-mint-400 transition-colors hover:bg-mint-400 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
        >
          <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{busy === 'copy' ? '冲洗中…' : copyLabel}</span>
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={disabled}
          aria-label={archive.isSelf ? '下载工卡' : '下载 TA 的工卡'}
          title={archive.isSelf ? '下载工卡' : '下载 TA 的工卡'}
          className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-ink-500 px-2 font-mono text-[10px] tracking-[0.04em] text-mist-300 transition-colors hover:border-mint-400/70 hover:text-mint-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {busy === 'download' ? '冲洗中…' : downloadLabel}
          </span>
        </button>
        <button
          type="button"
          onClick={onTimesheet}
          disabled={disabled}
          aria-label={archive.isSelf ? '下载考勤小票' : '下载 TA 的考勤小票'}
          title={archive.isSelf ? '下载考勤小票' : '下载 TA 的考勤小票'}
          className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-dashed border-ink-500 px-2 font-mono text-[10px] tracking-[0.04em] text-mist-400 transition-colors hover:border-amber-400/70 hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
        >
          <ReceiptText className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{busy === 'timesheet' ? '出票中…' : '考勤小票'}</span>
        </button>
      </div>

      <p className="shrink-0 border-t border-ink-700/80 px-4 py-1.5 text-center font-mono text-[8px] uppercase tracking-[0.16em] text-mist-500">
        点击空白处或按 Esc 关闭
      </p>
    </>
  );
}
