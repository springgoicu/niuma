'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { clearRenderFallback, retryRenderUrl } from '@/lib/game/runtime/render-mode';
import { sfx } from '@/lib/game/sfx';

const SFX_STORAGE_KEY = 'niuma:sfx:muted';

/**
 * 竖屏工具栏的总高（含 2px 外框）：状态行 + 分隔线 + 两列三行方钮。
 *
 * 导览卡要顺延到它下面，所以高度必须是可引用的常量而不是各处估的魔法值；
 * 改按钮尺寸时只改这里，NavCard 的 `top` 会跟着动。
 */
export const HUD_DOCK_PORTRAIT_REM = '12.75rem';

/**
 * 右上角工具栏按钮的唯一尺寸/状态来源。
 *
 * 桌面 36×36、触屏 44×44（触屏最小命中区），全部方形等距、只在外层画一圈边框：
 * 六个入口因此天然对齐，不会再因为文字长短参差或折行而散成一堆小盒子。
 */
export function hudButtonClassName({
  compact = false,
  active = false,
  danger = false,
}: {
  compact?: boolean;
  active?: boolean;
  danger?: boolean;
} = {}): string {
  const size = compact ? 'h-11 w-11' : 'h-9 w-9';
  const tone = danger
    ? active
      ? 'bg-signal-500/15 text-signal-500'
      : 'text-mist-500 hover:bg-signal-500/10 hover:text-signal-500 focus-visible:bg-signal-500/10 focus-visible:text-signal-500'
    : active
      ? 'bg-mint-400/10 text-mint-400'
      : 'text-mist-500 hover:bg-mint-400/10 hover:text-mint-400 focus-visible:bg-mint-400/10 focus-visible:text-mint-400';
  return `pointer-events-auto grid ${size} shrink-0 cursor-pointer place-items-center transition-colors focus-visible:outline-none ${tone}`;
}

/** 工具栏外框：整条只有这一层 2px 边框，内部按钮共享底色与背板 */
export function HudDock({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-auto flex items-stretch border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

/** 横栏里的竖分隔线：把「状态 / 工具 / 导航 / 危险」四段分开 */
export function HudDivider() {
  return <span aria-hidden className="w-px shrink-0 self-stretch bg-ink-700" />;
}

/**
 * 主线程角标的一键重试：清掉回退标记，并把地址上的 `render` 参数摘掉。
 *
 * 只重试一次：环境本身起不来渲染线程时，下一次启动会再回退一次并重新记上标记，
 * 角标回来告诉玩家「这台机器就是没有渲染线程」，而不是让他反复刷新。
 */
function retryRenderThread(): void {
  clearRenderFallback();
  if (typeof location === 'undefined') return;
  location.replace(retryRenderUrl(location.href));
}

/**
 * 工具栏最左端的状态段：在线灯 + 视野人数，单行。
 *
 * 只保留玩家真正会看的两件事；`aoi 900px`、连接状态明细这类调试信息
 * 留在断线横幅里，不占常驻 HUD。渲染线程崩过、已经掉到主线程时，末尾多一枚
 * 琥珀色角标——它是这一段里唯一的可点元素，也是那条「为什么就我卡」的自救入口。
 */
export function HudStatus({ compact = false }: { compact?: boolean }) {
  const nearby = useGameUi((state) => state.nearby);
  const status = useGameUi((state) => state.status);
  const renderMode = useGameUi((state) => state.renderMode);
  const online = status === 'online';

  // 刻意不用 role="status"：人数每 2 秒变一次，做成 live region 会让读屏
  // 反复打断玩家；可见文本本身已经可读，这里只补一条悬停说明
  return (
    <div
      title={online ? `视野内 ${nearby} 头牛马` : '正在接入园区'}
      className={`pointer-events-none flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
        compact ? 'h-11 px-2.5' : 'h-9 px-2.5'
      }`}
    >
      <span
        aria-hidden
        className={`${compact ? 'h-1.5 w-1.5' : 'h-2 w-2'} shrink-0 ${
          online ? 'animate-blink bg-mint-400' : 'bg-amber-400'
        }`}
      />
      <span className="shrink-0 text-mist-500">视野</span>
      <span className="shrink-0 tabular-nums text-mist-300">{nearby}</span>
      {renderMode === 'main' && (
        <button
          type="button"
          onClick={retryRenderThread}
          aria-label="当前为主线程渲染，点击重试渲染线程"
          title="渲染线程不可用，当前在主线程上跑，性能受限；点击重试渲染线程"
          className={`pointer-events-auto ml-0.5 shrink-0 cursor-pointer whitespace-nowrap border border-amber-400/60 leading-none text-amber-400 transition-colors hover:bg-amber-400/15 focus-visible:bg-amber-400/20 focus-visible:outline-none ${
            compact ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-1 text-[9px]'
          }`}
        >
          主线程
        </button>
      )}
    </div>
  );
}

/**
 * 游戏音效静音开关：发泄 / 设施互动共用同一条 master 总线（ADR-0048）。
 * 偏好只存本地，不参与任何服务端状态；初值固定为「有声」，
 * 挂载后再读存储，避免 SSR 水合不一致。
 */
export function SfxToggle({ compact = false }: { compact?: boolean }) {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SFX_STORAGE_KEY) === '1';
    setMuted(stored);
    sfx.setMuted(stored);
  }, []);

  const toggle = () => {
    const next = sfx.toggle();
    setMuted(next);
    window.localStorage.setItem(SFX_STORAGE_KEY, next ? '1' : '0');
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? '开启游戏音效' : '关闭游戏音效'}
      title={muted ? '游戏音效已关闭' : '游戏音效已开启'}
      className={hudButtonClassName({ compact, active: muted })}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );
}

/** 物种标签：他人工牌共用；新的左上角工牌用像素立绘，不再用文字标签 */
export function SpeciesTag({ species, dense = false }: { species: string; dense?: boolean }) {
  return (
    <span className={`tag shrink-0 ${dense ? 'px-1 py-0 text-[9px] tracking-[0.08em]' : ''}`}>
      {species === 'cow' ? 'cow' : 'horse'}
    </span>
  );
}

/** 断线 / 重连横幅：右上角在线状态已并入工具栏，见 `HudStatus` */
export function ConnectionBanner() {
  const status = useGameUi((state) => state.status);
  const detail = useGameUi((state) => state.detail);
  const rejected = useGameUi((state) => state.rejected);
  // 排队与被拒由 QueueGate 整屏接管，横幅只负责「接入中/断线」这类过渡态
  if (status === 'online' || status === 'idle' || status === 'queued' || rejected > 0) return null;
  // error 是渲染/初始化故障，不是网络断线：复用「正在重连」会让用户一直刷新却
  // 永远等不到重连成功。显示真实原因，颜色也和断线区分开。
  const isError = status === 'error';
  const label = status === 'connecting'
    ? '正在接入园区…'
    : isError
      ? detail || '渲染器异常，请刷新页面'
      : '连接中断，正在重连';
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2">
      <div className={`flex items-center gap-3 border-2 bg-ink-900/95 px-4 py-2 backdrop-blur ${
        isError ? 'border-red-400/60' : 'border-amber-400/60'
      }`}>
        <span className={`h-2 w-2 ${isError ? 'bg-red-400' : 'animate-blink bg-amber-400'}`} />
        <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${
          isError ? 'text-red-400' : 'text-amber-400'
        }`}>
          {label}
        </span>
      </div>
    </div>
  );
}
