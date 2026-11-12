'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Megaphone, X } from 'lucide-react';
import { COMMUNITY } from '@/lib/community';
import { useGameUi } from '@/lib/game-ui';

/** 同源压缩代理：线上是 https，直连图床的 http 链接会被浏览器按混合内容拦掉 */
const QR_SRC = '/api/community/qr';

/**
 * 二维码白纸托盘：四角定位刻线 + 加载失败可重试。
 *
 * `z-10` 把它抬到 `.panel-scan` 的扫描线之上——那层 1px 暗纹盖住码面会伤扫码。
 * 图片允许长按识别/保存：根容器的 `.no-callout` 要在这一张图上局部失效。
 */
function QrTray({ size, attempt, onRetry }: { size: number; attempt: number; onRetry: () => void }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative z-10 bg-white p-1.5">
      <span
        className="pointer-events-none absolute -left-1 -top-1 h-3 w-3 border-l-2 border-t-2 border-mint-500/80"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -right-1 -top-1 h-3 w-3 border-r-2 border-t-2 border-mint-500/80"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-1 -left-1 h-3 w-3 border-b-2 border-l-2 border-mint-500/80"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute -bottom-1 -right-1 h-3 w-3 border-b-2 border-r-2 border-mint-500/80"
        aria-hidden
      />

      {failed ? (
        <div className="grid place-items-center px-2 text-center" style={{ width: size, height: size }}>
          <div>
            <p className="font-mono text-[10px] leading-relaxed text-ink-700">
              二维码没拉下来
              <br />
              <span className="text-ink-500">检查网络后重试</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                onRetry();
              }}
              className="mt-2 cursor-pointer border-2 border-ink-700 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900 focus-visible:outline-none"
            >
              重试
            </button>
          </div>
        </div>
      ) : (
        <img
          src={`${QR_SRC}?v=${attempt}`}
          alt={COMMUNITY.wechat.alt}
          width={249}
          height={254}
          draggable={false}
          onError={() => setFailed(true)}
          className="block h-auto"
          style={{ width: size, WebkitTouchCallout: 'default', userSelect: 'auto' }}
        />
      )}
    </div>
  );
}

/**
 * 园区公告（微信群二维码）：右上角一枚「公告」小按钮，点开在下方展开可折叠的小块。
 *
 * 不做自动弹出：入场先看园区，想加群自己点。窄屏走横向版式，
 * 免得 300px 高的竖版卡片顶出矮屏舞台。
 */
export function NoticeBoard({ compact = false }: { compact?: boolean }) {
  const open = useGameUi((state) => state.noticeOpen);
  const setNoticeOpen = useGameUi((state) => state.setNoticeOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);

  const close = useCallback((restoreFocus = false) => {
    useGameUi.getState().setNoticeOpen(false);
    // 收起后焦点回到入口：Esc / 关闭按钮都不该把键盘用户甩回画布
    if (restoreFocus) rootRef.current?.querySelector<HTMLElement>('[data-notice-trigger]')?.focus();
  }, []);

  // 下拉不是模态：点画面任何地方都收起，Esc 也收起，但不拦着人继续操作游戏
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      useGameUi.getState().setNoticeOpen(false);
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

  return (
    <div ref={rootRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setNoticeOpen(!open)}
        aria-expanded={open}
        aria-controls="notice-board-panel"
        aria-label={open ? '收起园区公告栏' : '展开园区公告栏，扫码加入微信群'}
        title="园区公告 · 微信群"
        data-notice-trigger
        className={`flex cursor-pointer items-center border-2 bg-ink-900/92 font-mono text-[9px] uppercase tracking-[0.16em] backdrop-blur-sm transition-colors focus-visible:border-mint-400 focus-visible:outline-none ${
          open
            ? 'border-mint-400/60 text-mint-400'
            : 'border-ink-600 text-mist-500 hover:border-mint-400/60 hover:text-mint-400'
        } ${compact ? 'h-9 w-9 justify-center' : 'min-h-9 gap-1.5 px-2 py-1.5'}`}
      >
        <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {!compact && <span>公告</span>}
        {!compact && (
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <section
          id="notice-board-panel"
          role="dialog"
          aria-label="园区公告栏"
          className={`panel panel-scan animate-notice-in absolute right-0 top-full z-30 mt-1.5 ${
            compact ? 'w-[252px]' : 'w-[240px]'
          }`}
        >
          <span className="absolute inset-x-0 top-0 h-0.5 bg-amber-400/80" aria-hidden />

          <header className="flex items-center justify-between gap-2 border-b-2 border-ink-700 px-3 py-1.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-mint-400">// 园区公告</p>
            <button
              type="button"
              onClick={() => close(true)}
              aria-label="收起公告栏"
              className="-mr-1 grid h-5 w-5 cursor-pointer place-items-center text-mist-500 transition-colors hover:text-mint-400 focus-visible:text-mint-400 focus-visible:outline-none"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="border-b-2 border-ink-700 bg-mint-400/[0.06] px-3 py-2">
            <p className="font-mono text-[9px] tracking-[0.18em] text-mint-400">园区重装修完成</p>
            <p className="mt-1 text-[10px] leading-relaxed text-mist-300">
              北门内四角新院已启用：工作区、会议室、宿舍区、卫生间各自归位。
            </p>
          </div>

          {compact ? (
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <QrTray size={108} attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-[15px] font-semibold leading-tight tracking-[0.02em] text-mist-100">
                  {COMMUNITY.wechat.title}
                </h2>
                <p className="mt-1.5 text-[10px] leading-relaxed text-mist-300">{COMMUNITY.wechat.hint}</p>
                <p className="mt-2 text-[9px] leading-relaxed text-mist-500">{COMMUNITY.wechat.expiry}</p>
              </div>
            </div>
          ) : (
            <div className="px-3.5 pb-3 pt-2.5">
              <h2 className="font-display text-[17px] font-semibold leading-tight tracking-[0.02em] text-mist-100">
                {COMMUNITY.wechat.title}
              </h2>
              <p className="mt-1 text-[10px] leading-relaxed text-mist-300">{COMMUNITY.wechat.subtitle}</p>
              <div className="mt-2.5 flex justify-center">
                <QrTray size={148} attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
              </div>
              <p className="mt-2 text-center font-mono text-[9px] tracking-[0.1em] text-mist-300">
                {COMMUNITY.wechat.hint}
              </p>
              <p className="mt-1.5 border-l-2 border-ink-600 pl-2 text-[9px] leading-relaxed text-mist-500">
                {COMMUNITY.wechat.expiry}
              </p>
            </div>
          )}

          <footer className="flex items-center justify-between border-t-2 border-ink-700 px-3 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-mist-500">
            <span>{COMMUNITY.wechat.footer}</span>
            <span className="text-mint-400">notice</span>
          </footer>
        </section>
      )}
    </div>
  );
}
