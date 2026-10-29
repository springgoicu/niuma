'use client';

import { create } from 'zustand';
import type { ChatEntry, SessionStats } from './game/session';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'error';

interface GameUiState {
  status: ConnectionStatus;
  detail: string;
  backend: string;
  fps: number;
  ping: number;
  x: number;
  y: number;
  nearby: number;
  messages: ChatEntry[];
  chatOpen: boolean;
  setStatus: (status: ConnectionStatus, detail?: string) => void;
  setStats: (stats: SessionStats) => void;
  pushMessage: (entry: ChatEntry) => void;
  setChatOpen: (open: boolean) => void;
  reset: () => void;
}

const MAX_MESSAGES = 40;

export const useGameUi = create<GameUiState>((set) => ({
  status: 'idle',
  detail: '',
  backend: 'initializing',
  fps: 0,
  ping: 0,
  x: 4096,
  y: 4096,
  nearby: 0,
  messages: [],
  chatOpen: false,

  setStatus: (status, detail = '') => set({ status, detail }),

  setStats: (stats) =>
    set({
      fps: stats.fps,
      ping: stats.ping,
      x: stats.x,
      y: stats.y,
      nearby: stats.nearby,
      backend: stats.backend,
    }),

  pushMessage: (entry) =>
    set((state) => ({
      messages: [...state.messages.slice(-(MAX_MESSAGES - 1)), entry],
    })),

  setChatOpen: (chatOpen) => set({ chatOpen }),

  reset: () =>
    set({
      status: 'idle',
      detail: '',
      fps: 0,
      ping: 0,
      messages: [],
      chatOpen: false,
      nearby: 0,
    }),
}));
