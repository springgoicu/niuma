'use client';

import { ArrowRight, ShieldOff } from 'lucide-react';
import { useCreatorStore } from '@/lib/creator-store';
import { describeProfileName } from '@/lib/profile';

/**
 * 底部固定栏：只回显工牌名并负责上岗。
 * 输入框已经上移到页面顶部，这里保留的是「我现在叫什么」与「去改」两条最短路径。
 */
export function SaveBar({
  onSubmit,
  onFocusName,
  hydrated,
}: {
  onSubmit: () => void;
  onFocusName: () => void;
  hydrated: boolean;
}) {
  const name = useCreatorStore((state) => state.name);
  const status = describeProfileName(name);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700/80 bg-ink-900/[0.94] shadow-[0_-24px_48px_-32px_rgba(0,0,0,0.95)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[1560px] items-center gap-x-3 gap-y-2 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:gap-x-4 sm:px-8 sm:py-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-mist-400 sm:inline">
            工牌名
          </span>

          {!hydrated ? (
            <span className="h-11 sm:h-4" aria-hidden />
          ) : status.empty ? (
            <button
              type="button"
              onClick={onFocusName}
              className="inline-flex h-11 min-w-0 cursor-pointer items-center gap-2 border border-amber-400/45 bg-amber-400/[0.07] px-2.5 font-mono text-[11px] tracking-[0.06em] text-amber-400 transition-colors duration-150 hover:border-amber-400/80 sm:h-8"
            >
              <span className="h-1.5 w-1.5 shrink-0 bg-amber-400" aria-hidden />
              <span className="truncate">未填写工牌名 · 点此填写</span>
            </button>
          ) : (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-mono text-[12px] tracking-[0.02em] text-mist-100">
                {status.trimmed}
              </span>
              <button
                type="button"
                onClick={onFocusName}
                className="shrink-0 cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-mint-400 transition-colors duration-150 hover:text-lime-400"
              >
                修改
              </button>
            </span>
          )}

          {hydrated && status.blocked ? (
            <span role="alert" className="shrink-0 font-mono text-[9px] tracking-[0.12em] text-amber-400">
              名字用不了
            </span>
          ) : null}
        </div>

        <p className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mist-400 sm:flex">
          <ShieldOff className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          存在本机浏览器 · 换设备要重捏
        </p>

        <button
          type="button"
          onClick={onSubmit}
          disabled={hydrated && status.blocked}
          className="btn-primary group h-11 shrink-0 px-4 text-[12px] sm:px-6"
        >
          <span className="sm:hidden">上岗</span>
          <span className="hidden sm:inline">保存并上岗</span>
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </button>
      </div>
    </div>
  );
}
