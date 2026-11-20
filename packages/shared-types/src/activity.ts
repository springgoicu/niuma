/**
 * 全园区交互播报（ADR-0112）。
 *
 * 服务端把「谁、在哪、做了什么」套成一句成品文案，客户端只负责按 `kind`
 * 选样式与配色。编号只追加不复用：旧客户端收到不认识的 kind 直接跳过，
 * 新服务端也不会因为旧客户端而少发。
 *
 * 这里同时定义「分级」：强演出事件必达、生活类同类合并、常规动作只发给
 * 看不见这个人的玩家——200 人同屏时逐条广播坐下 / 挥手会直接刷爆下行。
 */

/** 播报事件编号。1–11 为服务端权威事件，12 起为客户端上报的纯观感事件 */
export const ACTIVITY_KIND = {
  /** 有人被创倒，急救站出车 */
  AmbulanceDispatched: 1,
  /** 伤员被抬上车 */
  AmbulanceLoaded: 2,
  /** 伤员被扶上病床 */
  ClinicTreating: 3,
  /** 治疗完成、重新站起 */
  ClinicRecovered: 4,
  /** 保安接到派单 */
  GuardDispatched: 5,
  /** 保安抓住目标、开始押送 */
  GuardEscort: 6,
  /** 目标被送进小黑屋反省点 */
  GuardJailed: 7,
  /** 被人创飞 */
  VentKnockdown: 8,
  /** 踢了老板一脚 */
  BossHit: 9,
  /** 尾刀打倒老板 */
  BossDown: 10,
  /** 工牌被点赞 */
  Like: 11,
  /** 许愿台上香 */
  Incense: 12,
  /** 茶台续杯 */
  Tea: 13,
  /** 售货机买水 */
  Vending: 14,
  /** 饮水机接水 */
  Water: 15,
  /** 咖啡机打咖啡 */
  Coffee: 16,
  /** 会议室里说话 */
  Meeting: 17,
  /** 影音室看片 */
  Cinema: 18,
  /** 游乐园玩一把 */
  Arcade: 19,
  /** 摸鱼亭摸鱼 */
  Loaf: 20,
  /** 坐下 */
  Sit: 21,
  /** 躺下 */
  Lie: 22,
  /** 起身 */
  Stand: 23,
  /** 跳跃 */
  Jump: 24,
  /** 25 / 26 曾用于赌桌圆凳与擂台观战席：编号永久留空不复用 */
  TableSeat: 25,
  RingSeat: 26,
  /** 打招呼 */
  Wave: 27,
  /** 买下或溢价收购园区房产冠名权 */
  VillaTrade: 28,
  /** 河边钓鱼出大货 */
  FishingCatch: 29,
  /** 园区特技驾驶 */
  VehicleStunt: 30,
  /** 街头通缉星级飙升 */
  WantedPeak: 31,
  /** 街头心肺复苏救人 */
  CprRescue: 32,
  /** 街头涂鸦占领墙面 */
  TurfCapture: 33,
  /** 完成街头零工配送/悬赏 */
  GigComplete: 34,
} as const;
export type ActivityKind = (typeof ACTIVITY_KIND)[keyof typeof ACTIVITY_KIND];

/** 播报分级：决定去重窗口、令牌桶优先级与是否排除「已经看得见的人」 */
export type ActivityTier = 'dramatic' | 'life' | 'routine';

/**
 * 分级表。
 *
 * `dramatic`：有实体演出的被动事件，身边人已经看到动画，只发给看不见的人；
 * `life`：纯本机演出（气泡、光晕、台词），身边人也看不到，因此不排除 AOI；
 * `routine`：坐下 / 挥手 / 跳跃这类高频动作，只发给看不见的人。
 */
export const ACTIVITY_TIER: ReadonlyMap<number, ActivityTier> = new Map<number, ActivityTier>([
  [ACTIVITY_KIND.AmbulanceDispatched, 'dramatic'],
  [ACTIVITY_KIND.AmbulanceLoaded, 'dramatic'],
  [ACTIVITY_KIND.ClinicTreating, 'dramatic'],
  [ACTIVITY_KIND.ClinicRecovered, 'dramatic'],
  [ACTIVITY_KIND.GuardDispatched, 'dramatic'],
  [ACTIVITY_KIND.GuardEscort, 'dramatic'],
  [ACTIVITY_KIND.GuardJailed, 'dramatic'],
  [ACTIVITY_KIND.VentKnockdown, 'dramatic'],
  [ACTIVITY_KIND.BossDown, 'dramatic'],
  [ACTIVITY_KIND.BossHit, 'life'],
  [ACTIVITY_KIND.Like, 'life'],
  [ACTIVITY_KIND.Incense, 'life'],
  [ACTIVITY_KIND.Tea, 'life'],
  [ACTIVITY_KIND.Vending, 'life'],
  [ACTIVITY_KIND.Water, 'life'],
  [ACTIVITY_KIND.Coffee, 'life'],
  [ACTIVITY_KIND.Meeting, 'life'],
  [ACTIVITY_KIND.Cinema, 'life'],
  [ACTIVITY_KIND.Arcade, 'life'],
  [ACTIVITY_KIND.Loaf, 'life'],
  [ACTIVITY_KIND.Sit, 'routine'],
  [ACTIVITY_KIND.Lie, 'routine'],
  [ACTIVITY_KIND.Stand, 'routine'],
  [ACTIVITY_KIND.Jump, 'routine'],
  [ACTIVITY_KIND.TableSeat, 'routine'],
  [ACTIVITY_KIND.RingSeat, 'routine'],
  [ACTIVITY_KIND.Wave, 'routine'],
  [ACTIVITY_KIND.VillaTrade, 'dramatic'],
  [ACTIVITY_KIND.FishingCatch, 'dramatic'],
  [ACTIVITY_KIND.VehicleStunt, 'routine'],
  [ACTIVITY_KIND.WantedPeak, 'dramatic'],
  [ACTIVITY_KIND.CprRescue, 'dramatic'],
  [ACTIVITY_KIND.TurfCapture, 'dramatic'],
  [ACTIVITY_KIND.GigComplete, 'life'],
]);

/** 允许客户端上报的编号：只能报纯观感事件，权威事件一律不接受伪造 */
export const ACTIVITY_REPORTABLE: ReadonlySet<number> = new Set<number>([
  ACTIVITY_KIND.Incense,
  ACTIVITY_KIND.Tea,
  ACTIVITY_KIND.Vending,
  ACTIVITY_KIND.Water,
  ACTIVITY_KIND.Coffee,
  ACTIVITY_KIND.Meeting,
  ACTIVITY_KIND.Cinema,
  ACTIVITY_KIND.Arcade,
  ACTIVITY_KIND.Loaf,
  ACTIVITY_KIND.Sit,
  ACTIVITY_KIND.Lie,
  ACTIVITY_KIND.Stand,
  ACTIVITY_KIND.Jump,
  ACTIVITY_KIND.TableSeat,
  ACTIVITY_KIND.RingSeat,
  ACTIVITY_KIND.Wave,
  ACTIVITY_KIND.VehicleStunt,
]);

/**
 * 每条播报最多 120 字节：长度字段只有 1 字节，中文按 3 字节算正好 40 字。
 * 公式：「X 在 Y 被创飞了」这类成品句不会超过 40 字，留出的余量足够长昵称。
 */
export const ACTIVITY_TEXT_MAX_BYTES = 120;

export const ACTIVITY_PACKET_BYTES = 9;
export const ACTIVITY_REPORT_BYTES = 3;

export interface ActivityTextParams {
  /** 事件主角的昵称 */
  name: string;
  /** 事件发生地；缺省时文案退化为不带地点的写法 */
  region?: string;
}

/**
 * 把事件编号套成一句面向全园区的话。
 *
 * 返回 `null` 表示「这个编号不该有文案」——调用方必须跳过而不是显示半句话。
 * 文案里的地点只对「被创飞」有意义：救护车与押送已经自带场所语义。
 */
export function formatActivity(kind: number, params: ActivityTextParams): string | null {
  const name = params.name.trim() || '一名牛马';
  const region = params.region && params.region.trim().length > 0 ? params.region.trim() : '';
  switch (kind) {
    case ACTIVITY_KIND.AmbulanceDispatched:
      return `急救站出车了：${name} 倒下了，救护车正在赶过去`;
    case ACTIVITY_KIND.AmbulanceLoaded:
      return `${name} 被抬上救护车，正送往急救站`;
    case ACTIVITY_KIND.ClinicTreating:
      return `值班护士把 ${name} 扶上了病床`;
    case ACTIVITY_KIND.ClinicRecovered:
      return `${name} 治疗完成，重新站起来了`;
    case ACTIVITY_KIND.GuardDispatched:
      return `保安出动了：${name} 好像要进小黑屋`;
    case ACTIVITY_KIND.GuardEscort:
      return `${name} 正被保安押着走`;
    case ACTIVITY_KIND.GuardJailed:
      return `${name} 被送进小黑屋反省点`;
    case ACTIVITY_KIND.VentKnockdown:
      return region ? `${name} 在${region}被创飞了` : `${name} 被创飞了`;
    case ACTIVITY_KIND.BossHit:
      return `${name} 一脚踢在老板身上`;
    case ACTIVITY_KIND.BossDown:
      return `${name} 把老板踢进了年度总结计划书`;
    case ACTIVITY_KIND.Like:
      return `有人给 ${name} 的工牌点了个赞`;
    case ACTIVITY_KIND.Incense:
      return `${name} 在许愿台上了香`;
    case ACTIVITY_KIND.Tea:
      return `${name} 在茶台续了杯茶`;
    case ACTIVITY_KIND.Vending:
      return `${name} 在售货机前买了瓶快乐水`;
    case ACTIVITY_KIND.Water:
      return `${name} 在饮水机前接了杯水`;
    case ACTIVITY_KIND.Coffee:
      return `${name} 在咖啡机前打了杯咖啡`;
    case ACTIVITY_KIND.Meeting:
      return `${name} 在会议室里说了句心里话`;
    case ACTIVITY_KIND.Cinema:
      return `${name} 在影音室看片看入了神`;
    case ACTIVITY_KIND.Arcade:
      return `${name} 在游乐园玩了一把`;
    case ACTIVITY_KIND.Loaf:
      return `${name} 在摸鱼亭里摸了会儿鱼`;
    case ACTIVITY_KIND.Sit:
      return region ? `${name} 在${region}坐下了` : `${name} 坐下了`;
    case ACTIVITY_KIND.Lie:
      return region ? `${name} 在${region}躺下了` : `${name} 躺下了`;
    case ACTIVITY_KIND.Stand:
      return `${name} 站了起来`;
    case ACTIVITY_KIND.Jump:
      return `${name} 蹦了一下`;
    case ACTIVITY_KIND.TableSeat:
      return `${name} 坐上了赌桌的圆凳`;
    case ACTIVITY_KIND.RingSeat:
      return `${name} 坐上了擂台观战席`;
    case ACTIVITY_KIND.Wave:
      return `${name} 打了个招呼`;
    case ACTIVITY_KIND.VillaTrade:
      return region ? `${name} 拿下了 ${region} 的冠名权` : `${name} 买下了一处园区地标`;
    case ACTIVITY_KIND.FishingCatch:
      return region ? `${name} 在${region}钓上了一条稀罕货` : `${name} 摸鱼钓上了罕见大货`;
    case ACTIVITY_KIND.VehicleStunt:
      return `${name} 踩下涡轮飙过园区环道`;
    case ACTIVITY_KIND.WantedPeak:
      return `${name} 被全园区保安拉响了最高通缉警报`;
    case ACTIVITY_KIND.CprRescue:
      return `${name} 在街头用 CPR 救醒了倒地的同事`;
    case ACTIVITY_KIND.TurfCapture:
      return region ? `${name} 在${region}留下了自己的街头涂鸦` : `${name} 占领了一面街头涂鸦墙`;
    case ACTIVITY_KIND.GigComplete:
      return `${name} 漂亮地完成了一单街头零工`;
    default:
      return null;
  }
}

/** 取分级；未知编号按 routine 处理，只上小地图、不占播报条 */
export function activityTierOf(kind: number): ActivityTier {
  return ACTIVITY_TIER.get(kind) ?? 'routine';
}

/**
 * 分级在 HUD 侧的数值编码：0 强演出 / 1 生活 / 2 常规。
 *
 * 服务端只关心字符串分级（决定去重窗口与授权），客户端拿数字当配色与读屏
 * 的数组下标——两套编码放同一处，避免各层各自硬写 0/1/2 对不上。
 */
export type ActivityTierCode = 0 | 1 | 2;

export const ACTIVITY_TIER_CODE: Readonly<Record<ActivityTier, ActivityTierCode>> = {
  dramatic: 0,
  life: 1,
  routine: 2,
};

export function activityTierCodeOf(kind: number): ActivityTierCode {
  return ACTIVITY_TIER_CODE[activityTierOf(kind)];
}
