'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { COMMUNITY } from '@/lib/community';
import { useGameUi } from '@/lib/game-ui';

/** 入场后自动展开的延时：错开 WelcomeBanner 的 5.6s 停留 + 0.32s 淡出 */
const AUTO_OPEN_MS = 6500;
/** 同源压缩代理：线上是 https，直连图床的 http 链接会被浏览器按混合内容拦掉 */
const QR_SRC = '/api/community/qr';

/**
 * 公告栏入口（ADR-0036 的 HUD 引导层）：右上角控件行里的一枚按钮。
 *
 * 桌面给图标 + 文字，和「打卡下班」同一行；手机压成 36px 方钮，
 * 与静音 / 全屏同高。`data-no-immersive` 让首次按压不被全屏手势抢走。
 */
export function NoticeBoardButton({ compact = false }: { compact?: boolean }) {
  const open = useGameUi((state) => state.noticeOpen);
  const setOpen = useGameUi((state) => state.setNoticeOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="打开园区公告栏，扫码加入微信群"
      title="园区公告 · 微信群"
      data-no-immersive
      data-notice-trigger
      className={`pointer-events-auto flex cursor-pointer items-center border-2 border-ink-600 bg-ink-900/92 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500 backdrop-blur-sm transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none ${
        compact ? 'h-9 w-9 justify-center' : 'min-h-9 gap-1.5 px-2 py-1.5'
      }`}
    >
      <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {!compact && <span>公告</span>}
      {!compact && <span className="h-1 w-1 bg-mint-400" aria-hidden />}
    </button>
  );
}

/**
 * 园区公告栏浮层：一块钉在墙上的木牌，二维码放在白纸托盘里。
 *
 * 二维码走 `/api/community/qr`（服务端压成调色板 PNG），因为线上的 https 页面
 * 直连 http 图床会被拦；图挂了就给「重试」，不让玩家对着破图猜。
 * 首次 online 后自动展开一次，手动关过就不再抢镜——一次性引导不写 localStorage。
 */
export function NoticeBoard({ compact = false }: { compact?: boolean }) {
  const open = useGameUi((state) => state.noticeOpen);
  const status = useGameUi((state) => state.status);
  const setNoticeOpen = useGameUi((state) => state.setNoticeOpen);
  const cardRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** 自动展开只发生一次；手动关过也记一次，之后不再弹 */
  const autoDone = useRef(false);
  const [failed, setFailed] = useState(false);
  /** 重试时换一次查询参数：接口忽略入参，只借浏览器缓存键重新取图 */
  const [attempt, setAttempt] = useState(0);

  const close = useCallback(() => {
    autoDone.current = true;
    useGameUi.getState().setNoticeOpen(false);
    // 焦点回到右上角的入口：Esc 关掉浮层后键盘用户不该掉回画布
    document.querySelector<HTMLElement>('[data-notice-trigger]')?.focus();
  }, []);

  useEffect(() => {
    if (status !== 'online' || autoDone.current) return;
    const timer = window.setTimeout(() => {
      autoDone.current = true;
      // 正在打字就别抢焦点
      if (!useGameUi.getState().chatOpen) useGameUi.getState().setNoticeOpen(true);
    }, AUTO_OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  // 打开时把焦点交给关闭按钮；Esc 关闭，Tab 在本卡片内循环
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  if (!open) return null;

  const qrSize = compact ? 136 : 160;

  return (
    <div
      className="animate-notice-veil absolute inset-0 z-30 flex items-center justify-center bg-ink-950/70 px-4 py-4 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-board-title"
        className="panel panel-scan animate-notice-in max-h-[92%] w-[min(340px,92vw)] overflow-y-auto"
      >
        <span className="absolute inset-x-0 top-0 h-0.5 bg-amber-400/80" aria-hidden />

        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b-2 border-ink-700 bg-ink-800/95 px-4 py-2.5 backdrop-blur-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-mint-400">// 园区公告</p>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="关闭公告栏"
            data-no-immersive
            className="-mr-1 grid h-6 w-6 cursor-pointer place-items-center text-mist-500 transition-colors hover:text-mint-400 focus-visible:text-mint-400 focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className={compact ? 'px-4 pb-3.5 pt-3' : 'px-5 pb-4 pt-4'}>
          <h2
            id="notice-board-title"
            className="font-display text-[22px] font-semibold leading-none tracking-[0.02em] text-mist-100"
          >
            {COMMUNITY.wechat.title}
          </h2>
          <p className="mt-2 text-[11px] leading-relaxed text-mist-300">{COMMUNITY.wechat.subtitle}</p>

          <div className="mt-3.5 flex justify-center">
            {/* z-10 把白纸托盘抬到 .panel-scan 的扫描线之上：那层 1px 暗纹盖住码面会伤扫码 */}
            <div className="relative z-10 bg-white p-2">
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
                <div className="grid place-items-center px-3 text-center" style={{ width: qrSize, height: qrSize }}>
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
                        setAttempt((value) => value + 1);
                      }}
                      className="mt-2.5 cursor-pointer border-2 border-ink-700 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900 focus-visible:outline-none"
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
                  style={{ width: qrSize, WebkitTouchCallout: 'default', userSelect: 'auto' }}
                />
              )}
            </div>
          </div>

          <p className="mt-3 text-center font-mono text-[10px] tracking-[0.12em] text-mist-300">
            {COMMUNITY.wechat.hint}
          </p>
          <p className="mt-2.5 border-l-2 border-ink-600 pl-2.5 text-[10px] leading-relaxed text-mist-500">
            {COMMUNITY.wechat.expiry}
          </p>
        </div>

        <footer className="flex items-center justify-between border-t-2 border-ink-700 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-mist-500">
          <span>{COMMUNITY.wechat.footer}</span>
          <span className="text-mint-400">notice</span>
        </footer>
      </section>
    </div>
  );
}
