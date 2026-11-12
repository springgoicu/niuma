'use client';

import {
  BOARD_METRIC_ALL,
  OpCode,
  decodeAppearanceBroadcast,
  decodeBoard,
  decodeCareerBroadcast,
  decodeChatBroadcast,
  decodeChatHistory,
  decodeChatRejected,
  decodeDespawn,
  decodeGraze,
  decodeLike,
  decodePong,
  decodeQueueRejected,
  decodeQueueStatus,
  decodeSeatState,
  decodeSpawn,
  decodeStatusBroadcast,
  decodeSystemNotice,
  decodeVent,
  decodeWelcome,
  encodeBoardRequest,
  encodeCareerReport,
  encodeChatHistoryRequest,
  encodeChatSend,
  encodeHello,
  encodeLikeRequest,
  encodeMoveInto,
  encodePing,
  encodeSetAppearance,
  encodeSetStatus,
  SYNC_FORMAT_COMPACT,
  SYNC_FORMAT_LEGACY,
  ByteWriter,
  type BoardMetric,
  type BoardPacket,
  type CareerSummary,
  type CharacterAppearance,
  type ChatHistoryPacket,
  type ChatPacket,
  type ChatSendPacket,
  type LikePacket,
  type MovePacket,
  type QueueStatusPacket,
  type ResumeState,
  type SeatStateEntry,
  type SpawnPacket,
  type SyncFormat,
  type SystemNoticePacket,
  type VentEventPacket,
  type WelcomePacket,
} from '@niuma/shared-types';

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
  /** 某个实体的考勤摘要变了（补报后服务端定向广播） */
  onCareer(id: number, career: CareerSummary): void;
  /** 工牌点赞变化：目标、当前计数与「是不是你点的」flag（ADR-0057） */
  onLike(packet: LikePacket): void;
  /** 牛马榜快照：一次请求最多回五条，按 metric 归并 */
  onBoard(packet: BoardPacket): void;
  /** 附近玩家咀嚼：只带实体 id，音效按该实体当前位置空间化 */
  onGraze(id: number): void;
  /**
   * 发泄结算：谁打了谁、打到哪儿。`targetId = 0` 表示空放。
   * 受害者的新坐标与躺姿走 Tick，这条包只负责「归因」与硬直的起点。
   */
  onVent(packet: VentEventPacket): void;
  /** 座位占用变化（入场时为全量快照，之后为增量） */
  onSeatState(entries: SeatStateEntry[]): void;
  onPing(rtt: number): void;
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
  private attempts = 0;
  private disposed = false;
  /** 被服务端拒绝后进入终止态：不自动重连，否则队列满时会自造重连风暴 */
  private terminal = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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

  setEntityId(id: number): void {
    this.selfId = id;
  }

  constructor(
    private readonly handlers: NetHandlers,
    private readonly url = defaultUrl(),
  ) {}

  connect(
    name: string,
    appearance: CharacterAppearance,
    resume?: ResumeState,
    status = '',
    career?: CareerSummary,
  ): void {
    this.name = name;
    this.appearance = appearance;
    this.resume = resume;
    this.status = status;
    this.career = career;
    this.disposed = false;
    this.terminal = false;
    this.open();
  }

  /** 断线重连前由会话刷新：重连同样带着最新落点，而不是首次入场时的旧快照 */
  setResume(resume: ResumeState | undefined): void {
    this.resume = resume;
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
      case OpCode.S2C_GRAZE:
        this.handlers.onGraze(decodeGraze(data));
        break;
      case OpCode.S2C_VENT:
        this.handlers.onVent(decodeVent(data));
        break;
      case OpCode.S2C_QUEUE_STATUS:
        this.handlers.onQueue(decodeQueueStatus(data));
        break;
      case OpCode.S2C_QUEUE_REJECTED:
        this.terminal = true;
        this.handlers.onRejected(decodeQueueRejected(data).reason);
        break;
      case OpCode.S2C_PONG: {
        const stamp = decodePong(data);
        const rtt = (Date.now() & 0xffffffff) - stamp;
        this.handlers.onPing(rtt >= 0 ? rtt : 0);
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
    this.lastPingAt = Date.now();
    this.socket?.send(encodePing(this.lastPingAt & 0xffffffff));
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

  /** 牛马榜查询：默认一次拉全部指标；服务端按指标各回一条 */
  sendBoard(metric: BoardMetric | typeof BOARD_METRIC_ALL = BOARD_METRIC_ALL): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeBoardRequest(metric));
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
