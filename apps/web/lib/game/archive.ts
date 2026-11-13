'use client';

import {
  EMPTY_CAREER,
  ENTITY_ROLE_GUARD,
  type CareerSummary,
  type CharacterAppearance,
  type Pose,
  type SeatKind,
  type Species,
} from '@niuma/shared-types';
import {
  dayKey,
  formatMinutesClock,
  getJobTitle,
  getStampTitle,
  getTodayMinutes,
  getTodayToiletMinutes,
  type AttendanceStorage,
} from './attendance';
import {
  departmentOf,
  employeeNumber,
  poseLabel,
  seatLabel,
  shiftOf,
  type BoardEntry,
  type PlayerBadge,
} from './badge';
import { EMPTY_CAREER_DAY, PX_PER_STEP, type CareerStats } from './career';
import type { GeoInfo } from './geo';
import type { ShareCardData } from './share-card';

/**
 * 工牌档案的唯一展示模型。
 *
 * 本人与他人都从这里拿 `BadgeArchive`：UI 不再判断「0 还是未上报」，
 * 也不直接读 attendance / geo / 协议字段。加字段只改这一层与一个展示组件。
 *
 * 只描述今天：没有任何累计、工龄、连续天数或会话时长字段，
 * 这样部署、刷新、重连都不会让档案出现与榜单不一致的第二套时间口径。
 */
export interface BadgeArchive {
  name: string;
  employeeNo: string;
  species: Species;
  appearance: CharacterAppearance;
  isSelf: boolean;
  /** 服务端内存里的工牌点赞数（ADR-0057） */
  likes: number;
  /** 当前连接是否已给这块工牌点过赞；本人档案恒为 false */
  liked: boolean;
  department: string;
  shift: string;
  jobTitle: string;
  jobWarning?: string;
  jobColor: string;
  status: string;
  region: string;
  location: string;
  pose: string;
  seat: string;
  /** 今日工时，`HH:MM`；未上报时为「未上报」 */
  todayDuration: string;
  /** 今日如厕分钟，任何时刻都 ≤ 今日工时 */
  todayToiletMinutes: number;
  /** 今日如厕占今日工时的比例（0–1），用于占比条 */
  todayToiletRatio: number;
  /** 入职日期：身份信息，不派生任何时长统计 */
  firstJoinDate: string;
  activity: {
    steps: number;
    distanceM: number;
    ventedCount: number;
    /** 今日成功击倒他人的次数 */
    knockdownCount: number;
    overtimeCount: number;
    /** 今日擂台冠 / 亚 / 季军（ADR-0073） */
    ringGold: number;
    ringSilver: number;
    ringBronze: number;
  };
  board: BoardEntry[];
  rank: number | null;
  stamp: string;
  stampRed: boolean;
  /**
   * 已解锁的成就戳印（ADR-0060）：目前只有赛博木鱼的「急急急放假人」。
   * 与主戳印分开：主章只盖一枚，成就是可以累积的小章。
   */
  achievements: string[];
  /** false 时今日工时/计数显示「未上报」，不拿 0 冒充真实数据 */
  hasCareer: boolean;
}

export interface SelfArchiveInput {
  name: string;
  species: Species;
  appearance: CharacterAppearance;
  status: string;
  region: string;
  geo: GeoInfo;
  attendance: AttendanceStorage;
  stats: CareerStats;
  pose: Pose;
  seated: boolean;
  seatKind: SeatKind | null;
  board: BoardEntry[];
  rank: number | null;
  /** 服务端当前记录的收到赞数；缺省 0（旧服务端 / 刚入场） */
  likes?: number;
  /** 本地解锁的成就戳印；缺省空数组 */
  achievements?: string[];
  now?: number;
}

/** 世界像素 → 展示里程（米）：与旧口径同一把尺子，纯展示不参与上报 */
const PX_PER_METER = 25;

function distanceMetersFromPx(px: number): number {
  return Math.floor(Math.max(0, px) / PX_PER_METER);
}

function distanceMetersFromSteps(steps: number): number {
  return distanceMetersFromPx(steps * PX_PER_STEP);
}

function clampCount(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

/** 今日如厕占比：工时为 0 时算 0，不画出一个不存在的比例。 */
function toiletRatio(toiletMinutes: number, todayMinutes: number): number {
  if (todayMinutes <= 0) return 0;
  return Math.min(1, Math.max(0, toiletMinutes / todayMinutes));
}

/** 本人档案：数据来自本地 store，不经过网络。 */
export function buildSelfArchive(input: SelfArchiveInput): BadgeArchive {
  const now = input.now ?? Date.now();
  const todayMinutes = getTodayMinutes(input.attendance, now);
  const todayToiletMinutes = Math.min(getTodayToiletMinutes(input.attendance, now), todayMinutes);
  const day = input.stats.daily[dayKey(now)] ?? EMPTY_CAREER_DAY;
  const todayHours = todayMinutes / 60;
  const job = getJobTitle(todayHours);
  const steps = clampCount(day.distancePx / PX_PER_STEP);
  const stamp = getStampTitle(todayHours, {
    steps,
    slackCount: day.slackCount,
    rank: input.rank,
  });
  return {
    name: input.name,
    employeeNo: employeeNumber(input.name),
    species: input.species,
    appearance: input.appearance,
    isSelf: true,
    likes: clampCount(input.likes ?? 0),
    liked: false,
    department: departmentOf(input.name),
    shift: shiftOf(input.name),
    jobTitle: job.title,
    ...(job.warning ? { jobWarning: job.warning } : {}),
    jobColor: job.color,
    status: input.status,
    region: input.region || '园区',
    location: `中国 · ${input.geo.region} · ${input.geo.city}`,
    pose: poseLabel(input.pose, false, input.seated),
    seat: seatLabel(input.seatKind),
    todayDuration: formatMinutesClock(todayMinutes),
    todayToiletMinutes,
    todayToiletRatio: toiletRatio(todayToiletMinutes, todayMinutes),
    firstJoinDate: input.attendance.firstJoinDate || '未上报',
    activity: {
      steps,
      distanceM: distanceMetersFromPx(day.distancePx),
      ventedCount: clampCount(day.ventedCount),
      knockdownCount: clampCount(day.knockdownCount),
      overtimeCount: clampCount(day.overtimeCount),
      ringGold: clampCount(day.ringGold),
      ringSilver: clampCount(day.ringSilver),
      ringBronze: clampCount(day.ringBronze),
    },
    board: input.board,
    rank: input.rank,
    stamp,
    stampRed: todayHours > 8,
    achievements: input.achievements ?? [],
    hasCareer: true,
  };
}

/** 他人档案：数据来自 2Hz 工牌推送，字段缺失时统一显示「未上报」。 */
export function buildRemoteArchive(badge: PlayerBadge, _now = Date.now()): BadgeArchive {
  const career: CareerSummary | undefined = badge.career;
  const hasCareer = career !== undefined;
  const effective = career ?? EMPTY_CAREER;
  const todayMinutes = clampCount(effective.todayMinutes);
  const todayToiletMinutes = Math.min(clampCount(effective.todayToiletMinutes), todayMinutes);
  const todayHours = todayMinutes / 60;
  const job = getJobTitle(todayHours);
  const stamp = hasCareer
    ? getStampTitle(todayHours, {
        steps: effective.todaySteps,
        slackCount: 0,
        rank: badge.rank,
      })
    : '未上报';
  // 3 位保安都叫「园区保安」：用实体 id 当 salt 拉开三张工牌；
  // 真人（role 0 / undefined）与普通同事不传，固定工号语义保持不变。
  const salt = badge.role === ENTITY_ROLE_GUARD ? badge.id : undefined;
  return {
    name: badge.name,
    employeeNo: employeeNumber(badge.name, salt),
    species: badge.species,
    appearance: badge.appearance,
    isSelf: false,
    likes: clampCount(badge.likes),
    liked: badge.liked,
    department: departmentOf(badge.name, salt),
    shift: shiftOf(badge.name, salt),
    jobTitle: hasCareer ? job.title : '未上报',
    ...(hasCareer && job.warning ? { jobWarning: job.warning } : {}),
    jobColor: hasCareer ? job.color : 'text-mist-500',
    status: badge.status,
    region: badge.region || '园区',
    location: effective.province ? `中国 · ${effective.province}` : '未上报',
    pose: poseLabel(badge.pose, badge.moving, badge.seated),
    seat: seatLabel(badge.seatKind),
    todayDuration: hasCareer ? formatMinutesClock(todayMinutes) : '未上报',
    todayToiletMinutes,
    todayToiletRatio: toiletRatio(todayToiletMinutes, todayMinutes),
    firstJoinDate: hasCareer && effective.firstJoinDate ? effective.firstJoinDate : '未上报',
    activity: {
      steps: clampCount(effective.todaySteps),
      distanceM: distanceMetersFromSteps(effective.todaySteps),
      ventedCount: clampCount(effective.todayVented),
      knockdownCount: clampCount(effective.todayKnockdown),
      overtimeCount: clampCount(effective.todayOvertime),
      ringGold: clampCount(effective.ringGold),
      ringSilver: clampCount(effective.ringSilver),
      ringBronze: clampCount(effective.ringBronze),
    },
    board: badge.board,
    rank: badge.rank,
    stamp,
    stampRed: hasCareer && todayHours > 8,
    // 成就只写在本机：别人的档案不展示我这边解锁了什么，避免把本地状态冒充他人事实
    achievements: [],
    hasCareer,
  };
}

/** 档案 → 分享卡数据。他人工卡带 `isSelf: false`，分享卡据此标「代打」。 */
export function toShareCardData(archive: BadgeArchive): ShareCardData {
  return {
    name: archive.name,
    employeeNo: archive.employeeNo,
    jobTitle: archive.jobTitle,
    species: archive.species,
    appearance: archive.appearance,
    location: archive.location,
    todayDuration: archive.todayDuration,
    todayToiletMinutes: archive.todayToiletMinutes,
    stamp: archive.stamp,
    department: archive.department,
    shift: archive.shift,
    activity: archive.activity,
    rank: archive.rank,
    isSelf: archive.isSelf,
    hasCareer: archive.hasCareer,
  };
}
