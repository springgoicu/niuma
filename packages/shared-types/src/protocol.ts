import { decodeAppearance, encodeAppearance } from './appearance-codec';
import {
  CAREER_FIXED_BYTES,
  CAREER_FIXED_BYTES_LEGACY,
  CAREER_FIXED_BYTES_V2,
  CAREER_FIXED_BYTES_V3,
  CAREER_MAX_BYTES,
  CAREER_MIN_BYTES,
  CAREER_SEGMENT_MAX_BYTES,
  CAREER_VERSION,
  CAREER_VERSION_LEGACY,
  CAREER_VERSION_V2,
  CAREER_VERSION_V3,
  dateToEpochDays,
  epochDaysToDate,
  sanitizeCareer,
  type CareerSummary,
} from './career';
import {
  LIKE_EXTENSION_BYTES,
  LIKE_EXTENSION_MAGIC,
  LIKE_PACKET_BYTES,
  LIKE_REQUEST_BYTES,
  MAX_LIKES,
  type LikePacket,
} from './like';
import { ROLE_EXTENSION_BYTES, ROLE_EXTENSION_MAGIC } from './role';
import {
  APPEARANCE_BYTES,
  CAREER_EXTENSION_MAGIC,
  CHAT_HISTORY_FLAG,
  CHAT_HISTORY_MAX_PAGE,
  CHAT_HISTORY_PACKET_BUDGET,
  CHAT_REJECT_BYTES,
  DEVICE_EXTENSION_BYTES,
  DEVICE_EXTENSION_MAGIC,
  PONG_CLOCK_BYTES,
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
  SESSION_EXTENSION_BYTES,
  SESSION_EXTENSION_MAGIC,
  STATUS_EXTENSION_MAGIC,
  AMBULANCE_PACKET_BYTES,
  BOSS_PACKET_BYTES,
  BOSS_SHOCK_PACKET_BYTES,
  INTERACT_REJECT_BYTES,
  JAIL_PACKET_BYTES,
  PATIENT_PACKET_BYTES,
  SYNC_CAPABILITY_MAGIC,
  SYNC_ENTRY_BYTES,
  SYNC_ENTRY_BYTES_COMPACT,
  SYNC_FORMAT_COMPACT,
  SYNC_FORMAT_LEGACY,
  SYNC_HEADER_BYTES,
  VENT_PACKET_BYTES,
  VENT_PACKET_WITH_FLAGS_BYTES,
  WELCOME_SESSION_BYTES,
  WELCOME_SESSION_MAGIC,
  WORLD_EVENT_PACKET_BYTES,
  type SyncFormat,
} from './constants';
import { bytesToDeviceId, deviceIdToBytes } from './device';
import {
  ECONOMY_EXTENSION_MAGIC,
  ECONOMY_MAX_BYTES,
  ECONOMY_MIN_BYTES,
  MAX_COINS,
  STAT_KEYS,
  clampCoins,
  clampItemCount,
  clampStatLevel,
  emptyEconomyProfile,
  findCosmeticSkuByKey,
  findCosmeticSkuById,
  findItemSku,
  findItemSkuById,
  sanitizeEconomyProfile,
  type EconomyProfile,
  type EconomyStats,
} from './economy';
import {
  P2P_FLAG_SELF_TARGET,
  type ItemEffectPacket,
  type P2PActionRequest,
  type P2PDuelStatePacket,
  type P2PInviteNotifyPacket,
  type P2PInviteRequest,
  type P2PInviteResultPacket,
  type P2PMatchPacket,
  type P2PRespondRequest,
  type P2PShowdownPacket,
  type ShopBuyRequest,
  type TipPacket,
  type TipRequest,
  type UseItemRequest,
} from './challenge';
import {
  PLAYER_EFFECT_FLAG_BLOCKED,
  PLAYER_EFFECT_FLAG_SELF,
  MAX_SHOUT_BYTES,
  MAX_SHOUT_CHARS,
  truncateShout,
  type ItemRejectPacket,
  type LoudspeakerPacket,
  type PlayerEffectPacket,
  type ShoutRejectPacket,
} from './buffs';
import { displayWidth } from './name';
import { DANMAKU_META_BYTES, normalizeDanmakuColor, normalizeDanmakuMode } from './danmaku';
import {
  BOSS_SHOCK,
  QUEST_PROGRESS_MAX,
  WORLD_EVENT,
  type BossShockPacket,
  type EventClaimResult,
  type QuestEntry,
  type QuestStatePacket,
  type WorldEventPacket,
} from './work';
import {
  dequantizeCoord,
  fromSyncCoord,
  packState,
  quantizeCoord,
  toSyncCoord,
  unpackState,
} from './quantize';
import type {
  AmbulancePacket,
  CareerBroadcastPacket,
  CharacterAppearance,
  ChatHistoryEntry,
  ChatHistoryPacket,
  ChatHistoryRequest,
  BossPacket,
  ChatPacket,
  ChatSendPacket,
  JailPacket,
  EntitySnapshot,
  LimitKind,
  MovePacket,
  PatientStatusPacket,
  QueueRejectedPacket,
  QueueStatusPacket,
  ResumeState,
  RingPacket,
  SpawnPacket,
  SystemNoticePacket,
  VentEventPacket,
  WelcomePacket,
  ApartmentPeekPacket,
  ApartmentRequest,
  ArenaBetRequest,
  ArenaPoolPacket,
  DiceBetRequest,
  DiceStatePacket,
  DiceTablePacket,
  InteractRejectPacket,
  VillaRequest,
  VillaStatePacket,
} from './types';
import {
  AMBULANCE_FLAG_CARRYING,
  AMBULANCE_FLAG_SIREN,
  AMBULANCE_STATE,
  BOSS_FLAG_DIED,
  BOSS_FLAG_RESET,
  JAIL_FLAG_SELF,
  JAIL_PHASE,
  OpCode,
  PATIENT_STATE,
  QUEUE_REJECT_REASON,
  RING_VENT_FLAG_ELIMINATED,
  RING_VENT_FLAG_HIT,
} from './types';
import { BOSS_MAX_HP } from './world/boss';
import { RING_CAPACITY, RING_MAX_HP, RING_PHASE } from './world/ring';

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

// ---------------------------------------------------------------------------
// 考勤摘要：HELLO / SPAWN 尾部段与 C2S_CAREER / S2C_CAREER
// ---------------------------------------------------------------------------

/**
 * 考勤摘要 payload（`CAREER_FIXED_BYTES` 为 v4 不含省份的定长部分）：
 *
 * `[version u8][firstJoinDays u16][todayMinutes u16][todayToiletMinutes u16]
 *  [todaySteps u32][todayKnockdown u16][todayVented u16][todayOvertime u16]
 *  [ringGold u16][ringSilver u16][ringBronze u16]
 *  [provinceLen u8][province nB]`
 *
 * 全部小端；日期用距 2000-01-01 的天数，0 表示未上报。
 * 只编码今天：历史累计不再进入协议；v4 解码器仍能解 v3 的 18 字节旧包。
 */
export function encodeCareer(career: CareerSummary): Uint8Array {
  const safe = sanitizeCareer(career);
  const provinceBytes = textEncoder.encode(safe.province);
  const out = new Uint8Array(CAREER_FIXED_BYTES + provinceBytes.length);
  const view = new DataView(out.buffer);
  let at = 0;
  out[at++] = CAREER_VERSION;
  view.setUint16(at, dateToEpochDays(safe.firstJoinDate), true);
  at += 2;
  view.setUint16(at, safe.todayMinutes, true);
  at += 2;
  view.setUint16(at, safe.todayToiletMinutes, true);
  at += 2;
  view.setUint32(at, safe.todaySteps, true);
  at += 4;
  view.setUint16(at, safe.todayKnockdown, true);
  at += 2;
  view.setUint16(at, safe.todayVented, true);
  at += 2;
  view.setUint16(at, safe.todayOvertime, true);
  at += 2;
  view.setUint16(at, safe.ringGold, true);
  at += 2;
  view.setUint16(at, safe.ringSilver, true);
  at += 2;
  view.setUint16(at, safe.ringBronze, true);
  at += 2;
  out[at++] = provinceBytes.length;
  out.set(provinceBytes, at);
  return out;
}

/**
 * 解一条摘要。长度不足、版本不认识、省份长度越界都回退 `undefined`：
 * 展示层据此显示「未上报」，而不是拿 0 冒充真实工时。
 *
 * v1/v2 只映射今日工时：旧包的 steps/counts 是历史累计，绝不能灌进今日字段。
 */
export function decodeCareer(
  data: Uint8Array,
  offset = 0,
  length = data.length - offset,
): CareerSummary | undefined {
  if (
    length < CAREER_MIN_BYTES ||
    length > CAREER_MAX_BYTES ||
    offset < 0 ||
    offset + length > data.length
  ) {
    return undefined;
  }
  const version = data[offset]!;
  if (
    version !== CAREER_VERSION &&
    version !== CAREER_VERSION_V3 &&
    version !== CAREER_VERSION_V2 &&
    version !== CAREER_VERSION_LEGACY
  ) {
    return undefined;
  }
  const fixedBytes =
    version === CAREER_VERSION
      ? CAREER_FIXED_BYTES
      : version === CAREER_VERSION_V3
        ? CAREER_FIXED_BYTES_V3
        : version === CAREER_VERSION_V2
          ? CAREER_FIXED_BYTES_V2
          : CAREER_FIXED_BYTES_LEGACY;
  if (length < fixedBytes) return undefined;

  const view = new DataView(data.buffer, data.byteOffset + offset, length);
  const firstJoinDays = view.getUint16(1, true);

  if (version !== CAREER_VERSION && version !== CAREER_VERSION_V3) {
    const todayMinutes = view.getUint16(9, true);
    const provinceLengthAt = version === CAREER_VERSION_V2 ? 35 : 33;
    const provinceLength = data[offset + provinceLengthAt] ?? 0;
    const provinceAt = offset + provinceLengthAt + 1;
    const available = Math.max(0, offset + length - provinceAt);
    const province =
      provinceLength > 0 && provinceLength <= available
        ? textDecoder.decode(data.subarray(provinceAt, provinceAt + provinceLength))
        : '';
    return sanitizeCareer({
      firstJoinDate: epochDaysToDate(firstJoinDays),
      todayMinutes,
      province,
    });
  }

  const todayMinutes = view.getUint16(3, true);
  const todayToiletMinutes = view.getUint16(5, true);
  const todaySteps = view.getUint32(7, true);
  const todayKnockdown = view.getUint16(11, true);
  const todayVented = view.getUint16(13, true);
  const todayOvertime = view.getUint16(15, true);
  const isV4 = version === CAREER_VERSION;
  const ringGold = isV4 ? view.getUint16(17, true) : 0;
  const ringSilver = isV4 ? view.getUint16(19, true) : 0;
  const ringBronze = isV4 ? view.getUint16(21, true) : 0;

  const provinceLength = data[offset + (isV4 ? 23 : 17)] ?? 0;
  const provinceAt = offset + (isV4 ? 24 : 18);
  const available = Math.max(0, offset + length - provinceAt);
  const province =
    provinceLength > 0 && provinceLength <= available
      ? textDecoder.decode(data.subarray(provinceAt, provinceAt + provinceLength))
      : '';
  return sanitizeCareer({
    firstJoinDate: epochDaysToDate(firstJoinDays),
    todayMinutes,
    todayToiletMinutes,
    todaySteps,
    todayKnockdown,
    todayVented,
    todayOvertime,
    ringGold,
    ringSilver,
    ringBronze,
    province,
  });
}

/** 独立编码一条尾部段：服务端按玩家缓存它，避免 200 人同秒入场时重复编码。 */
export function encodeCareerSegment(career: CareerSummary): Uint8Array {
  const payload = encodeCareer(career);
  const segment = new Uint8Array(2 + payload.length);
  segment[0] = CAREER_EXTENSION_MAGIC;
  segment[1] = payload.length;
  segment.set(payload, 2);
  return segment;
}

/** 写 HELLO / SPAWN 尾部的 `[0xfc][len u8][payload]`；没有摘要时一个字节都不写。 */
export function writeCareerSegment(writer: ByteWriter, career: CareerSummary | undefined): void {
  if (!career) return;
  const payload = encodeCareer(career);
  writer.u8(CAREER_EXTENSION_MAGIC).u8(payload.length).raw(payload);
}

/**
 * career 段在包里的总字节数（魔数 + 长度字节 + payload）。
 * 段不合法返回 0；`readCareerSegment`、后续点赞段与会话段的定位共用这一份校验。
 */
export function careerSegmentSizeAt(data: Uint8Array, offset: number): number {
  if (data.length - offset < 2 || data[offset] !== CAREER_EXTENSION_MAGIC) return 0;
  const length = data[offset + 1]!;
  if (length < CAREER_MIN_BYTES || length > CAREER_MAX_BYTES) return 0;
  if (data.length - offset - 2 < length) return 0;
  return 2 + length;
}

/** 读尾部段；不是 career 段或长度不合法都返回 undefined，不消费调用方的 offset。 */
export function readCareerSegment(data: Uint8Array, offset: number): CareerSummary | undefined {
  const total = careerSegmentSizeAt(data, offset);
  if (total === 0) return undefined;
  return decodeCareer(data, offset + 2, total - 2);
}

/** 经济段载荷：余额 + 四维 + 背包条目（id 升序，便于测试比对字节） */
function encodeEconomyPayload(profile: EconomyProfile): Uint8Array {
  const clean = sanitizeEconomyProfile(profile);
  const entries: Array<{ id: number; count: number }> = [];
  for (const [key, count] of Object.entries(clean.inventory)) {
    const sku = findItemSku(key);
    if (!sku || count <= 0) continue;
    entries.push({ id: sku.id, count: clampItemCount(count) });
  }
  entries.sort((a, b) => a.id - b.id);
  const writer = new ByteWriter(ECONOMY_MIN_BYTES + entries.length * 3);
  writer.u32(clean.coins);
  for (const key of STAT_KEYS) writer.u8(clean.stats[key]);
  writer.u8(entries.length);
  for (const entry of entries) writer.u8(entry.id).u16(entry.count);
  return writer.finish();
}

function decodeEconomyPayload(data: Uint8Array): EconomyProfile | undefined {
  const reader = new ByteReader(data);
  if (reader.remaining < ECONOMY_MIN_BYTES) return undefined;
  const coins = reader.u32();
  const stats: EconomyStats = {
    atkSpeedLv: clampStatLevel(reader.u8()),
    workEffLv: clampStatLevel(reader.u8()),
    critLv: clampStatLevel(reader.u8()),
    armorLv: clampStatLevel(reader.u8()),
  };
  const count = reader.u8();
  if (reader.remaining < count * 3) return undefined;
  const profile = emptyEconomyProfile();
  profile.coins = clampCoins(coins);
  profile.stats = stats;
  for (let i = 0; i < count; i += 1) {
    const sku = findItemSkuById(reader.u8());
    const itemCount = clampItemCount(reader.u16());
    // 未知 id 直接丢，但长度仍按协议吃掉：旧服务端新增的道具不该让整段解崩
    if (sku && itemCount > 0) profile.inventory[sku.key] = itemCount;
  }
  return profile;
}

/** 独立编码一条经济段：`[0xf7][len u8][payload]` */
export function encodeEconomySegment(profile: EconomyProfile): Uint8Array {
  const payload = encodeEconomyPayload(profile);
  const segment = new Uint8Array(2 + payload.length);
  segment[0] = ECONOMY_EXTENSION_MAGIC;
  segment[1] = payload.length;
  segment.set(payload, 2);
  return segment;
}

/** 写 HELLO 尾部的 `[0xf7][len u8][payload]`；没有档案时一个字节都不写。 */
export function writeEconomySegment(writer: ByteWriter, profile: EconomyProfile | undefined): void {
  if (!profile) return;
  const payload = encodeEconomyPayload(profile);
  writer.u8(ECONOMY_EXTENSION_MAGIC).u8(payload.length).raw(payload);
}

/** 经济段在包里的总字节数；魔数不符或长度不自洽返回 0，后续段不会错位。 */
export function economySegmentSizeAt(data: Uint8Array, offset: number): number {
  if (data.length - offset < 2 || data[offset] !== ECONOMY_EXTENSION_MAGIC) return 0;
  const length = data[offset + 1]!;
  if (length < ECONOMY_MIN_BYTES || length > ECONOMY_MAX_BYTES) return 0;
  if (data.length - offset - 2 < length) return 0;
  return 2 + length;
}

/** 读经济段；不是经济段或长度不合法都返回 undefined，不消费调用方的 offset。 */
export function readEconomySegment(
  data: Uint8Array,
  offset: number,
): EconomyProfile | undefined {
  const total = economySegmentSizeAt(data, offset);
  if (total === 0) return undefined;
  return decodeEconomyPayload(data.subarray(offset + 2, offset + total));
}

/** 补报：`[op 0x22][len u8][payload]` */
export function encodeCareerReport(career: CareerSummary): Uint8Array {
  const payload = encodeCareer(career);
  const writer = new ByteWriter(2 + payload.length);
  writer.u8(OpCode.C2S_CAREER).u8(payload.length).raw(payload);
  return writer.finish();
}

/** 补报解码：坏包返回 undefined，服务端静默丢弃。 */
export function decodeCareerReport(data: Uint8Array): CareerSummary | undefined {
  if (data.length < 2 || data[0] !== OpCode.C2S_CAREER) return undefined;
  const length = data[1]!;
  if (length < CAREER_MIN_BYTES || data.length - 2 < length) return undefined;
  return decodeCareer(data, 2, length);
}

/** 广播：`[op 0x23][entityId u16][len u8][payload]` */
export function encodeCareerBroadcast(packet: CareerBroadcastPacket): Uint8Array {
  const payload = encodeCareer(packet.career);
  const writer = new ByteWriter(4 + payload.length);
  writer.u8(OpCode.S2C_CAREER).u16(packet.entityId).u8(payload.length).raw(payload);
  return writer.finish();
}

export function decodeCareerBroadcast(data: Uint8Array): CareerBroadcastPacket | undefined {
  if (data.length < 4 || data[0] !== OpCode.S2C_CAREER) return undefined;
  const entityId = (data[1]! | (data[2]! << 8)) & 0xffff;
  const length = data[3]!;
  if (length < CAREER_MIN_BYTES || data.length - 4 < length) return undefined;
  const career = decodeCareer(data, 4, length);
  return career ? { entityId, career } : undefined;
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
  career?: CareerSummary,
  /** 调用方已缓存的整段（服务端按玩家缓存）；优先级高于 career */
  careerSegment?: Uint8Array,
  /** 工牌点赞数（ADR-0057）：只写 > 0 的 3 字节尾段 */
  likes?: number,
  /** 实体角色（0 普通 / 1 保安）：只有保安才写 2 字节尾段 */
  role?: number,
): void {
  writer.u8(OpCode.S2C_ENTITY_SPAWN).u16(id).u16(x).u16(y).u8(state).raw(body);
  // 在线秒数每秒变化，不能进 spawnBody 缓存；只有调用方现算时才追加这一段
  if (onlineSec !== undefined) writer.u8(ONLINE_EXTENSION_MAGIC).u32(onlineSec);
  if (careerSegment) writer.raw(careerSegment);
  else writeCareerSegment(writer, career);
  writeLikeSegment(writer, likes);
  writeRoleSegment(writer, role);
}

export function encodeSpawn(packet: SpawnPacket): Uint8Array {
  const body = buildSpawnBody(packet.name, packet.appearance, packet.status);
  const writer = new ByteWriter(
    6 +
      body.length +
      ONLINE_EXTENSION_BYTES +
      CAREER_SEGMENT_MAX_BYTES +
      LIKE_EXTENSION_BYTES +
      ROLE_EXTENSION_BYTES,
  );
  encodeSpawnInto(
    writer,
    packet.id,
    packet.x,
    packet.y,
    packet.state,
    body,
    packet.onlineSec,
    packet.career,
    undefined,
    packet.likes,
    packet.role,
  );
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
  // 0xfe / 0xfc / 0xfb / 0xfd 是尾部扩展段的魔数，不是状态长度，必须先排除再按长度读状态。
  let status = '';
  if (
    reader.remaining >= 1 &&
    data[reader.offset] !== ONLINE_EXTENSION_MAGIC &&
    data[reader.offset] !== CAREER_EXTENSION_MAGIC &&
    data[reader.offset] !== LIKE_EXTENSION_MAGIC &&
    data[reader.offset] !== ROLE_EXTENSION_MAGIC
  ) {
    const statusLength = reader.u8();
    // 长度字段与剩余字节不符说明包被截断或伪造：丢掉状态而不是猜半个字符
    status = statusLength <= reader.remaining ? truncateStatus(reader.utf8(statusLength)) : '';
  }
  // 在线秒数段：旧服务端没有这 5 字节，按 undefined 回退「首次看到起算」
  let onlineSec: number | undefined;
  if (reader.remaining >= ONLINE_EXTENSION_BYTES && data[reader.offset] === ONLINE_EXTENSION_MAGIC) {
    reader.u8();
    onlineSec = reader.u32();
  }
  // 考勤摘要段：旧服务端没有这一段，按 undefined 显示「未上报」
  const careerOffset = reader.offset;
  const career = readCareerSegment(data, careerOffset);
  // 点赞段：只有 likes > 0 才写；旧服务端没有这一段时按 0 展示。
  // `readCareerSegment` 不消费 offset，这里显式跳过 career 段再定位 0xfb。
  const likeOffset = careerOffset + careerSegmentSizeAt(data, careerOffset);
  const likes = readLikeSegment(data, likeOffset);
  // 角色段追加在 likes 之后：旧客户端读到 0xfd 会当作非法状态长度并忽略尾段
  const role = readRoleSegment(data, likeOffset + (likes !== undefined ? LIKE_EXTENSION_BYTES : 0));
  const packet: SpawnPacket = { id, x, y, state, name, appearance, status };
  if (onlineSec !== undefined) packet.onlineSec = onlineSec;
  if (career) packet.career = career;
  if (likes !== undefined) packet.likes = likes;
  if (role !== undefined) packet.role = role;
  return packet;
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

// ---------------------------------------------------------------------------
// 工牌点赞（ADR-0057）：查询、广播与 spawn 尾段
// ---------------------------------------------------------------------------

/** 点赞查询：`[op][targetId u16]`；targetId=0 或长度不符返回 undefined。 */
export function encodeLikeRequest(targetId: number): Uint8Array {
  const writer = new ByteWriter(LIKE_REQUEST_BYTES);
  writer.u8(OpCode.C2S_LIKE).u16(targetId & 0xffff);
  return writer.finish();
}

export function decodeLikeRequest(data: Uint8Array): number | undefined {
  if (data.length !== LIKE_REQUEST_BYTES || data[0] !== OpCode.C2S_LIKE) return undefined;
  const targetId = data[1]! | (data[2]! << 8);
  return targetId === 0 ? undefined : targetId;
}

/** 点赞广播：`[op][targetId u16][likes u16][flags u8]` */
export function encodeLike(targetId: number, likes: number, flags: number): Uint8Array {
  const writer = new ByteWriter(LIKE_PACKET_BYTES);
  const safeLikes = Number.isFinite(likes) ? Math.min(MAX_LIKES, Math.max(0, Math.floor(likes))) : 0;
  writer.u8(OpCode.S2C_LIKE).u16(targetId & 0xffff).u16(safeLikes).u8(flags & 0xff);
  return writer.finish();
}

export function decodeLike(data: Uint8Array): LikePacket | undefined {
  if (data.length !== LIKE_PACKET_BYTES || data[0] !== OpCode.S2C_LIKE) return undefined;
  return {
    targetId: data[1]! | (data[2]! << 8),
    likes: data[3]! | (data[4]! << 8),
    flags: data[5]!,
  };
}

/** spawn 尾段：`[0xfb][likes u16]`；0 赞一个字节都不写，旧包体不变。 */
export function writeLikeSegment(writer: ByteWriter, likes: number | undefined): void {
  if (likes === undefined || !Number.isFinite(likes) || likes <= 0) return;
  writer.u8(LIKE_EXTENSION_MAGIC).u16(Math.min(MAX_LIKES, Math.floor(likes)));
}

/** 读 spawn 尾段；不是点赞段或长度不足返回 undefined，不消费调用方 offset。 */
export function readLikeSegment(data: Uint8Array, offset: number): number | undefined {
  if (data.length - offset < LIKE_EXTENSION_BYTES || data[offset] !== LIKE_EXTENSION_MAGIC) {
    return undefined;
  }
  return data[offset + 1]! | (data[offset + 2]! << 8);
}

/** spawn 尾段：`[0xfd][role u8]`；普通角色一个字节都不写，旧包体不变。 */
export function writeRoleSegment(writer: ByteWriter, role: number | undefined): void {
  if (role === undefined || !Number.isFinite(role) || role <= 0) return;
  writer.u8(ROLE_EXTENSION_MAGIC).u8(Math.min(0xff, Math.floor(role)));
}

/** 读 spawn 尾段；不是角色段或长度不足返回 undefined，不消费调用方 offset。 */
export function readRoleSegment(data: Uint8Array, offset: number): number | undefined {
  if (data.length - offset < ROLE_EXTENSION_BYTES || data[offset] !== ROLE_EXTENSION_MAGIC) {
    return undefined;
  }
  return data[offset + 1]!;
}

/**
 * 发泄结算：`[op][attackerId u16][targetId u16][x u16][y u16]`，9 字节定长。
 *
 * 一次性事件通道，不属于 20Hz 同步包，只补 Tick 表达不了的两件事：
 * 「谁打到谁」让旁观者能把倒地归因到具体的人（音效、台词、镜头都有对象），
 * 「受害者坐标」让对方越过 128px 的本地和解阈值，直接贴到服务端算出的落点上。
 *
 * 擂台命中在末尾追加 `flags u8`：bit0 = 擂台命中，bit1 = 目标淘汰。
 * 普通发泄仍写 9 字节，旧客户端读到 9 字节时天然不认识这一位。
 */
export function encodeVent(
  attackerId: number,
  targetId: number,
  x: number,
  y: number,
  flags = 0,
): Uint8Array {
  const size = flags === 0 ? VENT_PACKET_BYTES : VENT_PACKET_WITH_FLAGS_BYTES;
  const writer = new ByteWriter(size);
  writer.u8(OpCode.S2C_VENT).u16(attackerId).u16(targetId).u16(x).u16(y);
  if (flags !== 0) writer.u8(flags);
  return writer.finish();
}

export function decodeVent(data: Uint8Array): VentEventPacket {
  if (data.byteLength !== VENT_PACKET_BYTES && data.byteLength !== VENT_PACKET_WITH_FLAGS_BYTES) {
    throw new Error(
      `vent packet must be ${VENT_PACKET_BYTES} or ${VENT_PACKET_WITH_FLAGS_BYTES} bytes, got ${data.byteLength}`,
    );
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_VENT) throw new Error('not a vent packet');
  const attackerId = reader.u16();
  const targetId = reader.u16();
  // 坐标保持量化口径：调用方用 dequantizeCoord 还原成世界像素，与移动包同一把尺子
  const x = reader.u16();
  const y = reader.u16();
  if (reader.remaining === 0) return { attackerId, targetId, x, y };
  const flags = reader.u8();
  return {
    attackerId,
    targetId,
    x,
    y,
    ringHit: (flags & RING_VENT_FLAG_HIT) !== 0,
    eliminated: (flags & RING_VENT_FLAG_ELIMINATED) !== 0,
  };
}

/**
 * 老板血量：`[op][hp u16][attackerId u16][flags u8]`，6 字节定长。
 *
 * 只传变化量，不传坐标：老板是静态地标，位置由 shared-types 常量固定。
 * flags 只编码两个一次性事件，其余位留给未来且被解码端忽略。
 */
export function encodeBoss(packet: BossPacket): Uint8Array {
  const flags = (packet.died ? BOSS_FLAG_DIED : 0) | (packet.reset ? BOSS_FLAG_RESET : 0);
  const writer = new ByteWriter(BOSS_PACKET_BYTES);
  writer.u8(OpCode.S2C_BOSS).u16(packet.hp).u16(packet.attackerId).u8(flags);
  return writer.finish();
}

export function decodeBoss(data: Uint8Array): BossPacket {
  if (data.byteLength !== BOSS_PACKET_BYTES) {
    throw new Error(`boss packet must be ${BOSS_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_BOSS) throw new Error('not a boss packet');
  // 服务端只会写 0..10000；解码端仍夹一次，坏包不至于把血条画成负数或超长
  const hp = Math.min(reader.u16(), BOSS_MAX_HP);
  const attackerId = reader.u16();
  const flags = reader.u8();
  return {
    hp,
    attackerId,
    died: (flags & BOSS_FLAG_DIED) !== 0,
    reset: (flags & BOSS_FLAG_RESET) !== 0,
  };
}

/**
 * 小黑屋处置：`[op][entityId u16][phase u8][flags u8][seconds u16][guardId u16]`，9 字节定长。
 *
 * 只表达「谁、到了哪个阶段、跟着哪个保安」，不传坐标：押送位移继续走 20Hz Tick，
 * 避免为一次执法事件新开一条高频包。`seconds` 字段保留，当前恒为 0（无禁足时长）。
 */
export function encodeJail(packet: JailPacket): Uint8Array {
  if (packet.phase < JAIL_PHASE.Warn || packet.phase > JAIL_PHASE.Released) {
    throw new Error(`jail phase out of range: ${packet.phase}`);
  }
  const flags = packet.self ? JAIL_FLAG_SELF : 0;
  const writer = new ByteWriter(JAIL_PACKET_BYTES);
  writer
    .u8(OpCode.S2C_JAIL)
    .u16(Math.max(0, Math.min(0xffff, packet.entityId)))
    .u8(packet.phase)
    .u8(flags)
    .u16(Math.max(0, Math.min(0xffff, packet.seconds)))
    .u16(Math.max(0, Math.min(0xffff, packet.guardId)));
  return writer.finish();
}

export function decodeJail(data: Uint8Array): JailPacket {
  if (data.byteLength !== JAIL_PACKET_BYTES) {
    throw new Error(`jail packet must be ${JAIL_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_JAIL) throw new Error('not a jail packet');
  const entityId = reader.u16();
  const phase = reader.u8();
  if (phase < JAIL_PHASE.Warn || phase > JAIL_PHASE.Released) {
    throw new Error(`jail phase out of range: ${phase}`);
  }
  const flags = reader.u8();
  const seconds = reader.u16();
  const guardId = reader.u16();
  return { entityId, phase, self: (flags & JAIL_FLAG_SELF) !== 0, seconds, guardId };
}

/**
 * 救护车同步：`[op][id u8][state u8][x u16][y u16][flags u8]`，8 字节定长。
 *
 * 坐标与 Tick 同一把量化尺子；警灯与载员走 flags，不新增字段。
 * 停靠静止时的去脏由发送端负责（ADR-0043）。
 */
export function encodeAmbulance(packet: AmbulancePacket): Uint8Array {
  if (packet.id < 0 || packet.id > 0xff) throw new Error(`ambulance id out of range: ${packet.id}`);
  if (
    packet.state !== AMBULANCE_STATE.Idle &&
    packet.state !== AMBULANCE_STATE.Dispatched &&
    packet.state !== AMBULANCE_STATE.Transporting &&
    packet.state !== AMBULANCE_STATE.Returning
  ) {
    throw new Error(`ambulance state out of range: ${packet.state}`);
  }
  const flags =
    (packet.flags & AMBULANCE_FLAG_SIREN ? AMBULANCE_FLAG_SIREN : 0) |
    (packet.flags & AMBULANCE_FLAG_CARRYING ? AMBULANCE_FLAG_CARRYING : 0);
  const writer = new ByteWriter(AMBULANCE_PACKET_BYTES);
  writer
    .u8(OpCode.S2C_AMBULANCE)
    .u8(packet.id)
    .u8(packet.state)
    .u16(quantizeCoord(packet.x))
    .u16(quantizeCoord(packet.y))
    .u8(flags);
  return writer.finish();
}

export function decodeAmbulance(data: Uint8Array): AmbulancePacket {
  if (data.byteLength !== AMBULANCE_PACKET_BYTES) {
    throw new Error(`ambulance packet must be ${AMBULANCE_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_AMBULANCE) throw new Error('not an ambulance packet');
  const id = reader.u8();
  const state = reader.u8();
  if (state > AMBULANCE_STATE.Returning) throw new Error(`ambulance state out of range: ${state}`);
  const x = dequantizeCoord(reader.u16());
  const y = dequantizeCoord(reader.u16());
  const flags = reader.u8();
  return { id, state: state as AmbulancePacket['state'], x, y, flags };
}

/** 伤员状态：`[op][entityId u16][state u8][seconds u16]`，6 字节定长。 */
export function encodePatientStatus(packet: PatientStatusPacket): Uint8Array {
  if (
    packet.state !== PATIENT_STATE.None &&
    packet.state !== PATIENT_STATE.Incapacitated &&
    packet.state !== PATIENT_STATE.Treating &&
    packet.state !== PATIENT_STATE.Shielded
  ) {
    throw new Error(`patient state out of range: ${packet.state}`);
  }
  const writer = new ByteWriter(PATIENT_PACKET_BYTES);
  writer
    .u8(OpCode.S2C_PATIENT)
    .u16(Math.max(0, Math.min(0xffff, packet.entityId)))
    .u8(packet.state)
    .u16(Math.max(0, Math.min(0xffff, Math.round(packet.seconds))));
  return writer.finish();
}

export function decodePatientStatus(data: Uint8Array): PatientStatusPacket {
  if (data.byteLength !== PATIENT_PACKET_BYTES) {
    throw new Error(`patient packet must be ${PATIENT_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_PATIENT) throw new Error('not a patient packet');
  const entityId = reader.u16();
  const state = reader.u8();
  if (state > PATIENT_STATE.Shielded) throw new Error(`patient state out of range: ${state}`);
  const seconds = reader.u16();
  return { entityId, state: state as PatientStatusPacket['state'], seconds };
}

/** 报名/取消都是单字节 opcode，服务端用靠近与阶段做二次裁决。 */
export function encodeRingEnter(): Uint8Array {
  return Uint8Array.of(OpCode.C2S_RING_ENTER);
}

export function encodeRingLeave(): Uint8Array {
  return Uint8Array.of(OpCode.C2S_RING_LEAVE);
}

/** 擂台包头部：op(1) + phase(1) + matchId(2) + remainingMs(4) + count(1) */
const RING_HEADER_BYTES = 9;
/** 每个席位定长部分：id(2) + slot(1) + hp(1) + flags(1) + rank(1) + nameLen(1) */
const RING_MEMBER_FIXED_BYTES = 7;

/**
 * 擂台快照：`[op][phase u8][matchId u16][remainingMs u32][count u8]`
 * + count × `[id u16][slot u8][hp u8][flags u8][rank u8][nameLen u8][name utf8]`。
 *
 * 名字直接随包下发，避免 HUD 还要去实体名字表里查已经离场的参赛者；
 * 名字已按昵称协议截断，最多 3 个席位，包长有硬上限。
 */
export function encodeRing(packet: RingPacket): Uint8Array {
  if (packet.members.length > RING_CAPACITY) {
    throw new Error(`ring packet supports ${RING_CAPACITY} members, got ${packet.members.length}`);
  }
  const names = packet.members.map((member) => truncateName(member.name));
  let size = RING_HEADER_BYTES;
  for (const name of names) size += RING_MEMBER_FIXED_BYTES + textEncoder.encode(name).length;
  const writer = new ByteWriter(size);
  writer
    .u8(OpCode.S2C_RING)
    .u8(packet.phase)
    .u16(packet.matchId)
    .u32(Math.max(0, packet.remainingMs))
    .u8(packet.members.length);
  packet.members.forEach((member, index) => {
    const name = names[index]!;
    const flags = member.eliminated ? 1 : 0;
    writer
      .u16(member.id)
      .u8(Math.min(Math.max(0, member.slot ?? index), RING_CAPACITY - 1))
      .u8(Math.min(member.hp, RING_MAX_HP))
      .u8(flags)
      .u8(member.rank)
      .u8(textEncoder.encode(name).length)
      .raw(textEncoder.encode(name));
  });
  return writer.finish();
}

export function decodeRing(data: Uint8Array): RingPacket {
  if (data.byteLength < RING_HEADER_BYTES) {
    throw new Error(`ring packet too short: ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_RING) throw new Error('not a ring packet');
  const phase = reader.u8();
  if (phase > RING_PHASE.Award) throw new Error(`ring phase out of range: ${phase}`);
  const matchId = reader.u16();
  const remainingMs = reader.u32();
  const count = reader.u8();
  if (count > RING_CAPACITY) throw new Error(`ring member count out of range: ${count}`);
  const members: RingPacket['members'] = [];
  for (let i = 0; i < count; i += 1) {
    if (reader.remaining < RING_MEMBER_FIXED_BYTES) throw new Error('ring member truncated');
    const id = reader.u16();
    const slot = reader.u8();
    if (slot >= RING_CAPACITY) throw new Error(`ring slot out of range: ${slot}`);
    const hp = Math.min(reader.u8(), RING_MAX_HP);
    const flags = reader.u8();
    const rank = reader.u8();
    const nameLength = reader.u8();
    if (nameLength > MAX_NAME_BYTES || nameLength > reader.remaining) {
      throw new Error(`ring name length out of range: ${nameLength}`);
    }
    members.push({
      id,
      slot,
      name: reader.utf8(nameLength),
      hp,
      eliminated: (flags & 1) !== 0,
      rank,
    });
  }
  if (reader.remaining !== 0) throw new Error(`ring packet has ${reader.remaining} trailing bytes`);
  return {
    phase: phase as RingPacket['phase'],
    matchId,
    remainingMs,
    members,
  };
}

/**
 * 聊天包布局（ADR-0056）：文本前先写 2 字节弹幕元数据。
 *
 * `C2S_CHAT`             = `[op u8][colorIndex u8][danmakuMode u8][len u16][utf8]`
 * `S2C_CHAT_BROADCAST`   = `[op u8][entityId u16][msgId u16][colorIndex u8][danmakuMode u8][len u16][utf8]`
 *
 * 这是一次有意破坏兼容的硬切：旧客户端会把 colorIndex 读成长度高字节。
 * 发布保障是构建版本强制刷新（ADR-0050），不做双格式分支。
 */
const CHAT_SEND_FIXED_BYTES = 3 + DANMAKU_META_BYTES;
const CHAT_BROADCAST_FIXED_BYTES = 7 + DANMAKU_META_BYTES;

export function encodeChatBroadcast(packet: ChatPacket): Uint8Array {
  const bytes = textEncoder.encode(packet.text);
  const writer = new ByteWriter(CHAT_BROADCAST_FIXED_BYTES + bytes.length);
  writer
    .u8(OpCode.S2C_CHAT_BROADCAST)
    .u16(packet.entityId)
    .u16(packet.msgId)
    // 编码端也归一化：服务端已经把值钳过一遍，这里防的是自造包与浮点残留
    .u8(normalizeDanmakuColor(packet.colorIndex))
    .u8(normalizeDanmakuMode(packet.danmakuMode))
    .u16(bytes.length)
    .raw(bytes);
  return writer.finish();
}

export function decodeChatBroadcast(data: Uint8Array): ChatPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_CHAT_BROADCAST) throw new Error('not a chat packet');
  const entityId = reader.u16();
  const msgId = reader.u16();
  const colorIndex = normalizeDanmakuColor(reader.u8());
  const danmakuMode = normalizeDanmakuMode(reader.u8());
  const length = reader.u16();
  return { entityId, msgId, colorIndex, danmakuMode, text: reader.utf8(length) };
}

export function encodeChatSend(packet: ChatSendPacket): Uint8Array {
  const bytes = textEncoder.encode(packet.text);
  const writer = new ByteWriter(CHAT_SEND_FIXED_BYTES + bytes.length);
  writer
    .u8(OpCode.C2S_CHAT)
    .u8(normalizeDanmakuColor(packet.colorIndex))
    .u8(normalizeDanmakuMode(packet.danmakuMode))
    .u16(bytes.length)
    .raw(bytes);
  return writer.finish();
}

export function decodeChatSend(data: Uint8Array): ChatSendPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_CHAT) throw new Error('not a chat send packet');
  const colorIndex = normalizeDanmakuColor(reader.u8());
  const danmakuMode = normalizeDanmakuMode(reader.u8());
  const length = reader.u16();
  return { colorIndex, danmakuMode, text: reader.utf8(length) };
}

/**
 * 会话续算段是否要写：0 表示「新的一次进园」，一个字节都不写。
 * 旧客户端永远不写这一段，旧服务端也不会读到它（段追加在最后）。
 */
function hasSessionCarry(sessionSec: number | undefined): sessionSec is number {
  return typeof sessionSec === 'number' && Number.isFinite(sessionSec) && sessionSec >= 1;
}

export function encodeHello(
  name: string,
  appearance: CharacterAppearance,
  resume?: ResumeState,
  status?: string,
  syncFormat: SyncFormat = SYNC_FORMAT_LEGACY,
  career?: CareerSummary,
  sessionSec?: number,
  deviceId?: string,
  economy?: EconomyProfile,
): Uint8Array {
  const nameBytes = textEncoder.encode(truncateName(name));
  const statusBytes = textEncoder.encode(truncateStatus(status));
  // 状态段只在真的有内容时写：空状态的 HELLO 与旧版逐字节相同
  const statusSize = statusBytes.length > 0 ? 2 + statusBytes.length : 0;
  // 不声明紧凑格式就不写能力段：旧服务端与旧客户端看到的帧长完全不变
  const capabilitySize = syncFormat === SYNC_FORMAT_COMPACT ? 2 : 0;
  const carry = hasSessionCarry(sessionSec);
  const deviceBytes = deviceIdToBytes(deviceId);
  const writer = new ByteWriter(
    2 +
      nameBytes.length +
      APPEARANCE_BYTES +
      (resume ? RESUME_BYTES : 0) +
      statusSize +
      capabilitySize +
      (career ? CAREER_SEGMENT_MAX_BYTES : 0) +
      (carry ? SESSION_EXTENSION_BYTES : 0) +
      (deviceBytes ? DEVICE_EXTENSION_BYTES : 0) +
      (economy ? 2 + ECONOMY_MAX_BYTES : 0),
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
  // 考勤摘要永远追加在最后：旧服务端读完能力段就停止，天然忽略
  writeCareerSegment(writer, career);
  // 会话续算段排在最后（ADR-0060）：旧服务端读完 career 段就停，看不到这 5 字节
  if (carry) writer.u8(SESSION_EXTENSION_MAGIC).u32(Math.floor(sessionSec));
  // 设备号段再排在会话段之后（ADR-0081）：旧服务端读到 0xf8 也只会忽略尾字节
  if (deviceBytes) writer.u8(DEVICE_EXTENSION_MAGIC).raw(deviceBytes);
  // 经济摘要永远排在最后（ADR-0082）：旧服务端读完设备段就停，天然忽略
  writeEconomySegment(writer, economy);
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
  /** 考勤摘要；旧客户端整段缺席时为 undefined */
  career?: CareerSummary;
  /** 断线前已在线秒数；旧客户端整段缺席时为 0（按新一次进园处理） */
  sessionSec: number;
  /** 进园资产摘要；旧客户端整段缺席时为 undefined（服务端按零资产处理） */
  economy?: EconomyProfile;
  /** 匿名设备号；段缺席时为空串 */
  deviceId: string;
} {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_HELLO) throw new Error('not a hello packet');
  const nameLength = reader.u8();
  const name = truncateName(reader.utf8(nameLength));
  const appearance = decodeAppearance(data, reader.offset);
  reader.offset += APPEARANCE_BYTES;

  let resume: ResumeState | undefined;
  // 状态 / 能力 / 考勤摘要段的魔数都不是 resume 版本号：先排除，免得把尾部读成落点
  if (
    reader.remaining >= RESUME_BYTES &&
    data[reader.offset] !== STATUS_EXTENSION_MAGIC &&
    data[reader.offset] !== SYNC_CAPABILITY_MAGIC &&
    data[reader.offset] !== CAREER_EXTENSION_MAGIC &&
    data[reader.offset] !== SESSION_EXTENSION_MAGIC &&
    data[reader.offset] !== DEVICE_EXTENSION_MAGIC &&
    data[reader.offset] !== ECONOMY_EXTENSION_MAGIC
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
  const careerAt = reader.offset;
  const career = readCareerSegment(data, careerAt);
  const sessionAt = careerAt + careerSegmentSizeAt(data, careerAt);
  const sessionSec = readSessionSegment(data, sessionAt);
  // 设备号段排在会话段之后（ADR-0081）：会话段缺席时也从同一位置开始窥视
  const deviceAt = sessionAt + sessionSegmentSizeAt(data, sessionAt);
  const deviceId = readDeviceSegment(data, deviceAt);
  // 段长按魔数与字节数判断，不看解析结果：设备号写成非法 hex 也要跳过这一段，
  // 否则后面的经济段会被当成设备段读，整段丢失
  const deviceSize =
    data.length - deviceAt >= DEVICE_EXTENSION_BYTES && data[deviceAt] === DEVICE_EXTENSION_MAGIC
      ? DEVICE_EXTENSION_BYTES
      : 0;
  // 经济段再排在设备段之后（ADR-0082）：缺席时整段为空，旧客户端不受影响
  const economy = readEconomySegment(data, deviceAt + deviceSize);
  const hello: {
    name: string;
    appearance: CharacterAppearance;
    resume?: ResumeState;
    status: string;
    syncFormat: SyncFormat;
    career?: CareerSummary;
    sessionSec: number;
    deviceId: string;
    economy?: EconomyProfile;
  } = { name, appearance, resume, status, syncFormat, sessionSec, deviceId };
  if (career) hello.career = career;
  if (economy) hello.economy = economy;
  return hello;
}

/** HELLO 尾段：`[0xfa][sec u32]`；缺席或截断一律回落到 0，不读包外字节。 */
function readSessionSegment(data: Uint8Array, offset: number): number {
  if (data.length - offset < SESSION_EXTENSION_BYTES || data[offset] !== SESSION_EXTENSION_MAGIC) {
    return 0;
  }
  return (
    (data[offset + 1]! | (data[offset + 2]! << 8) | (data[offset + 3]! << 16) | (data[offset + 4]! << 24)) >>>
    0
  );
}

/** 会话段真实占用的字节数：魔数与长度缺一都按「无此段」处理，后面的设备段才不会错位 */
function sessionSegmentSizeAt(data: Uint8Array, offset: number): number {
  if (data.length - offset < SESSION_EXTENSION_BYTES || data[offset] !== SESSION_EXTENSION_MAGIC) {
    return 0;
  }
  return SESSION_EXTENSION_BYTES;
}

/** HELLO 尾段：`[0xf8][deviceId 8B]`；缺席、截断或字节不足一律回落到空串（匿名新设备）。 */
function readDeviceSegment(data: Uint8Array, offset: number): string {
  if (data.length - offset < DEVICE_EXTENSION_BYTES || data[offset] !== DEVICE_EXTENSION_MAGIC) {
    return '';
  }
  return bytesToDeviceId(data.subarray(offset + 1, offset + DEVICE_EXTENSION_BYTES)) ?? '';
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
  // 会话续算回显排在格式字节之后（ADR-0060）：旧客户端先读到格式字节，
  // 既不会把会话段当成格式，也不会因为多出 5 字节而错位。
  const sessionSec = packet.sessionSec;
  if (typeof sessionSec === 'number' && Number.isFinite(sessionSec) && sessionSec >= 1) {
    writer.u8(WELCOME_SESSION_MAGIC).u32(Math.floor(sessionSec));
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
  // 旧格式不写这一段：包体与旧服务端逐字节相同，消费方的对象形状也不变。
  // 必须先窥视再消费：会话段（0xf9）就排在它后面，旧写法 `u8()` 会把魔数吃掉。
  if (reader.remaining >= 1 && data[reader.offset] === SYNC_FORMAT_COMPACT) {
    reader.u8();
    packet.syncFormat = SYNC_FORMAT_COMPACT;
  }
  if (reader.remaining >= WELCOME_SESSION_BYTES && data[reader.offset] === WELCOME_SESSION_MAGIC) {
    reader.u8();
    const sessionSec = reader.u32();
    if (sessionSec > 0) packet.sessionSec = sessionSec;
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

/** 服务器时钟样本：秒级 epoch + 园区时区偏移（分钟，东八区 = 480） */
export interface ServerClockStamp {
  serverSec: number;
  tzOffsetMin: number;
}

/**
 * PONG = `[op][timestamp u32]`，可选尾段 `[serverSec u32][tzOffsetMin i16]`。
 *
 * 时钟段不新增 opcode：心跳本身就是 1Hz，客户端拿到的每个 pong 都是一次对时样本。
 * 没有这一段（旧服务端）时包体与旧版逐字节相同，旧客户端读完 timestamp 就停。
 */
export function encodePong(timestamp: number, clock?: ServerClockStamp): Uint8Array {
  const writer = new ByteWriter(clock ? 5 + PONG_CLOCK_BYTES : 5);
  writer.u8(OpCode.S2C_PONG).u32(timestamp);
  if (clock) {
    const sec = Math.max(0, Math.floor(clock.serverSec)) >>> 0;
    // i16 用补码写：ByteWriter 只有 u16，负偏移要手动加回 65536 再落字节
    const minutes = Math.max(-32_768, Math.min(32_767, Math.floor(clock.tzOffsetMin)));
    writer.u32(sec).u16(minutes < 0 ? minutes + 0x1_0000 : minutes);
  }
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

/**
 * 读 PONG 的时钟尾段；旧服务端的 5 字节包返回 undefined（调用方按「未对时」处理）。
 * `timestamp` 仍按 `decodePong` 的口径读出来，避免调用方解两次包。
 */
export function decodePongClock(data: Uint8Array): (ServerClockStamp & { timestamp: number }) | undefined {
  if (data.length < 5 + PONG_CLOCK_BYTES || data[0] !== OpCode.S2C_PONG) return undefined;
  const timestamp =
    (data[1]! | (data[2]! << 8) | (data[3]! << 16) | (data[4]! << 24)) >>> 0;
  const serverSec = (data[5]! | (data[6]! << 8) | (data[7]! << 16) | (data[8]! << 24)) >>> 0;
  const rawTz = data[9]! | (data[10]! << 8);
  const tzOffsetMin = rawTz > 0x7fff ? rawTz - 0x1_0000 : rawTz;
  return { timestamp, serverSec, tzOffsetMin };
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
 * 改工牌名：`[op][len u16][utf8]`，与状态包同构。
 *
 * 空名是合法输入（表单会拦，但伪造包可能发来），服务端据此保留原名而不是改名成空。
 * 上限与入场同一把尺子（16 字符 / 48 字节），超长部分直接丢。
 */
export function encodeSetName(name: string): Uint8Array {
  // 空名不进包：`truncateName('')` 会换成兜底工牌名，那等于「改名成默认名」，
  // 服务端收到的空串才表示「这次不改名」。
  const bytes = textEncoder.encode(name.trim().length > 0 ? truncateName(name) : '');
  const writer = new ByteWriter(3 + bytes.length);
  writer.u8(OpCode.C2S_SET_NAME).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeSetName(data: Uint8Array): string {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_SET_NAME) throw new Error('not a set name packet');
  const length = reader.u16();
  // 空名与越界长度都按「不改名」处理：绝不能交给 `truncateName`，
  // 它会把空串换成兜底工牌名，等于替玩家改成了默认名。
  if (length === 0 || length > reader.remaining) return '';
  return truncateName(reader.utf8(length));
}

export function encodeNameBroadcast(entityId: number, name: string): Uint8Array {
  // 与 `encodeSetName` 同理：空名必须编码成零长度，不能借 `truncateName` 变成兜底名
  const bytes = textEncoder.encode(name.trim().length > 0 ? truncateName(name) : '');
  const writer = new ByteWriter(5 + bytes.length);
  writer.u8(OpCode.S2C_NAME).u16(entityId).u16(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeNameBroadcast(data: Uint8Array): { entityId: number; name: string } {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_NAME) throw new Error('not a name broadcast');
  const entityId = reader.u16();
  const length = reader.u16();
  // 空名对客户端没有意义：返回空串让调用方保留旧名字。
  // 不能走 `truncateName`——它会把空串换成兜底名，于是整片园区都叫「无名牛马」。
  if (length === 0 || length > reader.remaining) return { entityId, name: '' };
  return { entityId, name: truncateName(reader.utf8(length)) };
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

// ---------------------------------------------------------------------------
// 牛马币钱包（ADR-0082 / ADR-0104）：`[0x38][coins u32][4×stats u8][reason u8][count u8]`
// + count × `[itemId u8][count u16]` + 可选装扮段 `[cosmeticCount u8][cosmeticId u8]×N`。
// 完整背包快照而不是增量：幂等，也不需要合并逻辑。
// ADR-0098：房屋等级字节随户型下线一起去掉（此前是 `[houseTier u8][reason u8]`）。
// ADR-0104：尾段带服务端账本里的已解锁装扮；旧客户端读完背包就停，忽略尾段。
// ---------------------------------------------------------------------------

export interface WalletSyncPacket {
  coins: number;
  stats: EconomyStats;
  reason: number;
  inventory: Record<string, number>;
  /**
   * 已解锁装扮的 key 清单。
   *
   * `undefined` 表示这条包没有装扮段（旧服务端 / 旧测试包），客户端保持本地值；
   * 空数组表示服务端确认「一件也没有」，客户端应清空本地。
   */
  unlockedCosmetics?: string[];
}

export function encodeWalletSync(packet: WalletSyncPacket): Uint8Array {
  const clean = sanitizeEconomyProfile({
    coins: packet.coins,
    stats: packet.stats,
    inventory: packet.inventory,
    unlockedCosmetics: packet.unlockedCosmetics,
  });
  const entries: Array<{ id: number; count: number }> = [];
  for (const [key, count] of Object.entries(clean.inventory)) {
    const sku = findItemSku(key);
    if (sku && count > 0) entries.push({ id: sku.id, count: clampItemCount(count) });
  }
  entries.sort((a, b) => a.id - b.id);
  const cosmetics: number[] = [];
  if (packet.unlockedCosmetics !== undefined) {
    for (const key of clean.unlockedCosmetics) {
      const sku = findCosmeticSkuByKey(key);
      if (sku) cosmetics.push(sku.id);
    }
    cosmetics.sort((a, b) => a - b);
  }
  const writer = new ByteWriter(11 + entries.length * 3 + (packet.unlockedCosmetics !== undefined ? 1 + cosmetics.length : 0));
  writer.u8(OpCode.S2C_WALLET_SYNC).u32(clean.coins);
  for (const key of STAT_KEYS) writer.u8(clean.stats[key]);
  writer.u8(packet.reason & 0xff).u8(entries.length);
  for (const entry of entries) writer.u8(entry.id).u16(entry.count);
  if (packet.unlockedCosmetics !== undefined) {
    writer.u8(Math.min(0xff, cosmetics.length));
    for (const id of cosmetics.slice(0, 0xff)) writer.u8(id);
  }
  return writer.finish();
}

export function decodeWalletSync(data: Uint8Array): WalletSyncPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_WALLET_SYNC) throw new Error('not a wallet sync packet');
  if (reader.remaining < 10) throw new Error('wallet sync truncated');
  const coins = clampCoins(reader.u32());
  const stats: EconomyStats = {
    atkSpeedLv: clampStatLevel(reader.u8()),
    workEffLv: clampStatLevel(reader.u8()),
    critLv: clampStatLevel(reader.u8()),
    armorLv: clampStatLevel(reader.u8()),
  };
  const reason = reader.u8();
  const count = reader.u8();
  if (reader.remaining < count * 3) throw new Error('wallet sync inventory truncated');
  const inventory: Record<string, number> = {};
  for (let i = 0; i < count; i += 1) {
    const sku = findItemSkuById(reader.u8());
    const itemCount = clampItemCount(reader.u16());
    if (sku && itemCount > 0) inventory[sku.key] = itemCount;
  }
  const packet: WalletSyncPacket = { coins, stats, reason, inventory };
  // 尾段可选：旧服务端不发、旧客户端不读；读到装扮段就整份替换
  if (reader.remaining >= 1) {
    const cosmeticCount = reader.u8();
    const cosmetics: string[] = [];
    for (let i = 0; i < cosmeticCount && reader.remaining >= 1; i += 1) {
      const sku = findCosmeticSkuById(reader.u8());
      if (sku) cosmetics.push(sku.key);
    }
    packet.unlockedCosmetics = cosmetics;
  }
  return packet;
}

// ---------------------------------------------------------------------------
// P2P 互动（ADR-0083）
// ---------------------------------------------------------------------------

export function encodeP2PInvite(request: P2PInviteRequest): Uint8Array {
  const writer = new ByteWriter(10);
  writer
    .u8(OpCode.C2S_P2P_INVITE)
    .u16(Math.max(0, request.targetId) & 0xffff)
    .u8(request.gameType & 0xff)
    .u32(Math.max(0, Math.floor(request.wager)) >>> 0)
    .u16(Math.max(0, request.extra) & 0xffff);
  return writer.finish();
}

export function decodeP2PInvite(data: Uint8Array): P2PInviteRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_P2P_INVITE) throw new Error('not a p2p invite packet');
  return { targetId: reader.u16(), gameType: reader.u8(), wager: reader.u32(), extra: reader.u16() };
}

export function encodeP2PRespond(request: P2PRespondRequest): Uint8Array {
  const writer = new ByteWriter(6);
  writer.u8(OpCode.C2S_P2P_RESPOND).u32(Math.max(0, request.inviteId) >>> 0).u8(request.accept ? 1 : 0);
  return writer.finish();
}

export function decodeP2PRespond(data: Uint8Array): P2PRespondRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_P2P_RESPOND) throw new Error('not a p2p respond packet');
  return { inviteId: reader.u32(), accept: reader.u8() === 1 };
}

/** 邀请浮窗：名字长度用 u8，调用方已按 48 字节上限钳过 */
export function encodeP2PInviteNotify(packet: P2PInviteNotifyPacket): Uint8Array {
  const nameBytes = textEncoder.encode(truncateName(packet.fromName));
  const writer = new ByteWriter(16 + nameBytes.length);
  writer
    .u8(OpCode.S2C_P2P_INVITE_NOTIFY)
    .u32(Math.max(0, packet.inviteId) >>> 0)
    .u16(Math.max(0, packet.fromId) & 0xffff)
    .u8(packet.gameType & 0xff)
    .u32(Math.max(0, Math.floor(packet.wager)) >>> 0)
    .u16(Math.max(0, packet.extra) & 0xffff)
    .u16(Math.max(0, Math.min(65_535, Math.floor(packet.ttlMs))))
    .u8(nameBytes.length)
    .raw(nameBytes);
  return writer.finish();
}

export function decodeP2PInviteNotify(data: Uint8Array): P2PInviteNotifyPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_P2P_INVITE_NOTIFY) throw new Error('not an invite notify packet');
  const inviteId = reader.u32();
  const fromId = reader.u16();
  const gameType = reader.u8();
  const wager = reader.u32();
  const extra = reader.u16();
  const ttlMs = reader.u16();
  const nameLength = reader.u8();
  if (nameLength > reader.remaining) throw new Error('invite notify name truncated');
  return { inviteId, fromId, gameType, wager, extra, ttlMs, fromName: reader.utf8(nameLength) };
}

export function encodeP2PInviteResult(packet: P2PInviteResultPacket): Uint8Array {
  const writer = new ByteWriter(7);
  writer
    .u8(OpCode.S2C_P2P_INVITE_RESULT)
    .u32(Math.max(0, packet.inviteId) >>> 0)
    .u8(packet.reason & 0xff)
    .u8(packet.accepted ? 1 : 0);
  return writer.finish();
}

export function decodeP2PInviteResult(data: Uint8Array): P2PInviteResultPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_P2P_INVITE_RESULT) throw new Error('not an invite result packet');
  return { inviteId: reader.u32(), reason: reader.u8(), accepted: reader.u8() === 1 };
}

export function encodeP2PMatch(packet: P2PMatchPacket): Uint8Array {
  const nameBytes = textEncoder.encode(truncateName(packet.opponentName));
  const writer = new ByteWriter(20 + nameBytes.length);
  writer
    .u8(OpCode.S2C_P2P_MATCH)
    .u32(Math.max(0, packet.matchId) >>> 0)
    .u8(packet.gameType & 0xff)
    .u8(packet.phase & 0xff)
    .u16(Math.max(0, Math.min(65_535, Math.floor(packet.remainingMs))))
    .u16(Math.max(0, packet.selfId) & 0xffff)
    .u16(Math.max(0, packet.opponentId) & 0xffff)
    .u32(Math.max(0, Math.floor(packet.wager)) >>> 0)
    .u16(Math.max(0, packet.winnerId) & 0xffff)
    .u8(packet.endReason & 0xff)
    .u8(nameBytes.length)
    .raw(nameBytes);
  return writer.finish();
}

export function decodeP2PMatch(data: Uint8Array): P2PMatchPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_P2P_MATCH) throw new Error('not a match packet');
  const matchId = reader.u32();
  const gameType = reader.u8();
  const phase = reader.u8();
  const remainingMs = reader.u16();
  const selfId = reader.u16();
  const opponentId = reader.u16();
  const wager = reader.u32();
  const winnerId = reader.u16();
  const endReason = reader.u8();
  const nameLength = reader.u8();
  if (nameLength > reader.remaining) throw new Error('match name truncated');
  return {
    matchId,
    gameType,
    phase,
    remainingMs,
    selfId,
    opponentId,
    wager,
    winnerId,
    endReason,
    opponentName: reader.utf8(nameLength),
  };
}

/** 猜拳出拳：`[0x3e][matchId u32][action u8]` */
export function encodeP2PAction(request: P2PActionRequest): Uint8Array {
  const writer = new ByteWriter(6);
  writer
    .u8(OpCode.C2S_P2P_ACTION)
    .u32(Math.max(0, request.matchId) >>> 0)
    .u8(request.action & 0xff);
  return writer.finish();
}

export function decodeP2PAction(data: Uint8Array): P2PActionRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_P2P_ACTION) throw new Error('not a p2p action packet');
  return { matchId: reader.u32(), action: reader.u8() };
}

/** 亮牌：固定 24 字节，骰子 6 颗 / 猜拳 2 个手势共用同一段 data */
export function encodeP2PShowdown(packet: P2PShowdownPacket): Uint8Array {
  const writer = new ByteWriter(24);
  writer
    .u8(OpCode.S2C_P2P_SHOWDOWN)
    .u32(Math.max(0, packet.matchId) >>> 0)
    .u8(packet.gameType & 0xff)
    .u8(packet.round & 0xff)
    .u16(Math.max(0, packet.aId) & 0xffff)
    .u16(Math.max(0, packet.bId) & 0xffff)
    .u16(Math.max(0, packet.winnerId) & 0xffff)
    .u8(packet.flags & 0xff);
  for (let i = 0; i < 6; i += 1) {
    writer.u8(Math.max(0, Math.min(255, Math.floor(packet.dice[i] ?? 0))));
  }
  writer
    .u8(packet.aAction & 0xff)
    .u8(packet.bAction & 0xff)
    .u16(Math.max(0, Math.min(65_535, Math.floor(packet.durationMs))));
  return writer.finish();
}

export function decodeP2PShowdown(data: Uint8Array): P2PShowdownPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_P2P_SHOWDOWN) throw new Error('not a showdown packet');
  const matchId = reader.u32();
  const gameType = reader.u8();
  const round = reader.u8();
  const aId = reader.u16();
  const bId = reader.u16();
  const winnerId = reader.u16();
  const flags = reader.u8();
  const dice: number[] = [];
  for (let i = 0; i < 6; i += 1) dice.push(reader.u8());
  const aAction = reader.u8();
  const bAction = reader.u8();
  const durationMs = reader.u16();
  return {
    matchId,
    gameType,
    round,
    aId,
    bId,
    winnerId,
    flags,
    dice,
    aAction,
    bAction,
    durationMs,
  };
}

/** 切磋实时状态：`[0x40][matchId u32][aId u16][bId u16][hpA u8][hpB u8][remainingMs u16][flags u8]` */
export function encodeP2PDuelState(packet: P2PDuelStatePacket): Uint8Array {
  const writer = new ByteWriter(14);
  writer
    .u8(OpCode.S2C_P2P_DUEL_STATE)
    .u32(Math.max(0, packet.matchId) >>> 0)
    .u16(Math.max(0, packet.aId) & 0xffff)
    .u16(Math.max(0, packet.bId) & 0xffff)
    .u8(Math.max(0, Math.min(255, Math.floor(packet.hpA))))
    .u8(Math.max(0, Math.min(255, Math.floor(packet.hpB))))
    .u16(Math.max(0, Math.min(65_535, Math.floor(packet.remainingMs))))
    .u8(packet.flags & 0xff);
  return writer.finish();
}

export function decodeP2PDuelState(data: Uint8Array): P2PDuelStatePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_P2P_DUEL_STATE) throw new Error('not a duel state packet');
  return {
    matchId: reader.u32(),
    aId: reader.u16(),
    bId: reader.u16(),
    hpA: reader.u8(),
    hpB: reader.u8(),
    remainingMs: reader.u16(),
    flags: reader.u8(),
  };
}

export function encodeTipRequest(request: TipRequest): Uint8Array {
  const writer = new ByteWriter(7);
  writer
    .u8(OpCode.C2S_TIP)
    .u16(Math.max(0, request.targetId) & 0xffff)
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(request.amount))) >>> 0);
  return writer.finish();
}

export function decodeTipRequest(data: Uint8Array): TipRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_TIP) throw new Error('not a tip packet');
  return { targetId: reader.u16(), amount: reader.u32() };
}

export function encodeTipBroadcast(packet: TipPacket): Uint8Array {
  const writer = new ByteWriter(12);
  writer
    .u8(OpCode.S2C_TIP)
    .u16(Math.max(0, packet.fromId) & 0xffff)
    .u16(Math.max(0, packet.toId) & 0xffff)
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(packet.amount))) >>> 0)
    .u8(packet.received ? P2P_FLAG_SELF_TARGET : 0);
  return writer.finish();
}

export function decodeTipBroadcast(data: Uint8Array): TipPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_TIP) throw new Error('not a tip broadcast');
  const fromId = reader.u16();
  const toId = reader.u16();
  const amount = reader.u32();
  const flags = reader.u8();
  return { fromId, toId, amount, received: (flags & P2P_FLAG_SELF_TARGET) !== 0 };
}

export function encodeUseItem(request: UseItemRequest): Uint8Array {
  const writer = new ByteWriter(4);
  writer
    .u8(OpCode.C2S_USE_ITEM)
    .u16(Math.max(0, request.targetId) & 0xffff)
    .u8(request.itemId & 0xff);
  return writer.finish();
}

export function decodeUseItem(data: Uint8Array): UseItemRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_USE_ITEM) throw new Error('not a use item packet');
  return { targetId: reader.u16(), itemId: reader.u8() };
}

export function encodeShopBuy(request: ShopBuyRequest): Uint8Array {
  const writer = new ByteWriter(4);
  writer.u8(OpCode.C2S_SHOP_BUY).u8(request.kind & 0xff).u8(request.id & 0xff).u8(request.count & 0xff);
  return writer.finish();
}

export function decodeShopBuy(data: Uint8Array): ShopBuyRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_SHOP_BUY) throw new Error('not a shop buy packet');
  return { kind: reader.u8(), id: reader.u8(), count: reader.u8() };
}

export function encodeItemEffect(packet: ItemEffectPacket): Uint8Array {
  const writer = new ByteWriter(8);
  writer
    .u8(OpCode.S2C_ITEM_EFFECT)
    .u16(Math.max(0, packet.sourceId) & 0xffff)
    .u16(Math.max(0, packet.targetId) & 0xffff)
    .u8(packet.itemId & 0xff)
    .u8(packet.isTarget ? P2P_FLAG_SELF_TARGET : 0);
  return writer.finish();
}

export function decodeItemEffect(data: Uint8Array): ItemEffectPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_ITEM_EFFECT) throw new Error('not an item effect packet');
  const sourceId = reader.u16();
  const targetId = reader.u16();
  const itemId = reader.u8();
  const flags = reader.u8();
  return { sourceId, targetId, itemId, isTarget: (flags & P2P_FLAG_SELF_TARGET) !== 0 };
}

// ---------------------------------------------------------------------------
// 道具与 Buff 引擎（ADR-0085）：大喇叭与玩家特效
//
// 大喇叭复用聊天那道「长度字段 + utf8」的尺子，但字节上限按 30 字收紧到 90；
// 玩家特效是定长包——旁观者每 20Hz 都在收同步包，事件包越短越好。
// ---------------------------------------------------------------------------

/** 大喇叭上行：`[op][len u8][utf8]`；超长与空串在编码侧就截断，服务端仍会再判一次 */
export function encodeShout(text: string): Uint8Array {
  let clean = truncateShout(text);
  let bytes = textEncoder.encode(clean);
  // 全角字符 3 字节：90 字预算先撞字节上限时按字符退，直到两者都满足
  if (bytes.length > MAX_SHOUT_BYTES) {
    clean = Array.from(clean).slice(0, MAX_SHOUT_CHARS).join('');
    bytes = textEncoder.encode(clean);
    while (bytes.length > MAX_SHOUT_BYTES) {
      clean = Array.from(clean).slice(0, -1).join('');
      bytes = textEncoder.encode(clean);
    }
  }
  const writer = new ByteWriter(2 + bytes.length);
  writer.u8(OpCode.C2S_SHOUT).u8(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeShout(data: Uint8Array): string {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_SHOUT) throw new Error('not a shout packet');
  const length = reader.u8();
  if (length > reader.remaining) return '';
  return truncateShout(reader.utf8(length));
}

/** 大喇叭被拒：`[op][reason u8]`，2 字节定长 */
export function encodeShoutReject(reason: number): Uint8Array {
  const writer = new ByteWriter(2);
  writer.u8(OpCode.S2C_SHOUT_REJECT).u8(reason & 0xff);
  return writer.finish();
}

export function decodeShoutReject(data: Uint8Array): ShoutRejectPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_SHOUT_REJECT) throw new Error('not a shout reject packet');
  return { reason: reader.u8() };
}

/** 全服弹幕：`[op][fromId u16][len u8][utf8]` */
export function encodeLoudspeaker(packet: LoudspeakerPacket): Uint8Array {
  const text = truncateShout(packet.text);
  const bytes = textEncoder.encode(text);
  const writer = new ByteWriter(4 + bytes.length);
  writer.u8(OpCode.S2C_LOUDSPEAKER).u16(Math.max(0, packet.fromId) & 0xffff).u8(bytes.length).raw(bytes);
  return writer.finish();
}

export function decodeLoudspeaker(data: Uint8Array): LoudspeakerPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_LOUDSPEAKER) throw new Error('not a loudspeaker packet');
  const fromId = reader.u16();
  const length = reader.u8();
  if (length > reader.remaining) return { fromId, text: '' };
  return { fromId, text: truncateShout(reader.utf8(length)) };
}

/** 玩家特效：`[op][effect u8][sourceId u16][targetId u16][extraId u16][durationMs u16][flags u8]` */
export function encodePlayerEffect(packet: PlayerEffectPacket): Uint8Array {
  let flags = 0;
  if (packet.isTarget) flags |= PLAYER_EFFECT_FLAG_SELF;
  if (packet.blocked) flags |= PLAYER_EFFECT_FLAG_BLOCKED;
  const writer = new ByteWriter(11);
  writer
    .u8(OpCode.S2C_PLAYER_EFFECT)
    .u8(packet.effect & 0xff)
    .u16(Math.max(0, packet.sourceId) & 0xffff)
    .u16(Math.max(0, packet.targetId) & 0xffff)
    .u16(Math.max(0, packet.extraId) & 0xffff)
    .u16(Math.max(0, Math.min(0xffff, Math.round(packet.durationMs))) & 0xffff)
    .u8(flags);
  return writer.finish();
}

export function decodePlayerEffect(data: Uint8Array): PlayerEffectPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_PLAYER_EFFECT) throw new Error('not a player effect packet');
  const effect = reader.u8();
  const sourceId = reader.u16();
  const targetId = reader.u16();
  const extraId = reader.u16();
  const durationMs = reader.u16();
  const flags = reader.u8();
  return {
    effect,
    sourceId,
    targetId,
    extraId,
    durationMs,
    isTarget: (flags & PLAYER_EFFECT_FLAG_SELF) !== 0,
    blocked: (flags & PLAYER_EFFECT_FLAG_BLOCKED) !== 0,
  };
}

/** 道具未生效：`[op][reason u8][itemId u8]`，3 字节定长 */
export function encodeItemReject(reason: number, itemId: number): Uint8Array {
  const writer = new ByteWriter(3);
  writer.u8(OpCode.S2C_ITEM_REJECT).u8(reason & 0xff).u8(itemId & 0xff);
  return writer.finish();
}

export function decodeItemReject(data: Uint8Array): ItemRejectPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_ITEM_REJECT) throw new Error('not an item reject packet');
  return { reason: reader.u8(), itemId: reader.u8() };
}

// ---------------------------------------------------------------------------
// 热区建筑与高阶多人玩法（ADR-0087）
//
// 上行全部定长（赌桌 7 / 豪宅 3 / 押注 6 / 公寓 3），只有家具布局是变长；
// 下行按「一包一张桌 / 一包全部小院」聚合，20Hz 路径上不新增逐帧包。
// ---------------------------------------------------------------------------

export function encodeDiceBet(request: DiceBetRequest): Uint8Array {
  const writer = new ByteWriter(7);
  writer
    .u8(OpCode.C2S_DICE_BET)
    .u8(request.table & 0xff)
    .u8(request.side & 0xff)
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(request.amount))) >>> 0);
  return writer.finish();
}

export function decodeDiceBet(data: Uint8Array): DiceBetRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_DICE_BET) throw new Error('not a dice bet packet');
  return { table: reader.u8(), side: reader.u8(), amount: reader.u32() };
}

/** 每张桌的定长部分：id(1) + phase(1) + remaining(2) + round(2) + 三颗骰(3) + 池(4) + 我方(3) + flags(1) */
const DICE_TABLE_BYTES = 17;

export function encodeDiceState(packet: DiceStatePacket): Uint8Array {
  const count = Math.min(0xff, packet.tables.length);
  const writer = new ByteWriter(2 + count * DICE_TABLE_BYTES);
  writer.u8(OpCode.S2C_DICE_STATE).u8(count);
  for (const table of packet.tables.slice(0, count)) {
    writer
      .u8(table.id & 0xff)
      .u8(table.phase & 0xff)
      .u16(Math.max(0, Math.min(0xffff, Math.round(table.remainingMs))))
      .u16(table.roundId & 0xffff)
      .u8(table.dice[0] & 0x0f)
      .u8(table.dice[1] & 0x0f)
      .u8(table.dice[2] & 0x0f)
      .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(table.totalPot))) >>> 0)
      .u8(Math.max(0, Math.min(0xff, table.mySide + 1)))
      .u16(Math.min(0xffff, Math.max(0, Math.floor(table.myBet))))
      .u8(table.raid ? 1 : 0);
  }
  return writer.finish();
}

export function decodeDiceState(data: Uint8Array): DiceStatePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_DICE_STATE) throw new Error('not a dice state packet');
  const count = reader.u8();
  const tables: DiceTablePacket[] = [];
  for (let i = 0; i < count; i += 1) {
    if (reader.remaining < DICE_TABLE_BYTES) break;
    const id = reader.u8();
    const phase = reader.u8();
    const remainingMs = reader.u16();
    const roundId = reader.u16();
    const d0 = reader.u8();
    const d1 = reader.u8();
    const d2 = reader.u8();
    const totalPot = reader.u32();
    const mySide = reader.u8() - 1;
    const myBet = reader.u16();
    const flags = reader.u8();
    tables.push({
      id,
      phase,
      remainingMs,
      roundId,
      dice: [d0, d1, d2],
      totalPot,
      mySide,
      myBet,
      raid: (flags & 1) !== 0,
    });
  }
  return { tables };
}

export function encodeVillaRequest(request: VillaRequest): Uint8Array {
  const writer = new ByteWriter(3);
  writer.u8(OpCode.C2S_VILLA).u8(request.villa & 0xff).u8(request.action & 0xff);
  return writer.finish();
}

export function decodeVillaRequest(data: Uint8Array): VillaRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_VILLA) throw new Error('not a villa packet');
  return { villa: reader.u8(), action: reader.u8() };
}

export function encodeVillaState(packet: VillaStatePacket): Uint8Array {
  const villas = packet.villas.slice(0, 0xff);
  let size = 2;
  // 无主院子的 ownerName 就是空串：不能套昵称兜底，否则牌匾会把「待售」写成「无名牛马」
  const names = villas.map((villa) => (villa.ownerName.trim() === '' ? '' : truncateName(villa.ownerName)));
  for (const name of names) size += 7 + textEncoder.encode(name).length;
  const writer = new ByteWriter(size);
  writer.u8(OpCode.S2C_VILLA_STATE).u8(villas.length);
  villas.forEach((villa, index) => {
    const name = names[index]!;
    const bytes = textEncoder.encode(name);
    let flags = 0;
    if (villa.locked) flags |= 1;
    // bit1 = 已有房主（离线也算），bit2 = 收包人就是房主（按设备号）
    if (villa.owned) flags |= 1 << 1;
    if (villa.mine) flags |= 1 << 2;
    writer
      .u8(villa.id & 0xff)
      .u16(Math.max(0, villa.ownerId) & 0xffff)
      .u8(flags)
      .u16(Math.min(0xffff, Math.max(0, Math.floor(villa.pending))))
      .u8(bytes.length)
      .raw(bytes);
  });
  return writer.finish();
}

export function decodeVillaState(data: Uint8Array): VillaStatePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_VILLA_STATE) throw new Error('not a villa state packet');
  const count = reader.u8();
  const villas = [];
  for (let i = 0; i < count; i += 1) {
    if (reader.remaining < 7) break;
    const id = reader.u8();
    const ownerId = reader.u16();
    const flags = reader.u8();
    const pending = reader.u16();
    const nameLength = reader.u8();
    const ownerName = nameLength <= reader.remaining ? reader.utf8(nameLength) : '';
    villas.push({
      id,
      ownerId,
      ownerName,
      locked: (flags & 1) !== 0,
      owned: (flags & (1 << 1)) !== 0,
      mine: (flags & (1 << 2)) !== 0,
      pending,
    });
  }
  return { villas };
}

export function encodeArenaBet(request: ArenaBetRequest): Uint8Array {
  const writer = new ByteWriter(6);
  writer
    .u8(OpCode.C2S_ARENA_BET)
    .u8(request.side & 0xff)
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(request.amount))) >>> 0);
  return writer.finish();
}

export function decodeArenaBet(data: Uint8Array): ArenaBetRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_ARENA_BET) throw new Error('not an arena bet packet');
  return { side: reader.u8(), amount: reader.u32() };
}

export function encodeArenaPool(packet: ArenaPoolPacket): Uint8Array {
  const writer = new ByteWriter(14);
  writer
    .u8(OpCode.S2C_ARENA_POOL)
    .u16(packet.matchId & 0xffff)
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(packet.redPool))) >>> 0)
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(packet.bluePool))) >>> 0)
    .u8(packet.phase & 0xff)
    .u8(Math.max(0, Math.min(0xff, packet.mySide + 1)))
    .u32(Math.min(MAX_COINS, Math.max(0, Math.floor(packet.myBet))) >>> 0);
  return writer.finish();
}

export function decodeArenaPool(data: Uint8Array): ArenaPoolPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_ARENA_POOL) throw new Error('not an arena pool packet');
  return {
    matchId: reader.u16(),
    redPool: reader.u32(),
    bluePool: reader.u32(),
    phase: reader.u8(),
    mySide: reader.u8() - 1,
    myBet: reader.u32(),
  };
}

export function encodeApartmentRequest(request: ApartmentRequest): Uint8Array {
  const writer = new ByteWriter(3);
  writer.u8(OpCode.C2S_APARTMENT).u8(request.action & 0xff).u8(request.arg & 0xff);
  return writer.finish();
}

export function decodeApartmentRequest(data: Uint8Array): ApartmentRequest {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_APARTMENT) throw new Error('not an apartment packet');
  return { action: reader.u8(), arg: reader.u8() };
}

/**
 * 窗口探头全量快照：`[op][count u8]` + count × `[playerId u16][slot u8][window u8]`。
 *
 * 只发「谁在哪栋哪个窗口」：头的外观走常规实体同步，不在这条包里重复传。
 */
export function encodeApartmentPeek(packet: ApartmentPeekPacket): Uint8Array {
  const count = Math.min(0xff, packet.entries.length);
  const writer = new ByteWriter(2 + count * 4);
  writer.u8(OpCode.S2C_APARTMENT_PEEK).u8(count);
  for (const entry of packet.entries.slice(0, count)) {
    writer
      .u16(Math.max(0, entry.id) & 0xffff)
      .u8(entry.slot & 0xff)
      .u8(entry.window & 0xff);
  }
  return writer.finish();
}

export function decodeApartmentPeek(data: Uint8Array): ApartmentPeekPacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_APARTMENT_PEEK) throw new Error('not an apartment peek packet');
  const count = reader.u8();
  const entries: Array<{ id: number; slot: number; window: number }> = [];
  for (let i = 0; i < count; i += 1) {
    if (reader.remaining < 4) break;
    entries.push({ id: reader.u16(), slot: reader.u8(), window: reader.u8() });
  }
  return { entries };
}

// ---------------------------------------------------------------------------
// 打工产出 / Boss 2.0 / 世界事件 / 每日悬赏（ADR-0088）
//
// 上行全部定长且只有一两个字节；下行的悬赏状态与事件横幅同样很小，
// 20Hz 的 Tick 路径上一帧都不会多发。坐标为量化坐标，与其它下行包同一口径。
// ---------------------------------------------------------------------------

/** 搬砖结算：`[op][combo u8]`，2 字节定长 */
export function encodeWorkClaim(combo: number): Uint8Array {
  const writer = new ByteWriter(2);
  writer.u8(OpCode.C2S_WORK_CLAIM).u8(Math.max(0, Math.min(0xff, Math.floor(combo) || 0)));
  return writer.finish();
}

export function decodeWorkClaim(data: Uint8Array): number {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_WORK_CLAIM) throw new Error('not a work claim packet');
  return reader.u8();
}

/** 每级工效倍率写进 1 字节的十分位：10 = 1.0×、15 = 1.5× */
export const WORK_MULT_SCALE = 10;
/** 搬砖结果 flags：bit0 = 夜班加成生效 */
export const WORK_FLAG_NIGHT = 1;

export interface WorkResultPacket {
  amount: number;
  /** 十分位倍率（工效 × 夜班），只用于「本轮 ≈ N 币」的说明与日志 */
  mult: number;
  night: boolean;
}

/** 搬砖结果：`[op][amount u16][mult u8][flags u8]`，5 字节定长 */
export function encodeWorkResult(packet: WorkResultPacket): Uint8Array {
  const writer = new ByteWriter(5);
  writer
    .u8(OpCode.S2C_WORK_RESULT)
    .u16(Math.max(0, Math.min(0xffff, Math.floor(packet.amount) || 0)))
    .u8(Math.max(0, Math.min(0xff, Math.floor(packet.mult) || 0)))
    .u8(packet.night ? WORK_FLAG_NIGHT : 0);
  return writer.finish();
}

export function decodeWorkResult(data: Uint8Array): WorkResultPacket {
  if (data.byteLength !== 5) throw new Error(`work result must be 5 bytes, got ${data.byteLength}`);
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_WORK_RESULT) throw new Error('not a work result packet');
  const amount = reader.u16();
  const mult = reader.u8();
  const flags = reader.u8();
  return { amount, mult, night: (flags & WORK_FLAG_NIGHT) !== 0 };
}

/** 领取悬赏：`[op][questId u8]`，2 字节定长 */
export function encodeQuestClaim(questId: number): Uint8Array {
  const writer = new ByteWriter(2);
  writer.u8(OpCode.C2S_QUEST_CLAIM).u8(Math.max(0, Math.min(0xff, Math.floor(questId) || 0)));
  return writer.finish();
}

export function decodeQuestClaim(data: Uint8Array): number {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_QUEST_CLAIM) throw new Error('not a quest claim packet');
  return reader.u8();
}

/**
 * 悬赏状态：`[op][dayLen u8][day][count u8]` + count × 6 字节条目。
 *
 * 条目自带 `target`：客户端不必再按 id 反查 `QUEST_DEFS` 才知道进度条画到几分之几。
 * 日期字符串照抄 `YYYY-MM-DD`（10 字节），客户端据此判定「这份进度是不是今天的」。
 */
export function encodeQuestState(packet: QuestStatePacket): Uint8Array {
  const day = packet.day.slice(0, 10);
  const dayBytes = textEncoder.encode(day);
  const entries = packet.entries.slice(0, 0xff);
  const writer = new ByteWriter(3 + dayBytes.length + entries.length * 6);
  writer.u8(OpCode.S2C_QUEST_STATE).u8(dayBytes.length).raw(dayBytes).u8(entries.length);
  for (const entry of entries) {
    writer
      .u8(entry.id & 0xff)
      .u16(Math.max(0, Math.min(QUEST_PROGRESS_MAX, Math.floor(entry.progress) || 0)))
      .u16(Math.max(0, Math.min(QUEST_PROGRESS_MAX, Math.floor(entry.target) || 0)))
      .u8(entry.claimed ? 1 : 0);
  }
  return writer.finish();
}

export function decodeQuestState(data: Uint8Array): QuestStatePacket {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_QUEST_STATE) throw new Error('not a quest state packet');
  const dayLength = reader.u8();
  const day = dayLength <= reader.remaining ? reader.utf8(dayLength) : '';
  const count = reader.remaining > 0 ? reader.u8() : 0;
  const entries: QuestEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (reader.remaining < 6) break;
    const id = reader.u8();
    const progress = reader.u16();
    const target = reader.u16();
    const claimed = reader.u8() !== 0;
    entries.push({ id, progress, target, claimed });
  }
  return { day, entries };
}

/** 世界事件横幅：`[op][kind u8][phase u8][remainingSec u16][seed u16][amount u16]`，9 字节 */
export function encodeWorldEvent(packet: WorldEventPacket): Uint8Array {
  const writer = new ByteWriter(WORLD_EVENT_PACKET_BYTES);
  writer
    .u8(OpCode.S2C_WORLD_EVENT)
    .u8(packet.kind & 0xff)
    .u8(packet.phase & 0xff)
    .u16(Math.max(0, Math.min(0xffff, Math.round(packet.remainingSec))))
    .u16(packet.seed & 0xffff)
    .u16(Math.max(0, Math.min(0xffff, Math.round(packet.amount))));
  return writer.finish();
}

/**
 * 读端只保证「前 `WORLD_EVENT_PACKET_BYTES` 字节够读」：新字段一律追加在尾部，
 * 多出来的字节忽略。曾经的 8 字节硬校验把带 seed 的 9 字节包整包拒收，
 * 异常又在 Worker 里升级成渲染线程致命错误（ADR-0102）。
 */
export function decodeWorldEvent(data: Uint8Array): WorldEventPacket {
  if (data.byteLength < WORLD_EVENT_PACKET_BYTES) {
    throw new Error(`world event must be at least ${WORLD_EVENT_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_WORLD_EVENT) throw new Error('not a world event packet');
  return {
    kind: reader.u8(),
    phase: reader.u8(),
    remainingSec: reader.u16(),
    seed: reader.u16(),
    amount: reader.u16(),
  };
}

/** 抢红包：`[op][index u8]`，2 字节定长 */
export function encodeEventClaim(index: number): Uint8Array {
  const writer = new ByteWriter(2);
  writer.u8(OpCode.C2S_EVENT_CLAIM).u8(Math.max(0, Math.min(0xff, Math.floor(index) || 0)));
  return writer.finish();
}

export function decodeEventClaim(data: Uint8Array): number {
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.C2S_EVENT_CLAIM) throw new Error('not an event claim packet');
  return reader.u8();
}

/** 红包拾取结果 flags：bit0 = 这一包是发给领取者本人的 */
export const EVENT_CLAIM_FLAG_MINE = 1;

/** 红包拾取广播：`[op][index u8][amount u16][flags u8]`，5 字节定长 */
export function encodeEventClaimResult(packet: EventClaimResult): Uint8Array {
  const writer = new ByteWriter(5);
  writer
    .u8(OpCode.S2C_EVENT_CLAIM)
    .u8(packet.index & 0xff)
    .u16(Math.max(0, Math.min(0xffff, Math.floor(packet.amount) || 0)))
    .u8(packet.mine ? EVENT_CLAIM_FLAG_MINE : 0);
  return writer.finish();
}

export function decodeEventClaimResult(data: Uint8Array): EventClaimResult {
  if (data.byteLength !== 5) throw new Error(`event claim result must be 5 bytes, got ${data.byteLength}`);
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_EVENT_CLAIM) throw new Error('not an event claim result packet');
  const index = reader.u8();
  const amount = reader.u16();
  const flags = reader.u8();
  return { index, amount, mine: (flags & EVENT_CLAIM_FLAG_MINE) !== 0 };
}

/** 画饼冲击波：`[op][phase u8][x u16][y u16][radius u16][remainingMs u16][hits u8]`，11 字节 */
export function encodeBossShock(packet: BossShockPacket): Uint8Array {
  const writer = new ByteWriter(BOSS_SHOCK_PACKET_BYTES);
  writer
    .u8(OpCode.S2C_BOSS_SHOCK)
    .u8(packet.phase & 0xff)
    .u16(quantizeCoord(packet.x))
    .u16(quantizeCoord(packet.y))
    .u16(Math.max(0, Math.min(0xffff, Math.round(packet.radius))))
    .u16(Math.max(0, Math.min(0xffff, Math.round(packet.remainingMs))))
    .u8(Math.max(0, Math.min(0xff, Math.floor(packet.hits) || 0)));
  return writer.finish();
}

export function decodeBossShock(data: Uint8Array): BossShockPacket {
  if (data.byteLength < BOSS_SHOCK_PACKET_BYTES) {
    throw new Error(`boss shock must be at least ${BOSS_SHOCK_PACKET_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_BOSS_SHOCK) throw new Error('not a boss shock packet');
  return {
    phase: reader.u8(),
    x: dequantizeCoord(reader.u16()),
    y: dequantizeCoord(reader.u16()),
    radius: reader.u16(),
    remainingMs: reader.u16(),
    hits: reader.u8(),
  };
}

/** 冲击波预警的默认半径：服务端写入包体前与客户端兜底共用 */
export const BOSS_SHOCK_RADIUS = BOSS_SHOCK.Radius;
/** 红包雨的默认持续时间：客户端横幅倒计时兜底 */
export const WORLD_EVENT_RED_PACKET_MS = WORLD_EVENT.RedPacketDurationMs;

/** 互动拒绝回执（ADR-0104）：`[op][action u8][reason u8]`，只回给操作者本人 */
export function encodeInteractReject(packet: InteractRejectPacket): Uint8Array {
  const writer = new ByteWriter(INTERACT_REJECT_BYTES);
  writer
    .u8(OpCode.S2C_INTERACT_REJECT)
    .u8(Math.max(0, Math.min(0xff, Math.floor(packet.action) || 0)))
    .u8(Math.max(0, Math.min(0xff, Math.floor(packet.reason) || 0)));
  return writer.finish();
}

export function decodeInteractReject(data: Uint8Array): InteractRejectPacket {
  if (data.byteLength < INTERACT_REJECT_BYTES) {
    throw new Error(`interact reject must be at least ${INTERACT_REJECT_BYTES} bytes, got ${data.byteLength}`);
  }
  const reader = new ByteReader(data);
  if (reader.u8() !== OpCode.S2C_INTERACT_REJECT) throw new Error('not an interact reject packet');
  return { action: reader.u8(), reason: reader.u8() };
}
