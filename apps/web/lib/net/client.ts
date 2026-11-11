'use client';

import {
  OpCode,
  decodeAppearanceBroadcast,
  decodeChatBroadcast,
  decodeChatRejected,
  decodeDespawn,
  decodePong,
  decodeQueueRejected,
  decodeQueueStatus,
  decodeSeatState,
  decodeSpawn,
  decodeStatusBroadcast,
  decodeWelcome,
  encodeChatSend,
  encodeHello,
  encodeMoveInto,
  encodePing,
  encodeSetAppearance,
  encodeSetStatus,
  ByteWriter,
  type CharacterAppearance,
  type ChatPacket,
  type MovePacket,
  type QueueStatusPacket,
  type ResumeState,
  type SeatStateEntry,
  type SpawnPacket,
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
   */
  onSync(data: Uint8Array): void;
  onChat(packet: ChatPacket): void;
  /** 服务端拦下了一条发言（政治敏感 / 限速），只带原因，不回传原文 */
  onChatRejected(reason: number): void;
  onAppearance(id: number, appearance: CharacterAppearance): void;
  /** 某个实体的常驻状态变了（自己也会收到一条，用于对齐服务端裁决后的文本） */
  onStatus(id: number, status: string): void;
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

export class NetClient {
  private socket: WebSocket | null = null;
  private name = '';
  private appearance: CharacterAppearance | null = null;
  /** 常驻状态：重连时随 HELLO 一起带上，否则断线回来状态会凭空消失 */
  private status = '';
  /** 上一次会话的落点：每次（重）连都随 HELLO 上报，由服务端重新校验 */
  private resume: ResumeState | undefined;
  private attempts = 0;
  private disposed = false;
  /** 被服务端拒绝后进入终止态：不自动重连，否则队列满时会自造重连风暴 */
  private terminal = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPingAt = 0;
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

  connect(name: string, appearance: CharacterAppearance, resume?: ResumeState, status = ''): void {
    this.name = name;
    this.appearance = appearance;
    this.resume = resume;
    this.status = status;
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
        socket.send(encodeHello(this.name, this.appearance, this.resume, this.status));
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
      case OpCode.S2C_WELCOME:
        this.handlers.onWelcome(decodeWelcome(data));
        break;
      case OpCode.S2C_ENTITY_SPAWN:
        this.handlers.onSpawn(decodeSpawn(data));
        break;
      case OpCode.S2C_ENTITY_DESPAWN: {
        const packet = decodeDespawn(data);
        this.handlers.onDespawn(packet.id, packet.reason);
        break;
      }
      case OpCode.S2C_SYNC_ENTITIES:
        this.handlers.onSync(data);
        break;
      case OpCode.S2C_CHAT_BROADCAST:
        this.handlers.onChat(decodeChatBroadcast(data));
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
      case OpCode.S2C_SEAT_STATE:
        this.handlers.onSeatState(decodeSeatState(data));
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
    this.lastPingAt = Date.now();
    this.pingTimer = setInterval(() => {
      this.lastPingAt = Date.now();
      this.socket?.send(encodePing(this.lastPingAt & 0xffffffff));
    }, 2000);
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

  sendChat(text: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeChatSend(text));
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

  dispose(): void {
    this.disposed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}
