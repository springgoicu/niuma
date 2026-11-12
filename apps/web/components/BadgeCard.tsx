'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterAppearance, Species } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { getCurrentSessionDuration, useAttendance } from '@/lib/game/attendance';
import { GEO_FALLBACK, loadGeo, readCachedGeo, type GeoInfo } from '@/lib/game/geo';
import { StatusEditor } from './game/StatusEditor';
import { BadgeDetailModal } from './BadgeDetailModal';

export interface BadgeCardProps {
  name: string;
  species: Species;
  appearance: CharacterAppearance;
  statusText: string;
  onStatusChange: (status: string) => void;
  compact?: boolean;
  /** 打开档案时通知外壳清掉移动输入（WASD 掩码 / 自动寻路） */
  onDetailOpen?: () => void;
}

/**
 * 走秒单独订阅：整张工牌不必每秒重渲染，只有这一行数字在跳。
 * store 未启动时 now 为 0，函数会安全退化成 00:00:00。
 */
function SessionClock({ className }: { className?: string }) {
  const start = useAttendance((state) => state.sessionStartTime);
  const now = useAttendance((state) => state.now);
  return <span className={className}>{getCurrentSessionDuration(start, now)}</span>;
}

/**
 * 左上角常驻工牌。
 *
 * 布局与旧 PlayerCard 同一个槽位（HUD 顶栏左侧），但只保留三行信息：
 * 物种 + 昵称 + 状态 / 出勤地 / 在岗走秒。整卡点击仍是改状态，
 * 右侧独立竖条才是档案入口——两个交互不嵌套，键盘与读屏都不会打架。
 */
export function BadgeCard({
  name,
  species,
  appearance,
  statusText,
  onStatusChange,
  compact = false,
  onDetailOpen,
}: BadgeCardProps) {
  const statusOpen = useGameUi((state) => state.statusOpen);
  const setStatusOpen = useGameUi((state) => state.setStatusOpen);
  const setChatOpen = useGameUi((state) => state.setChatOpen);
  const [detailOpen, setDetailOpen] = useState(false);
  // 首帧先读会话缓存：回访时不必等请求就能显示上次的归属地
  const [geo, setGeo] = useState<GeoInfo>(() => readCachedGeo() ?? GEO_FALLBACK);

  useEffect(() => {
    let alive = true;
    void loadGeo().then((info) => {
      if (alive) setGeo(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggleStatus = useCallback(() => {
    // 手机端左上角只有一块地方：展开状态编辑时把聊天收起（维持旧工牌的行为）
    if (!statusOpen && compact) setChatOpen(false);
    setStatusOpen(!statusOpen);
  }, [compact, setChatOpen, setStatusOpen, statusOpen]);

  const openDetail = useCallback(() => {
    setStatusOpen(false);
    setDetailOpen(true);
    onDetailOpen?.();
  }, [onDetailOpen, setStatusOpen]);

  const closeDetail = useCallback(() => setDetailOpen(false), []);

  return (
    <div
      className={`pointer-events-auto border-2 border-neutral-700 bg-neutral-900/80 backdrop-blur-xs ${
        compact ? 'w-[200px]' : 'w-[268px]'
      }`}
    >
      {/* 三行主体与档案竖条共用一个定位容器：状态编辑展开时竖条不会跟着拉长 */}
      <div className="relative">
        <button
          type="button"
          onClick={toggleStatus}
          aria-expanded={statusOpen}
          aria-controls="status-editor"
          aria-label={`${name} 的工牌，点击设置状态`}
          title={statusText ? '修改状态' : '设置状态'}
          data-no-immersive
          className={`block w-full cursor-pointer pr-11 text-left transition-colors hover:bg-neutral-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400 ${
            compact ? 'px-2 py-2' : 'px-3 py-2.5'
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <img
              src={`/sprites/preview-${species}.png`}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={`pixelated shrink-0 ${compact ? 'h-4 w-4' : 'h-5 w-5'}`}
            />
            <span
              className={`min-w-0 max-w-[62%] truncate font-display font-bold text-white ${
                compact ? 'text-[12px]' : 'text-sm'
              }`}
            >
              {name}
            </span>
            {statusText ? (
              <span
                className={`min-w-0 flex-1 truncate font-mono text-mint-400 ${
                  compact ? 'text-[9px]' : 'text-[10px]'
                }`}
              >
                {statusText}
              </span>
            ) : (
              <span className="flex-1" />
            )}
          </span>

          <span
            className={`mt-1 flex min-w-0 items-center gap-1 font-mono text-mist-400 ${
              compact ? 'text-[9px]' : 'text-[10px]'
            }`}
          >
            <span aria-hidden="true">📍</span>
            <span className="shrink-0">出勤地：</span>
            <span className="min-w-0 truncate text-mist-300">
              {geo.region} · {geo.city}
            </span>
          </span>

          <span
            className={`mt-0.5 flex min-w-0 items-center gap-1 font-mono text-mist-400 ${
              compact ? 'text-[9px]' : 'text-[10px]'
            }`}
          >
            <span aria-hidden="true">⏱️</span>
            <span className="shrink-0">在岗时长：</span>
            <SessionClock className="tabular-nums text-emerald-400" />
          </span>
        </button>

        {/* 档案入口：独立按钮贴在卡片右侧，不嵌在状态按钮里 */}
        <button
          type="button"
          onClick={openDetail}
          aria-haspopup="dialog"
          aria-label="打开牛马考勤档案"
          title="牛马考勤档案"
          data-no-immersive
          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer flex-col items-center justify-center gap-1 border-l-2 border-neutral-700 bg-neutral-900/60 text-mist-400 transition-colors hover:bg-neutral-800 hover:text-mint-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-400"
        >
          <span className="text-[12px] leading-none" aria-hidden="true">
            📄
          </span>
          <span className="font-mono text-[8px] tracking-[0.08em]">档案</span>
        </button>
      </div>

      {statusOpen && (
        <StatusEditor
          value={statusText}
          compact={compact}
          onSave={onStatusChange}
          onClose={() => setStatusOpen(false)}
        />
      )}

      {detailOpen && typeof document !== 'undefined'
        ? createPortal(
            <BadgeDetailModal
              name={name}
              appearance={appearance}
              geo={geo}
              onClose={closeDetail}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
