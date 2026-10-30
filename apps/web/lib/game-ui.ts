'use client';

import { create } from 'zustand';
import type { QueueStatusPacket } from '@niuma/shared-types';
import type { ChatEntry, SessionStats } from './game/session';

export type ConnectionStatus = 'idle' | 'connecting' | 'queued' | 'online' | 'offline' | 'error';

interface GameUiState {
  status: ConnectionStatus;
  detail: string;
  backend: string;
  fps: number;
  ping: number;
  x: number;
  y: number;
  nearby: number;
  /** 排队中的位次快照；入场或被拒后清空 */
  queue: QueueStatusPacket | null;
  /** 被拒原因（1 队列满 / 2 等待超时），0 表示未被拒 */
  rejected: number;
  messages: ChatEntry[];
  chatOpen: boolean;
  setStatus: (status: ConnectionStatus, detail?: string) => void;
  setStats: (stats: SessionStats) => void;
  setQueue: (queue: QueueStatusPacket | null) => void;
  setRejected: (reason: number) => void;
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
  queue: null,
  rejected: 0,
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

  setQueue: (queue) => set({ queue }),

  setRejected: (rejected) => set({ rejected }),

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
      queue: null,
      rejected: 0,
    }),
}));
