'use client';

import {
  OpCode,
  decodeAppearanceBroadcast,
  decodeChatBroadcast,
  decodeDespawn,
  decodePong,
  decodeSpawn,
  decodeSync,
  decodeWelcome,
  encodeChatSend,
  encodeHello,
  encodeMove,
  encodePing,
  encodeSetAppearance,
  type CharacterAppearance,
  type ChatPacket,
  type EntitySnapshot,
  type SpawnPacket,
  type WelcomePacket,
} from '@niuma/shared-types';

export interface NetHandlers {
  onOpen(): void;
  onClose(): void;
  onWelcome(packet: WelcomePacket): void;
  onSpawn(packet: SpawnPacket): void;
  onDespawn(id: number, reason: number): void;
  onSync(tick: number, entities: EntitySnapshot[]): void;
  onChat(packet: ChatPacket): void;
  onAppearance(id: number, appearance: CharacterAppearance): void;
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
  private retry = 0;
  private disposed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPingAt = 0;
  private selfId = 0;

  setEntityId(id: number): void {
    this.selfId = id;
  }

  constructor(
    private readonly handlers: NetHandlers,
    private readonly url = defaultUrl(),
  ) {}

  connect(name: string, appearance: CharacterAppearance): void {
    this.name = name;
    this.appearance = appearance;
    this.disposed = false;
    this.open();
  }

  private open(): void {
    if (this.disposed) return;
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      if (this.appearance) socket.send(encodeHello(this.name, this.appearance));
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
      case OpCode.S2C_SYNC_ENTITIES: {
        const packet = decodeSync(data);
        this.handlers.onSync(packet.tick, packet.entities);
        break;
      }
      case OpCode.S2C_CHAT_BROADCAST:
        this.handlers.onChat(decodeChatBroadcast(data));
        break;
      case OpCode.S2C_APPEARANCE: {
        const packet = decodeAppearanceBroadcast(data);
        this.handlers.onAppearance(packet.entityId, packet.appearance);
        break;
      }
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
    if (this.disposed) return;
    const delay = Math.min(MAX_RETRY_DELAY, 500 * 2 ** this.retry);
    this.retry += 1;
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

  sendMove(x: number, y: number, state: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMove({ id: this.selfId, x, y, state }));
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

  dispose(): void {
    this.disposed = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}
