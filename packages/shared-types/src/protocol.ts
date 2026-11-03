import { decodeAppearance, encodeAppearance } from './appearance-codec';
import {
  APPEARANCE_BYTES,
  MAX_CHAT_CHARS,
  MAX_NAME_BYTES,
  MOVE_PACKET_BYTES,
  MOVE_PACKET_WITH_TIMING_BYTES,
  QUEUE_REJECT_BYTES,
  QUEUE_STATUS_BYTES,
  SYNC_ENTRY_BYTES,
} from './constants';
import type {
  CharacterAppearance,
  ChatPacket,
  EntitySnapshot,
  LimitKind,
  MovePacket,
  QueueRejectedPacket,
  QueueStatusPacket,
  SpawnPacket,
  WelcomePacket,
} from './types';
import { OpCode, QUEUE_REJECT_REASON } from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  offset = 0;

  constructor(size = 512) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): void {
    this.offset = 0;
  }

  private ensure(extra: number): void {
    const need = this.offset + extra;
    if (need <= this.buf.length) return;
    let size = this.buf.length || 64;
    while (size < need) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(value: number): this {
    this.ensure(1);
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
    return this;
  }

  u16(value: number): this {
    this.ensure(2);
    this.view.setUint16(this.offset, value & 0xffff, true);
    this.offset += 2;
    return this;
  }

  u32(value: number): this {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
    return this;
  }

  raw(src: Uint8Array): this {
    this.ensure(src.length);
    this.buf.set(src, this.offset);
    this.offset += src.length;
    return this;
  }

  /** 写入 UTF-8，返回写入字节数（调用方负责先写长度） */
  utf8(text: string): number {
    const bytes = textEncoder.encode(text);
    this.raw(bytes);
    return bytes.length;
  }

  /** 回填已知偏移处的 u16，用于「先留头部占位、后写数量」的同步包 */
  patchU16(at: number, value: number): void {
    this.view.setUint16(at, value & 0xffff, true);
  }

  finish(): Uint8Array {
    return this.buf.subarray(0, this.offset);
  }
}

export class ByteReader {
  offset = 0;
  private view: DataView;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.byteLength - this.offset;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  utf8(length: number): string {
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return textDecoder.decode(slice);
  }

  bytes(length: number): Uint8Array {
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

/** 只读 opcode，避免为每个包构造完整 reader */
export function readOpCode(data: Uint8Array): number {
  return data.byteLength > 0 ? data[0]! : 0;
}

export function truncateName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const fallback = cleaned.length > 0 ? cleaned : '无名牛马';
  let out = '';
  let bytes = 0;
  for (const ch of fallback) {
    const size = textEncoder.encode(ch).length;
    if (bytes + size > MAX_NAME_BYTES) break;
    out += ch;
    bytes += size;
  }
  return out.length > 0 ? out : '无名牛马';
}

export function truncateChat(text: string): string {
  const cleaned = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  let out = '';
  let count = 0;
  for (const ch of cleaned) {
    if (count >= MAX_CHAT_CHARS) break;
    out += ch;
    count += 1;
  }
  return out;
}

/** 编码移动包，支持带或不带序号和时间戳 */
export function encodeMove(packet: MovePacket): Uint8Array {
  const hasTimingInfo = packet.clientSequence !== undefined && packet.clientTimestampMs !== undefined;
  const size = hasTimingInfo ? 14 : 8;
  const w = new ByteWriter(size);
  w.u8(OpCode.C2S_MOVE).u16(packet.id).u16(packet.x).u16(packet.y).u8(packet.state);
  if (hasTimingInfo) {
    w.u16(packet.clientSequence!).u32(packet.clientTimestampMs!);
  }
  return w.finish();
}

export function decodeMove(data: Uint8Array, out?: MovePacket): MovePacket {
  const len = data.byteLength;
  if (len !== MOVE_PACKET_BYTES && len !== MOVE_PACKET_WITH_TIMING_BYTES) {
    throw new Error(`move packet must be ${MOVE_PACKET_BYTES} or ${MOVE_PACKET_WITH_TIMING_BYTES} bytes, got ${len}`);
  }
  if (data[0] !== OpCode.C2S_MOVE) throw new Error(`unexpected opcode ${data[0]}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const packet = out ?? ({} as MovePacket);
  packet.id = view.getUint16(1, true);
  packet.x = view.getUint16(3, true);
  packet.y = view.getUint16(5, true);
  packet.state = view.getUint8(7);
  if (len === MOVE_PACKET_WITH_TIMING_BYTES) {
    packet.clientSequence = view.getUint16(8, true);
    packet.clientTimestampMs = view.getUint32(10, true);
  }
  return packet;
}

export function writeSyncHeader(writer: ByteWriter, tick: number, count: number): void {
  writer.u8(OpCode.S2C_SYNC_ENTITIES).u32(tick).u16(count);
}

export function writeSyncEntry(writer: ByteWriter, entity: EntitySnapshot): void {
  writer.u16(entity.id).u16(entity.x).u16(entity.y).u8(entity.state);
}

export function encodeSync(tick: number, entities: readonly EntitySnapshot[]): Uint8Array {
  const writer = new ByteWriter(7 + entities.length * SYNC_ENTRY_BYTES);
  writeSyncHeader(writer, tick, entities.length);
  for (const entity of entities) writeSyncEntry(writer, entity);
  return writer.finish();
}

export function decodeSync(data: Uint8Array): { tick: number; entities: EntitySnapshot[] } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_SYNC_ENTITIES) throw new Error('not a sync packet');
  const tick = reader.u32();
  const count = reader.u16();
  if (reader.remaining !== count * SYNC_ENTRY_BYTES) {
    throw new Error(`sync payload mismatch: ${reader.remaining} vs ${count * SYNC_ENTRY_BYTES}`);
  }
  const entities: EntitySnapshot[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    entities[i] = { id: reader.u16(), x: reader.u16(), y: reader.u16(), state: reader.u8() };
  }
  return { tick, entities };
}

export function encodeSpawn(packet: SpawnPacket): Uint8Array {
  const nameBytes = textEncoder.encode(packet.name);
  const appearance = encodeAppearance(packet.appearance);
  const writer = new ByteWriter(9 + nameBytes.length + APPEARANCE_BYTES);
  writer
    .u8(OpCode.S2C_ENTITY_SPAWN)
    .u16(packet.id)
    .u16(packet.x)
    .u16(packet.y)
    .u8(packet.state)
    .u8(nameBytes.length)
    .raw(nameBytes)
    .raw(appearance);
  return writer.finish();
}

export function decodeSpawn(data: Uint8Array): SpawnPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_ENTITY_SPAWN) throw new Error('not a spawn packet');
  const id = reader.u16();
  const x = reader.u16();
  const y = reader.u16();
  const state = reader.u8();
  const nameLength = reader.u8();
  const name = reader.utf8(nameLength);
  const appearance = decodeAppearance(data, reader.offset);
  return { id, x, y, state, name, appearance };
}

export function encodeDespawn(id: number, reason = 0): Uint8Array {
  const writer = new ByteWriter(4);
  writer.u8(OpCode.S2C_ENTITY_DESPAWN).u16(id).u8(reason);
  return writer.finish();
}

export function decodeDespawn(data: Uint8Array): { id: number; reason: number } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_ENTITY_DESPAWN) throw new Error('not a despawn packet');
  return { id: reader.u16(), reason: reader.u8() };
}

export function encodeChatBroadcast(packet: ChatPacket): Uint8Array {
  const bytes = textEncoder.encode(packet.text);
  const writer = new ByteWriter(7 + bytes.length);
  writer.u8(OpCode.S2C_CHAT_BROADCAST).u16(packet.entityId).u16(packet.msgId).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeChatBroadcast(data: Uint8Array): ChatPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_CHAT_BROADCAST) throw new Error('not a chat packet');
  const entityId = reader.u16();
  const msgId = reader.u16();
  const length = reader.u16();
  return { entityId, msgId, text: reader.utf8(length) };
}

export function encodeChatSend(text: string): Uint8Array {
  const bytes = textEncoder.encode(text);
  const writer = new ByteWriter(3 + bytes.length);
  writer.u8(OpCode.C2S_CHAT).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeChatSend(data: Uint8Array): string {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_CHAT) throw new Error('not a chat send packet');
  const length = reader.u16();
  return reader.utf8(length);
}

export function encodeHello(name: string, appearance: CharacterAppearance): Uint8Array {
  const nameBytes = textEncoder.encode(truncateName(name));
  const writer = new ByteWriter(2 + nameBytes.length + APPEARANCE_BYTES);
  writer.u8(OpCode.C2S_HELLO).u8(nameBytes.length).raw(nameBytes).raw(encodeAppearance(appearance));
  return writer.finish();
}

export function decodeHello(data: Uint8Array): { name: string; appearance: CharacterAppearance } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_HELLO) throw new Error('not a hello packet');
  const nameLength = reader.u8();
  const name = truncateName(reader.utf8(nameLength));
  const appearance = decodeAppearance(data, reader.offset);
  return { name, appearance };
}

export function encodeWelcome(packet: WelcomePacket): Uint8Array {
  const writer = new ByteWriter(11);
  writer.u8(OpCode.S2C_WELCOME).u16(packet.entityId).u32(packet.tick).u16(packet.x).u16(packet.y);
  return writer.finish();
}

export function decodeWelcome(data: Uint8Array): WelcomePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_WELCOME) throw new Error('not a welcome packet');
  return { entityId: reader.u16(), tick: reader.u32(), x: reader.u16(), y: reader.u16() };
}

export function encodeAction(entityId: number, action: number): Uint8Array {
  const writer = new ByteWriter(4);
  writer.u8(OpCode.C2S_ACTION).u16(entityId).u8(action);
  return writer.finish();
}

export function decodeAction(data: Uint8Array): { entityId: number; action: number } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_ACTION) throw new Error('not an action packet');
  return { entityId: reader.u16(), action: reader.u8() };
}

export function encodePing(timestamp: number): Uint8Array {
  const writer = new ByteWriter(5);
  writer.u8(OpCode.C2S_PING).u32(timestamp);
  return writer.finish();
}

export function encodePong(timestamp: number): Uint8Array {
  const writer = new ByteWriter(5);
  writer.u8(OpCode.S2C_PONG).u32(timestamp);
  return writer.finish();
}

export function decodePing(data: Uint8Array): number {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_PING) throw new Error('not a ping packet');
  return reader.u32();
}

export function decodePong(data: Uint8Array): number {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_PONG) throw new Error('not a pong packet');
  return reader.u32();
}

export function encodeSetAppearance(appearance: CharacterAppearance): Uint8Array {
  const writer = new ByteWriter(1 + APPEARANCE_BYTES);
  writer.u8(OpCode.C2S_SET_APPEARANCE).raw(encodeAppearance(appearance));
  return writer.finish();
}

export function decodeSetAppearance(data: Uint8Array): CharacterAppearance {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_SET_APPEARANCE) throw new Error('not an appearance packet');
  return decodeAppearance(data, reader.offset);
}

export function encodeAppearanceBroadcast(entityId: number, appearance: CharacterAppearance): Uint8Array {
  const writer = new ByteWriter(3 + APPEARANCE_BYTES);
  writer.u8(OpCode.S2C_APPEARANCE).u16(entityId).raw(encodeAppearance(appearance));
  return writer.finish();
}

export function decodeAppearanceBroadcast(data: Uint8Array): { entityId: number; appearance: CharacterAppearance } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_APPEARANCE) throw new Error('not an appearance broadcast');
  const entityId = reader.u16();
  return { entityId, appearance: decodeAppearance(data, reader.offset) };
}

/** 水位千分比：越界输入不能把仪表打歪，统一钳到 0..1000 */
function clampPermille(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1000, Math.max(0, Math.round(value)));
}

/** 16 字节排队快照，服务端每秒每人一条 */
export function encodeQueueStatus(packet: QueueStatusPacket): Uint8Array {
  const writer = new ByteWriter(QUEUE_STATUS_BYTES);
  writer
    .u8(OpCode.S2C_QUEUE_STATUS)
    .u32(packet.ticket)
    .u16(packet.position)
    .u16(packet.length)
    .u16(packet.etaSec)
    .u16(packet.capacity)
    .u8(packet.dominant)
    .u16(clampPermille(packet.utilizationPermille));
  return writer.finish();
}

export function decodeQueueStatus(data: Uint8Array): QueueStatusPacket {
  if (data.byteLength !== QUEUE_STATUS_BYTES) {
    throw new Error(`queue status must be ${QUEUE_STATUS_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_QUEUE_STATUS) throw new Error('not a queue status packet');
  const ticket = reader.u32();
  const position = reader.u16();
  const length = reader.u16();
  const etaSec = reader.u16();
  const capacity = reader.u16();
  const dominant = reader.u8() as LimitKind;
  return { ticket, position, length, etaSec, capacity, dominant, utilizationPermille: reader.u16() };
}

/** 2 字节拒绝包：只区分「队列满」与「等待超时」 */
export function encodeQueueRejected(reason: number): Uint8Array {
  const writer = new ByteWriter(QUEUE_REJECT_BYTES);
  writer.u8(OpCode.S2C_QUEUE_REJECTED).u8(reason);
  return writer.finish();
}

export function decodeQueueRejected(data: Uint8Array): QueueRejectedPacket {
  if (data.byteLength !== QUEUE_REJECT_BYTES) {
    throw new Error(`queue rejected must be ${QUEUE_REJECT_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_QUEUE_REJECTED) throw new Error('not a queue rejected packet');
  // 未知 reason 一律降级为「队列已满」：客户端只认这两种，不能因为新枚举值卡死
  const reason =
    reader.u8() === QUEUE_REJECT_REASON.WaitTimeout
      ? QUEUE_REJECT_REASON.WaitTimeout
      : QUEUE_REJECT_REASON.QueueFull;
  return { reason };
}
