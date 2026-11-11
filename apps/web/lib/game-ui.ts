'use client';

import { POSE, type Pose, type QueueStatusPacket, type SeatKind } from '@niuma/shared-types';
import { create } from 'zustand';
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
  /** 本地角色姿态：动作按钮据此显示激活 / 不可用态 */
  localPose: Pose;
  /** 是否坐在座位锚点上 */
  seated: boolean;
  /** 当前座位种类：床位只能躺，凳子 / 椅子只能坐 */
  seatKind: SeatKind | null;
  /** 环境提示或动作被拦下的瞬时提示；null 表示不显示 */
  hint: string | null;
  setLocalState: (state: { pose: Pose; seated: boolean; seatKind: SeatKind | null }) => void;
  setHint: (hint: string | null) => void;
  setStatus: (status: ConnectionStatus, detail?: string) => void;
  setStats: (stats: SessionStats) => void;
  setQueue: (queue: QueueStatusPacket | null) => void;
  setRejected: (reason: number) => void;
  pushMessage: (entry: ChatEntry) => void;
  setChatOpen: (open: boolean) => void;
  reset: () => void;
}

const MAX_MESSAGES = 40;

const INITIAL = {
  status: 'idle' as ConnectionStatus,
  detail: '',
  backend: 'initializing',
  fps: 0,
  ping: 0,
  x: 4096,
  y: 4096,
  nearby: 0,
  queue: null,
  rejected: 0,
  messages: [] as ChatEntry[],
  chatOpen: false,
  localPose: POSE.Idle as Pose,
  seated: false,
  seatKind: null as SeatKind | null,
  hint: null,
};

export const useGameUi = create<GameUiState>((set) => ({
  ...INITIAL,

  setLocalState: ({ pose, seated, seatKind }) => set({ localPose: pose, seated, seatKind }),

  setHint: (hint) => set({ hint }),

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

  reset: () => set(INITIAL),
}));
