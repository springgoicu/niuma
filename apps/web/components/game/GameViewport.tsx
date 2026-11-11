'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Maximize, Minimize } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import type { ActionKey } from '@/lib/game/input';
import { GameSession } from '@/lib/game/session';
import { defaultAppearance, loadProfile, resolveProfileName, saveProfile, type Profile } from '@/lib/profile';
import { ActionBar } from './ActionBar';
import { ChatDock } from './ChatDock';
import { ConnectionBanner, OnlineBadge, PlayerCard, SfxToggle } from './Hud';
import { JoinGate } from './JoinGate';
import { MiniMap } from './MiniMap';
import { QueueGate } from './QueueGate';
import { Joystick, TouchActions } from './TouchControls';
import { useImmersiveStage, useIsTouch, useLandscapeStage } from '@/lib/use-touch-stage';

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
  const autoImmersiveRef = useRef(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);

  const setStatus = useGameUi((state) => state.setStatus);
  const setStats = useGameUi((state) => state.setStats);
  const setQueue = useGameUi((state) => state.setQueue);
  const setRejected = useGameUi((state) => state.setRejected);
  const pushMessage = useGameUi((state) => state.pushMessage);
  const setChatOpen = useGameUi((state) => state.setChatOpen);
  const setHint = useGameUi((state) => state.setHint);
  const setLocalState = useGameUi((state) => state.setLocalState);
  const hint = useGameUi((state) => state.hint);

  useEffect(() => {
    useGameUi.getState().reset();
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
      const profile: Profile = { name: resolveProfileName(name), appearance: defaultAppearance(species) };
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
      onRequestChat: () => setChatOpen(true),
      onHint: (next) => setHint(next),
      onLocalState: (state) => setLocalState(state),
    });
    sessionRef.current = session;
    session.start(host, profile).catch((error: unknown) => {
      console.error('[game] session failed', error);
      setStatus('error', '渲染器初始化失败');
    });
    return () => {
      session.stop();
      sessionRef.current = null;
    };
  }, [profile, setStatus, setStats, pushMessage, setChatOpen, setHint, setLocalState]);

  const getSession = useCallback(() => sessionRef.current, []);
  const handleChat = useCallback((text: string) => sessionRef.current?.sendChat(text), []);
  const handleAction = useCallback((action: ActionKey) => {
    sessionRef.current?.perform(action);
  }, []);
  const handleMove = useCallback((x: number, y: number) => {
    sessionRef.current?.setMoveVector(x, y);
  }, []);
  const handleRetry = useCallback(() => {
    useGameUi.getState().setRejected(0);
    useGameUi.getState().setQueue(null);
    sessionRef.current?.retry();
  }, []);

  return (
    <div
      className="no-callout relative h-dvh w-full touch-none select-none overflow-hidden bg-ink-950"
      onContextMenu={(event) => event.preventDefault()}
      style={rotated ? LANDSCAPE_STAGE_STYLE : undefined}
    >
      <div ref={hostRef} className="absolute inset-0" aria-label="游戏视口" />

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
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col items-start gap-2">
                <PlayerCard name={profile.name} species={profile.appearance.species} compact={isTouch} />
                {isTouch && <ChatDock onSend={handleChat} compact />}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
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
                    className="pointer-events-auto flex min-h-9 items-center gap-1.5 border-2 border-ink-600 bg-ink-900/92 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500 backdrop-blur-sm transition-colors hover:border-signal-500/60 hover:text-signal-500"
                  >
                    <LogOut className="h-3 w-3" />
                    打卡下班
                  </Link>
                </div>
              </div>
            </div>

            {isTouch ? (
              <div className="flex items-end justify-between gap-3">
                <Joystick onMove={handleMove} rotated={rotated} />
                <TouchActions onAction={handleAction} onChat={() => setChatOpen(true)} />
              </div>
            ) : (
              <div className="flex items-end justify-between gap-4">
                <ChatDock onSend={handleChat} />
                <div className="hidden flex-1 justify-center md:flex">
                  <ActionBar onAction={handleAction} onChat={() => setChatOpen(true)} />
                </div>
                <MiniMap getSession={getSession} />
              </div>
            )}
          </div>

          <QueueGate onRetry={handleRetry} />
          {hint && (
            <div
              role="status"
              className={`pointer-events-none absolute left-1/2 -translate-x-1/2 border-2 border-ink-600 bg-ink-900/92 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-signal-500 backdrop-blur-sm ${isTouch ? 'bottom-36' : 'bottom-24'}`}
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
