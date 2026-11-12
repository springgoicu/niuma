import { MAX_NAME_BYTES } from './constants';
import { ByteReader, ByteWriter } from './protocol';
import { OpCode } from './types';

/**
 * 牛马榜：中央公告栏的按需快照（ADR-0054）。
 *
 * 榜单只在玩家靠近公告栏、主动打开面板时拉取，不进 Tick 热路径；
 * 服务端在内存里按六个指标排序后回最多 `BOARD_TOP_N` 条，离线即离榜。
 * 本文件是双端唯一契约：指标编号、包体形状、上限与编解码都只写这一份。
 */

export const BOARD_METRIC = {
  /** 本次连续在岗秒数：服务端 joinedAt 口径，不可伪造 */
  Duty: 1,
  /** 本周累计工时（分钟）：本人自报 + 本次会话增量 */
  Week: 2,
  /** 坐下摸鱼次数：本人自报 */
  Slack: 3,
  /** 成功击倒他人次数：本人自报 */
  Knockdown: 4,
  /** 累计搬砖步数：本人自报 */
  Steps: 5,
  /** 收到的工牌点赞数：服务端内存计数（ADR-0057） */
  Likes: 6,
} as const;

export type BoardMetric = (typeof BOARD_METRIC)[keyof typeof BOARD_METRIC];

/** 0 表示一次拉全部指标；其余值对应单个 `BoardMetric` */
export const BOARD_METRIC_ALL = 0;

/** 六个指标各回一条包，客户端按 metric 归档 */
export const BOARD_METRIC_LIST: readonly BoardMetric[] = [
  BOARD_METRIC.Duty,
  BOARD_METRIC.Week,
  BOARD_METRIC.Slack,
  BOARD_METRIC.Knockdown,
  BOARD_METRIC.Steps,
  BOARD_METRIC.Likes,
];

/** 单榜条数上限：前十名足够撑起公告栏，也把单包压在 600 字节以内 */
export const BOARD_TOP_N = 10;
/** 名字长度沿用昵称字节上限（48B），不另造一份更宽的自由文本 */
export const BOARD_MAX_NAME_BYTES = MAX_NAME_BYTES;
/** 服务端距离门：客户端提示半径 96px，服务端放宽到 240px 吸收移动与延迟 */
export const BOARD_QUERY_RANGE = 240;
/** 同一连接两次榜单请求的最小间隔：挡住伪造包把按需查询当放大器 */
export const BOARD_QUERY_COOLDOWN_MS = 1_500;
/** 固定头：op + metric + online + slacking + count + selfRank + selfValue */
export const BOARD_HEADER_BYTES = 13;
/** 单条：id u16 + value u32 + nameLen u8 */
export const BOARD_ENTRY_FIXED_BYTES = 7;
/** 客户端自动刷新节拍：开面板时拉一次，之后按这个间隔补快照 */
export const BOARD_AUTO_REFRESH_MS = 20_000;
/** 手动刷新冷却：与服务端限频同量级，避免连点 */
export const BOARD_REFRESH_COOLDOWN_MS = 3_000;

export const BOARD_MAX_BYTES = BOARD_HEADER_BYTES + BOARD_TOP_N * (BOARD_ENTRY_FIXED_BYTES + BOARD_MAX_NAME_BYTES);

/** u32 字段的统一钳制：负数与非有限值一律落到 0，避免无符号写回成 4294967295 */
function clampBoardValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), 0xffffffff);
}

export interface BoardEntry {
  /** 在线实体 id，仅用于前端高亮自己；名字是快照，离场后仍可展示 */
  id: number;
  name: string;
  value: number;
}

/** 一条指标快照：园区现状 + 自己名次 + 前十名 */
export interface BoardPacket {
  metric: BoardMetric;
  /** 本园区当前在线人数 */
  online: number;
  /** 当前姿态为坐 / 躺的人数：公告栏顶部「摸鱼 M」的来源 */
  slacking: number;
  /** 0 表示未上榜或该项未上报；1 起为名次 */
  selfRank: number;
  /** 自己该项的数值；未上报时为 0 */
  selfValue: number;
  rows: BoardEntry[];
}

export function isBoardMetric(value: number): value is BoardMetric {
  return (
    value === BOARD_METRIC.Duty ||
    value === BOARD_METRIC.Week ||
    value === BOARD_METRIC.Slack ||
    value === BOARD_METRIC.Knockdown ||
    value === BOARD_METRIC.Steps ||
    value === BOARD_METRIC.Likes
  );
}

/**
 * 昵称按 UTF-8 字节截断到协议上限，且不切坏多字节字符。
 *
 * 服务端写入的名字已经过昵称钳制与审核，这里是协议层兜底：
 * 即便上游把 16 个 emoji 塞进来（64B），单包也不会被撑破。
 */
export function clampBoardName(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length <= BOARD_MAX_NAME_BYTES) return bytes;
  let end = BOARD_MAX_NAME_BYTES;
  // UTF-8 续字节形如 10xxxxxx：一直退到字符起点，宁可少一个字也不产生乱码
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end);
}

/** 查询包：`[op][metric u8]`，metric=0 拉全部六个指标 */
export function encodeBoardRequest(metric: BoardMetric | typeof BOARD_METRIC_ALL = BOARD_METRIC_ALL): Uint8Array {
  return new Uint8Array([OpCode.C2S_BOARD, metric & 0xff]);
}

/** 坏包 / 未知指标返回 undefined，服务端静默丢弃，不回错误包 */
export function decodeBoardRequest(data: Uint8Array): BoardMetric | typeof BOARD_METRIC_ALL | undefined {
  if (data.length < 2 || data[0] !== OpCode.C2S_BOARD) return undefined;
  const metric = data[1]!;
  if (metric === BOARD_METRIC_ALL) return BOARD_METRIC_ALL;
  return isBoardMetric(metric) ? metric : undefined;
}

/**
 * 榜单快照包：
 *
 * `[op 0x25][metric u8][online u16][slacking u16][count u8]
 *  [selfRank u16][selfValue u32]` + count × `[id u16][value u32][nameLen u8][name nB]`
 *
 * 全部小端。`count` 不会超过 `BOARD_TOP_N`；名字按字节截断。
 */
export function encodeBoard(packet: BoardPacket): Uint8Array {
  const rows = packet.rows.slice(0, BOARD_TOP_N);
  const writer = new ByteWriter(BOARD_HEADER_BYTES + rows.length * 24);
  writer
    .u8(OpCode.S2C_BOARD)
    .u8(packet.metric)
    .u16(packet.online)
    .u16(packet.slacking)
    .u8(rows.length)
    .u16(packet.selfRank)
    .u32(clampBoardValue(packet.selfValue));
  for (const row of rows) {
    const name = clampBoardName(row.name);
    writer.u16(row.id).u32(clampBoardValue(row.value)).u8(name.length).raw(name);
  }
  return writer.finish();
}

/**
 * 解一条榜单快照。任何一处越界都返回 undefined：
 * 榜单是展示数据，坏包宁可整条丢掉，也不要让半截名字或错位数值上屏。
 */
export function decodeBoard(data: Uint8Array): BoardPacket | undefined {
  if (data.length < BOARD_HEADER_BYTES || data[0] !== OpCode.S2C_BOARD) return undefined;
  const reader = new ByteReader(data);
  reader.u8();
  const metric = reader.u8();
  if (!isBoardMetric(metric)) return undefined;
  const online = reader.u16();
  const slacking = reader.u16();
  const count = reader.u8();
  if (count > BOARD_TOP_N) return undefined;
  const selfRank = reader.u16();
  const selfValue = reader.u32();

  const rows: BoardEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (reader.remaining < BOARD_ENTRY_FIXED_BYTES) return undefined;
    const id = reader.u16();
    const value = reader.u32();
    const nameLength = reader.u8();
    if (nameLength === 0 || nameLength > BOARD_MAX_NAME_BYTES || reader.remaining < nameLength) return undefined;
    rows.push({ id, name: reader.utf8(nameLength), value });
  }
  // 已知包体不允许尾随字节：多出来的内容只可能来自截断 / 错位，不能当成扩展静默吞掉
  if (reader.remaining !== 0) return undefined;
  return { metric, online, slacking, selfRank, selfValue, rows };
}
