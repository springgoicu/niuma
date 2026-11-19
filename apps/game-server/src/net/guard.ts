/**
 * 入站包闸门：在 dispatch 之前用一次数组索引判定长度合法性。
 *
 * 为什么不靠 decoder 自己 throw：
 *   ByteReader 用 DataView.getUint8，越界抛 RangeError，外层 try/catch 接得住，
 *   进程不会崩。但每抛一次就要构造 Error + 抓堆栈 —— 攻击者用 120 包/秒 × N 条
 *   连接可以把这个 catch 变成日志洪水，几秒钟就把 /var/log 写满、把磁盘 IO 打满。
 *   所以畸形包的正常路径应该是「O(1) 判定 → 立刻 close」，抛异常只作最后兜底。
 *
 * 为什么是数组而不是 Map：
 *   opcode 只有 0x01~0x29，一张 64 项的表就是全部取值域。Int16Array 索引是一次
 *   内存读，比哈希查找便宜，也不产生任何分配 —— 20Hz × 200 人 = 4000 次/秒的
 *   热路径上，任何一次分配都会被 GC 记住。
 */
import {
  APPEARANCE_BYTES,
  MOVE_PACKET_BYTES,
  MOVE_PACKET_WITH_TIMING_BYTES,
  OpCode,
} from '@niuma/shared-types';

export const PACKET_OK = 0;
/** 长度不自洽：越界读或截断包，直接 close(1008) */
export const PACKET_MALFORMED = 1;
/** 不认识的 opcode：可能是未来版本的包，丢弃即可，不必断线 */
export const PACKET_UNKNOWN = 2;

/**
 * 闸门表覆盖到当前最大上行 opcode（`C2S_ACTIVITY = 0x5f`）之后一档。
 * 表长必须严格大于最大 opcode，否则 `op >= TABLE_SIZE` 会把新包判成 UNKNOWN。
 */
const TABLE_SIZE = 0x60;

/** 1 = 该 opcode 是定长包 */
const known = new Uint8Array(TABLE_SIZE);
/** 定长包的确切字节数 */
const exact = new Int16Array(TABLE_SIZE);
/** 1 = 只校验「至少这么长」（HELLO 这类尾段自解析的包） */
const minOnly = new Uint8Array(TABLE_SIZE);
/** 变长包的头部固定长度（不含声明长度覆盖的载荷） */
const headerBytes = new Int16Array(TABLE_SIZE);
/** 声明长度字段在包内的偏移；-1 表示该包没有声明长度字段 */
const declaredAt = new Int8Array(TABLE_SIZE).fill(-1);
/** 声明长度字段占几个字节：1 或 2 */
const declaredWidth = new Uint8Array(TABLE_SIZE);

function defineExact(op: number, bytes: number): void {
  known[op] = 1;
  exact[op] = bytes;
}

function defineMin(op: number, bytes: number): void {
  known[op] = 1;
  minOnly[op] = 1;
  exact[op] = bytes;
}

function defineVariable(op: number, header: number, offset: number, width: number): void {
  known[op] = 1;
  headerBytes[op] = header;
  declaredAt[op] = offset;
  declaredWidth[op] = width;
}

// MOVE 有两个合法长度（8 / 14），在 checkPacket 里单独判
known[OpCode.C2S_MOVE] = 1;

// ---- 定长包：长度必须精确相等，多一个字节也算伪造 ----
defineExact(OpCode.C2S_ACTION, 4); // [op][entityId u16][action u8]
defineExact(OpCode.C2S_PING, 5); // [op][timestamp u32]
defineExact(OpCode.C2S_LIKE, 3); // [op][targetId u16]
defineExact(OpCode.C2S_BOARD, 2); // [op][metric u8]
defineExact(OpCode.C2S_CHAT_HISTORY, 4); // [op][beforeMsgId u16][limit u8]
defineExact(OpCode.C2S_SET_APPEARANCE, 1 + APPEARANCE_BYTES);
// 互动包全部定长：长度多一个字节即视为伪造（ADR-0083）
defineExact(OpCode.C2S_P2P_INVITE, 10); // [op][targetId u16][gameType u8][wager u32][extra u16]
defineExact(OpCode.C2S_P2P_RESPOND, 6); // [op][inviteId u32][accept u8]
defineExact(OpCode.C2S_P2P_ACTION, 6); // [op][matchId u32][action u8]
defineExact(OpCode.C2S_TIP, 7); // [op][targetId u16][amount u32]
defineExact(OpCode.C2S_USE_ITEM, 4); // [op][targetId u16][itemId u8]
defineExact(OpCode.C2S_SHOP_BUY, 4); // [op][kind u8][id u8][count u8]
// 大喇叭：`[op][len u8][utf8]`，长度由 decoder 再截到 30 字（90 字节）
defineVariable(OpCode.C2S_SHOUT, 2, 1, 1);

// ---- 热区建筑与房产玩法（ADR-0087）----
defineExact(OpCode.C2S_VILLA, 3); // [op][villa u8][action u8]
defineExact(OpCode.C2S_APARTMENT, 3); // [op][action u8][arg u8]

// ---- 打工产出 / 世界事件 / 每日悬赏（ADR-0088）：三个单字节参数的上行包 ----
defineExact(OpCode.C2S_WORK_CLAIM, 2); // [op][combo u8]
defineExact(OpCode.C2S_QUEST_CLAIM, 2); // [op][questId u8]
defineExact(OpCode.C2S_EVENT_CLAIM, 2); // [op][index u8]

// ---- 全园区播报（ADR-0112）：纯观感事件上报，定长 3 字节 ----
defineExact(OpCode.C2S_ACTIVITY, 3); // [op][kind u8][sub u8]

// ---- 变长包：头部 + 声明长度 ----
// HELLO 没有长度字段：昵称长度 + 固定外观段是下限，尾部各扩展段按魔数自解析。
// 用「最小合法长度」兜住截断包，具体字段交给 decoder（它已按 remaining 做过判断）。
defineMin(OpCode.C2S_HELLO, 2 + APPEARANCE_BYTES);
defineVariable(OpCode.C2S_CHAT, 5, 3, 2); // [op][color][mode][len u16][utf8]
defineVariable(OpCode.C2S_SET_STATUS, 3, 1, 2); // [op][len u16][utf8]
defineVariable(OpCode.C2S_SET_NAME, 3, 1, 2); // 同上
defineVariable(OpCode.C2S_CAREER, 2, 1, 1); // [op][len u8][payload]

/**
 * 单包判定。`len` 传 `data.byteLength`，不传 data 本身：
 * 只有变长包需要读一两个字节，调用方已经把 buffer 包好了。
 */
export function checkPacket(op: number, data: Uint8Array): number {
  if (op <= 0 || op >= TABLE_SIZE || known[op] === 0) return PACKET_UNKNOWN;
  const len = data.byteLength;

  if (op === OpCode.C2S_MOVE) {
    return len === MOVE_PACKET_BYTES || len === MOVE_PACKET_WITH_TIMING_BYTES
      ? PACKET_OK
      : PACKET_MALFORMED;
  }

  if (declaredAt[op] < 0) {
    const want = exact[op]!;
    if (minOnly[op] === 1) return len >= want ? PACKET_OK : PACKET_MALFORMED;
    return len === want ? PACKET_OK : PACKET_MALFORMED;
  }

  const header = headerBytes[op]!;
  if (len < header) return PACKET_MALFORMED;
  const at = declaredAt[op]!;
  const declared = declaredWidth[op] === 2 ? (data[at]! | (data[at + 1]! << 8)) : data[at]!;
  // 只要求「实际 >= 声明」而不是严格相等：多出来的字节会被 decoder 的 subarray 丢掉，
  // 但声明比实际长就会读到包外，那才是真正需要拦的情况。
  // 不额外设上限：合法声明最多 65535，而 len <= MAX_PACKET_BYTES(2048)，
  // 任何离谱的声明值都会在这里直接被 !(len >= header + declared) 挡掉。
  return len >= header + declared ? PACKET_OK : PACKET_MALFORMED;
}
