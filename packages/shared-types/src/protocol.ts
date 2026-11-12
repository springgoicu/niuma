import { decodeAppearance, encodeAppearance } from './appearance-codec';
import {
  APPEARANCE_BYTES,
  CHAT_HISTORY_FLAG,
  CHAT_HISTORY_MAX_PAGE,
  CHAT_HISTORY_PACKET_BUDGET,
  CHAT_REJECT_BYTES,
  FALLBACK_NICKNAME,
  MAX_CHAT_CHARS,
  MAX_NAME_BYTES,
  MAX_NAME_CHARS,
  MAX_STATUS_BYTES,
  MAX_STATUS_CHARS,
  MAX_STATUS_DISPLAY_UNITS,
  MOVE_PACKET_BYTES,
  MOVE_PACKET_WITH_TIMING_BYTES,
  ONLINE_EXTENSION_BYTES,
  ONLINE_EXTENSION_MAGIC,
  QUEUE_REJECT_BYTES,
  QUEUE_STATUS_BYTES,
  RESUME_BYTES,
  RESUME_VERSION,
  STATUS_EXTENSION_MAGIC,
  SYNC_CAPABILITY_MAGIC,
  SYNC_ENTRY_BYTES,
  SYNC_ENTRY_BYTES_COMPACT,
  SYNC_FORMAT_COMPACT,
  SYNC_FORMAT_LEGACY,
  SYNC_HEADER_BYTES,
  VENT_PACKET_BYTES,
  type SyncFormat,
} from './constants';
import { displayWidth } from './name';
import {
  dequantizeCoord,
  fromSyncCoord,
  packState,
  quantizeCoord,
  toSyncCoord,
  unpackState,
} from './quantize';
import type {
  CharacterAppearance,
  ChatHistoryEntry,
  ChatHistoryPacket,
  ChatHistoryRequest,
  ChatPacket,
  EntitySnapshot,
  LimitKind,
  MovePacket,
  QueueRejectedPacket,
  QueueStatusPacket,
  ResumeState,
  SpawnPacket,
  SystemNoticePacket,
  VentEventPacket,
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

  /** 回填 u8：历史包要先写 flags 占位，装完这一页才能确定条数 */
  patchU8(at: number, value: number): void {
    this.view.setUint8(at, value & 0xff);
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

/**
 * 昵称钳制：字符数与字节数两把尺子同时生效。
 *
 * 只按字节截断会漏掉「16 个汉字」这条产品规则（48 字节刚好兜不住 4 字节 emoji 的组合），
 * 只按字符截断又会让 u8 长度字段溢出——两个条件都得在协议层守住，服务端才是权威。
 */
export function truncateName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const fallback = cleaned.length > 0 ? cleaned : FALLBACK_NICKNAME;
  let out = '';
  let chars = 0;
  let bytes = 0;
  // 按码点遍历：slice 会把 emoji 的代理对切成半个字符
  for (const ch of fallback) {
    if (chars >= MAX_NAME_CHARS) break;
    const size = textEncoder.encode(ch).length;
    if (bytes + size > MAX_NAME_BYTES) break;
    out += ch;
    chars += 1;
    bytes += size;
  }
  return out.length > 0 ? out : FALLBACK_NICKNAME;
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

/**
 * 状态标签钳制：显示宽 / 码点 / 字节三重尺子同时生效，空串表示「没有状态」。
 *
 * 与 `truncateName` 的两点不同：
 * 1) 空输入是合法结果，不做兜底（清除状态就是发空串）；
 * 2) 多一把显示宽尺子——16 个单位就是 8 个汉字或 8 个 emoji，超出部分直接丢，
 *    不补省略号：状态在头顶独占一行，省略号白占一个身位还看不清。
 */
export function truncateStatus(text: string | undefined | null): string {
  if (typeof text !== 'string') return '';
  const cleaned = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return '';
  let out = '';
  let chars = 0;
  let bytes = 0;
  let width = 0;
  // 按码点遍历：slice 会把 emoji 的代理对切成半个字符
  for (const ch of cleaned) {
    if (chars >= MAX_STATUS_CHARS) break;
    const size = textEncoder.encode(ch).length;
    if (bytes + size > MAX_STATUS_BYTES) break;
    const w = displayWidth(ch);
    if (width + w > MAX_STATUS_DISPLAY_UNITS) break;
    out += ch;
    chars += 1;
    bytes += size;
    width += w;
  }
  return out.trim();
}

/** 写进调用方复用的缓冲：客户端 20Hz 上行不必每次都新建一条 14 字节包 */
export function encodeMoveInto(writer: ByteWriter, packet: MovePacket): void {
  writer.u8(OpCode.C2S_MOVE).u16(packet.id).u16(packet.x).u16(packet.y).u8(packet.state);
  if (packet.clientSequence !== undefined && packet.clientTimestampMs !== undefined) {
    writer.u16(packet.clientSequence).u32(packet.clientTimestampMs);
  }
}

/** 编码移动包，支持带或不带序号和时间戳 */
export function encodeMove(packet: MovePacket): Uint8Array {
  const writer = new ByteWriter(MOVE_PACKET_WITH_TIMING_BYTES);
  encodeMoveInto(writer, packet);
  return writer.finish();
}

export function decodeMove(data: Uint8Array, out?: MovePacket): MovePacket {
  const len = data.byteLength;
  if (len !== MOVE_PACKET_BYTES && len !== MOVE_PACKET_WITH_TIMING_BYTES) {
    throw new Error(`move packet must be ${MOVE_PACKET_BYTES} or ${MOVE_PACKET_WITH_TIMING_BYTES} bytes, got ${len}`);
  }
  if (data[0] !== OpCode.C2S_MOVE) throw new Error(`unexpected opcode ${data[0]}`);
  // 直接按字节取小端值：DataView 是每包一次的分配，200 人 20Hz 就是 4000 个/秒，
  // 而这里只有 4-7 个字段，手写移位比构造视图更快也更干净。
  const packet = out ?? ({} as MovePacket);
  packet.id = data[1]! | (data[2]! << 8);
  packet.x = data[3]! | (data[4]! << 8);
  packet.y = data[5]! | (data[6]! << 8);
  packet.state = data[7]!;
  if (len === MOVE_PACKET_WITH_TIMING_BYTES) {
    packet.clientSequence = data[8]! | (data[9]! << 8);
    packet.clientTimestampMs =
      (data[10]! | (data[11]! << 8) | (data[12]! << 16) | (data[13]! << 24)) >>> 0;
  }
  return packet;
}

export function writeSyncHeader(writer: ByteWriter, tick: number, count: number): void {
  writer.u8(OpCode.S2C_SYNC_ENTITIES).u32(tick).u16(count);
}

/**
 * 条目写入用标量参数而不是 `EntitySnapshot` 对象。
 *
 * Tick 里这张表是 O(可见性边数) 的：200 人全同屏时每 Tick 4 万次。
 * 传对象会让服务端在稳态下每秒造出 80 万个短命字面量，GC 一响就是一整帧。
 * 4 个标量没有任何需要归还的生命周期，比对象池更彻底。
 */
export function writeSyncEntry(writer: ByteWriter, id: number, x: number, y: number, state: number): void {
  writer.u16(id).u16(x).u16(y).u8(state);
}

/**
 * 6 字节紧凑条目，位表（低位在前）：
 *
 * ```
 * bit  0..9   id        (10 bit)
 * bit 10..24  x @1/4px  (15 bit)
 * bit 25..39  y @1/4px  (15 bit)
 * bit 40..47  state     ( 8 bit，与 packState 一致)
 * ```
 *
 * 入参仍是 1/8px 的 `quantizeCoord` 结果，降精度只发生在这一层。
 */
export function writeSyncEntryCompact(
  writer: ByteWriter,
  id: number,
  x: number,
  y: number,
  state: number,
): void {
  const qx = toSyncCoord(x);
  const qy = toSyncCoord(y);
  writer
    .u8(id & 0xff)
    .u8(((id >> 8) & 0x03) | ((qx & 0x3f) << 2))
    .u8((qx >> 6) & 0xff)
    .u8(((qx >> 14) & 0x01) | ((qy & 0x7f) << 1))
    .u8((qy >> 7) & 0xff)
    .u8(state & 0xff);
}

/**
 * 读同步包的服务端发送序号（包头偏移 1..4）。
 *
 * 抖动估计不能拿「包到达间隔」直接减 Tick：ADR-0043 去脏后静止人群整 Tick 不发包，
 * 间隔会被误判成几百毫秒抖动。tick 是服务端发送序号，`到达时刻 - tick × TICK_MS`
 * 只随传输时延变化，静止多久都不影响判断。
 */
export function readSyncTick(data: Uint8Array): number {
  if (data.byteLength < SYNC_HEADER_BYTES) {
    throw new Error(`sync packet too short: ${data.byteLength}`);
  }
  if (data[0] !== OpCode.S2C_SYNC_ENTITIES) throw new Error('not a sync packet');
  return (data[1]! | (data[2]! << 8) | (data[3]! << 16) | (data[4]! << 24)) >>> 0;
}

/**
 * 逐条消费同步包，不建数组、不建对象。
 *
 * 客户端每帧都要吃下整包实体，200 人同屏 20Hz 就是每秒 4000 个对象；
 * 直接按字节取（小端）比构造 DataView 更省，且调用方可以把写入 TypedArray
 * 的动作放进同一个循环里，避免"先解析成数组再遍历"的第二趟。
 *
 * 返回条目数。格式错误仍抛异常——协议是双端唯一契约，静默降级只会把问题推迟到更难查的地方。
 */
/**
 * 条目格式不靠包长猜，而是由 `S2C_WELCOME` 明确告知。
 *
 * 「按长度自适应」在截断包上是有歧义的：7 字节条目少收 1 字节，正好等于一条 6 字节条目
 * （count=1、payload=6），猜错不会报错，只会把垃圾字节当成坐标。因此格式是连接级契约，
 * 由服务端在入场时一次说清。
 */
export function readSync(
  data: Uint8Array,
  visit: (id: number, x: number, y: number, state: number) => void,
  format: SyncFormat = SYNC_FORMAT_LEGACY,
): number {
  if (data.byteLength < SYNC_HEADER_BYTES) {
    throw new Error(`sync packet too short: ${data.byteLength}`);
  }
  if (data[0] !== OpCode.S2C_SYNC_ENTITIES) throw new Error('not a sync packet');
  const count = data[5]! | (data[6]! << 8);
  const entryBytes = format === SYNC_FORMAT_COMPACT ? SYNC_ENTRY_BYTES_COMPACT : SYNC_ENTRY_BYTES;
  if (data.byteLength - SYNC_HEADER_BYTES !== count * entryBytes) {
    throw new Error(
      `sync payload mismatch: ${data.byteLength - SYNC_HEADER_BYTES} vs ${count}×${entryBytes}`,
    );
  }
  let at = SYNC_HEADER_BYTES;
  if (format === SYNC_FORMAT_COMPACT) {
    for (let i = 0; i < count; i += 1) {
      const b1 = data[at + 1]!;
      const b3 = data[at + 3]!;
      const id = data[at]! | ((b1 & 0x03) << 8);
      const qx = (b1 >> 2) | (data[at + 2]! << 6) | ((b3 & 0x01) << 14);
      const qy = ((b3 >> 1) & 0x7f) | (data[at + 4]! << 7);
      visit(id, fromSyncCoord(qx), fromSyncCoord(qy), data[at + 5]!);
      at += SYNC_ENTRY_BYTES_COMPACT;
    }
    return count;
  }
  for (let i = 0; i < count; i += 1) {
    visit(
      data[at]! | (data[at + 1]! << 8),
      data[at + 2]! | (data[at + 3]! << 8),
      data[at + 4]! | (data[at + 5]! << 8),
      data[at + 6]!,
    );
    at += SYNC_ENTRY_BYTES;
  }
  return count;
}

export function encodeSync(
  tick: number,
  entities: readonly EntitySnapshot[],
  format: SyncFormat = SYNC_FORMAT_LEGACY,
): Uint8Array {
  const compact = format === SYNC_FORMAT_COMPACT;
  const entryBytes = compact ? SYNC_ENTRY_BYTES_COMPACT : SYNC_ENTRY_BYTES;
  const writer = new ByteWriter(SYNC_HEADER_BYTES + entities.length * entryBytes);
  writeSyncHeader(writer, tick, entities.length);
  for (const entity of entities) {
    if (compact) writeSyncEntryCompact(writer, entity.id, entity.x, entity.y, entity.state);
    else writeSyncEntry(writer, entity.id, entity.x, entity.y, entity.state);
  }
  return writer.finish();
}

export function decodeSync(
  data: Uint8Array,
  format: SyncFormat = SYNC_FORMAT_LEGACY,
): { tick: number; entities: EntitySnapshot[] } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_SYNC_ENTITIES) throw new Error('not a sync packet');
  const tick = reader.u32();
  const count = reader.u16();
  const entities: EntitySnapshot[] = new Array(count);
  let at = 0;
  const seen = readSync(
    data,
    (id, x, y, state) => {
      entities[at++] = { id, x, y, state };
    },
    format,
  );
  if (seen !== count) throw new Error(`sync count mismatch: ${seen} vs ${count}`);
  return { tick, entities };
}

/**
 * 入场资料的「不变部分」：`[nameLen u8][nameBytes][appearance 32B]`。
 *
 * 新玩家入场时要给视野内所有人各发一份 spawn，但除了坐标与状态，内容完全一样。
 * 原实现每份都重新跑一遍 `TextEncoder.encode` + `encodeAppearance`（内部再分配 32 字节数组
 * 与 DataView，并做 11 次 sanitize），200 人同秒涌入时是 4 万次重复编码——这就是
 * README 里那次 158ms 长帧的根因。名字与外观在一局内不变，算一次存着即可。
 */
export function buildSpawnBody(name: string, appearance: CharacterAppearance, status = ''): Uint8Array {
  const nameBytes = textEncoder.encode(name);
  // 没设状态就不追加任何字节：包体与上一版完全一致，旧客户端不需要理解这段
  const statusBytes = textEncoder.encode(truncateStatus(status));
  const body = new Uint8Array(1 + nameBytes.length + APPEARANCE_BYTES + (statusBytes.length > 0 ? 1 : 0) + statusBytes.length);
  body[0] = nameBytes.length;
  body.set(nameBytes, 1);
  body.set(encodeAppearance(appearance), 1 + nameBytes.length);
  if (statusBytes.length > 0) {
    const at = 1 + nameBytes.length + APPEARANCE_BYTES;
    body[at] = statusBytes.length;
    body.set(statusBytes, at + 1);
  }
  return body;
}

/** 用现成的 body 拼一个完整 spawn 包：坐标与状态每次都写，保证入场位置不过期 */
export function encodeSpawnInto(
  writer: ByteWriter,
  id: number,
  x: number,
  y: number,
  state: number,
  body: Uint8Array,
  onlineSec?: number,
): void {
  writer.u8(OpCode.S2C_ENTITY_SPAWN).u16(id).u16(x).u16(y).u8(state).raw(body);
  // 在线秒数每秒变化，不能进 spawnBody 缓存；只有调用方现算时才追加这一段
  if (onlineSec !== undefined) writer.u8(ONLINE_EXTENSION_MAGIC).u32(onlineSec);
}

export function encodeSpawn(packet: SpawnPacket): Uint8Array {
  const body = buildSpawnBody(packet.name, packet.appearance, packet.status);
  const writer = new ByteWriter(6 + body.length + ONLINE_EXTENSION_BYTES);
  encodeSpawnInto(writer, packet.id, packet.x, packet.y, packet.state, body, packet.onlineSec);
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
  reader.offset += APPEARANCE_BYTES;
  // 旧服务端的入场包没有状态段：剩余 0 字节即「没设置」，不能因此拒收整条 spawn。
  // 0xfe 是在线秒数段的魔数，不是状态长度，必须先排除再按长度读状态。
  let status = '';
  if (reader.remaining >= 1 && data[reader.offset] !== ONLINE_EXTENSION_MAGIC) {
    const statusLength = reader.u8();
    // 长度字段与剩余字节不符说明包被截断或伪造：丢掉状态而不是猜半个字符
    status = statusLength <= reader.remaining ? truncateStatus(reader.utf8(statusLength)) : '';
  }
  // 在线秒数段：旧服务端没有这 5 字节，按 undefined 回退「首次看到起算」
  if (reader.remaining >= ONLINE_EXTENSION_BYTES && data[reader.offset] === ONLINE_EXTENSION_MAGIC) {
    reader.u8();
    return { id, x, y, state, name, appearance, status, onlineSec: reader.u32() };
  }
  return { id, x, y, state, name, appearance, status };
}

/** 写进调用方复用的缓冲：一次视野重算可能连发几十条 despawn，不必每条都新建 */
export function encodeDespawnInto(writer: ByteWriter, id: number, reason = 0): void {
  writer.u8(OpCode.S2C_ENTITY_DESPAWN).u16(id).u8(reason);
}

export function encodeDespawn(id: number, reason = 0): Uint8Array {
  const writer = new ByteWriter(4);
  encodeDespawnInto(writer, id, reason);
  return writer.finish();
}

export function decodeDespawn(data: Uint8Array): { id: number; reason: number } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_ENTITY_DESPAWN) throw new Error('not a despawn packet');
  return { id: reader.u16(), reason: reader.u8() };
}

/**
 * 咀嚼事件：一次性动作，不走 state 位（8 位已被朝向/姿态/四个叠加位占满），
 * 也不改 48 bit 紧凑条目；只发给看得见发声者的人（ADR-0048）。
 */
export function encodeGraze(id: number): Uint8Array {
  const writer = new ByteWriter(3);
  writer.u8(OpCode.S2C_GRAZE).u16(id);
  return writer.finish();
}

export function decodeGraze(data: Uint8Array): number {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_GRAZE) throw new Error('not a graze packet');
  return reader.u16();
}

/**
 * 发泄结算：`[op][attackerId u16][targetId u16][x u16][y u16]`，9 字节定长。
 *
 * 与 `encodeGraze` 同属一次性事件通道，但多带「谁打到谁」与受害者的权威坐标：
 * 前者让旁观者能把倒地归因到具体的人（音效、台词、镜头都有对象），
 * 后者让受害者本人越过 128px 的本地和解阈值，直接贴到服务端算出的落点上。
 */
export function encodeVent(attackerId: number, targetId: number, x: number, y: number): Uint8Array {
  const writer = new ByteWriter(VENT_PACKET_BYTES);
  writer.u8(OpCode.S2C_VENT).u16(attackerId).u16(targetId).u16(x).u16(y);
  return writer.finish();
}

export function decodeVent(data: Uint8Array): VentEventPacket {
  if (data.byteLength !== VENT_PACKET_BYTES) {
    throw new Error(`vent packet must be ${VENT_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_VENT) throw new Error('not a vent packet');
  // 坐标保持量化口径：调用方用 dequantizeCoord 还原成世界像素，与移动包同一把尺子
  return { attackerId: reader.u16(), targetId: reader.u16(), x: reader.u16(), y: reader.u16() };
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

export function encodeHello(
  name: string,
  appearance: CharacterAppearance,
  resume?: ResumeState,
  status?: string,
  syncFormat: SyncFormat = SYNC_FORMAT_LEGACY,
): Uint8Array {
  const nameBytes = textEncoder.encode(truncateName(name));
  const statusBytes = textEncoder.encode(truncateStatus(status));
  // 状态段只在真的有内容时写：空状态的 HELLO 与旧版逐字节相同
  const statusSize = statusBytes.length > 0 ? 2 + statusBytes.length : 0;
  // 不声明紧凑格式就不写能力段：旧服务端与旧客户端看到的帧长完全不变
  const capabilitySize = syncFormat === SYNC_FORMAT_COMPACT ? 2 : 0;
  const writer = new ByteWriter(
    2 + nameBytes.length + APPEARANCE_BYTES + (resume ? RESUME_BYTES : 0) + statusSize + capabilitySize,
  );
  writer.u8(OpCode.C2S_HELLO).u8(nameBytes.length).raw(nameBytes).raw(encodeAppearance(appearance));
  if (resume) {
    writer
      .u8(RESUME_VERSION)
      .u16(quantizeCoord(resume.x))
      .u16(quantizeCoord(resume.y))
      .u8(packState(resume.direction, resume.pose, false))
      .u16(resume.seatId);
  }
  if (statusBytes.length > 0) {
    writer.u8(STATUS_EXTENSION_MAGIC).u8(statusBytes.length).raw(statusBytes);
  }
  if (capabilitySize > 0) writer.u8(SYNC_CAPABILITY_MAGIC).u8(syncFormat);
  return writer.finish();
}

export function decodeHello(data: Uint8Array): {
  name: string;
  appearance: CharacterAppearance;
  resume?: ResumeState;
  /** 常驻状态；空串表示没设置（旧客户端整段缺席时同样是空串） */
  status: string;
  /** 对端声明的同步条目格式；没有能力段就是旧格式 */
  syncFormat: SyncFormat;
} {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_HELLO) throw new Error('not a hello packet');
  const nameLength = reader.u8();
  const name = truncateName(reader.utf8(nameLength));
  const appearance = decodeAppearance(data, reader.offset);
  reader.offset += APPEARANCE_BYTES;

  let resume: ResumeState | undefined;
  // 0xff 是状态段、0xfd 是能力段的魔数，都不是 resume 版本号：先排除，免得把尾部读成落点
  if (
    reader.remaining >= RESUME_BYTES &&
    data[reader.offset] !== STATUS_EXTENSION_MAGIC &&
    data[reader.offset] !== SYNC_CAPABILITY_MAGIC
  ) {
    const version = reader.u8();
    const x = reader.u16();
    const y = reader.u16();
    const state = reader.u8();
    const seatId = reader.u16();
    // 未来客户端可能写入新字段：版本不认识就整段丢弃，出生逻辑回落到随机点，
    // 但后面的状态段与能力段仍要照常解析，不能提前 return。
    if (version === RESUME_VERSION) {
      const unpacked = unpackState(state);
      resume = {
        x: dequantizeCoord(x),
        y: dequantizeCoord(y),
        direction: unpacked.direction,
        pose: unpacked.pose,
        seatId,
      };
    }
  }

  let status = '';
  if (reader.remaining >= 2 && data[reader.offset] === STATUS_EXTENSION_MAGIC) {
    reader.u8();
    const statusLength = reader.u8();
    status = statusLength <= reader.remaining ? truncateStatus(reader.utf8(statusLength)) : '';
  }

  let syncFormat: SyncFormat = SYNC_FORMAT_LEGACY;
  if (reader.remaining >= 2 && data[reader.offset] === SYNC_CAPABILITY_MAGIC) {
    reader.u8();
    syncFormat = reader.u8() === SYNC_FORMAT_COMPACT ? SYNC_FORMAT_COMPACT : SYNC_FORMAT_LEGACY;
  }
  return { name, appearance, resume, status, syncFormat };
}

export function encodeWelcome(packet: WelcomePacket): Uint8Array {
  const writer = new ByteWriter(13);
  writer
    .u8(OpCode.S2C_WELCOME)
    .u16(packet.entityId)
    .u32(packet.tick)
    .u16(packet.x)
    .u16(packet.y)
    .u8(packet.state ?? 0);
  // 尾部追加格式字节：旧客户端读完 state 就停，多余字节被忽略
  if (packet.syncFormat !== undefined && packet.syncFormat !== SYNC_FORMAT_LEGACY) {
    writer.u8(packet.syncFormat);
  }
  return writer.finish();
}

export function decodeWelcome(data: Uint8Array): WelcomePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_WELCOME) throw new Error('not a welcome packet');
  const entityId = reader.u16();
  const tick = reader.u32();
  const x = reader.u16();
  const y = reader.u16();
  // 旧服务端的 11 字节包没有 state：按 Idle + Down 处理，不让入场流程直接失败
  const state = reader.remaining >= 1 ? reader.u8() : 0;
  const packet: WelcomePacket = { entityId, tick, x, y, state };
  // 旧格式不写这一段：包体与旧服务端逐字节相同，消费方的对象形状也不变
  if (reader.remaining >= 1 && reader.u8() === SYNC_FORMAT_COMPACT) {
    packet.syncFormat = SYNC_FORMAT_COMPACT;
  }
  return packet;
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

/** 座位变动：occupant = 0 表示空出；一包可以带多条，入场时服务端一次性下发全量占用 */
export interface SeatStateEntry {
  seatId: number;
  occupant: number;
}

export function encodeSeatState(entries: readonly SeatStateEntry[]): Uint8Array {
  const writer = new ByteWriter(3 + entries.length * 4);
  writer.u8(OpCode.S2C_SEAT_STATE).u16(entries.length);
  for (const entry of entries) writer.u16(entry.seatId).u16(entry.occupant);
  return writer.finish();
}

export function decodeSeatState(data: Uint8Array): SeatStateEntry[] {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_SEAT_STATE) throw new Error('not a seat state packet');
  const count = reader.u16();
  if (reader.remaining !== count * 4) {
    throw new Error(`seat state payload mismatch: ${reader.remaining} vs ${count * 4}`);
  }
  const entries: SeatStateEntry[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    entries[i] = { seatId: reader.u16(), occupant: reader.u16() };
  }
  return entries;
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

/** 设置状态：`[op][len u16][utf8]`；空串即清除，服务端按同一把尺子再钳一次 */
export function encodeSetStatus(status: string): Uint8Array {
  const bytes = textEncoder.encode(truncateStatus(status));
  const writer = new ByteWriter(3 + bytes.length);
  writer.u8(OpCode.C2S_SET_STATUS).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeSetStatus(data: Uint8Array): string {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_SET_STATUS) throw new Error('not a set status packet');
  const length = reader.u16();
  // 长度字段超出实际负载说明包被截断或伪造：按「清除」处理，绝不越过缓冲
  return length <= reader.remaining ? truncateStatus(reader.utf8(length)) : '';
}

export function encodeStatusBroadcast(entityId: number, status: string): Uint8Array {
  const bytes = textEncoder.encode(truncateStatus(status));
  const writer = new ByteWriter(5 + bytes.length);
  writer.u8(OpCode.S2C_STATUS).u16(entityId).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeStatusBroadcast(data: Uint8Array): { entityId: number; status: string } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_STATUS) throw new Error('not a status broadcast');
  const entityId = reader.u16();
  const length = reader.u16();
  return { entityId, status: length <= reader.remaining ? truncateStatus(reader.utf8(length)) : '' };
}

/**
 * 系统提示包：文案由发送方套好模板，客户端只按 `kind` 选样式。
 * 文本仍走 `truncateChat` 收口，防止模板里塞进超长名字把包撑大。
 */
export function encodeSystemNotice(packet: SystemNoticePacket): Uint8Array {
  const bytes = textEncoder.encode(truncateChat(packet.text));
  const writer = new ByteWriter(7 + bytes.length);
  writer.u8(OpCode.S2C_SYSTEM_NOTICE).u8(packet.kind).u16(packet.entityId).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeSystemNotice(data: Uint8Array): SystemNoticePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_SYSTEM_NOTICE) throw new Error('not a system notice packet');
  const kind = reader.u8();
  const entityId = reader.u16();
  const length = reader.u16();
  // 长度字段超出实际负载说明包被截断或伪造：按空串处理，绝不越过缓冲
  return { kind, entityId, text: length <= reader.remaining ? reader.utf8(length) : '' };
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

/**
 * 聊天被拦下的回执：2 字节，只带原因，不回传原文。
 * 政治类命中与限速都走这条包——客户端据此在输入框下方给一句解释。
 */
export function encodeChatRejected(reason: number): Uint8Array {
  const writer = new ByteWriter(CHAT_REJECT_BYTES);
  writer.u8(OpCode.S2C_CHAT_REJECTED).u8(reason);
  return writer.finish();
}

export function decodeChatRejected(data: Uint8Array): { reason: number } {
  if (data.byteLength !== CHAT_REJECT_BYTES) {
    throw new Error(`chat rejected must be ${CHAT_REJECT_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_CHAT_REJECTED) throw new Error('not a chat rejected packet');
  // 原样返回：新服务端可能新增原因，客户端按「未知原因」给通用文案，不硬编码降级
  return { reason: reader.u8() };
}

/**
 * 历史页：`[op][flags u8][count u8]` + count × `[msgId u16][entityId u16][ageSec u32][name u8+bytes][text u16+bytes]`。
 *
 * 一页一包：累计到 `CHAT_HISTORY_PACKET_BUDGET` 就不再追加。
 * 被预算截断时由编码器自己把 `HasMore` 置真——只靠调用方判断的话，
 * 「这页没装完」会静默变成「没有更早的消息了」，用户再也翻不上去。
 */
export function encodeChatHistory(packet: ChatHistoryPacket): Uint8Array {
  const writer = new ByteWriter(64);
  writer.u8(OpCode.S2C_CHAT_HISTORY).u8(packet.flags).u8(0);
  let count = 0;
  let truncated = false;
  for (const entry of packet.entries) {
    const name = textEncoder.encode(truncateName(entry.name));
    const text = textEncoder.encode(truncateChat(entry.text));
    // 9 字节定长头 + 昵称 + 2 字节正文字段 + 正文：先算后写，绝不写到一半越界
    if (writer.offset + 11 + name.length + text.length > CHAT_HISTORY_PACKET_BUDGET) {
      truncated = true;
      break;
    }
    writer
      .u16(entry.msgId)
      .u16(entry.entityId)
      .u32(Math.max(0, Math.floor(entry.ageSec)))
      .u8(name.length)
      .raw(name)
      .u16(text.length)
      .raw(text);
    count += 1;
  }
  writer.patchU8(2, count);
  // 截断即代表「还有更早的」：这一页装不下的条目必须让客户端继续翻
  if (truncated) writer.patchU8(1, packet.flags | CHAT_HISTORY_FLAG.HasMore);
  return writer.finish();
}

export function decodeChatHistory(data: Uint8Array): ChatHistoryPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_CHAT_HISTORY) throw new Error('not a chat history packet');
  const flags = reader.u8();
  const count = reader.u8();
  const entries: ChatHistoryEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    // 定长头 9 字节都不够，说明包被截断：保留已解析的前缀，绝不在缓冲外取值
    if (reader.remaining < 9) break;
    const msgId = reader.u16();
    const entityId = reader.u16();
    const ageSec = reader.u32();
    const nameLength = reader.u8();
    if (nameLength > reader.remaining) break;
    const name = reader.utf8(nameLength);
    if (reader.remaining < 2) {
      entries.push({ msgId, entityId, ageSec, name, text: '' });
      break;
    }
    const textLength = reader.u16();
    // 长度字段越界：按空串处理并停下（与系统提示包同口径）
    if (textLength > reader.remaining) {
      entries.push({ msgId, entityId, ageSec, name, text: '' });
      break;
    }
    entries.push({ msgId, entityId, ageSec, name, text: reader.utf8(textLength) });
  }
  return { flags, entries };
}

export function encodeChatHistoryRequest(request: ChatHistoryRequest): Uint8Array {
  const writer = new ByteWriter(4);
  writer.u8(OpCode.C2S_CHAT_HISTORY).u16(Math.max(0, request.beforeMsgId)).u8(request.limit);
  return writer.finish();
}

export function decodeChatHistoryRequest(data: Uint8Array): ChatHistoryRequest {
  if (data.byteLength < 4) {
    throw new Error(`chat history request must be 4 bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_CHAT_HISTORY) throw new Error('not a chat history request');
  // 页长由服务端钳制：下行预算是服务端的，不由调用方改大
  return { beforeMsgId: reader.u16(), limit: Math.min(reader.u8(), CHAT_HISTORY_MAX_PAGE) };
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
