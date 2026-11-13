/**
 * 工牌考勤摘要：本人浏览器 → HELLO / C2S_CAREER → 服务端内存 → SPAWN / S2C_CAREER。
 *
 * 这里只放纯函数与常量，不碰网络、存储或 React：
 * - 服务端与客户端共用同一份钳制规则，伪造包最多只能让自己看起来更惨；
 * - 只保留「今天」的时长与计数，历史累计不再上传，也不参与任何展示；
 * - 字段全部走定长二进制，省份是唯一变长字段，且有独立的字符/字节上限；
 * - 日期编码为「距 2000-01-01 的天数」，0 表示未上报。
 */

import { SESSION_CARRY_MAX_SEC } from './constants';

/**
 * 摘要版本：解码器遇到不认识的版本整段丢弃，回退「未上报」。
 *
 * v1 → v2：在 `ventedCount` 后插入 `knockdownCount u16`，后续字段整体后移 2 字节。
 * v2 → v3：删除历史累计 / 周 / 连续 / 上报基线，只保留今日字段，定长从 36 收到 18。
 * 旧解码器看到 v3 会整段丢弃，不会把今日字段读成历史累计。
 */
export const CAREER_VERSION = 3;
export const CAREER_VERSION_V2 = 2;
export const CAREER_VERSION_LEGACY = 1;

/**
 * 上次会话秒数的采信上限（ADR-0060）。
 *
 * 目前只用于服务端内部的在线秒数连续性，不再参与任何今日统计。
 */
export function clampSessionCarry(carrySec: number, processUptimeSec: number): number {
  if (!Number.isFinite(carrySec) || carrySec <= 0) return 0;
  const uptime = Number.isFinite(processUptimeSec) ? Math.max(0, processUptimeSec) : 0;
  return Math.min(Math.floor(carrySec), SESSION_CARRY_MAX_SEC, Math.floor(uptime));
}

/** 省份上限：只到省，city / isp 永不下发。 */
export const MAX_PROVINCE_CHARS = 10;
export const MAX_PROVINCE_BYTES = 30;

/** 首次入职日期的编码原点（UTC，避免本地时区把日期挪一天）。 */
const CAREER_EPOCH_MS = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

/** 数值上限：只用于展示，取值再离谱也不该让包撑破或让 UI 溢出。 */
export const MAX_DAY_MINUTES = 1_440;
export const MAX_STEPS = 100_000_000;
export const MAX_COUNT = 65_535;

export interface CareerSummary {
  /** "YYYY-MM-DD"；空串表示未上报 */
  firstJoinDate: string;
  /** 今日在岗分钟（上报那一刻） */
  todayMinutes: number;
  /** 今日坐在马桶座位上的分钟，必须 ≤ todayMinutes */
  todayToiletMinutes: number;
  /** 今日步数（按本地里程折算） */
  todaySteps: number;
  /** 今日成功击倒他人的次数 */
  todayKnockdown: number;
  /** 今日被他人击倒的次数 */
  todayVented: number;
  /** 今日加班次数（0 或 1） */
  todayOvertime: number;
  /** 只到省；空串表示未上报 */
  province: string;
}

export const EMPTY_CAREER: CareerSummary = {
  firstJoinDate: '',
  todayMinutes: 0,
  todayToiletMinutes: 0,
  todaySteps: 0,
  todayKnockdown: 0,
  todayVented: 0,
  todayOvertime: 0,
  province: '',
};

/** v1 定长部分：version + 12 个数值 + provinceLen = 34 字节 */
export const CAREER_FIXED_BYTES_LEGACY = 34;
/** v2 定长部分：多一个 knockdownCount u16 = 36 字节 */
export const CAREER_FIXED_BYTES_V2 = 36;
/** v3 定长部分：version + 7 个今日数值 + provinceLen = 18 字节 */
export const CAREER_FIXED_BYTES = 18;
/** 信封层长度下限：v3 是最小的一版，26 字节的旧包也由版本分支自己检查 */
export const CAREER_MIN_BYTES = CAREER_FIXED_BYTES;
/** 单条摘要的最大长度：取最大版本定长 + 省份上限；长度字节 u8 必须放得下 */
export const CAREER_MAX_BYTES = CAREER_FIXED_BYTES_V2 + MAX_PROVINCE_BYTES;
/** 尾部段：魔数 + 长度 + payload */
export const CAREER_SEGMENT_MAX_BYTES = 2 + CAREER_MAX_BYTES;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  if (value <= min) return min;
  if (value >= max) return max;
  return Math.floor(value);
}

/** 只信任自己写过的日期形状：非法日期一律当未上报，不用今天冒充入职日。 */
export function dateToEpochDays(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return 0;
  const utc = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(utc)) return 0;
  const days = Math.floor((utc - CAREER_EPOCH_MS) / DAY_MS);
  return days > 0 && days <= 65_535 ? days : 0;
}

export function epochDaysToDate(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '';
  const date = new Date(CAREER_EPOCH_MS + Math.floor(days) * DAY_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 省份编码器只建一次：截断时按码点算字节，避免切半个 emoji。 */
const provinceEncoder = new TextEncoder();

/** 按码点截断省份：字符数与字节数取更严的一条。 */
export function truncateProvince(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const char of trimmed) {
    if (chars >= MAX_PROVINCE_CHARS) break;
    const size = provinceEncoder.encode(char).length;
    if (bytes + size > MAX_PROVINCE_BYTES) break;
    out += char;
    chars += 1;
    bytes += size;
  }
  return out;
}

/**
 * 把任意来源的摘要钳成合法形状。
 *
 * 服务端与客户端都调用这一份：服务端用它兜底伪造包，客户端用它兜底旧存档与缺失段。
 * 如厕时长在工时确定之后再钳一次，保证任何展示都满足「如厕 ≤ 工时」。
 */
export function sanitizeCareer(raw: unknown): CareerSummary {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_CAREER };
  const value = raw as Record<string, unknown>;
  const firstJoinDate =
    typeof value.firstJoinDate === 'string' && dateToEpochDays(value.firstJoinDate) > 0
      ? value.firstJoinDate
      : '';
  const todayMinutes = clampInt(value.todayMinutes, 0, MAX_DAY_MINUTES);
  return {
    firstJoinDate,
    todayMinutes,
    todayToiletMinutes: Math.min(
      clampInt(value.todayToiletMinutes, 0, MAX_DAY_MINUTES),
      todayMinutes,
    ),
    todaySteps: clampInt(value.todaySteps, 0, MAX_STEPS),
    todayKnockdown: clampInt(value.todayKnockdown, 0, MAX_COUNT),
    todayVented: clampInt(value.todayVented, 0, MAX_COUNT),
    todayOvertime: clampInt(value.todayOvertime, 0, 1),
    province: truncateProvince(value.province),
  };
}

/** 是否已上报考勤摘要：入职日期是唯一身份锚点，今日字段可以全为 0。 */
export function hasCareerReport(career: CareerSummary | undefined): boolean {
  return Boolean(career && career.firstJoinDate.length > 0);
}
