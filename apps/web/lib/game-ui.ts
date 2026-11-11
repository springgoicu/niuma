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
  /** 本地角色所在园区区域名：工牌「所在地」直接读它 */
  region: string;
  /** 本地会话已在线秒数：断线时工牌显示 --:-- */
  onlineSec: number;
  nearby: number;
  /** 排队中的位次快照；入场或被拒后清空 */
  queue: QueueStatusPacket | null;
  /** 被拒原因（1 队列满 / 2 等待超时），0 表示未被拒 */
  rejected: number;
  messages: ChatEntry[];
  chatOpen: boolean;
  /**
   * 每次「打开 / 重新聚焦聊天」自增。
   *
   * 面板已经展开但输入框失焦时（点过游戏画面），把 chatOpen 再设成 true 不会让
   * React 的 effect 重跑，回车就会没反应；用序号把这次请求变成一次真实变化。
   */
  chatFocusSeq: number;
  /** 工牌卡上的状态编辑面板：与聊天面板互斥收起，点击画布空白处一并关闭 */
  statusOpen: boolean;
  /** 园区公告栏（微信群二维码）：右上角的下拉小块，点开才展开 */
  noticeOpen: boolean;
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
  /** 打开聊天并请求聚焦输入框：与 setChatOpen(true) 的区别是「已展开也必须重新聚焦」 */
  requestChat: () => void;
  setStatusOpen: (open: boolean) => void;
  setNoticeOpen: (open: boolean) => void;
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
  region: '',
  onlineSec: 0,
  nearby: 0,
  queue: null,
  rejected: 0,
  messages: [] as ChatEntry[],
  chatOpen: false,
  chatFocusSeq: 0,
  statusOpen: false,
  noticeOpen: false,
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
      region: stats.region,
      onlineSec: stats.onlineSec,
      nearby: stats.nearby,
      backend: stats.backend,
    }),

  setQueue: (queue) => set({ queue }),

  setRejected: (rejected) => set({ rejected }),

  pushMessage: (entry) =>
    set((state) => ({
      messages: [...state.messages.slice(-(MAX_MESSAGES - 1)), entry],
    })),

  // 两块面板都贴在左上角：任一方展开就把另一方收起，避免叠成一列。
  // 展开时顺手推进聚焦序号，头部按钮与回车共用同一条聚焦路径
  setChatOpen: (chatOpen) =>
    set((state) =>
      chatOpen
        ? { chatOpen, statusOpen: false, noticeOpen: false, chatFocusSeq: state.chatFocusSeq + 1 }
        : { chatOpen },
    ),

  requestChat: () =>
    set((state) => ({
      chatOpen: true,
      statusOpen: false,
      noticeOpen: false,
      chatFocusSeq: state.chatFocusSeq + 1,
    })),

  setStatusOpen: (statusOpen) =>
    set(statusOpen ? { statusOpen, chatOpen: false, noticeOpen: false } : { statusOpen }),

  // 公告栏是右上角的下拉小块，不抢焦点，也不替用户关掉正在用的面板
  setNoticeOpen: (noticeOpen) => set({ noticeOpen }),

  reset: () => set(INITIAL),
}));
