'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useGameUi } from '@/lib/game-ui';
import { GameSession } from '@/lib/game/session';
import { defaultAppearance, loadProfile, saveProfile, type Profile } from '@/lib/profile';
import { ActionBar } from './ActionBar';
import { ChatDock } from './ChatDock';
import { ConnectionBanner, OnlineBadge, PlayerCard } from './Hud';
import { JoinGate } from './JoinGate';
import { MiniMap } from './MiniMap';

export function GameViewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);

  const setStatus = useGameUi((state) => state.setStatus);
  const setStats = useGameUi((state) => state.setStats);
  const pushMessage = useGameUi((state) => state.pushMessage);
  const setChatOpen = useGameUi((state) => state.setChatOpen);

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
      const profile: Profile = { name: name.slice(0, 16) || '无名牛马', appearance: defaultAppearance(species) };
      saveProfile(profile);
      setProfile(profile);
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!profile || !host || sessionRef.current) return;
    const session = new GameSession({
      onStatus: (status, detail) => setStatus(status, detail),
      onStats: (stats) => setStats(stats),
      onChat: (entry) => pushMessage(entry),
      onRequestChat: () => setChatOpen(true),
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
  }, [profile, setStatus, setStats, pushMessage, setChatOpen]);

  const getSession = useCallback(() => sessionRef.current, []);
  const handleChat = useCallback((text: string) => sessionRef.current?.sendChat(text), []);
  const handleAction = useCallback((action: 'sit' | 'lie' | 'emote') => {
    sessionRef.current?.perform(action);
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink-950">
      <div ref={hostRef} className="absolute inset-0" aria-label="游戏视口" />

      {checked && !profile && <JoinGate onEnter={setProfile} />}

      {profile && (
        <>
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
            <div className="flex items-start justify-between gap-3">
              <PlayerCard name={profile.name} species={profile.appearance.species} />
              <div className="flex flex-col items-end gap-2">
                <OnlineBadge />
                <Link
                  href="/"
                  className="pointer-events-auto flex items-center gap-1.5 border-2 border-ink-600 bg-ink-900/92 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-mist-500 backdrop-blur-sm transition-colors hover:border-signal-500/60 hover:text-signal-500"
                >
                  <LogOut className="h-3 w-3" />
                  打卡下班
                </Link>
              </div>
            </div>

            <div className="flex items-end justify-between gap-4">
              <ChatDock onSend={handleChat} />
              <div className="hidden flex-1 justify-center md:flex">
                <ActionBar onAction={handleAction} onChat={() => setChatOpen(true)} />
              </div>
              <MiniMap getSession={getSession} />
            </div>
          </div>

          <ConnectionBanner />
        </>
      )}
    </div>
  );
}
