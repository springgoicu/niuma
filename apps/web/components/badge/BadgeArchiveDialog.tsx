'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toShareCardData, type BadgeArchive } from '@/lib/game/archive';
import {
  downloadShareCard,
  renderShareCard,
  shareOrDownload,
} from '@/lib/game/share-card';
import { ActivityGrid, ArchiveFields, BoardList } from './ArchiveFields';
import { Barcode, Chip, FakeQr } from './BadgeArt';

const SELF_TOAST = '工牌已就绪，快去向老板/社交平台证明你的工时！';
const OTHER_TOAST = 'TA 的工卡已生成，代打存档请谨慎传播';
const FAILURE_TEXT = '工卡打印失败，稍后再试一次';

/** 弹窗打开期间要吞掉的游戏键：不清掉的话角色会顶着弹窗继续走 */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyZ',
  'KeyX',
  'KeyC',
  'KeyE',
  'KeyF',
  'KeyG',
]);

interface BadgeArchiveDialogProps {
  archive: BadgeArchive;
  onClose: () => void;
}

/**
 * 统一的牛马考勤档案。
 *
 * 本人与他人的差异只在取数壳：这里只认 `BadgeArchive`，
 * 印章、条码、分享、焦点与按键处理都只有一份。
 */
export function BadgeArchiveDialog({ archive, onClose }: BadgeArchiveDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3_200);
  }, []);

  // 打开：先把当前焦点（可能是聊天输入框）摘掉，再让焦点落到关闭按钮
  useEffect(() => {
    const previous = document.activeElement;
    if (previous instanceof HTMLElement) previous.blur();
    closeRef.current?.focus();
    return () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      // 优先找游戏舞台里的那张 canvas，避免误抓到小地图或其他离屏画布
      const canvas =
        document.querySelector<HTMLCanvasElement>('[aria-label="游戏视口"] canvas') ??
        document.querySelector<HTMLCanvasElement>('canvas');
      if (canvas) {
        canvas.tabIndex = -1;
        canvas.focus({ preventScroll: true });
      }
    };
  }, []);

  // 捕获阶段吞键：Escape 关闭，WASD / 方向键 / 空格 / 动作键不再穿透到游戏输入
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (GAME_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // 焦点在按钮上时不要 preventDefault：空格仍应能触发按钮的默认点击
        const target = event.target;
        const interactive =
          target instanceof HTMLElement &&
          Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'));
        event.stopPropagation();
        if (!interactive) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 在点击调用栈里同步启动渲染：Safari 的 ClipboardItem 需要这段 Promise
      const canvasPromise = renderShareCard(toShareCardData(archive));
      await shareOrDownload(canvasPromise, archive.employeeNo);
      notify(archive.isSelf ? SELF_TOAST : OTHER_TOAST);
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(false);
    }
  }, [busy, archive, notify]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = await renderShareCard(toShareCardData(archive));
      downloadShareCard(canvas, archive.employeeNo);
      notify(archive.isSelf ? SELF_TOAST : OTHER_TOAST);
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(false);
    }
  }, [busy, archive, notify]);

  const handleTimesheet = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = await renderShareCard(toShareCardData(archive), 'timesheet');
      downloadShareCard(canvas, archive.employeeNo);
      notify(archive.isSelf ? '考勤小票已出票，拿去贴工位' : 'TA 的考勤小票已出票');
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(false);
    }
  }, [busy, archive, notify]);

  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 cursor-pointer bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
        data-no-immersive
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="badge-archive-title"
        onKeyDown={trapFocus}
        data-no-immersive
        className="relative z-10 max-h-[92dvh] w-[min(430px,94vw)] overflow-y-auto overscroll-contain border-2 border-neutral-500 bg-neutral-800 p-[3px] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.95)]"
      >
        <div className="border-2 border-neutral-700 bg-neutral-900">
          {/* 挂绳孔 + 金属夹：塑料工牌套的顶部结构 */}
          <div
            className="relative h-11 border-b-2 border-neutral-700 bg-neutral-800"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 6px)',
            }}
          >
            <span className="absolute left-1/2 top-0 h-2.5 w-10 -translate-x-1/2 border-x-2 border-b-2 border-neutral-500 bg-neutral-600" />
            <span className="absolute left-1/2 top-2.5 h-4 w-24 -translate-x-1/2 rounded-full border-2 border-neutral-600 bg-neutral-950 shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)]" />
          </div>

          <div className="flex items-start justify-between gap-3 border-b border-neutral-700 px-4 py-3">
            <div className="min-w-0">
              <p
                id="badge-archive-title"
                className="font-display text-base font-semibold tracking-wide text-mist-100"
              >
                牛马考勤档案
              </p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.24em] text-mist-500">
                NIOMA · EMPLOYEE RECORD
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="关闭档案"
              title="关闭档案（Esc）"
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center border-2 border-neutral-600 bg-neutral-800 text-mist-400 transition-colors hover:border-mint-400/70 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3 border-b border-neutral-700 px-4 py-3">
            <img
              src={`/sprites/preview-${archive.species}.png`}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pixelated h-12 w-12 shrink-0 border border-neutral-600 bg-neutral-950 p-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold tracking-wide text-mist-100">
                {archive.name}
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[9px] text-mist-500">
                <span className="border border-neutral-600 px-1 py-0.5 uppercase tracking-[0.08em]">
                  {archive.species}
                </span>
                <span className="truncate">
                  {archive.department} · {archive.shift}
                </span>
                <span className="border border-mint-400/40 px-1 py-0.5 uppercase tracking-[0.08em] text-mint-400">
                  {archive.isSelf ? '本人' : '代打存档'}
                </span>
              </div>
              {archive.status && (
                <p className="mt-1 truncate font-mono text-[10px] text-mint-400">{archive.status}</p>
              )}
            </div>
          </div>

          <ArchiveFields archive={archive} />
          <ActivityGrid archive={archive} />
          <BoardList archive={archive} />

          {/* 盖章区：给印章留一块独立纸面，不压住任何一条考勤字段 */}
          <div className="relative h-[88px] border-t-2 border-dashed border-neutral-700 px-4">
            <p className="pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">
              APPROVAL
            </p>
            <p className="mt-1.5 max-w-[168px] font-sans text-[9px] leading-relaxed text-mist-500">
              {archive.isSelf
                ? '本卡由园区工位系统自动签发，无需主管签字。'
                : '本卡为代打存档，工龄与行为数据由本人客户端自报。'}
            </p>
            <div
              className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-[15deg] border-[3px] px-1.5 py-1 ${
                archive.stampRed ? 'border-rose-500/85' : 'border-amber-400/85'
              }`}
            >
              <div
                className={`border px-2.5 py-1.5 text-center ${
                  archive.stampRed ? 'border-rose-500/70' : 'border-amber-400/70'
                }`}
              >
                <p
                  className="font-mono text-[12px] font-bold tracking-[0.16em] text-transparent"
                  style={{ WebkitTextStroke: `1px ${archive.stampRed ? '#fb7185' : '#f2c879'}` }}
                >
                  {archive.stamp}
                </p>
                <p
                  className={`mt-0.5 font-mono text-[7px] tracking-[0.18em] ${
                    archive.stampRed ? 'text-rose-400/80' : 'text-amber-400/80'
                  }`}
                >
                  NIOMA HR · VERIFIED
                </p>
              </div>
            </div>
          </div>

          {/* 卡底校验区：伪条码 / 伪二维码 / 安全芯片 */}
          <div className="flex items-end gap-3 border-t-2 border-neutral-700 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Barcode value={archive.employeeNo} />
              <p className="mt-1 font-mono text-[9px] tracking-[0.18em] text-mist-500">
                {archive.employeeNo} · 仅供自嘲
              </p>
            </div>
            <FakeQr value={archive.employeeNo} />
            <Chip />
          </div>

          <div className="grid grid-cols-2 gap-2 border-t-2 border-neutral-700 p-3">
            <button
              type="button"
              onClick={handleCopy}
              disabled={busy}
              className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-mint-400/80 bg-mint-400/10 px-2 font-mono text-[10px] tracking-[0.08em] text-mint-400 transition-colors hover:bg-mint-400 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? '冲洗中…' : archive.isSelf ? '📸 复制工卡图片' : '📸 复制 TA 的工卡'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy}
              className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-neutral-600 px-2 font-mono text-[10px] tracking-[0.08em] text-mist-300 transition-colors hover:border-mint-400/70 hover:text-mint-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
            >
              {archive.isSelf ? '💾 下载工卡' : '💾 下载 TA 的工卡'}
            </button>
            <button
              type="button"
              onClick={handleTimesheet}
              disabled={busy}
              className="col-span-2 flex min-h-9 cursor-pointer items-center justify-center gap-1.5 border-2 border-dashed border-neutral-600 px-2 font-mono text-[10px] tracking-[0.08em] text-mist-400 transition-colors hover:border-amber-400/70 hover:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
            >
              🧾 复印考勤小票
            </button>
          </div>

          <p className="border-t border-neutral-800 px-4 py-1.5 text-center font-mono text-[8px] uppercase tracking-[0.16em] text-mist-500">
            点击空白处或按 Esc 关闭
          </p>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[120] w-[min(380px,92vw)] -translate-x-1/2 border-2 border-mint-400/80 bg-neutral-950/95 px-4 py-2.5 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.95)]"
        >
          <p className="flex items-start gap-2 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-mint-400">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 animate-blink bg-mint-400" aria-hidden />
            {toast}
          </p>
        </div>
      )}
    </div>
  );
}
