'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Maximize, Minimize } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import type { ActionKey } from '@/lib/game/input';
import { GameSession } from '@/lib/game/session';
import { loadSnapshot } from '@/lib/game/snapshot';
import {
  defaultAppearance,
  loadProfile,
  resolveProfileName,
  resolveProfileStatus,
  saveProfile,
  type Profile,
} from '@/lib/profile';
import { ActionBar } from './ActionBar';
import { ChatDock } from './ChatDock';
import { ConnectionBanner, OnlineBadge, PlayerCard, SfxToggle } from './Hud';
import { InspectCard } from './InspectCard';
import { JoinGate } from './JoinGate';
import { MiniMap } from './MiniMap';
import { NavCard } from './NavCard';
import { QueueGate } from './QueueGate';
import { WelcomeBanner } from './WelcomeBanner';
import { Joystick, TouchActions } from './TouchControls';
import { useImmersiveStage, useIsTouch, useLandscapeStage, useVisualViewportSize } from '@/lib/use-touch-stage';

/**
 * 竖屏触屏时把舞台横过来（系统横屏锁失败的兜底）：
 * 舞台宽高互换，再绕左上角旋转 90° 并平移回视口内。
 */
const LANDSCAPE_STAGE_STYLE = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100dvh',
  height: '100dvw',
  transformOrigin: '0 0',
  transform: 'translate(100dvw, 0) rotate(90deg)',
} as const;

export function GameViewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const isTouch = useIsTouch();
  const rotated = useLandscapeStage(isTouch);
  // 全屏 + 横屏锁：手机端拿到真正的横向满屏，锁不住时由 rotated 的 CSS 旋转兜底
  const immersive = useImmersiveStage(isTouch);
  // 输入法弹起时 dvh 不变，用可视视口高度把舞台缩到键盘之上（旋转舞台不参与，见下）
  const viewport = useVisualViewportSize();
  const autoImmersiveRef = useRef(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  /** 正在查看的角色 netId；null 表示没有打开详情 */
  const [inspectId, setInspectId] = useState<number | null>(null);

  const setStatus = useGameUi((state) => state.setStatus);
  const setStats = useGameUi((state) => state.setStats);
  const setQueue = useGameUi((state) => state.setQueue);
  const setRejected = useGameUi((state) => state.setRejected);
  const pushMessage = useGameUi((state) => state.pushMessage);
  const setHint = useGameUi((state) => state.setHint);
  const setLocalState = useGameUi((state) => state.setLocalState);
  const hint = useGameUi((state) => state.hint);

  /**
   * 打开聊天：先清掉仍按住的移动键（输入框接管键盘后角色不该继续滑行），
   * 再请求聚焦。聚焦走自增序号——面板已展开但失焦时，把 chatOpen 再设 true 不会触发 effect。
   */
  const openChat = useCallback(() => {
    sessionRef.current?.clearMovement();
    useGameUi.getState().requestChat();
  }, []);

  useEffect(() => {
    useGameUi.getState().reset();
    setInspectId(null);
    const stored = loadProfile();
    if (stored) {
      setProfile(stored);
      setChecked(true);
      return;
    }
    // 深链：/play?name=夜班实习生&species=horse 可直接入场，便于演示与分享
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) {
      const species = params.get('species') === 'horse' ? 'horse' : 'cow';
      // 深链同样过钳制与审核：这是唯一一条绕过表单的取名路径
      const profile: Profile = {
        name: resolveProfileName(name),
        appearance: defaultAppearance(species),
        status: '',
      };
      saveProfile(profile);
      setProfile(profile);
    }
    setChecked(true);
  }, []);

  // 已经存过工牌的人不会经过上岗按钮，只有在园区里的第一次按下才能补上全屏。
  // 浏览器要求全屏由用户手势触发，所以这一次按下之后就不再重试：用户主动退出全屏也不会被拉回去。
  useEffect(() => {
    if (autoImmersiveRef.current) return;
    if (!profile || !isTouch || !immersive.supported || immersive.active) return;
    const onFirstPress = (event: PointerEvent) => {
      // 聊天与显式避开全屏的控件不抢手势，留给右上角的按钮
      if (event.target instanceof Element && event.target.closest('input, textarea, [data-no-immersive]')) return;
      autoImmersiveRef.current = true;
      window.removeEventListener('pointerdown', onFirstPress);
      immersive.enter();
    };
    window.addEventListener('pointerdown', onFirstPress);
    return () => window.removeEventListener('pointerdown', onFirstPress);
  }, [profile, isTouch, immersive]);

  useEffect(() => {
    const host = hostRef.current;
    if (!profile || !host || sessionRef.current) return;
    const session = new GameSession({
      onStatus: (status, detail) => setStatus(status, detail),
      onQueue: (queue) => setQueue(queue),
      onRejected: (reason) => setRejected(reason),
      onStats: (stats) => setStats(stats),
      onChat: (entry) => pushMessage(entry),
      onRequestChat: openChat,
      onHint: (next) => setHint(next),
      onLocalState: (state) => setLocalState(state),
    });
    sessionRef.current = session;
    // 上次的落点只作为「入场偏好」交给服务端裁决：座位可能已被占、坐标可能已经不可走
    session.start(host, profile, loadSnapshot() ?? undefined).catch((error: unknown) => {
      console.error('[game] session failed', error);
      setStatus('error', '渲染器初始化失败');
    });
    return () => {
      session.stop();
      sessionRef.current = null;
    };
  }, [profile, setStatus, setStats, pushMessage, openChat, setHint, setLocalState]);

  const getSession = useCallback(() => sessionRef.current, []);
  const handleChat = useCallback((text: string) => sessionRef.current?.sendChat(text), []);
  const handleAction = useCallback((action: ActionKey) => {
    sessionRef.current?.perform(action);
  }, []);
  const handleMove = useCallback((x: number, y: number) => {
    sessionRef.current?.setMoveVector(x, y);
  }, []);

  /**
   * 点选角色：舞台局部坐标交给会话做拾取，命中远端角色就打开工牌，点空白 / 自己则收起。
   * 桌面宿主与手机摇杆轻点共用这一条路径，坐标口径完全一致（offsetX / offsetY）。
   */
  const handlePick = useCallback((stageX: number, stageY: number) => {
    const badge = sessionRef.current?.inspectAt(stageX, stageY) ?? null;
    setInspectId(badge?.id ?? null);
  }, []);

  const handleCloseInspect = useCallback(() => setInspectId(null), []);
  const handleRetry = useCallback(() => {
    useGameUi.getState().setRejected(0);
    useGameUi.getState().setQueue(null);
    sessionRef.current?.retry();
  }, []);

  /**
   * 状态：先过与协议同一把尺子，再「存档 → 通知会话」。
   * 存档要在这里做而不是在 session 里：session 只认识网络与渲染，不碰 localStorage。
   */
  const handleStatusChange = useCallback(
    (raw: string) => {
      if (!profile) return;
      const status = resolveProfileStatus(raw);
      const next: Profile = { ...profile, status };
      setProfile(next);
      saveProfile(next);
      sessionRef.current?.setStatus(status);
    },
    [profile],
  );

  /** 点画布空白处收面板：聊天、状态与他人工牌都回到收起态，焦点交还给移动 */
  const closePanels = useCallback(() => {
    const ui = useGameUi.getState();
    ui.setChatOpen(false);
    ui.setStatusOpen(false);
    setInspectId(null);
  }, []);

  return (
    <div
      className="no-callout relative h-dvh w-full touch-none select-none overflow-hidden bg-ink-950"
      onContextMenu={(event) => event.preventDefault()}
      style={
        rotated
          ? LANDSCAPE_STAGE_STYLE
          : // 只有触屏才跟随可视视口：桌面端浏览器缩放时不该让舞台跟着缩水
            isTouch && viewport.height > 0
            ? { height: viewport.height }
            : undefined
      }
    >
      <div
        ref={hostRef}
        className="absolute inset-0"
        aria-label="游戏视口"
        onPointerDown={(event) => {
          if (event.button === 0) closePanels();
        }}
        onPointerUp={(event) => {
          if (event.button !== 0) return;
          const native = event.nativeEvent;
          // offset 是舞台局部坐标：旋转舞台与 DPR 变化都不需要另做换算
          handlePick(native.offsetX, native.offsetY);
        }}
      />

      {/* 摇杆热区铺满左半屏，必须在 HUD 之下：HUD 的 pointer-events-none 让空白处的按压穿透下来 */}
      {profile && isTouch && (
        <Joystick onMove={handleMove} onEngage={closePanels} onTap={handlePick} rotated={rotated} />
      )}

      {checked && !profile && (
        <JoinGate
          onEnter={(next) => {
            // 必须在这次点击的同一个调用栈里请求全屏，晚一拍浏览器就不认这个手势了
            immersive.enter();
            setProfile(next);
          }}
        />
      )}

      {profile && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 flex flex-col justify-between ${
              isTouch ? (rotated ? 'game-safe-rotated' : 'game-safe') : 'p-4'
            }`}
          >
            {/* 手机端顶栏压成一行：左侧折叠工牌与右侧控件同高，把纵向空间还给画面。
                对齐用 items-start，工牌展开时只向下长，右侧控件不跟着跳。 */}
            <div className="flex items-start justify-between gap-3">
              <div className={`flex min-w-0 flex-col items-start gap-2 ${isTouch ? 'relative' : ''}`}>
                <PlayerCard
                  name={profile.name}
                  species={profile.appearance.species}
                  statusText={profile.status}
                  onStatusChange={handleStatusChange}
                  compact={isTouch}
                />
                {/* 聊天浮层挂在工牌下方（top-full）而不是写死偏移：工牌展开时它会自己让位，
                    且不参与 HUD 的纵向 flex，不会把底部操作区顶出屏幕 */}
                {isTouch && (
                  <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 flex justify-start">
                    <ChatDock onSend={handleChat} onOpen={openChat} compact />
                  </div>
                )}
              </div>
              <div className={`flex shrink-0 ${isTouch ? 'items-center gap-2' : 'flex-col items-end gap-2'}`}>
                <OnlineBadge compact={isTouch} />
                <div className="flex items-center gap-2">
                  <SfxToggle compact={isTouch} />
                  {/* 手机端的收尾出口：自动全屏被系统拒掉之后，这里还能再要一次 */}
                  {isTouch && immersive.supported && (
                    <button
                      type="button"
                      onClick={immersive.toggle}
                      aria-pressed={immersive.active}
                      aria-label={immersive.active ? '退出全屏' : '全屏游戏'}
                      title={immersive.active ? '退出全屏' : '全屏游戏'}
                      data-no-immersive
                      className="pointer-events-auto grid h-9 w-9 place-items-center border-2 border-ink-600 bg-ink-900/92 text-mist-500 backdrop-blur-sm transition-colors hover:border-mint-400/60 hover:text-mint-400 focus-visible:border-mint-400 focus-visible:outline-none"
                    >
                      {immersive.active ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </button>
                  )}
                  <Link
                    href="/"
                    aria-label="打卡下班"
                    data-no-immersive
                    className="pointer-events-auto flex min-h-9 items-center gap-1.5 border-2 border-ink-600 bg-ink-900/92 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500 backdrop-blur-sm transition-colors hover:border-signal-500/60 hover:text-signal-500"
                  >
                    <LogOut className="h-3 w-3" />
                    打卡下班
                  </Link>
                </div>
                {/* 他人工牌：桌面贴在右上角控件列下方，宽度与自身工牌接近 */}
                {!isTouch && (
                  <InspectCard playerId={inspectId} getSession={getSession} onClose={handleCloseInspect} />
                )}
              </div>
            </div>

            {isTouch ? (
              <div className="flex items-end justify-end">
                <TouchActions onAction={handleAction} onChat={openChat} />
              </div>
            ) : (
              <div className="flex items-end justify-between gap-4">
                <ChatDock onSend={handleChat} onOpen={openChat} />
                <div className="hidden flex-1 justify-center md:flex">
                  <ActionBar onAction={handleAction} onChat={openChat} />
                </div>
                <MiniMap getSession={getSession} />
              </div>
            )}
          </div>

          {/* 手机端他人工牌浮在动作盘上方居中：不铺遮罩、不与右上角导览卡抢位置 */}
          {isTouch && (
            <div className="pointer-events-none absolute bottom-[152px] left-1/2 z-30 -translate-x-1/2">
              <InspectCard playerId={inspectId} getSession={getSession} onClose={handleCloseInspect} compact />
            </div>
          )}

          {/* 出生点的引导层：实体地标在画面里，这两块负责「说清楚」与随时可查（ADR-0036） */}
          <NavCard compact={isTouch} />
          <WelcomeBanner compact={isTouch} />

          <QueueGate onRetry={handleRetry} />
          {hint && (
            <div
              role="status"
              className={`pointer-events-none absolute left-1/2 -translate-x-1/2 border-2 border-ink-600 bg-ink-900/92 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-signal-500 backdrop-blur-sm ${isTouch ? 'bottom-40' : 'bottom-24'}`}
            >
              {hint}
            </div>
          )}
          <ConnectionBanner />
        </>
      )}
    </div>
  );
}
