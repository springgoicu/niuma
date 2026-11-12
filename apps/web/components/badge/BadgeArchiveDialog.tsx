'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toShareCardData, type BadgeArchive } from '@/lib/game/archive';
import { downloadShareCard, renderShareCard, shareOrDownload } from '@/lib/game/share-card';
import { nextTabIndex, type TabNavKey } from '@/lib/game/tab-keyboard';
import { ArchiveFooter, type ArchiveBusy } from './ArchiveFooter';
import { ArchiveTabs, type ArchiveTabId } from './ArchiveTabs';
import { ActivityPanel } from './ActivityPanel';
import { AttendancePanel } from './AttendancePanel';
import { IdentityPanel } from './IdentityPanel';

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

const TAB_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

interface BadgeArchiveDialogProps {
  archive: BadgeArchive;
  onClose: () => void;
}

/**
 * 统一的牛马考勤档案。
 *
 * 固定高度外壳 + 三页签：头部身份带与底部分享区常驻，只有当前页滚动。
 * 本人与他人的差异只在取数壳：这里只认 `BadgeArchive`，
 * 印章、条码、分享、焦点与按键处理都只有一份。
 */
export function BadgeArchiveDialog({ archive, onClose }: BadgeArchiveDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<number | null>(null);
  const [tab, setTab] = useState<ArchiveTabId>('identity');
  const [busy, setBusy] = useState<ArchiveBusy>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 换人 / 本人↔代打切换时回到证件页，避免打开别人的档案先看到上一页签
  useEffect(() => {
    setTab('identity');
  }, [archive.employeeNo, archive.isSelf]);

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

  // 捕获阶段吞键：Escape 关闭；方向键在页签之间移动；其余游戏键不再穿透
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      // 方向键/Home/End 必须在这里处理：GAME_KEYS 也在 capture 阶段吞键，
      // 只挂 tablist 的 React onKeyDown 根本收不到。
      const target = event.target;
      const tabButton =
        target instanceof HTMLElement ? target.closest<HTMLElement>('[role="tab"]') : null;
      if (tabButton && TAB_KEYS.has(event.key)) {
        const tabs = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
        );
        const current = tabs.indexOf(tabButton);
        const next = nextTabIndex(current, event.key as TabNavKey, tabs.length);
        event.preventDefault();
        event.stopPropagation();
        tabs[next]?.focus();
        return;
      }

      if (GAME_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // 焦点在按钮上时不要 preventDefault：空格仍应能触发按钮的默认点击
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
    setBusy('copy');
    try {
      // 在点击调用栈里同步启动渲染：Safari 的 ClipboardItem 需要这段 Promise
      const canvasPromise = renderShareCard(toShareCardData(archive));
      await shareOrDownload(canvasPromise, archive.employeeNo);
      notify(archive.isSelf ? SELF_TOAST : OTHER_TOAST);
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(null);
    }
  }, [busy, archive, notify]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy('download');
    try {
      const canvas = await renderShareCard(toShareCardData(archive));
      downloadShareCard(canvas, archive.employeeNo);
      notify(archive.isSelf ? SELF_TOAST : OTHER_TOAST);
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(null);
    }
  }, [busy, archive, notify]);

  const handleTimesheet = useCallback(async () => {
    if (busy) return;
    setBusy('timesheet');
    try {
      const canvas = await renderShareCard(toShareCardData(archive), 'timesheet');
      downloadShareCard(canvas, archive.employeeNo);
      notify(archive.isSelf ? '考勤小票已出票，拿去贴工位' : 'TA 的考勤小票已出票');
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(null);
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
        className="absolute inset-0 cursor-pointer bg-black/75 backdrop-blur-[2px]"
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
        className="relative z-10 flex h-[min(640px,92dvh)] w-[min(430px,94vw)] flex-col overflow-hidden border-2 border-ink-500 bg-ink-800 p-[3px] shadow-[0_28px_70px_-30px_rgba(0,0,0,0.95)]"
      >
        <div className="flex min-h-0 flex-1 flex-col border-2 border-ink-600 bg-ink-900">
          {/* 挂绳孔 + 金属夹：压到 28px，把高度让给页签内容 */}
          <div
            className="relative h-7 shrink-0 border-b-2 border-ink-600 bg-ink-800"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 2px, transparent 2px 6px)',
            }}
          >
            <span className="absolute left-1/2 top-0 h-2 w-10 -translate-x-1/2 border-x-2 border-b-2 border-ink-500 bg-ink-600" />
            <span className="absolute left-1/2 top-2 h-3 w-24 -translate-x-1/2 rounded-full border-2 border-ink-500 bg-ink-950 shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)]" />
          </div>

          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-600 px-4 py-2.5">
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
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center border-2 border-ink-500 bg-ink-800 text-mist-400 transition-colors hover:border-mint-400/70 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-b-2 border-ink-600 px-4 py-2.5">
            <img
              src={`/sprites/preview-${archive.species}.png`}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pixelated h-12 w-12 shrink-0 border border-ink-500 bg-ink-950 p-1"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold tracking-wide text-mist-100">
                {archive.name}
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[9px] text-mist-500">
                <span className="border border-ink-500 px-1 py-0.5 uppercase tracking-[0.08em]">
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

          <ArchiveTabs active={tab} onChange={setTab} />

          <div
            id="archive-panel"
            role="tabpanel"
            aria-labelledby={`archive-tab-${tab}`}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-mint-400/60"
          >
            {tab === 'identity' && <IdentityPanel archive={archive} />}
            {tab === 'attendance' && <AttendancePanel archive={archive} />}
            {tab === 'activity' && <ActivityPanel archive={archive} />}
          </div>

          <ArchiveFooter
            archive={archive}
            busy={busy}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onTimesheet={handleTimesheet}
          />
        </div>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-[120] w-[min(380px,92vw)] -translate-x-1/2 border-2 border-mint-400/80 bg-ink-950/95 px-4 py-2.5 shadow-[0_12px_30px_-14px_rgba(0,0,0,0.95)]"
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
