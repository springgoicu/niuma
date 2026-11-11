'use client';

import { POSE, type NavTargetId, type Pose, type QueueStatusPacket, type SeatKind } from '@niuma/shared-types';
import { create } from 'zustand';
import { loadChatOpen, saveChatOpen } from './chat-prefs';
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
  /**
   * 历史分页状态。
   *
   * `cursor` 是最旧一条聊天消息的 msgId，上翻请求拿它当「before」游标；
   * 0 表示还没拿到过聊天（别拿它去请求，否则服务端会按「最新一页」整表替换）。
   */
  history: { loading: boolean; hasMore: boolean; cursor: number };
  /** 面板收起期间累计的新消息数：标题栏用它替代没有信息量的总条数 */
  unread: number;
  chatOpen: boolean;
  /**
   * 每次「打开 / 重新聚焦聊天」自增。
   *
   * 面板已经展开但输入框失焦时（点过游戏画面），把 chatOpen 再设成 true 不会让
   * React 的 effect 重跑，回车就会没反应；用序号把这次请求变成一次真实变化。
   */
  chatFocusSeq: number;
  /** 工牌卡上的状态编辑面板：与常驻聊天互不打扰，点击画布空白处一并关闭 */
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
  /** 正在自动前往的导览目标；null 表示没有导航 */
  navTarget: { id: NavTargetId; name: string } | null;
  setLocalState: (state: { pose: Pose; seated: boolean; seatKind: SeatKind | null }) => void;
  setHint: (hint: string | null) => void;
  setNavTarget: (nav: { id: NavTargetId; name: string } | null) => void;
  setStatus: (status: ConnectionStatus, detail?: string) => void;
  setStats: (stats: SessionStats) => void;
  setQueue: (queue: QueueStatusPacket | null) => void;
  setRejected: (reason: number) => void;
  pushMessage: (entry: ChatEntry) => void;
  /**
   * 落一页历史：`replace` 是首屏 / 重连快照（整表替换），否则整页前插。
   * 按 msgId 去重、按时间兜底排序、裁剪到 `MAX_MESSAGES`。
   */
  applyHistory: (entries: ChatEntry[], meta: { replace: boolean; hasMore: boolean }) => void;
  setHistoryLoading: (loading: boolean) => void;
  /** 只切展开态并写盘；已展开时再调不会触发聚焦 */
  setChatOpen: (open: boolean) => void;
  /** 打开聊天并请求聚焦输入框：与 setChatOpen(true) 的区别是「已展开也必须重新聚焦」 */
  requestChat: () => void;
  /**
   * 从 localStorage 恢复上次的展开状态。
   * 只恢复面板，不推进聚焦序号——刷新后不该自动弹输入法。
   */
  restoreChatOpen: () => void;
  setStatusOpen: (open: boolean) => void;
  setNoticeOpen: (open: boolean) => void;
  reset: () => void;
}

/**
 * 列表上限。服务端环形缓冲也是 200 条，两者对齐后「往上翻到底」与「列表被裁掉」
 * 是同一件事，不会出现翻了一半突然断档。
 */
const MAX_MESSAGES = 200;

/** 未读徽标的上限：再多也只是个数字，`99+` 足够 */
const MAX_UNREAD = 99;

/** 列表里最旧的一条聊天消息 id；只有系统播报时返回 0（负数 id 不能当游标） */
function oldestChatMsgId(messages: readonly ChatEntry[]): number {
  for (const message of messages) {
    if (message.kind !== 'system' && message.id > 0) return message.id;
  }
  return 0;
}

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
  history: { loading: false, hasMore: false, cursor: 0 },
  unread: 0,
  chatOpen: false,
  chatFocusSeq: 0,
  statusOpen: false,
  noticeOpen: false,
  localPose: POSE.Idle as Pose,
  seated: false,
  seatKind: null as SeatKind | null,
  hint: null,
  navTarget: null as { id: NavTargetId; name: string } | null,
};

export const useGameUi = create<GameUiState>((set) => ({
  ...INITIAL,

  setLocalState: ({ pose, seated, seatKind }) => set({ localPose: pose, seated, seatKind }),

  setHint: (hint) => set({ hint }),

  setNavTarget: (navTarget) => set({ navTarget }),

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
      // 展开着看到的不算「没看」；收起期间才累计，进面板即清
      unread: state.chatOpen ? 0 : Math.min(MAX_UNREAD, state.unread + 1),
    })),

  applyHistory: (entries, meta) =>
    set((state) => {
      if (meta.replace) {
        // 首屏 / 重连快照：服务端就是权威的那几条，整表替换。
        // 未读不动——进园补发十条不该让人一进来就看到「10 条未读」
        const messages = entries.slice(-MAX_MESSAGES);
        return {
          messages,
          unread: state.unread,
          history: { loading: false, hasMore: meta.hasMore, cursor: oldestChatMsgId(messages) },
        };
      }

      // 上翻：只前插本地没有的条目。msgId 是 u16 会回绕，去重键必须带上「是不是聊天」
      const seen = new Set<number>();
      for (const message of state.messages) {
        if (message.kind !== 'system') seen.add(message.id);
      }
      const fresh = entries.filter((entry) => !seen.has(entry.id));
      // 历史时间只有秒级精度，与实时消息混排时按时间统一排序，避免前插顺序偶尔颠倒
      const messages = [...fresh, ...state.messages]
        .sort((a, b) => a.at - b.at)
        .slice(-MAX_MESSAGES);
      return {
        messages,
        history: { loading: false, hasMore: meta.hasMore, cursor: oldestChatMsgId(messages) },
      };
    }),

  setHistoryLoading: (loading) =>
    set((state) => ({ history: { ...state.history, loading } })),

  // 只切展开态并落盘。聊天是常驻面板：桌面端工牌在左上、聊天在左下，不必互相收起；
  // 手机端的空间互斥由 Hud 组件按 compact 显式处理。
  // 聚焦不在这里做——头部按钮 / 回车走 requestChat，恢复 last-opened 走 restoreChatOpen。
  setChatOpen: (chatOpen) =>
    set((state) => {
      if (state.chatOpen === chatOpen) return {};
      saveChatOpen(chatOpen);
      return chatOpen ? { chatOpen, unread: 0 } : { chatOpen };
    }),

  requestChat: () =>
    set((state) => {
      if (!state.chatOpen) saveChatOpen(true);
      return {
        chatOpen: true,
        chatFocusSeq: state.chatFocusSeq + 1,
        unread: 0,
      };
    }),

  restoreChatOpen: () =>
    set(() => (loadChatOpen() ? { chatOpen: true, unread: 0 } : {})),

  // 状态编辑面板仍占左上角：桌面端与左下角的聊天不冲突，只让开右上角的公告栏
  setStatusOpen: (statusOpen) =>
    set(statusOpen ? { statusOpen, noticeOpen: false } : { statusOpen }),

  // 公告栏是右上角的下拉小块，不抢焦点，也不替用户关掉正在用的面板
  setNoticeOpen: (noticeOpen) => set({ noticeOpen }),

  reset: () => set(INITIAL),
}));
