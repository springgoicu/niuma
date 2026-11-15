'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Compass } from 'lucide-react';
import { DISTRICTS, SPAWN_CENTER, districtAt, regionAt, type NavTargetId } from '@niuma/shared-types';
import { useGameUi } from '@/lib/game-ui';
import { nearestReading, navReadings, plazaReading, sceneLabel, OCTANT_NAMES } from '@/lib/game/nav';
import { HUD_DOCK_PORTRAIT_REM } from './Hud';

/** 触摸端：离开北门口袋超过这个距离就自动收起，把画面还给摇杆与动作盘 */
const LEASH = 260;
/** 触摸端：入场后自动展开的时长 */
const AUTO_COLLAPSE_MS = 8000;

/** 区色 → CSS 十六进制：区色只在 `DISTRICTS` 里定义一次，这里只做格式转换 */
function districtTint(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * 园区导览卡（ADR-0036 / ADR-0040 / ADR-0077）：实时方位 + 名称 + 步行秒数，
 * 每行是一个「去这里」按钮——点击后角色沿网格 A* 自动走过去，
 * 导航中该行变成「取消」。
 *
 * 目标只列可互动设施与四间房（共 8 处），列表按「室内 / 园区」分组并限高滚动：
 * 组标题吸顶，竖屏里不会把画面挤掉；滚动只吃指针，不吃 WASD。
 * 方位与距离全部来自 `nav.ts`（共享 `NAV_TARGETS`），箭头按真实方位角旋转；
 * 位置每 500ms 由 store 更新一次，正好够用，不额外开轮询。
 */
export function NavCard({
  compact = false,
  portrait = false,
  onNavigate,
  onNavigateHome,
  onCancelNavigation,
}: {
  compact?: boolean;
  portrait?: boolean;
  onNavigate: (id: NavTargetId) => void;
  /** 回中央广场：广场不是场所，走客户端动作（ADR-0099） */
  onNavigateHome: () => void;
  onCancelNavigation: () => void;
}) {
  const x = useGameUi((state) => state.x);
  const y = useGameUi((state) => state.y);
  const chatOpen = useGameUi((state) => state.chatOpen);
  const noticeOpen = useGameUi((state) => state.noticeOpen);
  const installOpen = useGameUi((state) => state.installOpen);
  const navTarget = useGameUi((state) => state.navTarget);
  /** 指路牌发来的「请展开」序号；0 表示还没人请求过 */
  const navOpenSeq = useGameUi((state) => state.navOpenSeq);
  const [open, setOpen] = useState(true);
  /** 用户手动开合过就不再自动收起，避免和手指抢控制权 */
  const manual = useRef(false);

  const readings = useMemo(() => navReadings(x, y), [x, y]);
  // ADR-0097：导览卡按五区分组，空组不占位；组顺序即 DISTRICTS 的顺序。
  // 组标题带上 `district.color`：与世界里的区门门灯、指路牌书脊是同一份色标，
  // 玩家在画布上认过的颜色，在面板里能立刻对上。
  const groups = useMemo(
    () =>
      DISTRICTS.map((district) => ({
        key: district.id,
        label: district.name,
        color: district.color,
        items: readings.filter((reading) => reading.target.district === district.id),
      })).filter((group) => group.items.length > 0),
    [readings],
  );
  const nearest = nearestReading(readings);
  const navReading = navTarget ? readings.find((reading) => reading.target.id === navTarget.id) ?? null : null;
  // 回广场那一行：广场不是场所，读数单独算一条
  const home = plazaReading(x, y);
  const headingHome = navTarget?.id === 'plaza';
  const place = regionAt(x, y);
  const district = districtAt(x, y);
  const region = district && place !== district.name ? `${district.name} · ${place}` : place;

  useEffect(() => {
    if (!compact) return;
    const timer = window.setTimeout(() => {
      if (!manual.current) setOpen(false);
    }, AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [compact]);

  useEffect(() => {
    if (!compact) return;
    const dx = x - SPAWN_CENTER.x;
    const dy = y - SPAWN_CENTER.y;
    if (dx * dx + dy * dy > LEASH * LEASH && !manual.current) setOpen(false);
  }, [compact, x, y]);

  // 世界指路牌按 F 或点击牌面：外面只能发「请展开」的序号，
  // 这里顺手把 manual 置位，免得刚展开就被自动收起逻辑（离开出生点 / 超时）收回去。
  useEffect(() => {
    if (navOpenSeq === 0) return;
    manual.current = true;
    setOpen(true);
  }, [navOpenSeq]);

  const toggle = () => {
    manual.current = true;
    setOpen((value) => !value);
  };

  // 导航中点某一行：换目标直接重新寻路，点同一行则取消
  const pick = (id: NavTargetId) => {
    manual.current = true;
    if (navTarget?.id === id) onCancelNavigation();
    else onNavigate(id);
  };

  // 竖屏聊天浮层从左上铺到 250px、右上角的两块下拉（公告 / 桌面入口）都从右上展开，
  // 与 196px 的导览卡没有并存的余地
  if (portrait && (chatOpen || noticeOpen || installOpen)) return null;

  return (
    <div
      className={`pointer-events-none absolute z-20 ${
        compact ? 'right-3 top-[100px]' : 'bottom-4 right-4 lg:bottom-[248px]'
      }`}
      // 竖屏右上是「状态行 + 两列方钮格」的系统工具栏：高度由 hud.ts 的
      // HUD_DOCK_PORTRAIT_REM 统一给出，导览卡顺延到它下面并让开刘海
      style={
        compact && portrait
          ? { top: `calc(max(0.75rem, env(safe-area-inset-top)) + ${HUD_DOCK_PORTRAIT_REM})` }
          : undefined
      }
    >
      {open ? (
        <section
          aria-label="园区导览"
          className="pointer-events-auto w-[196px] border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm"
        >
          <header className="flex items-center gap-1.5 border-b-2 border-ink-700 px-2.5 py-1.5">
            <Compass className="h-3 w-3 shrink-0 text-mint-400" aria-hidden />
            <span className="flex-1 truncate font-mono text-[9px] tracking-[0.16em] text-mist-300">
              园区导览 <span className="text-mist-500">/ nav</span>
            </span>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={true}
              aria-label="收起园区导览"
              className="grid h-5 w-5 cursor-pointer place-items-center text-mist-500 transition-colors hover:text-mint-400 focus-visible:text-mint-400 focus-visible:outline-none"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="max-h-[280px] overflow-y-auto overscroll-contain">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-y border-ink-700/70 bg-ink-900/95 px-2.5 py-1 font-mono text-[8px] tracking-[0.16em] text-mist-500">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2.5 w-[3px] shrink-0"
                      style={{ backgroundColor: districtTint(group.color) }}
                    />
                    <span className="truncate">{group.label}</span>
                  </span>
                  <span className="tabular-nums text-mist-600">{group.items.length}</span>
                </div>
                <ul>
                  {group.items.map((reading) => {
                    const navigating = navTarget?.id === reading.target.id;
                    // 导航中只高亮目标行，避免「最近」与「正在前往」两套高亮打架
                    const nearestActive = !navTarget && nearest?.target.id === reading.target.id;
                    return (
                      <li key={reading.target.id}>
                        <button
                          type="button"
                          onClick={() => pick(reading.target.id)}
                          aria-pressed={navigating}
                          aria-label={
                            navigating
                              ? `取消前往${reading.target.name}`
                              : `前往${reading.target.name}，${OCTANT_NAMES[reading.octant]}方向，步行约 ${reading.seconds} 秒`
                          }
                          className={`group flex min-h-9 w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors focus-visible:bg-mint-400/10 focus-visible:outline-none ${
                            navigating
                              ? 'bg-mint-400/12 text-mint-400'
                              : nearestActive
                                ? 'bg-mint-400/5 text-mint-400 hover:bg-mint-400/10'
                                : 'text-mist-300 hover:bg-ink-800/80 hover:text-mist-100'
                          }`}
                        >
                          <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center">
                            <ArrowUp
                              className="h-3.5 w-3.5 transition-transform duration-200"
                              style={{ transform: `rotate(${reading.bearingDeg}deg)` }}
                            />
                          </span>
                          <span className="flex-1 truncate text-[11px] leading-none">{reading.target.name}</span>
                          <span className="shrink-0 font-mono text-[8px] tracking-[0.08em] text-mist-500">
                            {sceneLabel(reading.target.scene)}
                          </span>
                          <span
                            className={`font-mono text-[9px] tabular-nums ${
                              navigating ? 'text-mint-400/80' : 'text-mist-400'
                            }`}
                          >
                            ≈{reading.seconds}s
                          </span>
                          <span
                            aria-hidden
                            className={`shrink-0 font-mono text-[9px] tracking-[0.08em] transition-colors ${
                              navigating
                                ? 'text-signal-500'
                                : nearestActive
                                  ? 'text-mint-400/80 group-hover:text-mint-400'
                                  : 'text-mist-500 group-hover:text-mint-400'
                            }`}
                          >
                            {navigating ? '取消' : '去这里'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {/* 回中央广场：广场不属于任何大区，单独一条，永远排在最后 */}
            <div className="border-t border-ink-700/70">
              <div className="flex items-center justify-between border-b border-ink-700/70 bg-ink-900/95 px-2.5 py-1 font-mono text-[8px] tracking-[0.16em] text-mist-500">
                <span>广场</span>
                <span className="tabular-nums text-mist-600">1</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  manual.current = true;
                  if (headingHome) onCancelNavigation();
                  else onNavigateHome();
                }}
                aria-pressed={headingHome}
                aria-label={
                  headingHome
                    ? '取消回中央广场'
                    : `回中央广场，${OCTANT_NAMES[home.octant]}方向，步行约 ${home.seconds} 秒`
                }
                className={`group flex min-h-9 w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left transition-colors focus-visible:bg-mint-400/10 focus-visible:outline-none ${
                  headingHome ? 'bg-mint-400/12 text-mint-400' : 'text-mist-300 hover:bg-ink-800/80 hover:text-mist-100'
                }`}
              >
                <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center">
                  <ArrowUp
                    className="h-3.5 w-3.5 transition-transform duration-200"
                    style={{ transform: `rotate(${home.bearingDeg}deg)` }}
                  />
                </span>
                <span className="flex-1 truncate text-[11px] leading-none">回中央广场</span>
                <span className="shrink-0 font-mono text-[8px] tracking-[0.08em] text-mist-500">室外</span>
                <span
                  className={`font-mono text-[9px] tabular-nums ${
                    headingHome ? 'text-mint-400/80' : 'text-mist-400'
                  }`}
                >
                  ≈{home.seconds}s
                </span>
                <span
                  aria-hidden
                  className={`shrink-0 font-mono text-[9px] tracking-[0.08em] transition-colors ${
                    headingHome ? 'text-signal-500' : 'text-mist-500 group-hover:text-mint-400'
                  }`}
                >
                  {headingHome ? '取消' : '去这里'}
                </span>
              </button>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-2 border-t-2 border-ink-700 px-2.5 py-1 font-mono text-[8px] tracking-[0.12em] text-mist-400">
            <span className="truncate">{region}</span>
            <span className={`shrink-0 ${navTarget ? 'text-mint-400' : ''}`}>
              {navTarget ? `前往 ${navTarget.name}` : '步行'}
            </span>
          </footer>
        </section>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={
            navTarget
              ? `展开园区导览，正在前往${navTarget.name}`
              : nearest
                ? `展开园区导览，最近 ${nearest.target.name} 约 ${nearest.seconds} 秒`
                : '展开园区导览'
          }
          className="pointer-events-auto flex h-9 cursor-pointer items-center gap-1.5 border-2 border-ink-600 bg-ink-900/92 px-2.5 font-mono text-[9px] tracking-[0.14em] text-mist-300 backdrop-blur-sm transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
        >
          <Compass className="h-3.5 w-3.5 text-mint-400" aria-hidden />
          {navTarget ? (
            <>
              {navReading && (
                <ArrowUp
                  aria-hidden
                  className="h-3 w-3 text-mint-400"
                  style={{ transform: `rotate(${navReading.bearingDeg}deg)` }}
                />
              )}
              <span className="text-mist-100">前往 {navTarget.name}</span>
            </>
          ) : (
            <>
              导览
              {nearest && (
                <>
                  <ArrowUp
                    aria-hidden
                    className="h-3 w-3 text-mint-400"
                    style={{ transform: `rotate(${nearest.bearingDeg}deg)` }}
                  />
                  <span className="text-mist-100">{nearest.target.name}</span>
                  <span className="tabular-nums text-mist-400">≈{nearest.seconds}s</span>
                </>
              )}
            </>
          )}
        </button>
      )}
    </div>
  );
}
