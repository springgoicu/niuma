'use client';

import {
  POSE,
  emptyEconomyProfile,
  type ArenaPoolPacket,
  type DiceStatePacket,
  type DiceResultPacket,
  type DiceBoardPacket,
  type EconomyProfile,
  type NavTargetId,
  type P2PDuelStatePacket,
  type P2PInviteNotifyPacket,
  type P2PInviteResultPacket,
  type P2PMatchPacket,
  type P2PShowdownPacket,
  type Pose,
  type QueueStatusPacket,
  type RingPacket,
  type SeatKind,
  type VillaStatePacket,
  type BossShockPacket,
  type QuestStatePacket,
  type WorldEventPacket,
} from '@niuma/shared-types';
import { create } from 'zustand';
import { loadChatOpen, saveChatOpen } from './chat-prefs';
import { loadActivityFeedOpen, saveActivityFeedOpen } from './activity-prefs';
import type { ActivityItem } from './game/activity-feed';
import type { BoardEntry, PlayerBadge } from './game/badge';
import type { ChatEntry, SessionStats } from './game/session';
import type { RenderMode } from './game/runtime/render-mode';

export type ConnectionStatus = 'idle' | 'connecting' | 'queued' | 'online' | 'offline' | 'error';

interface GameUiState {
  status: ConnectionStatus;
  /** 本地玩家实体 id（0 = 尚未入场），擂台 HUD 用它标识「你」 */
  selfId: number;
  detail: string;
  backend: string;
  /** 渲染宿主：`main` 表示已回退主线程，HUD 据此显示角标与重试入口 */
  renderMode: RenderMode;
  fps: number;
  ping: number;
  x: number;
  y: number;
  /** 本地角色所在园区区域名：工牌「所在地」直接读它 */
  region: string;
  /** 本地玩家收到的工牌点赞数：本人档案显示「收到的赞」（ADR-0057） */
  myLikes: number;
  nearby: number;
  /** 视野内今日工时榜（最多 5 条），本人档案与排行条共用 */
  board: BoardEntry[];
  /** 本地玩家在视野榜里的名次；未上榜为 null */
  rank: number | null;
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
  /** 工牌卡上的编辑面板（名字 + 状态）：与常驻聊天互不打扰，点击画布空白处一并关闭 */
  statusOpen: boolean;
  /** 园区公告栏（微信群二维码）：右上角的下拉小块，点开才展开 */
  noticeOpen: boolean;
  /** 「存到桌面」的下拉小块：与公告栏同一格，两者互斥 */
  installOpen: boolean;
  /** 本地角色姿态：动作按钮据此显示激活 / 不可用态 */
  localPose: Pose;
  /** 是否坐在座位锚点上 */
  seated: boolean;
  /** 当前座位种类：床位只能躺，凳子 / 椅子只能坐 */
  seatKind: SeatKind | null;
  /** 当前座位组（`dice-a` / `arena-bench` …）：入座类面板据此判断资格 */
  seatGroup: string | null;
  /** 环境提示或动作被拦下的瞬时提示；null 表示不显示 */
  hint: string | null;
  /** 正在自动前往的导览目标；null 表示没有导航。`'plaza'` 是客户端的「回中央广场」 */
  navTarget: { id: NavTargetId | 'plaza'; name: string } | null;
  /**
   * 「请把导览卡展开」的请求序号，每次自增。
   *
   * 导览卡的展开态是组件内部状态（触屏端会自行收起），所以外面不能直接写布尔量；
   * 用序号驱动一次真实变化，连点指路牌也能重新展开而不是被 React 判成同值跳过。
   */
  navOpenSeq: number;
  /**
   * 过门区域横幅（纯客户端）：`key` 自增驱动重播，同一区域再次进入也会重新淡入。
   * 会话态、不落盘——换个园区、刷新页面都不该记住「上次弹过哪一条」。
   */
  areaBanner: { key: number; title: string; subtitle: string; color: number } | null;
  /**
   * 擂台快照与收到时刻。
   *
   * 服务端只在阶段变化 / 扣血 / 1Hz 心跳时广播，`receivedAt` 是收到包时的**服务器时刻**
   * （ADR-0081），HUD 用 `serverNow() - receivedAt` 本地递减；所以必须存这两个值，
   * 不能只存 remainingMs。
   */
  ring: { packet: RingPacket; receivedAt: number } | null;
  /** 牛马币钱包（ADR-0082）：服务端权威快照，金币变动时整块替换 */
  wallet: EconomyProfile;
  /** 收到但还没回应的邀请；`expiresAt` 用服务器时刻，倒计时不受本机时钟影响 */
  invite: { packet: P2PInviteNotifyPacket; expiresAt: number } | null;
  /** 自己发起的邀请结果：拒绝 / 超时 / 余额不足等，短暂展示后清除 */
  inviteResult: P2PInviteResultPacket | null;
  /** 当前对局：Started 时开始倒计时，Finished 时展示结算 */
  match: P2PMatchPacket | null;
  /** 最近一次头顶亮牌：猜拳回合推进与结算文案都读它 */
  showdown: { packet: P2PShowdownPacket; receivedAt: number } | null;
  /** 切磋实时血量：HUD 与结算卡共用 */
  duel: { packet: P2PDuelStatePacket; receivedAt: number } | null;
  /** 点人选中的快捷菜单目标；null 表示菜单收起 */
  menuTarget: { id: number; name: string; badge: PlayerBadge | null } | null;
  /** 打赏 / 道具子面板的目标；null 表示没开 */
  actionTarget: { id: number; name: string; mode: 'tip' | 'item' } | null;
  shopOpen: boolean;
  /** 商店当前页签（ADR-0085 / ADR-0087）：属性 / 消耗品 / 装扮三页 */
  shopTab: 'stats' | 'items' | 'cosmetics';
  /** 大喇叭输入面板：买下之后才允许打开 */
  shoutOpen: boolean;
  /** 置顶金色横幅：`key` 自增，组件按它重播入场动画 */
  shoutBanner: { key: number; fromId: number; text: string } | null;
  /** 金币飘字：`key` 自增，组件按它错开动画 */
  coinPops: Array<{ key: number; amount: number; id: number }>;
  // ---- 热区建筑（ADR-0087）----
  /** 赌桌面板：桌号，null 表示收起 */
  diceOpen: number | null;
  /** 赌桌公共局快照：面板与桌心骰子都读它 */
  dice: DiceStatePacket | null;
  /**
   * 最近一局结算单：按桌号存两份（0 / 1），亮牌到达即替换。
   *
   * 保留上一局而不是清空：玩家在亮牌结束后才打开面板，也要能看到刚才谁赢了多少。
   */
  diceResults: Array<DiceResultPacket | null>;
  /** 赌桌排行榜快照：只在打开榜单页签时按需拉取 */
  diceBoard: DiceBoardPacket | null;
  /** 榜单请求在途：面板据此显示「正在算榜」，拒绝回执会把它清掉 */
  diceBoardPending: boolean;
  /** 八角笼观战押注面板 */
  arenaBetOpen: boolean;
  /** 八角笼彩池快照 */
  arenaPool: ArenaPoolPacket | null;
  /** 豪宅卡片：villaId，null 表示收起 */
  villaOpen: number | null;
  /** 两栋小院的牌匾 / 锁状态 */
  villas: VillaStatePacket | null;

  // ---- 打工产出 / 随机事件 / 每日悬赏（ADR-0088）----
  /** 加班搬砖终端小游戏：整层浮窗，世界与连接照跑 */
  workOpen: boolean;
  /** 每日悬赏进度快照：服务端权威，入场补发 + 进度变化各一条 */
  quests: QuestStatePacket | null;
  /** 悬赏面板展开态 */
  questOpen: boolean;
  /** 世界事件横幅：`receivedAt` 用本机单调时钟，按 remainingSec 本地倒数 */
  worldEvent: { packet: WorldEventPacket; receivedAt: number } | null;
  /** 画饼冲击波：预警圈与命中震屏共用，到期由组件清除 */
  bossShock: { packet: BossShockPacket; receivedAt: number } | null;
  /**
   * 全园区播报（ADR-0112）：最近 8 条，播报条与小地图页脚计数共用。
   * `at` 是本机单调时钟，只用于判断「还在不在 6 秒有效期内」。
   */
  activities: Array<ActivityItem & { at: number }>;
  /** 播报条开关（localStorage 记忆）：关掉后小地图标记照旧，两者互不牵连 */
  activityFeedOpen: boolean;
  pushActivity: (event: Omit<ActivityItem, 'key'>) => void;
  setActivityFeedOpen: (open: boolean) => void;
  /** 从 localStorage 恢复开关偏好；只在会话启动时调一次 */
  restoreActivityFeedOpen: () => void;
  setWorkOpen: (open: boolean) => void;
  setQuests: (packet: QuestStatePacket | null) => void;
  setQuestOpen: (open: boolean) => void;
  setWorldEvent: (packet: WorldEventPacket | null) => void;
  setBossShock: (packet: BossShockPacket | null, receivedAt?: number) => void;
  setDiceOpen: (table: number | null) => void;
  setDice: (packet: DiceStatePacket | null) => void;
  setDiceResult: (packet: DiceResultPacket) => void;
  setDiceBoard: (packet: DiceBoardPacket | null) => void;
  setDiceBoardPending: (pending: boolean) => void;
  setArenaBetOpen: (open: boolean) => void;
  setArenaPool: (packet: ArenaPoolPacket | null) => void;
  setVillaOpen: (villa: number | null) => void;
  setVillas: (packet: VillaStatePacket | null) => void;
  setWallet: (wallet: EconomyProfile) => void;
  setInvite: (invite: { packet: P2PInviteNotifyPacket; expiresAt: number } | null) => void;
  setInviteResult: (result: P2PInviteResultPacket | null) => void;
  setMatch: (match: P2PMatchPacket | null) => void;
  setShowdown: (packet: P2PShowdownPacket | null) => void;
  setDuel: (packet: P2PDuelStatePacket | null) => void;
  setMenuTarget: (target: { id: number; name: string; badge: PlayerBadge | null } | null) => void;
  setActionTarget: (target: { id: number; name: string; mode: 'tip' | 'item' } | null) => void;
  /** `tab` 缺省时保留当前页签：老调用点只有一个布尔量，不该被新参数打断 */
  setShopOpen: (open: boolean, tab?: 'stats' | 'items' | 'cosmetics') => void;
  setShoutOpen: (open: boolean) => void;
  pushShoutBanner: (fromId: number, text: string) => void;
  clearShoutBanner: (key: number) => void;
  pushCoinPop: (amount: number, id: number) => void;
  clearCoinPop: (key: number) => void;
  setLocalState: (state: {
    pose: Pose;
    seated: boolean;
    seatKind: SeatKind | null;
    seatGroup: string | null;
  }) => void;
  setRing: (packet: RingPacket | null, receivedAt: number) => void;
  setHint: (hint: string | null) => void;
  setNavTarget: (nav: { id: NavTargetId | 'plaza'; name: string } | null) => void;
  /** 请求展开导览卡：只自增序号，真正的开合仍由 NavCard 决定 */
  requestNavCardOpen: () => void;
  /** 弹一条过门横幅；同一片区域连进两次也重播，`key` 是重播开关 */
  pushAreaBanner: (banner: { title: string; subtitle: string; color: number }) => void;
  /** 关闭横幅；`key` 不匹配时不动（避免旧定时器关掉新横幅） */
  clearAreaBanner: (key: number) => void;
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
  setInstallOpen: (open: boolean) => void;
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
  selfId: 0,
  detail: '',
  backend: 'initializing',
  // 首帧统计到达前按「渲染线程」显示：宁可晚一拍提示，也不要在正常的 Worker 会话上闪一下角标
  renderMode: 'worker' as RenderMode,
  fps: 0,
  ping: 0,
  x: 4096,
  y: 4096,
  region: '',
  myLikes: 0,
  nearby: 0,
  board: [] as BoardEntry[],
  rank: null as number | null,
  queue: null,
  rejected: 0,
  messages: [] as ChatEntry[],
  history: { loading: false, hasMore: false, cursor: 0 },
  unread: 0,
  chatOpen: false,
  chatFocusSeq: 0,
  statusOpen: false,
  noticeOpen: false,
  installOpen: false,
  localPose: POSE.Idle as Pose,
  seated: false,
  seatKind: null as SeatKind | null,
  seatGroup: null as string | null,
  hint: null,
  navTarget: null as { id: NavTargetId | 'plaza'; name: string } | null,
  navOpenSeq: 0,
  areaBanner: null as { key: number; title: string; subtitle: string; color: number } | null,
  ring: null as { packet: RingPacket; receivedAt: number } | null,
  wallet: emptyEconomyProfile(),
  invite: null as { packet: P2PInviteNotifyPacket; expiresAt: number } | null,
  inviteResult: null as P2PInviteResultPacket | null,
  match: null as P2PMatchPacket | null,
  showdown: null as { packet: P2PShowdownPacket; receivedAt: number } | null,
  duel: null as { packet: P2PDuelStatePacket; receivedAt: number } | null,
  menuTarget: null as { id: number; name: string; badge: PlayerBadge | null } | null,
  actionTarget: null as { id: number; name: string; mode: 'tip' | 'item' } | null,
  shopOpen: false,
  shopTab: 'items' as 'stats' | 'items' | 'cosmetics',
  shoutOpen: false,
  shoutBanner: null as { key: number; fromId: number; text: string } | null,
  coinPops: [] as Array<{ key: number; amount: number; id: number }>,
  diceOpen: null as number | null,
  dice: null as DiceStatePacket | null,
  diceResults: [null, null] as Array<DiceResultPacket | null>,
  diceBoard: null as DiceBoardPacket | null,
  diceBoardPending: false,
  arenaBetOpen: false,
  arenaPool: null as ArenaPoolPacket | null,
  villaOpen: null as number | null,
  villas: null as VillaStatePacket | null,
  workOpen: false,
  quests: null as QuestStatePacket | null,
  questOpen: false,
  worldEvent: null as { packet: WorldEventPacket; receivedAt: number } | null,
  bossShock: null as { packet: BossShockPacket; receivedAt: number } | null,
  activities: [] as Array<ActivityItem & { at: number }>,
  activityFeedOpen: true,
};
let coinPopSeq = 0;
let activitySeq = 0;
/** 播报只留最近 8 条：够播报条排队，也够页脚计数，不让数组无限长 */
const MAX_ACTIVITIES = 8;
let shoutSeq = 0;
let areaSeq = 0;
const MAX_COIN_POPS = 5;

export const useGameUi = create<GameUiState>((set) => ({
  ...INITIAL,

  setLocalState: ({ pose, seated, seatKind, seatGroup }) =>
    set({ localPose: pose, seated, seatKind, seatGroup }),

  setRing: (packet, receivedAt) => set({ ring: packet ? { packet, receivedAt } : null }),

  setWallet: (wallet) => set({ wallet }),

  setInvite: (invite) => set({ invite }),

  setInviteResult: (inviteResult) =>
    set(inviteResult ? { inviteResult, invite: null } : { inviteResult: null }),

  setMatch: (match) => set({ match }),

  setShowdown: (packet) =>
    set(packet ? { showdown: { packet, receivedAt: performance.now() } } : { showdown: null }),

  setDuel: (packet) =>
    set(packet ? { duel: { packet, receivedAt: performance.now() } } : { duel: null }),

  setMenuTarget: (menuTarget) => set({ menuTarget }),

  setActionTarget: (actionTarget) => set({ actionTarget }),

  setShopOpen: (shopOpen, tab) =>
    set((state) => ({ shopOpen, shopTab: tab ?? state.shopTab })),

  setShoutOpen: (shoutOpen) => set({ shoutOpen }),

  // 横幅用 key 驱动重播：同一个人连发两条也要重新滑入，而不是停在原地换字
  pushShoutBanner: (fromId, text) =>
    set({ shoutBanner: { key: ++shoutSeq, fromId, text } }),

  clearShoutBanner: (key) =>
    set((state) => (state.shoutBanner?.key === key ? { shoutBanner: null } : {})),

  pushCoinPop: (amount, id) =>
    set((state) => ({
      coinPops: [...state.coinPops.slice(-(MAX_COIN_POPS - 1)), { key: ++coinPopSeq, amount, id }],
    })),

  clearCoinPop: (key) =>
    set((state) => ({ coinPops: state.coinPops.filter((pop) => pop.key !== key) })),

  // ---- 热区建筑（ADR-0087）----
  setDiceOpen: (diceOpen) => set({ diceOpen }),
  setDice: (dice) => set({ dice }),
  setDiceResult: (packet) =>
    set((state) => {
      const index = packet.table === 1 ? 1 : 0;
      const previous = state.diceResults[index];
      // 同一局会被补发一次（进场 / 重连）：直接丢弃，避免面板闪一下重播
      if (previous && previous.roundId === packet.roundId && previous.entries.length === packet.entries.length) {
        return state;
      }
      const next = [...state.diceResults];
      next[index] = packet;
      return { diceResults: next };
    }),
  setDiceBoard: (diceBoard) => set({ diceBoard, diceBoardPending: false }),
  setDiceBoardPending: (diceBoardPending) => set({ diceBoardPending }),
  setArenaBetOpen: (arenaBetOpen) => set({ arenaBetOpen }),
  setArenaPool: (arenaPool) => set({ arenaPool }),
  setVillaOpen: (villaOpen) => set({ villaOpen }),
  setVillas: (villas) => set({ villas }),

  // ---- 打工产出 / 随机事件 / 每日悬赏（ADR-0088）----
  setWorkOpen: (workOpen) => set({ workOpen }),
  setQuests: (quests) => set({ quests }),
  setQuestOpen: (questOpen) => set({ questOpen }),
  // 横幅与冲击波都记下收到时刻：倒计时与动画按本地单调时钟推进，不受本机日历影响
  setWorldEvent: (packet) =>
    set({ worldEvent: packet ? { packet, receivedAt: performance.now() } : null }),
  setBossShock: (packet, receivedAt) =>
    set({ bossShock: packet ? { packet, receivedAt: receivedAt ?? performance.now() } : null }),

  // ---- 全园区播报（ADR-0112）----
  pushActivity: (event) =>
    set((state) => ({
      activities: [...state.activities, { ...event, key: ++activitySeq, at: performance.now() }].slice(
        -MAX_ACTIVITIES,
      ),
    })),
  setActivityFeedOpen: (open) => {
    saveActivityFeedOpen(open);
    set({ activityFeedOpen: open });
  },
  restoreActivityFeedOpen: () => set({ activityFeedOpen: loadActivityFeedOpen() }),

  setHint: (hint) => set({ hint }),

  setNavTarget: (navTarget) => set({ navTarget }),

  requestNavCardOpen: () => set((state) => ({ navOpenSeq: state.navOpenSeq + 1 })),

  pushAreaBanner: (banner) => set({ areaBanner: { key: ++areaSeq, ...banner } }),

  clearAreaBanner: (key) =>
    set((state) => (state.areaBanner?.key === key ? { areaBanner: null } : {})),

  setStatus: (status, detail = '') => set({ status, detail }),

  setStats: (stats) =>
    set({
      selfId: stats.selfId,
      fps: stats.fps,
      ping: stats.ping,
      x: stats.x,
      y: stats.y,
      region: stats.region,
      myLikes: stats.likes,
      nearby: stats.nearby,
      board: stats.board,
      rank: stats.rank,
      backend: stats.backend,
      renderMode: stats.renderMode,
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
      // 一整页都是本地已有的条目（重连抖动，或被 200 条上限裁掉）：列表内容没变。
      // 换一个新数组只会让 ChatLog 多跑一次滚动判定，还会把「上翻返回空页」
      // 误当成新消息拉回底部；游标也保持原位，别在拿不到新内容时继续前移。
      if (fresh.length === 0) {
        return {
          history: { loading: false, hasMore: meta.hasMore, cursor: state.history.cursor },
        };
      }
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

  // 工牌编辑面板仍占左上角：桌面端与左下角的聊天不冲突，只让开右上角的下拉块
  setStatusOpen: (statusOpen) =>
    set(statusOpen ? { statusOpen, noticeOpen: false, installOpen: false } : { statusOpen }),

  // 公告栏与「存到桌面」共用右上角同一格：同一时刻只能开一个，否则两块 2px 边框
  // 会直接叠在一起。两者都不抢焦点，也不替用户关掉正在用的其它面板。
  setNoticeOpen: (noticeOpen) =>
    set(noticeOpen ? { noticeOpen, installOpen: false } : { noticeOpen }),

  setInstallOpen: (installOpen) =>
    set(installOpen ? { installOpen, noticeOpen: false } : { installOpen }),

  // 钱包不清零：换园区 / 重连都沿用同一份资产，reset 只清会话态
  reset: () => set((state) => ({ ...INITIAL, wallet: state.wallet, coinPops: [] })),
}));
