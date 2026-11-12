'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { GAME_KEYS } from '@/lib/game/game-keys';
import {
  HOLIDAY_TABLE_YEARS,
  dailyAlmanac,
  formatCountdown,
  upcomingHolidays,
  weekProgress,
  weekendCountdown,
} from '@/lib/game/holiday-calendar';
import { localDateKey } from '@/lib/game/local-date';
import { HolidayCard, Note } from './bulletin/CorkboardPieces';
import { FishDrum, useFishDrum } from './bulletin/FishDrum';

/**
 * 牛马放假告示板（ADR-0059）。
 *
 * 视觉是一块被拉到眼前的软木板：木框 + 软木面 + 钉住的便签，
 * 而不是又一层 ink 玻璃面板。三张便签分别回答三个问题：
 * 这周还剩多久下班、下个假期还有几天、今天宜忌什么。
 *
 * 数据全部来自 `holiday-calendar` 的纯函数，与 Worker 里的跑马灯同源；
 * 敲木鱼的账本只写 localStorage，零服务端持久化。
 */

interface BulletinModalProps {
  onClose(): void;
}

export function BulletinModal({ onClose }: BulletinModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const drum = useFishDrum();
  const [now, setNow] = useState(() => Date.now());

  // 秒级跳动：只推进本地时钟，不发请求、不碰服务端
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const dateKey = localDateKey(now);
  const countdown = weekendCountdown(now);
  const progress = weekProgress(now);
  const almanac = useMemo(() => dailyAlmanac(dateKey), [dateKey]);
  const holidays = useMemo(() => upcomingHolidays(now, 3), [dateKey]);
  const weekend = countdown.state === 'IS_WEEKEND';
  const firstYear = HOLIDAY_TABLE_YEARS[0] ?? 2026;
  const lastYear = HOLIDAY_TABLE_YEARS[HOLIDAY_TABLE_YEARS.length - 1] ?? firstYear;
  const tableYears = `${firstYear}–${lastYear}`;
  const strikeFish = drum.strike;

  // 打开：焦点从画布 / 聊天输入框收进面板；关闭后还给游戏画布
  useEffect(() => {
    const previous = document.activeElement;
    if (previous instanceof HTMLElement) previous.blur();
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const canvas =
        document.querySelector<HTMLCanvasElement>('[aria-label="游戏视口"] canvas') ??
        document.querySelector<HTMLCanvasElement>('canvas');
      if (canvas) {
        canvas.tabIndex = -1;
        canvas.focus({ preventScroll: true });
      }
    };
  }, []);

  // capture 阶段接管键盘：Esc 收起；空格敲木鱼；其余游戏键不穿透到画布
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const interactive =
        target instanceof HTMLElement &&
        Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'));

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      // 输入法组合态：空格是选词，不是敲木鱼。不同浏览器分别报 isComposing 与 229
      if (event.isComposing || event.keyCode === 229) return;

      if (event.code === 'Space') {
        event.stopPropagation();
        event.preventDefault();
        // 长按不连击：空格游戏的节奏是「一下一下」
        if (event.repeat) return;
        // 焦点在按钮上时，空格照常激活按钮（浏览器默认动作已被拦，这里补一次）
        const button = target instanceof HTMLElement ? target.closest('button') : null;
        if (button) {
          button.click();
          return;
        }
        // 输入框 / 可编辑区域交给输入法，其余位置才是敲木鱼
        if (!interactive) strikeFish();
        return;
      }

      if (GAME_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.stopPropagation();
        if (!interactive) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [strikeFish, onClose]);

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 cursor-pointer bg-black/75 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulletin-title"
        tabIndex={-1}
        onKeyDown={trapFocus}
        className="animate-bulletin-in relative z-10 flex max-h-[min(720px,92dvh)] w-[min(560px,96vw)] flex-col overflow-hidden border-[6px] border-[#5b3d2a] bg-[#7a5237] p-[3px] shadow-[0_30px_80px_-32px_rgba(0,0,0,0.95)] focus-visible:outline-none"
      >
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-2 border-[#4a3123] px-3 py-3 sm:px-4"
          style={{
            backgroundColor: '#b98a57',
            backgroundImage:
              'radial-gradient(circle at 30% 40%, rgba(74,50,30,0.22) 0 1px, transparent 1.5px), radial-gradient(circle at 70% 65%, rgba(255,240,214,0.18) 0 1px, transparent 1.5px)',
            backgroundSize: '9px 11px, 13px 15px',
          }}
        >
          {/* 红布横幅：底部两个燕尾口，像真的钉在木框上 */}
          <header className="relative shrink-0">
            <div
              className="mx-auto w-[94%] border-2 border-[#8f2c2c] bg-[#b83b3b] px-3 pb-4 pt-2 text-center shadow-[0_4px_0_rgba(60,20,15,0.35)]"
              style={{
                clipPath:
                  'polygon(0 0, 100% 0, 100% 86%, 93% 100%, 86% 86%, 14% 86%, 7% 100%, 0 86%)',
              }}
            >
              <h2
                id="bulletin-title"
                className="font-display text-[26px] font-semibold leading-none tracking-[0.16em] text-[#fff1d6]"
              >
                牛马放假告示板
              </h2>
              <p className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.3em] text-[#f6c9a8]">
                NIOMA · HOLIDAY NOTICE
              </p>
            </div>
          </header>

          {/* 板块 A：本周下班冲刺 */}
          <div className="mt-2">
            <Note rotate={-0.6}>
              <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[#b08a5e] pb-1.5">
                <h3 className="font-display text-[15px] font-semibold tracking-[0.1em] text-[#2a2118]">本周下班冲刺</h3>
                <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#7a5237]">WEEK SPRINT</span>
              </div>

              <div className="mt-2 bg-[#1b1611] px-3 py-2.5">
                <p
                  className="font-mono text-[clamp(17px,4.6vw,23px)] font-semibold leading-none tabular-nums text-mint-400"
                  aria-live="off"
                >
                  {weekend ? '合法摸鱼周末进行中' : formatCountdown(countdown.remainingMs)}
                </p>
                <p className="mt-1.5 font-mono text-[8px] tracking-[0.14em] text-mist-500">
                  {weekend
                    ? `下周一 09:00 再上工 · 还剩 ${formatCountdown(countdown.weekendRemainingMs)}`
                    : '周五 18:00 准时解放 · 每秒刷新'}
                </p>
              </div>

              <div className="mt-2.5">
                <div className="flex items-baseline justify-between font-mono text-[9px] tracking-[0.1em] text-[#6b4a35]">
                  <span>本周工时已消耗</span>
                  <span className="tabular-nums text-[#2a2118]">{progress.percent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="本周工时已消耗百分比"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                  className="mt-1 h-2.5 border border-[#7a5237] bg-[#d8c39d] p-[2px]"
                >
                  <div
                    className="h-full bg-mint-500 transition-[width] duration-700 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[8px] text-[#7a5237]">
                  <span>周一 09:00</span>
                  <span>周五 18:00</span>
                </div>
              </div>
            </Note>
          </div>

          {/* 板块 B：最近重大假日 */}
          <div className="mt-3">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="font-display text-[15px] font-semibold tracking-[0.1em] text-[#3a2819]">最近重大假日</h3>
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#5c4632]">NEXT {holidays.length}</span>
            </div>
            {holidays.length === 0 ? (
              <p className="mt-2 border border-dashed border-[#6b4a35]/70 px-3 py-4 text-center font-mono text-[10px] text-[#3a2819]">
                节假日表正在维护，先按周五下班算。
              </p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {holidays.map((holiday, index) => (
                  <HolidayCard key={`${holiday.id}-${holiday.at}`} holiday={holiday} featured={index === 0} />
                ))}
              </div>
            )}
          </div>

          {/* 板块 C：今日牛马老黄历 */}
          <div className="mt-3">
            <Note rotate={0.5} tilt="left">
              <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-[#b08a5e] pb-1.5">
                <h3 className="font-display text-[15px] font-semibold tracking-[0.1em] text-[#2a2118]">今日牛马老黄历</h3>
                <span className="font-mono text-[8px] tracking-[0.14em] text-[#7a5237]">{dateKey}</span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="flex items-center gap-1 font-mono text-[9px] font-semibold tracking-[0.16em] text-[#1f7d66]">
                    <span className="h-2 w-2 bg-[#2fb59a]" aria-hidden="true" />
                    宜
                  </p>
                  <ul className="mt-1 space-y-1">
                    {almanac.good.map((item) => (
                      <li key={item} className="text-[11px] leading-snug text-[#2a2118]">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-l border-dashed border-[#b08a5e] pl-2">
                  <p className="flex items-center gap-1 font-mono text-[9px] font-semibold tracking-[0.16em] text-[#a8402f]">
                    <span className="h-2 w-2 bg-[#c0503f]" aria-hidden="true" />
                    忌
                  </p>
                  <ul className="mt-1 space-y-1">
                    {almanac.bad.map((item) => (
                      <li key={item} className="text-[11px] leading-snug text-[#2a2118]">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="mt-2 border-t border-dashed border-[#b08a5e] pt-2 text-[11px] italic leading-relaxed text-[#5c4632]">
                {almanac.motto}
              </p>
            </Note>
          </div>

          {/* 解锁条：只在本次打开期间刚凑满 20 下时出现 */}
          {drum.justUnlocked && (
            <div
              role="status"
              className="mt-3 flex items-center gap-2 border border-[#8f2c2c] bg-[#f4e6c8] px-2 py-1.5"
            >
              <span className="animate-stamp-in rotate-[12deg] border-2 border-[#b83b3b] px-1 py-0.5 font-mono text-[8px] font-semibold text-[#b83b3b]">
                已解锁
              </span>
              <p className="font-mono text-[10px] leading-relaxed text-[#2a2118]">
                工牌成就「急急急放假人」已盖上，可在工牌档案里查看。
              </p>
            </div>
          )}

          {/* 页脚：说明 + 木鱼 */}
          <footer className="mt-3 flex flex-col-reverse items-stretch gap-3 border-t border-[#6b4a35]/60 pt-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9px] leading-relaxed tracking-[0.08em] text-[#3a2819]">
                Esc 收起 · 空格敲木鱼 · 点击板外也能关
              </p>
              <p className="mt-1 font-mono text-[8px] leading-relaxed text-[#5c4632]">
                农历节日按 {tableYears} 对照表推算 · 连休天数为预期 · 数据只存在本机
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 flex min-h-9 cursor-pointer items-center gap-1.5 border-2 border-[#5b3d2a] bg-[#7a5237] px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-[#ffe9cf] transition-colors hover:border-[#2a2118] hover:bg-[#5b3d2a] focus-visible:border-amber-400 focus-visible:outline-none"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                合上告示板
              </button>
            </div>
            <FishDrum drum={drum} />
          </footer>
        </div>
      </div>
    </div>
  );
}
