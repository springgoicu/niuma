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
 * 名字都控制在 8 个汉字以内（显示宽 16），工号与部门由客户端按名字哈希派生，
 * 所以只要名字正常，工牌看上去与真人完全一样。
 */
export interface NpcProfile {
  name: string;
  appearance: CharacterAppearance;
  /** 工牌上的常驻状态；空串表示不设置 */
  status: string;
  /** 合成考勤：只用于工牌展示，不进牛马榜 */
  career: CareerSummary;
  /** 步速系数：相对 MOVE_SPEED */
  speedFactor: number;
  /** 弹幕颜色索引：让频道里不同同事有稳定的个人色 */
  chatColor: number;
  /** 入场时刻：比开服早 30 分钟到 6 小时，看起来像已经上了一阵班 */
  joinedAt: number;
}

/** 名字池：优先真实感的职场昵称，避免「路人甲」这类一眼假的占位名 */
const NAME_POOL: readonly string[] = [
  '加班老张',
  '摸鱼小李',
  '周报机器',
  '咖啡续命王',
  '工位钉子户',
  '夜班实习生',
  '会议室常客',
  '打印机维修员',
  '带薪发呆员',
  '下班第一名',
  '周一综合症',
  '通勤两小时',
  '工位绿萝',
  '键盘敲击手',
  '午休计时员',
  'PPT 苦手',
  '表格炼金术士',
  '已读不回',
  '电梯口等人',
  '茶水间情报员',
  '迟到惯犯',
  '工牌不离身',
  '会议纪要员',
  '需求搬运工',
  '临时项目经理',
  '报销单猎人',
  '工位小卖部',
  '显示器亮度拉满',
  '耳机永动机',
  '微波炉排队王',
  '年假收藏家',
  '试用期小马',
  '午休散步员',
  '窗边工位',
  '九点半打卡',
  '六点零一分',
  '餐补计算器',
  '文件找不到',
  '工位充电宝',
  '静音模式',
  '周会记录官',
  '咖啡机守夜人',
  '工牌挂绳收藏家',
  '离下班还有八小时',
  '工位午睡冠军',
  '会前五分钟',
  '电梯按键员',
  '周一早高峰',
];

/**
 * 频道台词池：短、生活化、不带攻击性，读起来像同事在水群里随口一说。
 * 内置内容不需要审核；外置 JSON 的台词由 director 走与昵称同一套审核后再进入这里。
 */
export const NPC_CHAT_LINES: readonly string[] = [
  '这周的周报谁写完了，借我抄抄',
  '我去接杯咖啡，回来再改',
  '会议室又被占了，站着开吧',
  '打印机又卡纸了，谁去救一下',
  '今天食堂有红烧肉，早点去',
  '需求又变了，先做一版看看',
  '我先下班了，明天再说',
  '这个 bug 昨天还在的',
  '谁的工牌落在茶水间了',
  '下午三点开会，别忘了',
  '空调是不是又没开',
  '我刚点的外卖怎么还没到',
  '别催了，在做了',
  '这个排期有点紧',
  '先对齐一下，再动手',
  '我这边同步一下进度',
  '这版先上线，后面再优化',
  '你那个文件发我一份',
  '楼下咖啡买一送一',
  '今天应该不用加班吧',
  '周会能快点结束吗',
  '我先摸五分钟鱼',
  '工位旁边的绿萝又蔫了',
  '谁把微波炉弄糊了',
  '这需求看着有点眼熟',
  '先放着，明天再看',
  '我投屏又连不上了',
  '午休别叫我，谢谢',
];

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
      headwear: rng.chance(0.55) ? rng.pick(HEADWEAR_IDS) : 'none',
      eyewear: rng.chance(0.3) ? rng.pick(EYEWEAR_IDS) : 'none',
      neckwear: rng.chance(0.45) ? rng.pick(NECKWEAR_IDS) : 'none',
      hairstyle: rng.chance(0.7) ? rng.pick(HAIR_IDS) : 'none',
    },
  });
}

export interface NpcRosterOptions {
  speed: { min: number; max: number };
  now: number;
}

/**
 * 一次生成整份名册：名字洗牌后按顺序分配，超出池子时允许重名
 * （真人也会重名，重名比「同事 11 号」自然得多）。
 */
export function buildNpcRoster(rng: Rng, count: number, options: NpcRosterOptions): NpcProfile[] {
  const names = rng.shuffle(NAME_POOL);
  const profiles: NpcProfile[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = names[index % names.length]!;
    profiles.push({
      name,
      appearance: buildNpcAppearance(rng),
      status: rng.pick(STATUS_POOL),
      career: buildNpcCareer(rng, options.now),
      speedFactor: rng.range(options.speed.min, options.speed.max),
      chatColor: rng.int(0, 7),
      // 已经上了一阵班：工牌上的「本次在岗」从半小时到六小时不等
      joinedAt: options.now - rng.int(1_800, 21_600) * 1_000,
    });
  }
  return profiles;
}
