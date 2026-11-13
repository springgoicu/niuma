import {
  EYEWEAR_IDS,
  HAIR_IDS,
  HEADWEAR_IDS,
  NECKWEAR_IDS,
  PATTERN_IDS,
  SNOUT_IDS,
  TAIL_IDS,
  sanitizeAppearance,
  type CareerSummary,
  type CharacterAppearance,
  type Species,
} from '@niuma/shared-types';
import type { Rng } from './rng';

/**
 * NPC 的名册：名字、外观、常驻状态与合成考勤。
 *
 * 这些内容全部是服务端内置的静态池，不读玩家输入、不落库、不进审核；
 * 名字由「常见姓 + 普通名/牛马梗名」随机组合而成，都是 2–3 个汉字（显示宽 ≤ 16）；
 * 工号与部门由客户端按名字哈希派生，所以只要名字正常，工牌看上去与真人完全一样。
 */
/** 普通同事：随机便装，在园区里随便走走停停 */
export const NPC_ROLE_WORKER = 0;
/** 保安：整套警服 + 头顶警灯，同样全岛巡逻 */
export const NPC_ROLE_GUARD = 1;
export type NpcRole = typeof NPC_ROLE_WORKER | typeof NPC_ROLE_GUARD;

/** 固定 3 位保安；不随 GAME_NPC_COUNT 变化，关停仍由 GAME_NPC_ENABLED/count=0 控制 */
export const GUARD_COUNT = 3;

export interface NpcProfile {
  name: string;
  appearance: CharacterAppearance;
  /** 工牌上的常驻状态；空串表示不设置 */
  status: string;
  /** 合成考勤：只用于工牌展示，不进牛马榜 */
  career: CareerSummary;
  /** 步速系数：相对 MOVE_SPEED */
  speedFactor: number;
  /** 普通同事或保安：随 spawn 包下发，客户端据此画警灯 */
  role: NpcRole;
  /** 入场时刻：比开服早 30 分钟到 6 小时，看起来像已经上了一阵班 */
  joinedAt: number;
}

/**
 * 姓名生成：常见姓氏 × 普通名字，再掺一批牛马梗名（加班、摸鱼、周报…）。
 *
 * 每次开服洗牌后取前 N 个，5 位同事互不重名，下次开服又是另一批人；
 * 组合空间远大于 `MAX_NPC_COUNT`（64），因此不需要循环重试兜底。
 * 全部是 2–3 个汉字，天然落在 8 汉字 / 16 显示宽的头顶预算内。
 */
const SURNAME_POOL: readonly string[] = [
  '张',
  '王',
  '李',
  '赵',
  '刘',
  '陈',
  '杨',
  '黄',
  '周',
  '吴',
  '徐',
  '孙',
  '马',
  '朱',
  '胡',
  '郭',
  '何',
  '高',
  '林',
  '罗',
  '郑',
  '梁',
  '谢',
  '宋',
  '唐',
  '许',
  '邓',
  '冯',
  '韩',
  '曹',
  '曾',
  '彭',
  '萧',
  '蔡',
  '潘',
  '田',
  '董',
  '袁',
  '于',
  '余',
];

const GIVEN_NAME_POOL: readonly string[] = [
  '伟',
  '静',
  '敏',
  '磊',
  '洋',
  '芳',
  '娜',
  '强',
  '军',
  '杰',
  '涛',
  '明',
  '超',
  '霞',
  '平',
  '刚',
  '鹏',
  '宇',
  '辉',
  '玲',
  '婷',
  '勇',
  '艳',
  '斌',
  '思远',
  '子涵',
  '雨欣',
  '嘉怡',
  '晓东',
  '雅静',
  '志强',
  '梦瑶',
  '佳琪',
  '浩然',
  '梓涵',
  '若曦',
  '明轩',
  '欣怡',
  '博文',
  '雨桐',
  '子豪',
  '诗涵',
  '一鸣',
  '嘉伟',
  '晨曦',
  '思琪',
  '俊杰',
  '婉清',
  '佳慧',
  '文涛',
];

/** 牛马梗名：只在名这一格玩梗，姓仍是真姓，读起来像「张加班」这种外号 */
const MEME_NAME_POOL: readonly string[] = [
  '加班',
  '摸鱼',
  '周报',
  '打卡',
  '开会',
  '续命',
  '返工',
  '赶工',
  '待命',
  '熬夜',
  '通勤',
  '搬砖',
  '划水',
  '复盘',
];

/** 全量「姓 × 名」组合：普通名与梗名混洗，约四分之一带梗 */
const NAME_COMBOS: readonly string[] = [
  ...SURNAME_POOL.flatMap((surname) => GIVEN_NAME_POOL.map((given) => `${surname}${given}`)),
  ...SURNAME_POOL.flatMap((surname) => MEME_NAME_POOL.map((meme) => `${surname}${meme}`)),
];

/** 生成 `count` 个互不重名的随机姓名；`count` 由调用方按 `MAX_NPC_COUNT` 钳过 */
export function buildNpcNames(rng: Rng, count: number): string[] {
  const limit = Math.max(0, Math.min(count, NAME_COMBOS.length));
  return rng.shuffle(NAME_COMBOS).slice(0, limit);
}

const STATUS_POOL: readonly string[] = [
  '',
  '',
  '',
  '开会中',
  '摸鱼中',
  '等下班',
  '写周报',
  '勿扰',
  '续命中',
  '带薪发呆',
  '找文件',
  '午休中',
];

const PROVINCE_POOL: readonly string[] = [
  '广东',
  '浙江',
  '江苏',
  '四川',
  '山东',
  '河南',
  '湖北',
  '福建',
  '陕西',
  '湖南',
];

interface NpcLook {
  body: number;
  pattern: number;
  hoof: number;
  eyes: number;
  extra: number;
  snout: number;
  tail: number;
  headwear: number;
  eyewear: number;
  neckwear: number;
  hairstyle: number;
}

/** 协调配色：整套使用，避免随机拼色拼出脏色 */
const LOOKS: readonly NpcLook[] = [
  {
    body: 0xefe6d6,
    pattern: 0xb89f86,
    hoof: 0x6b5a48,
    eyes: 0x3a2f26,
    extra: 0xd8c4a8,
    snout: 0xefe6d6,
    tail: 0xefe6d6,
    headwear: 0x9a7b62,
    eyewear: 0x7d8c74,
    neckwear: 0xb96b83,
    hairstyle: 0x6b5136,
  },
  {
    body: 0xf7dde2,
    pattern: 0xfffaf9,
    hoof: 0x8d5a63,
    eyes: 0x2a1f22,
    extra: 0xf3c6cf,
    snout: 0xf7dde2,
    tail: 0xf7dde2,
    headwear: 0xc9748a,
    eyewear: 0xd8b48e,
    neckwear: 0xb96b83,
    hairstyle: 0x5a3a41,
  },
  {
    body: 0x6d4a55,
    pattern: 0xe6c9d2,
    hoof: 0x3b2a30,
    eyes: 0xf4e3e8,
    extra: 0xc98ea0,
    snout: 0x8a5c68,
    tail: 0x6d4a55,
    headwear: 0xb96b83,
    eyewear: 0xd8b48e,
    neckwear: 0xe6c9d2,
    hairstyle: 0x3b2a30,
  },
  {
    body: 0xd7f0e4,
    pattern: 0x8fb8a8,
    hoof: 0x4a6b5e,
    eyes: 0x22332b,
    extra: 0xa8d8c4,
    snout: 0xd7f0e4,
    tail: 0xd7f0e4,
    headwear: 0x4f8c74,
    eyewear: 0x66756a,
    neckwear: 0xc9a37a,
    hairstyle: 0x3f5a4a,
  },
  {
    body: 0xc98a5a,
    pattern: 0xf0d6b8,
    hoof: 0x6b4a32,
    eyes: 0x2a201a,
    extra: 0xe0b080,
    snout: 0xd8a878,
    tail: 0xc98a5a,
    headwear: 0x8a5a3a,
    eyewear: 0x4a4040,
    neckwear: 0x3f6b8a,
    hairstyle: 0x4a3020,
  },
  {
    body: 0x3f4a6b,
    pattern: 0x9aa8c9,
    hoof: 0x2a3040,
    eyes: 0xe8ecf4,
    extra: 0x7a88b0,
    snout: 0x5a6488,
    tail: 0x3f4a6b,
    headwear: 0x2c4a7c,
    eyewear: 0xc9a37a,
    neckwear: 0xe6c9d2,
    hairstyle: 0x1f2430,
  },
];

const DAY_MS = 86_400_000;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 首次入职日期：UTC 日历日，避免本地时区把日期挪一天 */
function joinDateOf(now: number, daysAgo: number): string {
  const date = new Date(now - daysAgo * DAY_MS);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * 合成一份自洽的考勤：工龄越长，累计工时与步数越大；今日/本周不越界。
 * 所有值都落在 `career.ts` 的协议上限内，编码时不需要再截断。
 */
export function buildNpcCareer(rng: Rng, now: number): CareerSummary {
  const daysAgo = rng.int(6, 400);
  const perDayMinutes = rng.int(180, 520);
  const activeDays = Math.max(1, Math.round(daysAgo * rng.range(0.5, 0.9)));
  const todayMinutes = rng.int(0, Math.min(480, perDayMinutes));
  const weekMinutes = Math.min(10_080, todayMinutes + rng.int(0, 4) * perDayMinutes);
  const steps = Math.min(99_999_999, activeDays * rng.int(600, 2_400));

  return {
    firstJoinDate: joinDateOf(now, daysAgo),
    totalOnlineMinutes: Math.min(60 * 24 * 365 * 100, activeDays * perDayMinutes),
    activeDays: Math.min(36_500, activeDays),
    todayMinutes,
    weekMinutes,
    streakDays: rng.int(0, Math.min(30, daysAgo)),
    steps,
    distanceM: Math.round(steps * rng.range(0.6, 0.9)),
    slackCount: rng.int(0, 200),
    ventedCount: rng.int(0, 20),
    knockdownCount: rng.int(0, 5),
    overtimeCount: rng.int(0, 40),
    province: rng.pick(PROVINCE_POOL),
    reportedOnlineSec: 0,
  };
}

/** 普通同事可选配饰：警用件只留给保安，避免便装同事混进大檐帽 */
const WORKER_HEADWEAR_IDS = HEADWEAR_IDS.filter((id) => id !== 'police_cap');
const WORKER_NECKWEAR_IDS = NECKWEAR_IDS.filter((id) => id !== 'epaulette');

/** 随机外观：物种、配色、斑纹、口鼻、角/鬃、尾巴与四件配饰 */
export function buildNpcAppearance(rng: Rng): CharacterAppearance {
  const species: Species = rng.chance(0.5) ? 'cow' : 'horse';
  const look = rng.pick(LOOKS);
  const parts: CharacterAppearance['parts'] = {
    patternId: rng.int(0, PATTERN_IDS.length - 1),
    snoutId: rng.int(0, SNOUT_IDS.length - 1),
    tailId: rng.int(0, TAIL_IDS.length - 1),
  };
  if (species === 'cow') parts.hornId = rng.int(0, 3);
  else parts.maneId = rng.int(0, 2);

  return sanitizeAppearance({
    species,
    colors: { ...look },
    parts,
    cosmetics: {
      // 配饰大概率戴一件，留一部分「什么都不戴」避免人人像制服
      headwear: rng.chance(0.55) ? rng.pick(WORKER_HEADWEAR_IDS) : 'none',
      eyewear: rng.chance(0.3) ? rng.pick(EYEWEAR_IDS) : 'none',
      neckwear: rng.chance(0.45) ? rng.pick(WORKER_NECKWEAR_IDS) : 'none',
      hairstyle: rng.chance(0.7) ? rng.pick(HAIR_IDS) : 'none',
    },
  });
}

/** 保安制服：深藏蓝主体 + 银白肩章/反光条，帽子固定大檐警帽 */
const GUARD_LOOK = {
  body: 0x2c3e66,
  pattern: 0x1d2a4a,
  hoof: 0x141c2e,
  eyes: 0x1a1f2a,
  extra: 0x35507f,
  snout: 0x3a4d78,
  tail: 0x2c3e66,
  headwear: 0x1f2c4a,
  eyewear: 0x141a26,
  neckwear: 0xdfe6f0,
  hairstyle: 0x1a2233,
} as const;

/** 保安外观：整套警服，物种与角/鬃仍随机，避免三个保安长得一模一样 */
export function buildGuardAppearance(rng: Rng): CharacterAppearance {
  const species: Species = rng.chance(0.5) ? 'cow' : 'horse';
  const parts: CharacterAppearance['parts'] = {
    // 斑纹固定 none：制服要干净，斑块会把反光条打碎
    patternId: 0,
    snoutId: rng.int(0, SNOUT_IDS.length - 1),
    tailId: rng.int(0, TAIL_IDS.length - 1),
  };
  if (species === 'cow') parts.hornId = rng.int(0, 3);
  else parts.maneId = rng.int(0, 2);

  return sanitizeAppearance({
    species,
    colors: { ...GUARD_LOOK },
    parts,
    cosmetics: {
      // 帽子与肩章是保安的识别件；墨镜按概率戴，避免三个人的脸完全一样
      headwear: 'police_cap',
      eyewear: rng.chance(0.6) ? 'sun' : 'none',
      neckwear: 'epaulette',
      hairstyle: 'buzz',
    },
  });
}

export interface NpcRosterOptions {
  speed: { min: number; max: number };
  now: number;
}

export interface NpcRosterCounts {
  /** 普通同事数量 */
  workers: number;
  /** 保安数量 */
  guards: number;
}

/** 一次生成整份名册：同事与保安姓名互不重名，其余字段各自随机 */
export function buildNpcRoster(
  rng: Rng,
  counts: NpcRosterCounts,
  options: NpcRosterOptions,
): NpcProfile[] {
  const workers = Math.max(0, counts.workers);
  const guards = Math.max(0, counts.guards);
  const total = workers + guards;
  const names = buildNpcNames(rng, total);
  const profiles: NpcProfile[] = [];
  for (let index = 0; index < total; index += 1) {
    const isGuard = index >= workers;
    profiles.push({
      name: names[index]!,
      appearance: isGuard ? buildGuardAppearance(rng) : buildNpcAppearance(rng),
      // 保安头顶留给警灯，不设常驻状态；同事保留随机状态
      status: isGuard ? '' : rng.pick(STATUS_POOL),
      career: buildNpcCareer(rng, options.now),
      speedFactor: rng.range(options.speed.min, options.speed.max),
      role: isGuard ? NPC_ROLE_GUARD : NPC_ROLE_WORKER,
      // 已经上了一阵班：工牌上的「本次在岗」从半小时到六小时不等
      joinedAt: options.now - rng.int(1_800, 21_600) * 1_000,
    });
  }
  return profiles;
}
