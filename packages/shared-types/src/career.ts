/**
 * 工牌考勤摘要：本人浏览器 → HELLO / C2S_CAREER → 服务端内存 → SPAWN / S2C_CAREER。
 *
 * 这里只放纯函数与常量，不碰网络、存储或 React：
 * - 服务端与客户端共用同一份钳制规则，伪造包最多只能让自己看起来更惨；
 * - 字段全部走定长二进制，省份是唯一变长字段，且有独立的字符/字节上限；
 * - 日期编码为「距 2000-01-01 的天数」，0 表示未上报。
 */

/**
 * 摘要版本：解码器遇到不认识的版本整段丢弃，回退「未上报」。
 *
 * v1 → v2：在 `ventedCount` 后插入 `knockdownCount u16`，后续字段整体后移 2 字节。
 * 因此版本号必须升级：v1 解码器看到 v2 会整段丢弃，而不是把省份读成乱码。
 */
/**
 * 上报之后又过了多少分钟。
 *
 * 只算「服务端会话秒数 − 上报时的会话秒数」：重连会重置 `joinedAt`，
 * 两端时钟差也不会造成重复计时。与 `withCareerDelta` 同一口径，
 * 服务端榜单与客户端工牌都必须调用这一份，不要各写一遍。
 */
export function careerSessionDeltaMinutes(career: CareerSummary, onlineSec: number): number {
  if (!Number.isFinite(onlineSec)) return 0;
  const reported = Math.max(0, career.reportedOnlineSec);
  return Math.floor(Math.max(0, onlineSec - reported) / 60);
}

export const CAREER_VERSION = 2;
export const CAREER_VERSION_LEGACY = 1;

/** 省份上限：只到省，city / isp 永不下发。 */
export const MAX_PROVINCE_CHARS = 10;
export const MAX_PROVINCE_BYTES = 30;

/** 首次入职日期的编码原点（UTC，避免本地时区把日期挪一天）。 */
const CAREER_EPOCH_MS = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

/** 数值上限：只用于展示，取值再离谱也不该让包撑破或让 UI 溢出。 */
const MAX_TOTAL_ONLINE_MINUTES = 60 * 24 * 365 * 100;
const MAX_ACTIVE_DAYS = 36_500;
const MAX_DAY_MINUTES = 1_440;
const MAX_WEEK_MINUTES = 10_080;
const MAX_STREAK_DAYS = 36_500;
const MAX_STEPS = 100_000_000;
const MAX_DISTANCE_M = 100_000_000;
const MAX_COUNT = 65_535;
const MAX_REPORTED_ONLINE_SEC = 100 * 365 * 24 * 3_600;

export interface CareerSummary {
  /** "YYYY-MM-DD"；空串表示未上报 */
  firstJoinDate: string;
  /** 历史累计在岗分钟（不含本次会话尚未上报的部分） */
  totalOnlineMinutes: number;
  /** 有工时的日期数，用于推导日均 */
  activeDays: number;
  /** 今日累计在岗分钟（上报那一刻） */
  todayMinutes: number;
  /** 本周累计在岗分钟（上报那一刻） */
  weekMinutes: number;
  /** 连续在岗天数（上报那一刻） */
  streakDays: number;
  steps: number;
  distanceM: number;
  slackCount: number;
  /** 被他人击倒的累计次数 */
  ventedCount: number;
  /** 成功击倒他人的累计次数；v1 摘要缺省为 0 */
  knockdownCount: number;
  overtimeCount: number;
  /** 只到省；空串表示未上报 */
  province: string;
  /** 服务端写入、客户端只读：上报那一刻的会话在线秒数 */
  reportedOnlineSec: number;
}

export const EMPTY_CAREER: CareerSummary = {
  firstJoinDate: '',
  totalOnlineMinutes: 0,
  activeDays: 0,
  todayMinutes: 0,
  weekMinutes: 0,
  streakDays: 0,
  steps: 0,
  distanceM: 0,
  slackCount: 0,
  ventedCount: 0,
  knockdownCount: 0,
  overtimeCount: 0,
  province: '',
  reportedOnlineSec: 0,
};

/** v1 定长部分：version + 12 个数值 + provinceLen = 34 字节 */
export const CAREER_FIXED_BYTES_LEGACY = 34;
/** v2 定长部分：多一个 knockdownCount u16 = 36 字节 */
export const CAREER_FIXED_BYTES = 36;
/**
 * 信封层长度下限：v1 包也必须能进入 `decodeCareer` 再做版本分支。
 * 用 v2 的 36 当门槛会把所有 v1 摘要直接挡在门外。
 */
export const CAREER_MIN_BYTES = CAREER_FIXED_BYTES_LEGACY;
/** 单条摘要的最大长度：v2 定长 + 省份上限；长度字节 u8 必须放得下 */
export const CAREER_MAX_BYTES = CAREER_FIXED_BYTES + MAX_PROVINCE_BYTES;
/** 尾部段：魔数 + 长度 + payload */
export const CAREER_SEGMENT_MAX_BYTES = 2 + CAREER_MAX_BYTES;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  return rounded > max ? max : rounded;
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
 */
export function sanitizeCareer(raw: unknown): CareerSummary {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_CAREER };
  const value = raw as Record<string, unknown>;
  const firstJoinDate =
    typeof value.firstJoinDate === 'string' && dateToEpochDays(value.firstJoinDate) > 0
      ? value.firstJoinDate
      : '';
  return {
    firstJoinDate,
    totalOnlineMinutes: clampInt(value.totalOnlineMinutes, 0, MAX_TOTAL_ONLINE_MINUTES),
    activeDays: clampInt(value.activeDays, 0, MAX_ACTIVE_DAYS),
    todayMinutes: clampInt(value.todayMinutes, 0, MAX_DAY_MINUTES),
    weekMinutes: clampInt(value.weekMinutes, 0, MAX_WEEK_MINUTES),
    streakDays: clampInt(value.streakDays, 0, MAX_STREAK_DAYS),
    steps: clampInt(value.steps, 0, MAX_STEPS),
    distanceM: clampInt(value.distanceM, 0, MAX_DISTANCE_M),
    slackCount: clampInt(value.slackCount, 0, MAX_COUNT),
    ventedCount: clampInt(value.ventedCount, 0, MAX_COUNT),
    knockdownCount: clampInt(value.knockdownCount, 0, MAX_COUNT),
    overtimeCount: clampInt(value.overtimeCount, 0, MAX_COUNT),
    province: truncateProvince(value.province),
    reportedOnlineSec: clampInt(value.reportedOnlineSec, 0, MAX_REPORTED_ONLINE_SEC),
  };
}
