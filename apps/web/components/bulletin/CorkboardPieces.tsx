'use client';

import type { ReactNode } from 'react';
import { holidayDaysLabel, type Holiday } from '@/lib/game/holiday-calendar';
import { serverDateKey } from '@/lib/game/server-date';
import { serverTzOffsetMin } from '@/lib/game/server-clock';

/**
 * 软木板上的两件实物：便签纸与日历撕页（ADR-0059）。
 *
 * 单独收在这里，是因为弹窗要回答的是「这周还剩多久、下个假期几天」，
 * 纸怎么钉、钉在哪个角度属于陈设，不该和取数与键盘逻辑挤在一个文件里。
 */

/** 便签纸：一张泛黄纸 + 一枚图钉；旋转角度由调用方给，避免整排一模一样 */
export function Note({
  children,
  rotate = 0,
  tilt = 'center',
}: {
  children: ReactNode;
  rotate?: number;
  tilt?: 'center' | 'left';
}) {
  return (
    <section
      className="relative border border-[#b08a5e] bg-[#f4e6c8] px-3 pb-2.5 pt-3 shadow-[0_1px_0_rgba(60,40,25,0.35),0_8px_18px_-12px_rgba(0,0,0,0.75)]"
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <span
        aria-hidden="true"
        className={`absolute -top-[5px] h-2.5 w-2.5 rounded-full border border-black/35 shadow-[1px_2px_2px_rgba(40,24,10,0.45)] ${
          tilt === 'center' ? 'left-1/2 -translate-x-1/2 bg-[#4fe3c1]' : 'left-4 bg-[#e07a4a]'
        }`}
      />
      {children}
    </section>
  );
}

/** 日历撕页：红页眉 + 节日名 + 剩余天数；不再写每年都不同的「连休 N 天」预期 */
export function HolidayCard({ holiday, featured }: { holiday: Holiday; featured: boolean }) {
  // 月份按园区日历读：节日日期本身就是园区零点，用本机时区会整体错一天
  const month = Number.parseInt(serverDateKey(holiday.at, serverTzOffsetMin()).slice(5, 7), 10);
  return (
    <article
      className={`relative border bg-[#fff6e0] shadow-[0_1px_0_rgba(60,40,25,0.3),0_6px_12px_-10px_rgba(0,0,0,0.7)] ${
        featured ? 'border-[#b83b3b]' : 'border-[#c8a878]'
      }`}
    >
      <div className="flex items-center justify-between bg-[#b83b3b] px-1.5 py-0.5 font-mono text-[8px] tracking-[0.14em] text-[#ffe9cf]">
        <span>{month} 月</span>
        <span className="tabular-nums">{holiday.daysLeft === 0 ? 'TODAY' : `${holiday.daysLeft}D`}</span>
      </div>
      <div className="px-2 pb-2 pt-1.5">
        <p className="font-display text-[15px] font-semibold leading-none text-[#2a2118]">{holiday.name}</p>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[#1f7d66]">{holidayDaysLabel(holiday.daysLeft)}</p>
      </div>
      {featured && (
        <span className="absolute -right-1.5 -top-2 rotate-6 border border-amber-400 bg-[#f2c879] px-1 py-px font-mono text-[8px] font-semibold text-[#2a2118]">
          最近
        </span>
      )}
    </article>
  );
}
