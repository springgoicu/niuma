'use client';

import {
  BOARD_METRIC_ALL,
  OpCode,
  decodeAmbulance,
  decodeAppearanceBroadcast,
  decodeBoard,
  decodeBoss,
  decodeBossShock,
  decodeCareerBroadcast,
  decodeChatBroadcast,
  decodeChatHistory,
  decodeChatRejected,
  decodeDespawn,
  decodeJail,
  decodeLike,
  decodeNameBroadcast,
  decodePatientStatus,
  decodePong,
  decodePongClock,
  decodeQueueRejected,
  decodeQueueStatus,
  decodeRing,
  decodeSeatState,
  decodeSpawn,
  decodeItemEffect,
  decodeItemReject,
  decodeLoudspeaker,
  decodePlayerEffect,
  decodeShoutReject,
  decodeP2PDuelState,
  decodeP2PInviteNotify,
  decodeP2PInviteResult,
  decodeP2PMatch,
  decodeP2PShowdown,
  decodeStatusBroadcast,
  decodeSystemNotice,
  decodeTipBroadcast,
  decodeVent,
  decodeWalletSync,
  decodeWelcome,
  decodeDiceState,
  decodeVillaState,
  decodeQuestState,
  decodeWorkResult,
  decodeWorldEvent,
  decodeEventClaimResult,
  decodeArenaPool,
  decodeRoomState,
  decodeRoomInvite,
  encodeDiceBet,
  encodeWorkClaim,
  encodeQuestClaim,
  encodeEventClaim,
  encodeVillaRequest,
  encodeArenaBet,
  encodeApartmentRequest,
  encodeApartmentInvite,
  encodeRoomLayout,
  encodeBoardRequest,
  encodeCareerReport,
  encodeChatHistoryRequest,
  encodeChatSend,
  encodeHello,
  encodeLikeRequest,
  encodeMoveInto,
  encodeP2PAction,
  encodeP2PInvite,
  encodeP2PRespond,
  encodePing,
  encodeRingEnter,
  encodeRingLeave,
  encodeSetAppearance,
  encodeShopBuy,
  encodeShout,
  encodeTipRequest,
  encodeUseItem,
  encodeSetName,
  encodeSetStatus,
  SYNC_FORMAT_COMPACT,
  SYNC_FORMAT_LEGACY,
  ByteWriter,
  type AmbulancePacket,
  type BoardMetric,
  type BoardPacket,
  type BossPacket,
  type CareerSummary,
  type CharacterAppearance,
  type ChatHistoryPacket,
  type ChatPacket,
  type ChatSendPacket,
  type EconomyProfile,
  type ItemEffectPacket,
  type ItemRejectPacket,
  type JailPacket,
  type LikePacket,
  type LoudspeakerPacket,
  type MovePacket,
  type PlayerEffectPacket,
  type P2PActionRequest,
  type P2PDuelStatePacket,
  type P2PInviteNotifyPacket,
  type P2PInviteResultPacket,
  type P2PMatchPacket,
  type P2PInviteRequest,
  type P2PRespondRequest,
  type P2PShowdownPacket,
  type PatientStatusPacket,
  type ShopBuyRequest,
  type TipPacket,
  type TipRequest,
  type UseItemRequest,
  type WalletSyncPacket,
  type QueueStatusPacket,
  type ResumeState,
  type RingPacket,
  type SeatStateEntry,
  type ShoutRejectPacket,
  type SpawnPacket,
  type SyncFormat,
  type SystemNoticePacket,
  type VentEventPacket,
  type WelcomePacket,
  type DiceStatePacket,
  type VillaStatePacket,
  type ArenaPoolPacket,
  type RoomStatePacket,
  type RoomInvitePacket,
  type FurniturePlacement,
  type BossShockPacket,
  type EventClaimResult,
  type QuestStatePacket,
  type WorkResultPacket,
  type WorldEventPacket,
} from '@niuma/shared-types';
import { ensureDeviceId } from '../game/device-id';

export interface NetHandlers {
  onOpen(): void;
  onClose(): void;
  onWelcome(packet: WelcomePacket): void;
  /** 服务端准入后的排队位次快照，每秒一条 */
  onQueue(status: QueueStatusPacket): void;
  /** 被拒绝（队列满 / 等待超时）后不再自动重连，必须显式 retry */
  onRejected(reason: number): void;
  onSpawn(packet: SpawnPacket): void;
  onDespawn(id: number, reason: number): void;
  /**
   * 同步包的原始字节。交给会话自己用 `readSync` 逐条消费：
   * 中转一层数组会在 200 人同屏时每秒造出 4000 个短命对象。
   *
   * `format` 是服务端在 WELCOME 里定下的条目格式，必须透传：
   * 按包长去猜会在截断包上把尾部字节读成坐标。
   */
  onSync(data: Uint8Array, format: SyncFormat): void;
  onChat(packet: ChatPacket): void;
  /** 历史聊天页（首屏补发或上翻），`flags` 见 CHAT_HISTORY_FLAG */
  onChatHistory(packet: ChatHistoryPacket): void;
  /** 系统提示（进园 / 离园等）：文案已由服务端套好模板，客户端只按 kind 选样式 */
  onSystemNotice(packet: SystemNoticePacket): void;
  /** 服务端拦下了一条发言（政治敏感 / 限速），只带原因，不回传原文 */
  onChatRejected(reason: number): void;
  onAppearance(id: number, appearance: CharacterAppearance): void;
  /** 某个实体的常驻状态变了（自己也会收到一条，用于对齐服务端裁决后的文本） */
  onStatus(id: number, status: string): void;
  /** 某个实体改了工牌名（自己也会收到一条，用于对齐打码后的名字） */
  onName(id: number, name: string): void;
  /** 某个实体的考勤摘要变了（补报后服务端定向广播） */
  onCareer(id: number, career: CareerSummary): void;
  /** 工牌点赞变化：目标、当前计数与「是不是你点的」flag（ADR-0057） */
  onLike(packet: LikePacket): void;
  /** 牛马榜快照：一次请求最多回五条，按 metric 归并 */
  onBoard(packet: BoardPacket): void;
  /**
   * 发泄结算：谁打了谁、打到哪儿。`targetId = 0` 表示空放。
   * 受害者的新坐标与躺姿走 Tick，这条包只负责「归因」与硬直的起点。
   */
  onVent(packet: VentEventPacket): void;
  /** 老板血量：入场快照、每次发泄结算与跨日重置都走这一条（ADR-0070） */
  onBoss(packet: BossPacket): void;
  /** 小黑屋处置：警告 / 保安出动 / 押送 / 入狱 / 释放（ADR-0072） */
  onJail(packet: JailPacket): void;
  /** 救护车四态 / 警灯 / 量化坐标（ADR-0084），停靠静止时不重复下发 */
  onAmbulance?(packet: AmbulancePacket): void;
  /** 伤员昏迷 / 治疗 / 工伤保护状态变化，客户端按 seconds 本地倒计时 */
  onPatient?(packet: PatientStatusPacket): void;
  /** 擂台快照：阶段变化 / 扣血 / 1Hz 心跳都会广播；会话层用服务器时刻记锚点，本地递减倒计时 */
  onRing(packet: RingPacket): void;
  /** 赌桌公共局快照（ADR-0087）：两张桌一包，亮牌期 1Hz 心跳 */
  onDiceState?(packet: DiceStatePacket): void;
  /** 豪宅牌匾 / 锁状态，1Hz 心跳对齐可收币数 */
  onVillaState?(packet: VillaStatePacket): void;
  /** 八角笼彩池快照：押注、开赛与结算各一条 */
  onArenaPool?(packet: ArenaPoolPacket): void;
  /** 房间状态：门牌、房主与家具布局，只发给同频道的人 */
  onRoomState?(packet: RoomStatePacket): void;
  /** 串门邀请通知 */
  onRoomInvite?(packet: RoomInvitePacket): void;
  /** 座位占用变化（入场时为全量快照，之后为增量） */
  onSeatState(entries: SeatStateEntry[]): void;
  onPing(rtt: number): void;
  /**
   * 服务器时钟样本（ADR-0081）：心跳尾段带来的秒级 epoch + 园区时区偏移。
   * 旧服务端的 pong 没有这一段，不会触发。
   */
  onClock?(sample: { serverSec: number; rttMs: number; tzOffsetMin: number }): void;
  /** 钱包快照：进园纠正 + 每次发币/扣币/升级/背包变动（ADR-0082） */
  onWallet?(packet: WalletSyncPacket): void;
  /** 收到别人的对战邀请（15 秒 TTL，前端负责倒计时） */
  onInvite?(packet: P2PInviteNotifyPacket): void;
  /** 自己发起的邀请有了结果：接受 / 拒绝 / 超时 */
  onInviteResult?(packet: P2PInviteResultPacket): void;
  /** 对局开始与结算：玩法的胜负完全由服务端裁决 */
  onMatch?(packet: P2PMatchPacket): void;
  /** 头顶亮牌：骰子 / 猜拳 / 切磋结算，附近 AOI 都会收到 */
  onShowdown?(packet: P2PShowdownPacket): void;
  /** 切磋实时血量与倒计时 */
  onDuelState?(packet: P2PDuelStatePacket): void;
  /** 打赏到账 / 出手的飘字载体，余额走 onWallet */
  onTip?(packet: TipPacket): void;
  /** 道具效果：目标与旁观者都收到同一条，只是 isTarget 不同 */
  onItemEffect?(packet: ItemEffectPacket): void;
  /**
   * 玩家特效（ADR-0085）：脚底风 / 护盾环 / 摸鱼贴纸 / 滑倒 / 保安盯梢。
   *
   * 取代 `onItemEffect`：后者只有「谁对谁用了什么」，表达不了时长与「被挡下」。
   */
  onPlayerEffect?(packet: PlayerEffectPacket): void;
  /** 全服大喇叭：所有在线真人都会收到 */
  onLoudspeaker?(packet: LoudspeakerPacket): void;
  /** 大喇叭被拒（不扣道具） */
  onShoutReject?(packet: ShoutRejectPacket): void;
  /** 道具没生效：只回给操作者本人 */
  onItemReject?(packet: ItemRejectPacket): void;
  /** 搬砖结果（ADR-0088）：服务端算的金额与倍率，客户端只用它做飘字 */
  onWorkResult?(packet: WorkResultPacket): void;
  /** 每日悬赏进度快照：入场补发 + 每次进度变化 / 领取 */
  onQuestState?(packet: QuestStatePacket): void;
  /** 世界事件横幅：阶段切换时一条，客户端本地倒数 */
  onWorldEvent?(packet: WorldEventPacket): void;
  /** 红包被抢走：本人 mine=true，旁观者 mine=false */
  onEventClaim?(packet: EventClaimResult): void;
  /** 画饼冲击波：预警 2 秒 / 结算时各一条 */
  onBossShock?(packet: BossShockPacket): void;
}

function defaultUrl(): string {
  const configured = process.env.NEXT_PUBLIC_GAME_WS_URL;
  if (configured) return configured;
  if (typeof window === 'undefined') return 'ws://127.0.0.1:3001/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // 本地 `next dev`（3000）没有反代，直连游戏服；线上访问的是 80/443，
  // 端口为空时走同源 /ws，由 nginx 升级到游戏服，避免浏览器直连 3001 失败
  const port = window.location.port === '3000' ? ':3001' : '';
  return `${protocol}://${window.location.hostname}${port}/ws`;
}

const MAX_RETRY_DELAY = 8000;
/**
 * Ping 间隔。自适应缓冲要 p95，2s 一次攒满 24 个样本要 48s；
 * 1s 一次只多 1 个极小的上行包，却能让好网/坏网的判定在 20s 内收敛。
 */
const PING_INTERVAL_MS = 1000;

export class NetClient {
  private socket: WebSocket | null = null;
  private name = '';
  private appearance: CharacterAppearance | null = null;
  /** 常驻状态：重连时随 HELLO 一起带上，否则断线回来状态会凭空消失 */
  private status = '';
  /** 考勤摘要：重连同样带上，避免回来后他人工牌显示「未上报」 */
  private career: CareerSummary | undefined;
  /** 上一次会话的落点：每次（重）连都随 HELLO 上报，由服务端重新校验 */
  private resume: ResumeState | undefined;
  /**
   * 资产摘要：HELLO 的最后一个段（ADR-0082）。
   * 本地新变动会先写到这里，重连时随 HELLO 一起上报，避免掉线期间的收益被旧快照覆盖。
   */
  private economy: EconomyProfile | undefined;
  /**
   * 断线前已在线秒数（ADR-0060）：重连时随 HELLO 上报，服务端据此续算在岗时长。
   * 每次新的一轮进园都从 0 起，只有连接断开的那一刻才写入。
   */
  private sessionSec = 0;
  private attempts = 0;
  private disposed = false;
  /** 被服务端拒绝后进入终止态：不自动重连，否则队列满时会自造重连风暴 */
  private terminal = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 上一次 ping 包里回显的时间戳。
   *
   * 用单调时钟而不是 `Date.now()`：RTT 会直接喂给服务器时钟的样本修正，
   * 系统时间被改一下就能把它算成几秒，顺手把时钟推歪（ADR-0081）。
   */
  private lastPingAt = 0;
  /**
   * 服务端实际采用的同步条目格式，来自 WELCOME 尾部。
   * 连到旧服务端时这一段缺席，按 7 字节处理，新旧两端都能正常显示。
   */
  private syncFormat: SyncFormat = SYNC_FORMAT_LEGACY;
  private selfId = 0;
  /** 上行移动包复用：缓冲与对象都只建一次 */
  private readonly moveWriter = new ByteWriter(16);
  private readonly movePacket: MovePacket = { id: 0, x: 0, y: 0, state: 0 };
  /**
   * 匿名设备号（ADR-0081）：点赞与擂台战绩的聚合键。
   * Worker 里读不到 localStorage，所以由 init 消息带进来；主线程回退时才自己生成。
   */
  private readonly deviceId: string;

  setEntityId(id: number): void {
    this.selfId = id;
  }

  constructor(
    private readonly handlers: NetHandlers,
    private readonly url = defaultUrl(),
    deviceId = '',
  ) {
    this.deviceId = deviceId !== '' ? deviceId : ensureDeviceId();
  }

  connect(
    name: string,
    appearance: CharacterAppearance,
    resume?: ResumeState,
    status = '',
    career?: CareerSummary,
    economy?: EconomyProfile,
  ): void {
    this.name = name;
    this.appearance = appearance;
    this.resume = resume;
    this.status = status;
    this.career = career;
    this.economy = economy;
    this.disposed = false;
    this.terminal = false;
    this.open();
  }

  /** 断线重连前由会话刷新：重连同样带着最新落点，而不是首次入场时的旧快照 */
  setResume(resume: ResumeState | undefined): void {
    this.resume = resume;
  }

  /**
   * 断线时记下已在线秒数，下次 HELLO 带上（ADR-0060）。
   * 只在连接断开的那一刻写：在线期间不需要、也不该反复覆盖。
   */
  setSessionSec(sessionSec: number): void {
    this.sessionSec = Number.isFinite(sessionSec) ? Math.max(0, Math.floor(sessionSec)) : 0;
  }

  /** 用户点「重新排队」：清掉终止态并立刻重连，不等指数退避 */
  retry(): void {
    if (this.disposed) return;
    this.terminal = false;
    this.attempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const stale = this.socket;
    if (stale) {
      // 先摘掉回调再关：否则旧连接的 onclose 会再排一次重连，造出双连接
      stale.onopen = null;
      stale.onmessage = null;
      stale.onerror = null;
      stale.onclose = null;
      stale.close();
      this.socket = null;
    }
    this.open();
  }

  private open(): void {
    if (this.disposed) return;
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      if (this.appearance) {
        // 声明支持 6 字节紧凑条目：服务端按能力协商决定用不用，旧服务端会忽略这一段
        socket.send(
          encodeHello(
            this.name,
            this.appearance,
            this.resume,
            this.status,
            SYNC_FORMAT_COMPACT,
            this.career,
            // 断线续算：旧服务端读完前面的段就停，看不到这 5 字节
            this.sessionSec,
            // 匿名设备号（ADR-0081）：只做点赞/战绩聚合，旧服务端忽略
            this.deviceId,
            // 资产摘要（ADR-0082）：永久层在浏览器，进园时交给服务端清洗
            this.economy,
          ),
        );
      }
      this.handlers.onOpen();
      this.startPing();
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.handle(new Uint8Array(event.data));
    };

    socket.onerror = () => {
      console.error('[net] socket error');
    };

    socket.onclose = () => {
      this.stopPing();
      this.socket = null;
      // 被拒后不改状态也不重连：否则「园区已满」会被冲成「正在重连」
      if (this.terminal) return;
      this.handlers.onClose();
      this.scheduleReconnect();
    };
  }

  private handle(data: Uint8Array): void {
    switch (data[0]) {
      case OpCode.S2C_WELCOME: {
        const packet = decodeWelcome(data);
        // 格式以服务端为准：客户端声明的是「支持」，不是「已经用上」
        this.syncFormat = packet.syncFormat ?? SYNC_FORMAT_LEGACY;
        this.handlers.onWelcome(packet);
        break;
      }
      case OpCode.S2C_ENTITY_SPAWN:
        this.handlers.onSpawn(decodeSpawn(data));
        break;
      case OpCode.S2C_ENTITY_DESPAWN: {
        const packet = decodeDespawn(data);
        this.handlers.onDespawn(packet.id, packet.reason);
        break;
      }
      case OpCode.S2C_SYNC_ENTITIES:
        this.handlers.onSync(data, this.syncFormat);
        break;
      case OpCode.S2C_CHAT_BROADCAST:
        this.handlers.onChat(decodeChatBroadcast(data));
        break;
      case OpCode.S2C_CHAT_HISTORY:
        this.handlers.onChatHistory(decodeChatHistory(data));
        break;
      case OpCode.S2C_SYSTEM_NOTICE:
        this.handlers.onSystemNotice(decodeSystemNotice(data));
        break;
      case OpCode.S2C_CHAT_REJECTED:
        this.handlers.onChatRejected(decodeChatRejected(data).reason);
        break;
      case OpCode.S2C_APPEARANCE: {
        const packet = decodeAppearanceBroadcast(data);
        this.handlers.onAppearance(packet.entityId, packet.appearance);
        break;
      }
      case OpCode.S2C_STATUS: {
        const packet = decodeStatusBroadcast(data);
        this.handlers.onStatus(packet.entityId, packet.status);
        break;
      }
      case OpCode.S2C_NAME: {
        const packet = decodeNameBroadcast(data);
        // 空名字对客户端没有意义：保留旧名而不是把头顶清空
        if (packet.name.length > 0) this.handlers.onName(packet.entityId, packet.name);
        break;
      }
      case OpCode.S2C_CAREER: {
        const packet = decodeCareerBroadcast(data);
        if (packet) this.handlers.onCareer(packet.entityId, packet.career);
        break;
      }
      case OpCode.S2C_LIKE: {
        const packet = decodeLike(data);
        if (packet) this.handlers.onLike(packet);
        break;
      }
      case OpCode.S2C_BOARD: {
        const packet = decodeBoard(data);
        if (packet) this.handlers.onBoard(packet);
        break;
      }
      case OpCode.S2C_SEAT_STATE:
        this.handlers.onSeatState(decodeSeatState(data));
        break;
      case OpCode.S2C_VENT:
        this.handlers.onVent(decodeVent(data));
        break;
      case OpCode.S2C_BOSS:
        this.handlers.onBoss(decodeBoss(data));
        break;
      case OpCode.S2C_JAIL:
        this.handlers.onJail(decodeJail(data));
        break;
      case OpCode.S2C_AMBULANCE:
        this.handlers.onAmbulance?.(decodeAmbulance(data));
        break;
      case OpCode.S2C_PATIENT:
        this.handlers.onPatient?.(decodePatientStatus(data));
        break;
      case OpCode.S2C_RING:
        this.handlers.onRing(decodeRing(data));
        break;
      case OpCode.S2C_QUEUE_STATUS:
        this.handlers.onQueue(decodeQueueStatus(data));
        break;
      case OpCode.S2C_WALLET_SYNC: {
        const packet = decodeWalletSync(data);
        // 记住最新资产：下一次 HELLO 用它，而不是进园前的旧快照
        this.economy = {
          coins: packet.coins,
          stats: packet.stats,
          unlockedCosmetics: this.economy?.unlockedCosmetics ?? [],
          inventory: packet.inventory,
          houseTier: packet.houseTier,
          dailyQuests: this.economy?.dailyQuests ?? { day: '', progress: {}, claimed: [] },
        };
        this.handlers.onWallet?.(packet);
        break;
      }
      case OpCode.S2C_P2P_INVITE_NOTIFY:
        this.handlers.onInvite?.(decodeP2PInviteNotify(data));
        break;
      case OpCode.S2C_P2P_INVITE_RESULT:
        this.handlers.onInviteResult?.(decodeP2PInviteResult(data));
        break;
      case OpCode.S2C_P2P_MATCH:
        this.handlers.onMatch?.(decodeP2PMatch(data));
        break;
      case OpCode.S2C_P2P_SHOWDOWN:
        this.handlers.onShowdown?.(decodeP2PShowdown(data));
        break;
      case OpCode.S2C_P2P_DUEL_STATE:
        this.handlers.onDuelState?.(decodeP2PDuelState(data));
        break;
      case OpCode.S2C_TIP:
        this.handlers.onTip?.(decodeTipBroadcast(data));
        break;
      case OpCode.S2C_ITEM_EFFECT:
        this.handlers.onItemEffect?.(decodeItemEffect(data));
        break;
      case OpCode.S2C_PLAYER_EFFECT:
        this.handlers.onPlayerEffect?.(decodePlayerEffect(data));
        break;
      case OpCode.S2C_LOUDSPEAKER:
        this.handlers.onLoudspeaker?.(decodeLoudspeaker(data));
        break;
      case OpCode.S2C_SHOUT_REJECT:
        this.handlers.onShoutReject?.(decodeShoutReject(data));
        break;
      case OpCode.S2C_ITEM_REJECT:
        this.handlers.onItemReject?.(decodeItemReject(data));
        break;
      case OpCode.S2C_DICE_STATE:
        this.handlers.onDiceState?.(decodeDiceState(data));
        break;
      case OpCode.S2C_VILLA_STATE:
        this.handlers.onVillaState?.(decodeVillaState(data));
        break;
      case OpCode.S2C_ARENA_POOL:
        this.handlers.onArenaPool?.(decodeArenaPool(data));
        break;
      case OpCode.S2C_ROOM_STATE:
        this.handlers.onRoomState?.(decodeRoomState(data));
        break;
      case OpCode.S2C_ROOM_INVITE:
        this.handlers.onRoomInvite?.(decodeRoomInvite(data));
        break;
      case OpCode.S2C_WORK_RESULT:
        this.handlers.onWorkResult?.(decodeWorkResult(data));
        break;
      case OpCode.S2C_QUEST_STATE:
        this.handlers.onQuestState?.(decodeQuestState(data));
        break;
      case OpCode.S2C_WORLD_EVENT:
        this.handlers.onWorldEvent?.(decodeWorldEvent(data));
        break;
      case OpCode.S2C_EVENT_CLAIM:
        this.handlers.onEventClaim?.(decodeEventClaimResult(data));
        break;
      case OpCode.S2C_BOSS_SHOCK:
        this.handlers.onBossShock?.(decodeBossShock(data));
        break;
      case OpCode.S2C_QUEUE_REJECTED:
        this.terminal = true;
        this.handlers.onRejected(decodeQueueRejected(data).reason);
        break;
      case OpCode.S2C_PONG: {
        const stamp = decodePong(data);
        const rtt = (Math.floor(performance.now()) & 0xffffffff) - stamp;
        const measured = rtt >= 0 ? rtt : 0;
        this.handlers.onPing(measured);
        // 尾段时钟（ADR-0081）：和 RTT 同包，天然能把样本挪到发送时刻
        const clock = decodePongClock(data);
        if (clock && clock.serverSec > 0) {
          this.handlers.onClock?.({
            serverSec: clock.serverSec,
            rttMs: measured,
            tzOffsetMin: clock.tzOffsetMin,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.terminal) return;
    const delay = Math.min(MAX_RETRY_DELAY, 500 * 2 ** this.attempts);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    this.stopPing();
    // 立即发一次：首屏不需要等一个完整间隔才拿到第一个 RTT 样本
    this.sendPing();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private sendPing(): void {
    this.lastPingAt = Math.floor(performance.now()) & 0xffffffff;
    this.socket?.send(encodePing(this.lastPingAt));
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  sendMove(x: number, y: number, state: number, clientSequence?: number, clientTimestampMs?: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    // 复用同一块缓冲与同一个包对象：20Hz 上行不该每次造两份垃圾
    const packet = this.movePacket;
    packet.id = this.selfId;
    packet.x = x;
    packet.y = y;
    packet.state = state;
    packet.clientSequence = clientSequence;
    packet.clientTimestampMs = clientTimestampMs;
    this.moveWriter.reset();
    encodeMoveInto(this.moveWriter, packet);
    this.socket.send(this.moveWriter.finish());
  }

  sendAction(entityId: number, action: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(new Uint8Array([OpCode.C2S_ACTION, entityId & 0xff, (entityId >> 8) & 0xff, action & 0xff]));
  }

  /** 发言：颜色索引与飞行模式随包上行（ADR-0056） */
  sendChat(packet: ChatSendPacket): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeChatSend(packet));
  }

  /** 上翻：`beforeMsgId = 0` 表示要最新一页（服务端会以 Replace 语义回） */
  sendChatHistory(beforeMsgId: number, limit: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeChatHistoryRequest({ beforeMsgId, limit }));
  }

  sendAppearance(appearance: CharacterAppearance): void {
    this.appearance = appearance;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeSetAppearance(appearance));
  }

  /** 空串即清除状态；离线时也记下来，重连的 HELLO 会带上 */
  sendStatus(status: string): void {
    this.status = status;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeSetStatus(status));
  }

  /** 改工牌名：离线时也记下来，重连的 HELLO 会带上新名字 */
  sendName(name: string): void {
    this.name = name;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeSetName(name));
  }

  /** 考勤摘要补报：离线时也记下来，重连的 HELLO 会带上 */
  sendCareer(career: CareerSummary): void {
    this.career = career;
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeCareerReport(career));
  }

  /** 工牌点赞：服务端裁决；离线时是空操作，UI 的超时会收回「点赞中」 */
  sendLike(targetId: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeLikeRequest(targetId));
  }

  /** 擂台报名：服务端按容量 / 阶段 / 距离二次裁决 */
  sendRingEnter(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeRingEnter());
  }

  /** 取消报名：只允许在等待第 2 人阶段生效 */
  sendRingLeave(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeRingLeave());
  }

  /** 发起对战邀请：距离 / 忙碌 / 赌注都由服务端二次裁决（ADR-0083） */
  sendP2PInvite(request: P2PInviteRequest): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeP2PInvite(request));
  }

  sendP2PRespond(request: P2PRespondRequest): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeP2PRespond(request));
  }

  /** 猜拳出拳：只带 matchId 与 1..3，合法性由服务端复核 */
  sendP2PAction(request: P2PActionRequest): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeP2PAction(request));
  }

  sendTip(request: TipRequest): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeTipRequest(request));
  }

  sendUseItem(request: UseItemRequest): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeUseItem(request));
  }

  sendShopBuy(request: ShopBuyRequest): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeShopBuy(request));
  }

  /**
   * 搬砖结算（ADR-0088）：只报「这一轮敲完了、连击多少」。
   *
   * 坐姿、工位、间隔与金额全部由服务端裁决，客户端连一个金额字段都不发，
   * 从协议层面就不给刷钱留口子。
   */
  sendWorkClaim(combo: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeWorkClaim(combo));
  }

  /** 领取每日悬赏：进度与「今天领过没有」都由服务端判 */
  sendQuestClaim(questId: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeQuestClaim(questId));
  }

  /** 抢红包：只发序号，位置与是否已被领走由服务端复核 */
  sendEventClaim(index: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeEventClaim(index));
  }

  /** 大喇叭：文案已在编码侧截到 30 字，服务端还会再过一遍审核 */
  sendShout(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeShout(text));
  }

  /** 牛马榜查询：默认一次拉全部指标；服务端按指标各回一条 */
  sendBoard(metric: BoardMetric | typeof BOARD_METRIC_ALL = BOARD_METRIC_ALL): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeBoardRequest(metric));
  }

  // ---- 热区建筑（ADR-0087）：上行只带意图，金额与资格由服务端复核 ----

  sendDiceBet(request: { table: number; side: number; amount: number }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeDiceBet(request));
  }

  sendVilla(request: { villa: number; action: number }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeVillaRequest(request));
  }

  sendArenaBet(request: { side: number; amount: number }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeArenaBet(request));
  }

  sendApartment(request: { action: number; arg: number }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeApartmentRequest(request));
  }

  sendApartmentInvite(targetId: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeApartmentInvite(targetId));
  }

  sendRoomLayout(placements: ReadonlyArray<FurniturePlacement>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeRoomLayout(placements));
  }

  dispose(): void {
    this.disposed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}
