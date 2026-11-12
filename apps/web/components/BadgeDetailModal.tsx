'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CharacterAppearance } from '@niuma/shared-types';
import { employeeNumber } from '@/lib/game/badge';
import {
  dayKey,
  formatDuration,
  getCurrentSessionDuration,
  getDailyAverageHours,
  getJobTitle,
  getSeniorityDays,
  getStampTitle,
  useAttendance,
} from '@/lib/game/attendance';
import type { GeoInfo } from '@/lib/game/geo';
import {
  downloadShareCard,
  renderShareCard,
  shareOrDownload,
  type ShareCardData,
} from '@/lib/game/share-card';

const TOAST_TEXT = '工牌已就绪，快去向老板/社交平台证明你的工时！';
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

interface BadgeDetailModalProps {
  name: string;
  appearance: CharacterAppearance;
  geo: GeoInfo;
  onClose: () => void;
}

function hashString(input: string): number {
  let hash = 5381;
  for (const char of input) {
    hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

/** 伪条码：宽度由工号派生，同一张工牌每次都长一样 */
function barcodeBars(value: string): Array<{ x: number; width: number }> {
  let hash = hashString(value) || 1;
  const bars: Array<{ x: number; width: number }> = [];
  let cursor = 0;
  let index = 0;
  while (cursor < 118) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const width = 1 + (hash & 1);
    if (index % 2 === 0) bars.push({ x: cursor, width });
    cursor += width + 1 + ((hash >>> 9) & 1);
    index += 1;
  }
  return bars;
}

/** 伪二维码：三个定位角 + 由工号派生的模块，纯装饰但稳定可复现 */
function qrCells(value: string): Array<[number, number]> {
  let hash = hashString(value) || 1;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 21; x += 1) {
      const inFinder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (inFinder) {
        const lx = x > 13 ? x - 14 : x;
        const ly = y > 13 ? y - 14 : y;
        const edge = lx === 0 || lx === 6 || ly === 0 || ly === 6;
        const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
        if (edge || core) cells.push([x, y]);
        continue;
      }
      hash = (hash * 1103515245 + 12345 + x * 17 + y * 13) >>> 0;
      if ((hash >>> 11) & 1) cells.push([x, y]);
    }
  }
  return cells;
}

function Barcode({ value }: { value: string }) {
  const bars = useMemo(() => barcodeBars(value), [value]);
  return (
    <svg
      viewBox="0 0 120 26"
      preserveAspectRatio="none"
      className="block h-8 w-full border border-neutral-600 bg-[#e9e1cf]"
      role="img"
      aria-label={`工号条码 ${value}`}
    >
      {bars.map((bar, index) => (
        <rect key={index} x={bar.x} y={3} width={bar.width} height={20} fill="#14100c" />
      ))}
    </svg>
  );
}

function FakeQr({ value }: { value: string }) {
  const cells = useMemo(() => qrCells(value), [value]);
  return (
    <svg
      viewBox="0 0 21 21"
      className="h-11 w-11 shrink-0 border border-neutral-600 bg-[#e9e1cf] p-0.5"
      aria-hidden="true"
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#14100c" />
      ))}
    </svg>
  );
}

function Chip() {
  return (
    <div
      className="relative h-6 w-9 shrink-0 overflow-hidden border border-amber-300/80 bg-amber-400"
      aria-hidden="true"
    >
      <span className="absolute inset-x-0 top-1.5 h-px bg-amber-800/60" />
      <span className="absolute inset-x-0 bottom-1.5 h-px bg-amber-800/60" />
      <span className="absolute inset-y-0 left-2 w-px bg-amber-800/60" />
      <span className="absolute inset-y-0 right-2 w-px bg-amber-800/60" />
    </div>
  );
}

function FieldRow({
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
      <dd className={`min-w-0 truncate text-right ${accent ? 'text-mint-400' : 'text-mist-100'}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 牛马考勤档案：像素工牌套 + 实体印章。
 *
 * 打开时先 blur 当前焦点（输入框/画布），再把键盘焦点交给关闭按钮；
 * 关闭时把焦点交还 Pixi 画布，WASD 立刻恢复，不需要用户再点一次画面。
 */
export function BadgeDetailModal({ name, appearance, geo, onClose }: BadgeDetailModalProps) {
  const now = useAttendance((state) => state.now);
  const firstJoinDate = useAttendance((state) => state.firstJoinDate);
  const totalOnlineMs = useAttendance((state) => state.totalOnlineMs);
  const dailyRecords = useAttendance((state) => state.dailyRecords);
  const sessionStartTime = useAttendance((state) => state.sessionStartTime);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const clock = now || Date.now();
  const storage = useMemo(
    () => ({ firstJoinDate, totalOnlineMs, dailyRecords, sessionStartTime }),
    [firstJoinDate, totalOnlineMs, dailyRecords, sessionStartTime],
  );
  const averageHours = getDailyAverageHours(storage);
  const seniorityDays = getSeniorityDays(firstJoinDate, clock);
  const job = getJobTitle(averageHours);
  const stamp = getStampTitle(averageHours, seniorityDays);
  const stampRed = averageHours > 8;
  const employeeNo = employeeNumber(name);
  const sessionDuration = getCurrentSessionDuration(sessionStartTime, clock);
  const todayMs = dailyRecords[dayKey(clock)] ?? 0;
  const totalHours = (totalOnlineMs / 3_600_000).toFixed(1);
  const location = `中国 · ${geo.region} · ${geo.city}`;

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3_200);
  }, []);

  const buildShareData = useCallback(
    (): ShareCardData => ({
      name,
      employeeNo,
      jobTitle: job.title,
      species: appearance.species,
      appearance,
      location,
      todayDuration: formatDuration(todayMs),
      dailyAverageHours: averageHours,
      stamp,
    }),
    [name, employeeNo, job.title, appearance, location, todayMs, averageHours, stamp],
  );

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

  // 捕获阶段吞键：Escape 关闭，WASD / 方向键 / 空格 / 动作键不再穿透到 window 上的游戏输入
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (
        GAME_KEYS.has(event.code) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
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
      const canvasPromise = renderShareCard(buildShareData());
      await shareOrDownload(canvasPromise, employeeNo);
      notify(TOAST_TEXT);
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(false);
    }
  }, [busy, buildShareData, employeeNo, notify]);

  const handleDownload = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = await renderShareCard(buildShareData());
      downloadShareCard(canvas, employeeNo);
      notify(TOAST_TEXT);
    } catch {
      notify(FAILURE_TEXT);
    } finally {
      setBusy(false);
    }
  }, [busy, buildShareData, employeeNo, notify]);

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
        aria-labelledby="badge-detail-title"
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
                id="badge-detail-title"
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

          <dl className="grid gap-2 px-4 py-3.5 font-mono text-[10px] sm:text-[11px]">
            <FieldRow label="固定工号" value={employeeNo} accent />
            <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-neutral-700/80 pb-2">
              <dt className="shrink-0 text-mist-500">职级称谓</dt>
              <dd className="min-w-0 text-right">
                <span className={`block truncate font-semibold ${job.color}`}>{job.title}</span>
                {job.warning && (
                  <span
                    role="status"
                    className="mt-0.5 block animate-blink font-mono text-[10px] text-rose-400"
                  >
                    {job.warning}
                  </span>
                )}
              </dd>
            </div>
            <FieldRow label="本次在岗" value={sessionDuration} accent />
            <FieldRow label="日均在线" value={`${averageHours.toFixed(1)} 小时 / 天`} />
            <FieldRow
              label="累计工龄"
              value={`已入职 ${seniorityDays} 天 · 累计在岗 ${totalHours} 小时`}
            />
            <FieldRow label="出勤地点" value={location} />
          </dl>

          {/* 盖章区：给印章留一块独立纸面，不压住任何一条考勤字段 */}
          <div className="relative h-[88px] border-t-2 border-dashed border-neutral-700 px-4">
            <p className="pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-mist-500">
              APPROVAL
            </p>
            <p className="mt-1.5 max-w-[168px] font-sans text-[9px] leading-relaxed text-mist-500">
              本卡由园区工位系统自动签发，无需主管签字。
            </p>
            <div
              className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rotate-[15deg] border-[3px] px-1.5 py-1 ${
                stampRed ? 'border-rose-500/85' : 'border-amber-400/85'
              }`}
            >
              <div
                className={`border px-2.5 py-1.5 text-center ${
                  stampRed ? 'border-rose-500/70' : 'border-amber-400/70'
                }`}
              >
                <p
                  className="font-mono text-[12px] font-bold tracking-[0.16em] text-transparent"
                  style={{ WebkitTextStroke: `1px ${stampRed ? '#fb7185' : '#f2c879'}` }}
                >
                  {stamp}
                </p>
                <p
                  className={`mt-0.5 font-mono text-[7px] tracking-[0.18em] ${
                    stampRed ? 'text-rose-400/80' : 'text-amber-400/80'
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
              <Barcode value={employeeNo} />
              <p className="mt-1 font-mono text-[9px] tracking-[0.18em] text-mist-500">
                {employeeNo} · 仅供自嘲
              </p>
            </div>
            <FakeQr value={employeeNo} />
            <Chip />
          </div>

          <div className="grid grid-cols-2 gap-2 border-t-2 border-neutral-700 p-3">
            <button
              type="button"
              onClick={handleCopy}
              disabled={busy}
              className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-mint-400/80 bg-mint-400/10 px-2 font-mono text-[10px] tracking-[0.08em] text-mint-400 transition-colors hover:bg-mint-400 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? '冲洗中…' : '📸 复制工卡图片'}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy}
              className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border-2 border-neutral-600 px-2 font-mono text-[10px] tracking-[0.08em] text-mist-300 transition-colors hover:border-mint-400/70 hover:text-mint-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 disabled:cursor-wait disabled:opacity-60"
            >
              💾 下载工卡
            </button>
          </div>
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
