'use client';

import {
  EMPTY_CAREER,
  type CareerSummary,
  type CharacterAppearance,
  type Pose,
  type SeatKind,
  type Species,
} from '@niuma/shared-types';
import {
  dayKey,
  formatDuration,
  getActiveDays,
  getDailyAverageHours,
  getJobTitle,
  getSeniorityDays,
  getStampTitle,
  getStreakDays,
  getWeekMinutes,
  type AttendanceStorage,
} from './attendance';
import {
  departmentOf,
  employeeNumber,
  formatOnline,
  poseLabel,
  seatLabel,
  shiftOf,
  withCareerDelta,
  type BoardEntry,
  type PlayerBadge,
} from './badge';
import type { CareerStats } from './career';
import type { GeoInfo } from './geo';
import type { ShareCardData } from './share-card';

/**
 * 工牌档案的唯一展示模型。
 *
 * 本人与他人都从这里拿 `BadgeArchive`：UI 不再判断「0 还是未上报」，
 * 也不直接读 attendance / geo / 协议字段。加字段只改这一层与一个展示组件。
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
  sessionDuration: string;
  todayDuration: string;
  weekHours: number;
  dailyAverageHours: number;
  seniorityDays: number;
  totalHours: string;
  firstJoinDate: string;
  streakDays: number;
  activity: {
    steps: number;
    distanceM: number;
    slackCount: number;
    ventedCount: number;
    /** 成功击倒他人的累计次数 */
    knockdownCount: number;
    overtimeCount: number;
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
  /** false 时工时/履历字段显示「未上报」，不拿 0 冒充真实数据 */
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
  /** 服务端会话秒数（ADR-0060）；`null` 表示当前不在线，档案显示 `--:--` */
  onlineSec: number | null;
  /** 服务端当前记录的收到赞数；缺省 0（旧服务端 / 刚入场） */
  likes?: number;
  /** 本地解锁的成就戳印；缺省空数组 */
  achievements?: string[];
  now?: number;
}

function hoursOf(minutes: number): number {
  return Math.round((Math.max(0, minutes) / 60) * 10) / 10;
}

/** 本人档案：数据来自本地 store，不经过网络。 */
export function buildSelfArchive(input: SelfArchiveInput): BadgeArchive {
  const now = input.now ?? Date.now();
  const todayMs = input.attendance.dailyRecords[dayKey(now)] ?? 0;
  const weekMinutes = getWeekMinutes(input.attendance, now);
  const totalMinutes = Math.max(0, input.attendance.totalOnlineMs) / 60_000;
  const activeDays = getActiveDays(input.attendance.dailyRecords);
  const averageHours = getDailyAverageHours(input.attendance);
  const seniorityDays = getSeniorityDays(input.attendance.firstJoinDate, now);
  const streakDays = getStreakDays(input.attendance.dailyRecords, now);
  const job = getJobTitle(averageHours);
  const stamp = getStampTitle(averageHours, seniorityDays, {
    streakDays,
    steps: input.stats.steps,
    slackCount: input.stats.slackCount,
    rank: input.rank,
  });
  return {
    name: input.name,
    employeeNo: employeeNumber(input.name),
    species: input.species,
    appearance: input.appearance,
    isSelf: true,
    likes: Math.max(0, Math.floor(input.likes ?? 0)),
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
    // 与牛马榜「在岗」、左上角工牌同源：服务端会话秒数（ADR-0060）
    sessionDuration: input.onlineSec === null ? '--:--' : formatOnline(input.onlineSec),
    todayDuration: formatDuration(todayMs),
    weekHours: hoursOf(weekMinutes),
    dailyAverageHours: averageHours,
    seniorityDays,
    totalHours: (totalMinutes / 60).toFixed(1),
    firstJoinDate: input.attendance.firstJoinDate || '未上报',
    streakDays,
    activity: {
      steps: Math.max(0, Math.floor(input.stats.steps)),
      distanceM: Math.max(0, Math.floor(input.stats.distancePx / 25)),
      slackCount: Math.max(0, Math.floor(input.stats.slackCount)),
      ventedCount: Math.max(0, Math.floor(input.stats.ventedCount)),
      knockdownCount: Math.max(0, Math.floor(input.stats.knockdownCount)),
      overtimeCount: Math.max(0, Math.floor(input.stats.overtimeCount)),
    },
    board: input.board,
    rank: input.rank,
    stamp,
    stampRed: averageHours > 8,
    achievements: input.achievements ?? [],
    hasCareer: true,
  };
}

/** 他人档案：数据来自 2Hz 工牌推送，字段缺失时统一显示「未上报」。 */
export function buildRemoteArchive(badge: PlayerBadge, now = Date.now()): BadgeArchive {
  const career: CareerSummary | undefined = badge.career;
  const hasCareer = career !== undefined;
  const effective = career ? withCareerDelta(career, badge.onlineSec) : EMPTY_CAREER;
  const activeDays = effective.activeDays;
  const averageHours =
    hasCareer && activeDays > 0
      ? Math.round((effective.totalOnlineMinutes / activeDays / 60) * 10) / 10
      : 0;
  const seniorityDays = hasCareer ? getSeniorityDays(effective.firstJoinDate, now) : 0;
  const job = getJobTitle(averageHours);
  const stamp = hasCareer
    ? getStampTitle(averageHours, seniorityDays, {
        streakDays: effective.streakDays,
        steps: effective.steps,
        slackCount: effective.slackCount,
        rank: badge.rank,
      })
    : '未上报';
  return {
    name: badge.name,
    employeeNo: employeeNumber(badge.name),
    species: badge.species,
    appearance: badge.appearance,
    isSelf: false,
    likes: Math.max(0, Math.floor(badge.likes)),
    liked: badge.liked,
    department: departmentOf(badge.name),
    shift: shiftOf(badge.name),
    jobTitle: hasCareer ? job.title : '未上报',
    ...(hasCareer && job.warning ? { jobWarning: job.warning } : {}),
    jobColor: hasCareer ? job.color : 'text-mist-500',
    status: badge.status,
    region: badge.region || '园区',
    location: effective.province ? `中国 · ${effective.province}` : '未上报',
    pose: poseLabel(badge.pose, badge.moving, badge.seated),
    seat: seatLabel(badge.seatKind),
    sessionDuration: formatOnline(badge.onlineSec),
    todayDuration: hasCareer ? formatDuration(effective.todayMinutes * 60_000) : '未上报',
    weekHours: hasCareer ? hoursOf(effective.weekMinutes) : 0,
    dailyAverageHours: averageHours,
    seniorityDays,
    totalHours: hasCareer ? (effective.totalOnlineMinutes / 60).toFixed(1) : '未上报',
    firstJoinDate: hasCareer && effective.firstJoinDate ? effective.firstJoinDate : '未上报',
    streakDays: effective.streakDays,
    activity: {
      steps: Math.max(0, Math.floor(effective.steps)),
      distanceM: Math.max(0, Math.floor(effective.distanceM)),
      slackCount: Math.max(0, Math.floor(effective.slackCount)),
      ventedCount: Math.max(0, Math.floor(effective.ventedCount)),
      knockdownCount: Math.max(0, Math.floor(effective.knockdownCount)),
      overtimeCount: Math.max(0, Math.floor(effective.overtimeCount)),
    },
    board: badge.board,
    rank: badge.rank,
    stamp,
    stampRed: hasCareer && averageHours > 8,
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
    dailyAverageHours: archive.dailyAverageHours,
    stamp: archive.stamp,
    weekHours: archive.weekHours,
    streakDays: archive.streakDays,
    department: archive.department,
    shift: archive.shift,
    activity: archive.activity,
    rank: archive.rank,
    isSelf: archive.isSelf,
    hasCareer: archive.hasCareer,
  };
}
