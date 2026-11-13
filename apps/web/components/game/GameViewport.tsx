'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Maximize, Minimize, Shuffle } from 'lucide-react';
import {
  BOARD_METRIC,
  CAREER_REPORT_INTERVAL_MS,
  type BoardMetric,
  type BoardPacket,
  type ChatSendPacket,
  type NavTargetId,
} from '@niuma/shared-types';
import { BadgeCard } from '@/components/BadgeCard';
import { BulletinModal } from '@/components/BulletinModal';
import { RemoteArchiveDialog } from '@/components/badge/RemoteArchiveDialog';
import { reloadForStaleAssets } from '@/lib/build-version';
import { parseSpeciesParam } from '@/lib/creator-seed';
import { useGameUi } from '@/lib/game-ui';
import { loadDanmakuPrefs, saveDanmakuPrefs } from '@/lib/danmaku-prefs';
import { isAtlasVersionMismatch } from '@/lib/game/atlas-errors';
import {
  dayKey,
  getTodayMinutes,
  getTodayToiletMinutes,
  loadAttendance,
  startAttendanceClock,
  useAttendance,
} from '@/lib/game/attendance';
import { DEFAULT_DANMAKU_PREFS, type DanmakuPrefs } from '@/lib/game/danmaku-prefs';
import type { PlayerBadge } from '@/lib/game/badge';
import {
  EMPTY_CAREER_STATS,
  PX_PER_STEP,
  buildCareerSummary,
  loadCareerStats,
  startCareerClock,
  useCareer,
} from '@/lib/game/career';
import { loadGeo, readCachedGeo } from '@/lib/game/geo';
import { createGameClient } from '@/lib/game/client/create-game-client';
import type { GameClient } from '@/lib/game/client/game-client';
import type { ActionKey } from '@/lib/game/input';
import { loadSnapshot, resumeForPark } from '@/lib/game/snapshot';
import type { ParkEntry } from '@/lib/park';
import {
  defaultAppearance,
  loadProfile,
  resolveProfileName,
  resolveProfileStatus,
  saveProfile,
  type Profile,
} from '@/lib/profile';
import { ActionBar } from './ActionBar';
import type { BadgeSavePayload } from './BadgeEditor';
import { ChatDock } from './ChatDock';
import {
  ConnectionBanner,
  HudDivider,
  HudDock,
  HudStatus,
  SfxToggle,
  hudButtonClassName,
} from './Hud';
import { InstallAppButton } from './InstallAppButton';
import { InteractionHint } from './InteractionHint';
import { JoinGate } from './JoinGate';
import { LeaderboardDialog } from './LeaderboardDialog';
import { MiniMap } from './MiniMap';
import { NavCard } from './NavCard';
import { NoticeBoard } from './NoticeBoard';
import { QueueGate } from './QueueGate';
import { WelcomeBanner } from './WelcomeBanner';
import { Joystick, TouchActions } from './TouchControls';
import { useImmersiveStage, useIsPortrait, useIsTouch, useVisualViewportSize } from '@/lib/use-touch-stage';

export interface GameViewportProps {
  /** 服务端下发的园区白名单：只用于名字展示与「切换园区」的去向校验 */
  parks: readonly ParkEntry[];
  parkId: string;
  parkName: string;
  /** 已按白名单解析好的 WebSocket 端点，一次会话内不变 */
  wsUrl: string;
  /** 首选园区不可达时被顶替掉的那座的名称；null 表示正常进入 */
  fallbackFrom: string | null;
  /** 深链参数：/play?name=夜班实习生&species=horse */
  initialName?: string;
  initialSpecies?: string;
}

export function GameViewport({
  parks,
  parkId,
  parkName,
  wsUrl,
  fallbackFrom,
  initialName,
  initialSpecies,
}: GameViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<GameClient | null>(null);
  /** 小地图容器：子组件的 ref 回调先于本组件的 effect 触发，所以先存下来，客户端就绪后再挂载 */
  const minimapElRef = useRef<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  /**
   * 启动用的最新工牌。
   *
   * 状态编辑会改 `profile`，但那是「同一场会话里改一行字」，不该重建 WebSocket
   * 与渲染线程——所以启动 effect 只依赖「有没有工牌」，具体内容从 ref 读最新值。
   */
  const profileRef = useRef<Profile | null>(profile);
  profileRef.current = profile;
  const entering = profile !== null;
  const isTouch = useIsTouch();
  const isPortrait = useIsPortrait();
  // 竖屏只决定触控区与 HUD 的排布；世界倍率由 renderer 按屏幕宽高比自适应
  const portrait = isTouch && isPortrait;
  // 全屏只由右上角按钮手动触发，不自动进入：朝向始终交给设备与用户
  const immersive = useImmersiveStage();
  // 输入法弹起时 dvh 不变，用可视视口高度把舞台缩到键盘之上
  const viewport = useVisualViewportSize();
  const [checked, setChecked] = useState(false);
  /** 正在查看的角色 netId；null 表示没有打开详情 */
  const [inspectId, setInspectId] = useState<number | null>(null);
  /** 点选当帧的工牌：档案弹窗首帧直接有内容，不必等 2Hz 推送 */
  const [inspectSeed, setInspectSeed] = useState<PlayerBadge | null>(null);
  /** 牛马榜面板：靠近公告栏按 F 打开 */
  const [boardOpen, setBoardOpen] = useState(false);
  /** 牛马放假告示板：靠近按 F 或点击牌面展开软木看板（ADR-0059） */
  const [bulletinOpen, setBulletinOpen] = useState(false);
  /** 五个指标的快照：一次请求回五条，页签切换只读本地缓存 */
  const [boards, setBoards] = useState<Partial<Record<BoardMetric, BoardPacket>>>({});
  /** 行为统计门面：距离 / 摸鱼 / 被喷 / 加班都从这里记 */
  const careerClockRef = useRef<ReturnType<typeof startCareerClock> | null>(null);
  /** 考勤门面：今日工时 / 今日如厕的坐离切换都从这里走 */
  const attendanceClockRef = useRef<ReturnType<typeof startAttendanceClock> | null>(null);
  /** 上一次统计坐标：2Hz 采样差分算里程 */
  const lastStatsRef = useRef<{ x: number; y: number } | null>(null);
  /** 上一次入座状态：只在「未坐 → 坐」的边沿记一次摸鱼 */
  const lastSeatedRef = useRef(false);
  /**
   * 入场兜底的告知条：首选园区探活失败、被顶替到另一座时要让玩家知道
   * 自己去的不是原本那座，而不是安静地换一个世界。几秒后自行消失。
   */
  const [notice, setNotice] = useState<string | null>(
    fallbackFrom ? `${fallbackFrom}暂时不可达，已进入${parkName}` : null,
  );
  /** 只有多园区部署时「切换园区」才有意义 */
  const canSwitchPark = parks.length > 1;
  /**
   * 弹幕偏好。
   *
   * 首帧用默认值而不是直接读盘：服务端渲染没有 localStorage，
   * 两端初始 DOM 必须一致；真正的值在挂载后的 effect 里补上。
   */
  const [danmakuPrefs, setDanmakuPrefs] = useState<DanmakuPrefs>({ ...DEFAULT_DANMAKU_PREFS });

  const setStatus = useGameUi((state) => state.setStatus);
  const setStats = useGameUi((state) => state.setStats);
  const setQueue = useGameUi((state) => state.setQueue);
  const setRejected = useGameUi((state) => state.setRejected);
  const pushMessage = useGameUi((state) => state.pushMessage);
  const applyHistory = useGameUi((state) => state.applyHistory);
  const setHint = useGameUi((state) => state.setHint);
  const setLocalState = useGameUi((state) => state.setLocalState);
  const setNavTarget = useGameUi((state) => state.setNavTarget);
  const hint = useGameUi((state) => state.hint);
  const status = useGameUi((state) => state.status);

  /**
   * 打开聊天：先清掉仍按住的移动键（输入框接管键盘后角色不该继续滑行），
   * 再请求聚焦。聚焦走自增序号——面板已展开但失焦时，把 chatOpen 再设 true 不会触发 effect。
   */
  const openChat = useCallback(() => {
    clientRef.current?.clearMovement();
    useGameUi.getState().requestChat();
  }, []);

  /**
   * 打开牛马榜：先收回移动控制权，再让面板接管。
   * 与聊天同一条纪律——按住 W 靠近公告栏按 F 时，角色不该顶着面板继续走。
   */
  const openBoard = useCallback(() => {
    clientRef.current?.clearMovement();
    // 公告栏是模态：把可能开着的工牌档案收起，避免两块面板叠在一起
    setInspectId(null);
    setBulletinOpen(false);
    setBoardOpen(true);
  }, []);

  const closeBoard = useCallback(() => setBoardOpen(false), []);

  /**
   * 展开放假告示板：与牛马榜互斥，先收回移动控制权再让面板接管。
   * 两块牌子相距 272px，正常走位不会同时命中，这里只防手快 / 脚本。
   */
  const openBulletin = useCallback(() => {
    clientRef.current?.clearMovement();
    setInspectId(null);
    setBoardOpen(false);
    setBulletinOpen(true);
  }, []);

  const closeBulletin = useCallback(() => setBulletinOpen(false), []);

  /** 拉全部指标：打开面板、手动刷新与 20 秒自动刷新都走这里 */
  const requestBoard = useCallback(() => {
    clientRef.current?.requestBoard();
  }, []);

  /** 给正在查看的工牌点赞：服务端裁决，面板按推送结果点亮「已点赞」 */
  const handleLike = useCallback((id: number) => {
    clientRef.current?.like(id);
  }, []);

  useEffect(() => {
    useGameUi.getState().reset();
    // reset 会清空 chatOpen：必须排在其后恢复上次的常驻状态（只开面板，不抢焦点）
    useGameUi.getState().restoreChatOpen();
    setInspectId(null);
    setBoardOpen(false);
    setBulletinOpen(false);
    setBoards({});
    const stored = loadProfile();
    if (stored) {
      setProfile(stored);
      setChecked(true);
      return;
    }
    // 深链：/play?name=夜班实习生&species=horse 可直接入场，便于演示与分享。
    // 参数由 Server Component 解析后作为 props 传下来，客户端不再读 window.location
    if (initialName) {
      const profile: Profile = {
        // 深链同样过钳制与审核：这是唯一一条绕过表单的取名路径
        name: resolveProfileName(initialName),
        appearance: defaultAppearance(parseSpeciesParam(initialSpecies) ?? 'cow'),
        status: '',
      };
      saveProfile(profile);
      setProfile(profile);
    }
    setChecked(true);
  }, [initialName, initialSpecies]);

  // 挂载后再读盘：localStorage 在 SSR 不存在，首帧必须与默认值一致才不触发水合告警
  useEffect(() => {
    setDanmakuPrefs(loadDanmakuPrefs());
  }, []);

  // 进入园区即开始本地考勤：1 秒心跳走内存，离开页面 / 卸载时停表并落盘。
  // 只依赖「有没有工牌」：改状态不应该把今日工时清零。
  useEffect(() => {
    if (!entering) return;
    const clock = startAttendanceClock();
    attendanceClockRef.current = clock;
    return () => {
      clock.dispose();
      if (attendanceClockRef.current === clock) attendanceClockRef.current = null;
    };
  }, [entering]);

  // 行为统计与考勤同生命周期：进园开始攒，离开时停表落盘
  useEffect(() => {
    if (!entering) return;
    const clock = startCareerClock();
    careerClockRef.current = clock;
    lastStatsRef.current = null;
    lastSeatedRef.current = false;
    return () => {
      clock.dispose();
      careerClockRef.current = null;
    };
  }, [entering]);

  /**
   * 组装当前考勤摘要。优先读内存里的 Tracker（最多领先落盘 30 秒），
   * 没有 Tracker 时回退到 localStorage；省份取 geo 缓存，未就绪时留空。
   */
  const buildCareerReport = useCallback(() => {
    // 优先读 attendance store 的内存值（每秒推进），没有 store 时回退 localStorage
    const live = useAttendance.getState();
    const attendance = live.firstJoinDate
      ? {
          firstJoinDate: live.firstJoinDate,
          dailyRecords: live.dailyRecords,
          dailyToiletRecords: live.dailyToiletRecords,
        }
      : loadAttendance();
    const stats = careerClockRef.current?.snapshot() ?? loadCareerStats() ?? EMPTY_CAREER_STATS;
    return buildCareerSummary(attendance, stats, readCachedGeo()?.region ?? '');
  }, []);

  /**
   * 榜单里自己那一行的本地兜底值：服务端快照最多落后 20 秒，
   * 刚部署完还可能没收到本次上报。只在展示时读取，不写回快照。
   */
  const selfBoardValue = useCallback((metric: BoardMetric): number => {
    const clockState = useAttendance.getState();
    const now = clockState.now > 0 ? clockState.now : Date.now();
    const day = useCareer.getState().daily[dayKey(now)];
    switch (metric) {
      case BOARD_METRIC.TodayMinutes:
        return getTodayMinutes(clockState, now);
      case BOARD_METRIC.TodayToilet:
        return getTodayToiletMinutes(clockState, now);
      case BOARD_METRIC.TodayKnockdown:
        return day?.knockdownCount ?? 0;
      case BOARD_METRIC.TodayVented:
        return day?.ventedCount ?? 0;
      case BOARD_METRIC.TodaySteps:
        return Math.floor((day?.distancePx ?? 0) / PX_PER_STEP);
    }
  }, []);

  // 兜底告知条只播一次：入场几秒后收起，别在游戏画面上常驻一条运维信息
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const host = hostRef.current;
    const current = profileRef.current;
    if (!entering || !current || !host || clientRef.current) return;
    let cancelled = false;
    let started: GameClient | null = null;
    let reportTimer: number | null = null;
    // 园区在会话构造期绑定：重连沿用同一个端点，不会在断线恢复时漂到另一座园区
    void createGameClient({
      wsUrl,
      parkId,
      // 灰度开关（?zoom/?flat/?light/?season/?render）原样转给渲染线程：Worker 里没有 location
      search: window.location.search,
      // 初值直接读盘：Worker 里拿不到 localStorage，必须在主线程读好再随 init 带过去
      danmakuPrefs: loadDanmakuPrefs(),
      callbacks: {
        onStatus: (status, detail) => setStatus(status, detail),
        onQueue: (queue) => setQueue(queue),
        onRejected: (reason) => setRejected(reason),
        onStats: (stats) => {
          setStats(stats);
          // 2Hz 坐标差分算里程；首帧与超过 256px 的跳变由记录器自己忽略
          const previous = lastStatsRef.current;
          if (previous) {
            const dx = stats.x - previous.x;
            const dy = stats.y - previous.y;
            careerClockRef.current?.recordDistance(Math.hypot(dx, dy));
          }
          lastStatsRef.current = { x: stats.x, y: stats.y };
          careerClockRef.current?.recordOvertime();
        },
        onChat: (entry) => pushMessage(entry),
        onChatHistory: (entries, meta) => applyHistory(entries, meta),
        onHint: (next) => setHint(next),
        onLocalState: (state) => {
          setLocalState(state);
          // 如厕计时跟座位类型走：坐在马桶座上攒今日如厕，起身即结算。
          // setToilet 内部按 active 变化短路，重复上报同一状态不会重复计时。
          attendanceClockRef.current?.setToilet(
            state.seated && state.seatKind === 'toilet',
          );
          // 只在「未坐 → 坐」的边沿记一次摸鱼；床上躺平不算摸鱼
          if (!lastSeatedRef.current && state.seated && state.seatKind !== 'bed') {
            careerClockRef.current?.recordSlack();
          }
          lastSeatedRef.current = state.seated;
        },
        onNav: (nav) => setNavTarget(nav),
        onVentHit: (local) => {
          if (local) careerClockRef.current?.recordVented();
        },
        onVentDealt: () => careerClockRef.current?.recordKnockdown(),
        onBoardOpen: openBoard,
        onBulletinOpen: openBulletin,
        onBoard: (packet) => setBoards((prev) => ({ ...prev, [packet.metric]: packet })),
      },
      // Enter 与点选都发生在主线程：键盘监听不经过渲染线程，命中判定在渲染线程
      onRequestChat: openChat,
      onPick: (id, badge) => {
        setInspectId(id);
        setInspectSeed(badge ?? null);
      },
    })
      .then(async (client) => {
        if (cancelled) {
          client.stop();
          return;
        }
        started = client;
        clientRef.current = client;
        // 小地图可能早于客户端挂载：先补一次移交，之后的挂载走 ref 回调
        if (minimapElRef.current) client.attachMinimap(minimapElRef.current);
        // 上次的落点只作为「入场偏好」交给服务端裁决：座位可能已被占、坐标可能已经不可走。
        // 换过园区时 resumeForPark 会把它丢掉，角色从新园区门口开始
        await client.start(
          host,
          { ...current, career: buildCareerReport() },
          resumeForPark(loadSnapshot(), parkId),
        );
        if (cancelled) return;
        // geo 是异步的：首次进园时 HELLO 可能还没省份，拿到后再补报一次
        void loadGeo().then(() => {
          if (!cancelled) client.updateCareer(buildCareerReport());
        });
        // 今日工时每分钟都在变：20 秒补报一次，服务端转给正在围观的人；
        // 服务端重启后，下一次 HELLO 会用本机缓存的最近一次摘要重建榜单。
        reportTimer = window.setInterval(() => {
          if (cancelled) return;
          client.updateCareer(buildCareerReport());
        }, CAREER_REPORT_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        console.error('[game] session failed', error);
        // 素材版本错配不是渲染器缺陷：换一张匹配的页面比红条正确；
        // 守卫拦下（已经刷过一次）时才退化成玩家可读的提示。
        if (isAtlasVersionMismatch(error)) {
          if (!reloadForStaleAssets()) setStatus('error', '园区刚更新过，请刷新页面');
          return;
        }
        setStatus('error', '渲染器初始化失败');
      });
    return () => {
      cancelled = true;
      if (reportTimer !== null) window.clearInterval(reportTimer);
      started?.stop();
      clientRef.current = null;
    };
  }, [
    entering,
    wsUrl,
    parkId,
    setStatus,
    setStats,
    pushMessage,
    applyHistory,
    openChat,
    openBoard,
    openBulletin,
    setHint,
    setLocalState,
    setNavTarget,
    buildCareerReport,
  ]);

  /** 小地图容器回调：先于 effect 触发，客户端未就绪时由 client.start 之后补挂 */
  const minimapRef = useCallback((host: HTMLDivElement | null) => {
    minimapElRef.current = host;
    if (host) clientRef.current?.attachMinimap(host);
  }, []);

  /** 追看工牌：只在被查看时让渲染线程按 2Hz 推送，收起后不再产生消息 */
  const subscribeBadge = useCallback(
    (id: number | null, onChange: (badge: PlayerBadge | null) => void) => {
      clientRef.current?.subscribeBadge(id, onChange);
    },
    [],
  );

  const handleChat = useCallback((packet: ChatSendPacket) => clientRef.current?.sendChat(packet), []);
  /**
   * 弹幕设置变更：先落盘再下发。
   *
   * 落盘在主线程（Worker 碰不到 localStorage），下发走一条低频消息——
   * 设置也是事件驱动，不进每帧控制块。
   */
  const handleDanmakuPrefsChange = useCallback((next: DanmakuPrefs) => {
    setDanmakuPrefs(next);
    saveDanmakuPrefs(next);
    clientRef.current?.setDanmakuPrefs(next);
  }, []);
  /**
   * 上翻到顶：先点亮加载态，再发请求。加载态由响应里的 `applyHistory` 清掉，
   * ChatDock 另有超时兜底——离线时请求会石沉大海，不能让「正在加载」永远转着。
   */
  const handleLoadHistory = useCallback((cursor: number) => {
    useGameUi.getState().setHistoryLoading(true);
    clientRef.current?.requestHistory(cursor);
    // 离线时请求会石沉大海：超时自己收起加载态，不让「正在加载」永远转着
    window.setTimeout(() => useGameUi.getState().setHistoryLoading(false), 4000);
  }, []);
  const handleAction = useCallback((action: ActionKey) => {
    clientRef.current?.perform(action);
  }, []);
  const handleMove = useCallback((x: number, y: number) => {
    clientRef.current?.setMoveVector(x, y);
  }, []);
  const handleNavigate = useCallback((id: NavTargetId) => {
    clientRef.current?.navigateTo(id);
  }, []);
  const handleCancelNavigation = useCallback(() => {
    clientRef.current?.cancelNavigation();
  }, []);

  /**
   * 点选角色：统一用屏幕坐标减舞台 rect 换算局部坐标。命中判定在渲染线程
   * （角色位置只在那里），结果经 `onPick` 回调回来再决定展开 / 收起工牌。
   */
  const handlePick = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    clientRef.current?.pick(clientX - rect.left, clientY - rect.top);
  }, []);

  /** 打开档案弹窗前先清移动输入：弹窗期间键盘事件被吞，但已按住的键不能留在掩码里 */
  const handleDetailOpen = useCallback(() => {
    clientRef.current?.clearMovement();
  }, []);

  const handleCloseInspect = useCallback(() => {
    setInspectId(null);
    setInspectSeed(null);
  }, []);
  const handleRetry = useCallback(() => {
    useGameUi.getState().setRejected(0);
    useGameUi.getState().setQueue(null);
    clientRef.current?.retry();
  }, []);

  /**
   * 工牌：先过与协议同一把尺子，再「存档 → 通知会话」。
   * 存档要在这里做而不是在 session 里：session 只认识网络与渲染，不碰 localStorage。
   */
  const handleBadgeSave = useCallback(
    ({ name: rawName, status: rawStatus }: BadgeSavePayload) => {
      if (!profile) return;
      const name = resolveProfileName(rawName);
      const status = resolveProfileStatus(rawStatus);
      if (name === profile.name && status === profile.status) return;
      const next: Profile = { ...profile, name, status };
      setProfile(next);
      saveProfile(next);
      // 只广播真的变了的字段：改名不该顺手重发一遍状态，反之亦然
      if (name !== profile.name) clientRef.current?.setName(name);
      if (status !== profile.status) clientRef.current?.setStatus(status);
    },
    [profile],
  );

  /**
   * 点画布空白处 / 摇杆落下：只收状态编辑与他人工牌，把焦点交还给移动。
   * 聊天是常驻面板——用户没主动关就一直开着，只有 Esc 与面板头部按钮能收起。
   */
  const closePanels = useCallback(() => {
    const ui = useGameUi.getState();
    ui.setStatusOpen(false);
    setInspectId(null);
    // 面板常驻后输入框可能还拿着焦点：点画布 / 落摇杆要把焦点还给移动，
    // 但不动 chatOpen——收面板只能由用户按 Esc 或点头部按钮决定。
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, []);

  /**
   * 右上角工具栏的三组按钮。
   *
   * 全部方形等距、只共享外层一圈边框（`HudDock`），不再有文字胶囊：
   * 悬停 / 展开态由 `hudButtonClassName` 统一，语义靠 `aria-label` + `title`。
   */
  const hudToolButtons = (
    <>
      <NoticeBoard compact={isTouch} />
      <InstallAppButton compact={isTouch} />
      <SfxToggle compact={isTouch} />
      {/* 手机端唯一全屏入口：只有这里的手动点击才会收起浏览器界面 */}
      {isTouch && immersive.supported && (
        <button
          type="button"
          onClick={immersive.toggle}
          aria-pressed={immersive.active}
          aria-label={immersive.active ? '退出全屏' : '全屏游戏'}
          title={immersive.active ? '退出全屏' : '全屏游戏'}
          className={hudButtonClassName({ compact: isTouch, active: immersive.active })}
        >
          {immersive.active ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      )}
    </>
  );

  /** 多园区部署才有切换入口；单园区把它整段藏掉，不留一条空分隔线 */
  const hudSwitchButton = canSwitchPark ? (
    <Link
      href="/enter?from=play"
      aria-label="切换园区"
      title={`切换园区（当前在${parkName}）`}
      className={hudButtonClassName({ compact: isTouch })}
    >
      <Shuffle className="h-4 w-4" />
    </Link>
  ) : null;

  const hudLogoutButton = (
    <Link
      href="/"
      aria-label="打卡下班"
      title="打卡下班"
      className={hudButtonClassName({ compact: isTouch, danger: true })}
    >
      <LogOut className="h-4 w-4" />
    </Link>
  );

  return (
    <div
      className="no-callout relative h-dvh w-full touch-none select-none overflow-hidden bg-ink-950"
      onContextMenu={(event) => event.preventDefault()}
      style={
        // 只有触屏才跟随可视视口：桌面端浏览器缩放时不该让舞台跟着缩水
        isTouch && viewport.height > 0 ? { height: viewport.height } : undefined
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
          // 与摇杆轻点共用同一条路径：屏幕坐标 → 舞台 rect 换算
          handlePick(event.clientX, event.clientY);
        }}
      />

      {/* 摇杆热区横屏铺满左半屏、竖屏收进左下 58%，必须在 HUD 之下：
          HUD 的 pointer-events-none 让空白处的按压穿透下来 */}
      {profile && isTouch && (
        <Joystick onMove={handleMove} onEngage={closePanels} onTap={handlePick} portrait={portrait} />
      )}

      {checked && !profile && (
        <JoinGate
          onEnter={(next) => {
            setProfile(next);
          }}
        />
      )}

      {profile && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 flex flex-col justify-between ${
              isTouch ? 'game-safe' : 'p-4'
            }`}
          >
            {/* 顶栏：左侧工牌、右侧系统工具栏。对齐用 items-start，
                工牌展开时只向下长，右侧工具栏不跟着跳。 */}
            <div className="flex items-start justify-between gap-3">
              {/* 竖屏里展开的工牌会碰到右上的导览卡：把工牌抬到导览卡之上，展开时以工牌为准 */}
              <div
                className={`flex min-w-0 flex-col items-start gap-2 ${isTouch ? 'relative' : ''} ${
                  portrait ? 'z-30' : ''
                }`}
              >
                <BadgeCard
                  name={profile.name}
                  species={profile.appearance.species}
                  appearance={profile.appearance}
                  statusText={profile.status}
                  onSave={handleBadgeSave}
                  compact={isTouch}
                  onDetailOpen={handleDetailOpen}
                />
                {/* 聊天浮层挂在工牌下方（top-full）而不是写死偏移：工牌展开时它会自己让位，
                    且不参与 HUD 的纵向 flex，不会把底部操作区顶出屏幕 */}
                {isTouch && (
                  <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 flex justify-start">
                    <ChatDock
                      onSend={handleChat}
                      onOpen={openChat}
                      onLoadHistory={handleLoadHistory}
                      danmakuPrefs={danmakuPrefs}
                      onDanmakuPrefsChange={handleDanmakuPrefsChange}
                      compact
                    />
                  </div>
                )}
              </div>
              {/* 右上角系统工具栏：状态段 + 工具段 + 导航段 + 危险段，只共享一圈外框。
                  横屏是一条横栏；竖屏横向只有 360–390px，收成「状态行 + 两列方钮格」，
                  左侧工牌才保得住 200px 的可读宽度。 */}
              <div className="flex shrink-0 items-start">
                {portrait ? (
                  <div className="pointer-events-auto flex flex-col border-2 border-ink-600 bg-ink-900/92 backdrop-blur-sm">
                    <HudStatus compact />
                    <span aria-hidden className="h-px w-full bg-ink-700" />
                    <div className="grid grid-cols-2 gap-1 p-1">
                      {hudToolButtons}
                      {hudSwitchButton}
                      {hudLogoutButton}
                    </div>
                  </div>
                ) : (
                  <HudDock>
                    <HudStatus compact={isTouch} />
                    <HudDivider />
                    {hudToolButtons}
                    {hudSwitchButton && (
                      <>
                        <HudDivider />
                        {hudSwitchButton}
                      </>
                    )}
                    <HudDivider />
                    {hudLogoutButton}
                  </HudDock>
                )}
              </div>
            </div>

            {isTouch ? (
              <div className="flex items-end justify-end">
                <TouchActions onAction={handleAction} onChat={openChat} portrait={portrait} />
              </div>
            ) : (
              <div className="flex items-end justify-between gap-4">
                <ChatDock
                  onSend={handleChat}
                  onOpen={openChat}
                  onLoadHistory={handleLoadHistory}
                  danmakuPrefs={danmakuPrefs}
                  onDanmakuPrefsChange={handleDanmakuPrefsChange}
                />
                <div className="hidden flex-1 justify-center md:flex">
                  <ActionBar onAction={handleAction} onChat={openChat} />
                </div>
                <MiniMap hostRef={minimapRef} />
              </div>
            )}
          </div>

          {/* 他人工牌：桌面与手机共用同一个完整档案弹窗，避免两套布局的字段漂移 */}
          <RemoteArchiveDialog
            playerId={inspectId}
            seed={inspectSeed}
            subscribeBadge={subscribeBadge}
            onClose={handleCloseInspect}
            onLike={handleLike}
          />

          {/* 牛马榜：靠近中央广场的公告栏按 F 打开（ADR-0054） */}
          {boardOpen && (
            <LeaderboardDialog
              boards={boards}
              status={status}
              selfValue={selfBoardValue}
              onRequest={requestBoard}
              onClose={closeBoard}
            />
          )}

          {/* 牛马放假告示板：靠近广场北缘的木板按 F 或点击牌面展开（ADR-0059） */}
          {bulletinOpen && <BulletinModal onClose={closeBulletin} />}

          {/* 出生点的引导层：实体地标在画面里，这两块负责「说清楚」与随时可查（ADR-0036） */}
          <NavCard
            compact={isTouch}
            portrait={portrait}
            onNavigate={handleNavigate}
            onCancelNavigation={handleCancelNavigation}
          />
          <WelcomeBanner compact={isTouch} portrait={portrait} />

          <QueueGate onRetry={handleRetry} />
          {hint && (
            <InteractionHint
              hint={hint}
              isTouch={isTouch}
              portrait={portrait}
              onAction={handleAction}
            />
          )}
          <ConnectionBanner />
          {/* 兜底告知条排在重连横幅下面：入场瞬间两者可能同时在，不能互相盖住 */}
          {notice && (
            <div role="status" className="pointer-events-none absolute left-1/2 top-32 z-30 -translate-x-1/2">
              <div className="flex items-center gap-3 border-2 border-amber-400/60 bg-ink-900/95 px-4 py-2 backdrop-blur">
                <span className="h-2 w-2 shrink-0 bg-amber-400" aria-hidden />
                <span className="font-mono text-[11px] tracking-[0.18em] text-amber-400">{notice}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
