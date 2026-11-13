'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Link2, MonitorCheck, MonitorDown, X } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import {
  detectInstallPlatform,
  installGuide,
  type InstallGuide,
  type InstallPlatform,
} from '@/lib/install-guide';
import { copyPageLink, promptInstall } from '@/lib/install-prompt';
import { useInstallPrompt } from '@/lib/use-install-prompt';
import { hudButtonClassName } from './Hud';

/** 「已复制」就地停留的时长：够看清，又不至于让按钮一直是完成态 */
const COPIED_MS = 1600;

/**
 * 手动引导正文：主路径（没有安装信号）与被拒之后的兜底路径共用同一段文案，
 * 避免两处各写一套步骤、改一处漏一处。
 */
function GuideSteps({ guide }: { guide: InstallGuide }) {
  return (
    <>
      <p className="font-display text-[14px] font-semibold leading-tight text-mist-100">
        {guide.heading}
      </p>
      <ol className="mt-2 space-y-1.5">
        {guide.steps.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span
              aria-hidden
              className="mt-px shrink-0 font-mono text-[9px] tabular-nums text-mint-400/80"
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="text-[10px] leading-relaxed text-mist-300">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 border-l-2 border-ink-600 pl-2 text-[9px] leading-relaxed text-mist-400">
        {guide.shortcut}
      </p>
    </>
  );
}

/**
 * 园区右上角的「存到桌面」入口。
 *
 * 面板三种正文，按浏览器能力择优：
 * 1. 已在独立窗口里 → 只报状态，不再劝人装；
 * 2. Chromium 给了安装信号 → 主行动直接弹原生安装框；
 * 3. 其余浏览器 → 按系统给出分步引导（`install-guide.ts`）。
 *
 * 形态与 `NoticeBoard` 完全同构：右上角下拉、点外部收起、Esc 收起并回焦，
 * 不抢焦点、不拦着人继续操作游戏。
 */
export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const open = useGameUi((state) => state.installOpen);
  const setInstallOpen = useGameUi((state) => state.setInstallOpen);
  const { canPrompt, installed } = useInstallPrompt();
  const [platform, setPlatform] = useState<InstallPlatform>('desktop-other');
  const [copied, setCopied] = useState(false);
  /** 正在等原生安装框的答复：期间禁用按钮，避免连点二次弹框 */
  const [pending, setPending] = useState(false);
  /** 上一次安装尝试的结果：取消与失败都要有可见反馈，不能点完像没反应 */
  const [note, setNote] = useState<'cancelled' | 'blocked' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | null>(null);

  // UA 只在挂载后读：服务端没有 navigator，首帧统一按通用引导，避免水合不一致
  useEffect(() => {
    setPlatform(
      detectInstallPlatform(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints }),
    );
  }, []);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const close = useCallback((restoreFocus = false) => {
    useGameUi.getState().setInstallOpen(false);
    // 收起后焦点回到入口：Esc / 关闭按钮都不该把键盘用户甩回画布
    if (restoreFocus) {
      rootRef.current?.querySelector<HTMLElement>('[data-install-trigger]')?.focus();
    }
  }, []);

  // 下拉不是模态：点画面任何地方都收起，Esc 也收起，但不拦着人继续操作游戏
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      useGameUi.getState().setInstallOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const copy = useCallback(async () => {
    const done = await copyPageLink();
    if (!done) return;
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }, []);

  /**
   * 弹原生安装框。
   *
   * 事件是一次性的：被取消就真的用掉了（`dismissed`），但「没弹起来」
   * 不该把这次会话的安装能力一起没收——`promptInstall()` 会把事件放回去，
   * 所以这里允许用户再点一次。
   */
  const install = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setNote(null);
    const outcome = await promptInstall();
    setPending(false);
    if (outcome === 'dismissed') setNote('cancelled');
    else if (outcome === 'unavailable') setNote('blocked');
  }, [pending]);

  const toggle = useCallback(() => {
    setNote(null);
    setInstallOpen(!open);
  }, [open, setInstallOpen]);

  const guide = installGuide(platform);
  const label = installed ? '已在桌面' : '存到桌面';

  return (
    <div ref={rootRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="install-app-panel"
        aria-label={open ? '收起桌面入口' : `${label}，可加到桌面、主屏或书签`}
        title={installed ? '已经在桌面上了' : '存到桌面 · 加到主屏或书签'}
        data-install-trigger
        className={hudButtonClassName({ compact, active: open })}
      >
        {installed ? (
          <MonitorCheck className="h-4 w-4" aria-hidden />
        ) : (
          <MonitorDown className="h-4 w-4" aria-hidden />
        )}
      </button>

      {open && (
        <section
          id="install-app-panel"
          role="dialog"
          aria-label="存到桌面"
          className={`panel panel-scan animate-notice-in absolute right-0 top-full z-30 mt-1.5 ${
            compact ? 'w-[264px]' : 'w-[268px]'
          }`}
        >
          <span className="absolute inset-x-0 top-0 h-0.5 bg-mint-400/80" aria-hidden />

          <header className="flex items-center justify-between gap-2 border-b-2 border-ink-700 px-3 py-1.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-mint-400">
              // 桌面入口
            </p>
            <button
              type="button"
              onClick={() => close(true)}
              aria-label="收起桌面入口"
              className="-mr-1 grid h-5 w-5 cursor-pointer place-items-center text-mist-500 transition-colors hover:text-mint-400 focus-visible:text-mint-400 focus-visible:outline-none"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          {installed ? (
            <div className="flex items-start gap-2 px-3 py-3">
              <MonitorCheck className="mt-px h-3.5 w-3.5 shrink-0 text-mint-400" aria-hidden />
              <div className="min-w-0">
                <p className="font-display text-[14px] font-semibold leading-tight text-mist-100">
                  已经在桌面上了
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-mist-300">
                  从桌面图标打开的牛马是独立窗口，昵称、外观和上次去的园区都还在。
                </p>
              </div>
            </div>
          ) : canPrompt ? (
            <div className="px-3 py-3">
              <p className="font-display text-[14px] font-semibold leading-tight text-mist-100">
                {note === 'blocked' ? '这次没装成' : '把园区装到桌面'}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-mist-300">
                {note === 'blocked'
                  ? '浏览器这次没允许安装，可以再点一次，也可以按下面的方式手动添加。'
                  : '桌面或任务栏会多一个牛马图标，点开直接进上次那座园区。'}
              </p>
              <button
                type="button"
                onClick={() => void install()}
                disabled={pending}
                className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-1.5 border-2 border-mint-400 bg-mint-400/15 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-mint-400 transition-colors hover:bg-mint-400/25 focus-visible:bg-mint-400/25 focus-visible:outline-none disabled:cursor-progress disabled:opacity-60"
              >
                <MonitorDown className="h-3.5 w-3.5" aria-hidden />
                {pending ? '正在唤起安装…' : note === 'blocked' ? '再试一次' : '装到桌面'}
              </button>
              {note === 'blocked' && (
                <div className="mt-2.5 border-t-2 border-ink-700 pt-2.5">
                  <GuideSteps guide={guide} />
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 pb-2.5 pt-3">
              {/* 取消一次之后 Chromium 会收回这次的安装信号：说清楚为什么换成了手动步骤 */}
              {note === 'cancelled' && (
                <p role="status" className="mb-2 border-l-2 border-amber-400/60 pl-2 text-[9px] leading-relaxed text-amber-400">
                  已取消安装。想再装可以按下面的步骤添加。
                </p>
              )}
              <GuideSteps guide={guide} />
            </div>
          )}

          <footer className="flex items-center justify-between gap-2 border-t-2 border-ink-700 px-3 py-1.5">
            <button
              type="button"
              onClick={() => void copy()}
              className={`flex cursor-pointer items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors focus-visible:text-mint-400 focus-visible:outline-none ${
                copied ? 'text-mint-400' : 'text-mist-400 hover:text-mint-400'
              }`}
            >
              {copied ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <Link2 className="h-3 w-3" aria-hidden />
              )}
              <span>{copied ? '已复制' : '复制链接'}</span>
            </button>
            <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-mist-500">
              install
            </span>
          </footer>

          {/* 复制结果只用屏幕阅读器播报：按钮自己已经变成「已复制」，不用全屏 toast */}
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? '园区链接已复制' : ''}
          </span>
        </section>
      )}
    </div>
  );
}
