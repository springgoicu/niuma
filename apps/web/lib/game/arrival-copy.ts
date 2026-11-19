/**
 * 过门区域横幅的文案与状态机（ADR 见 docs/adr：纯客户端表现，无协议、不落盘）。
 *
 * 三条纪律：
 * 1. **纯函数**：不碰 Pixi、不碰 DOM、不读时钟——`now` 由调用方传入，
 *    因此 `bun:test` 里能直接跑「一拍不弹 / 两拍弹 / 冷却内不重复」；
 * 2. **零第二份坐标**：区名与区色全部从 `DISTRICTS` / `VENUES` 反查，
 *    与指路牌书脊、小地图区块是同一份色标；
 * 3. **不新增协议**：触发源是既有的 2Hz `onStats.region`，服务端完全不知情。
 *
 * 为什么用「连续两拍确认」而不是立即弹：区域名每 500ms 才更新一次，
 * 玩家站在门线上左右挪半步就会让名字来回跳；两拍确认 + 4 秒冷却之后，
 * 只有当人真的进了另一处才会出现横幅。
 */

import { DISTRICTS, PLAZA_REGION_NAME, VENUES, type DistrictId } from '@niuma/shared-types';
import { VENUE_COLORS } from './venue-palette';

/** 连续几拍（`onStats` 的 500ms 节拍）确认后才算真的进了这个区域 */
export const ARRIVAL_CONFIRM_TICKS = 2;
/** 冷却：同一个区域在冷却期内不重播，门口来回蹭不会连闪 */
export const ARRIVAL_COOLDOWN_MS = 4000;
/** 区域名兜底：`regionAt` 在五区之外返回它 */
const WILDS = '园区野地';

export interface ArrivalState {
  /** 已经展示过的区域名：一直待在这里不会再弹 */
  readonly shown: string;
  /** 正在确认的区域名 */
  readonly pending: string;
  /** 该区域连续命中的拍数 */
  readonly hits: number;
  /** 上次弹出的时刻（调用方的单调时钟毫秒） */
  readonly lastAt: number;
}

/** 横幅的展示内容：区名 + 一句职场调侃 + 区色 */
export interface ArrivalCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly color: number;
}

/** 初始状态：`lastAt = 0` 让入场后的第一次过门不受冷却影响 */
export function initialArrivalState(): ArrivalState {
  return { shown: '', pending: '', hits: 0, lastAt: 0 };
}

/** 五区大区的副标题：区内场所没单列时用它 */
const DISTRICT_SUBTITLES: Record<DistrictId, string> = {
  corporate: '上班的方向，鞋底自动变重',
  amusement: '摸鱼合法区，输了算工伤',
  living: '下班之后才敢往这边走',
  service: '排队、反省、抢救，一条龙',
  scenery: '看水的人，KPI 都留在岸上',
};

/**
 * 具体场所的副标题：键是 `VENUES[].name` 与 `PLAZA_REGION_NAME`。
 *
 * 只写玩家一眼能认出来的地方；没列到的场所回落到所属大区的那一句，
 * 所以新增场所不会出现「只有标题没有副标题」的空条。
 */
const PLACE_SUBTITLES: Readonly<Record<string, string>> = {
  [PLAZA_REGION_NAME]: '打卡从这圈石砖开始',
  工作区: '工位已经记住你的体温',
  会议室: '三十分钟，八个待办',
  发泄区: '老板的膝盖今天也照常',
  财神供案: '香火比涨薪灵',
  紫砂茶台: '茶凉了，事还没完',
  卫生间: '带薪三十秒，人间净土',
  小黑屋: '反省一下，为什么还在这',
  护士急救站: '工伤鉴定，先量血压',
  游乐园: '摩天轮不查考勤',
  不夜城夜店: '霓虹街最贵的灯牌，谁买下归谁',
  霓虹改车铺: '街头潮人聚集地，按 E 先过两招',
  夜市拉面摊: '深夜热汤配宵夜，第一套地契很稳',
  宿舍区: '被子比会议更懂你',
  家庭影音室: '黑暗里没有 OKR',
  牛马公寓: '钥匙在手，工牌放门口',
  摸鱼一号院: '有钱人的摸鱼，叫生活',
  摸鱼二号院: '有钱人的摸鱼，叫生活',
  摸鱼湖钓屋: '坐看风平浪静，顺便收一棵摇钱树',
  翠竹隐士居: '竹影半墙，KPI 追不上来',
  沉思畔茶院: '临塘品茗，园区北岸的私人茶坊',
  摸鱼湖: '水面比周报平静',
  沉思浅塘: '想清楚了再回去',
  涟漪湖: '一圈圈，比 KPI 温柔',
  [WILDS]: '这里没有工位，只有草',
};

/** 副标题兜底：真的遇到没登记的名字，也别让横幅空着半行 */
const FALLBACK_SUBTITLE = '打卡点已更新';

/** 区域名 → 所属大区（找不到返回 undefined） */
function districtOf(region: string): DistrictId | undefined {
  if (region === PLAZA_REGION_NAME) return undefined;
  const venue = VENUES.find((spec) => spec.name === region);
  if (venue) return venue.district;
  const district = DISTRICTS.find((spec) => spec.name === region);
  return district?.id;
}

/** 区域色：场所 → 所属大区色；广场与野地回落广场暖光 */
function colorOf(region: string, districtId: DistrictId | undefined): number {
  if (districtId) {
    const district = DISTRICTS.find((spec) => spec.id === districtId);
    if (district) return district.color;
  }
  return VENUE_COLORS.plaza.glow;
}

/** 区域名 → 横幅内容：标题就是区域名本身，副标题按「场所 → 大区 → 兜底」逐级回落 */
export function arrivalCopy(region: string): ArrivalCopy {
  const districtId = districtOf(region);
  const districtSubtitle = districtId ? DISTRICT_SUBTITLES[districtId] : undefined;
  const subtitle = PLACE_SUBTITLES[region] ?? districtSubtitle ?? FALLBACK_SUBTITLE;
  return { title: region, subtitle, color: colorOf(region, districtId) };
}

/**
 * 推进一拍：返回下一状态与本拍是否该弹横幅。
 *
 * `region` 为空串（尚未入场 / 断线）时只清确认计数，不动 `shown`——
 * 重连回到原处不该再弹一次。
 */
export function stepArrival(
  state: ArrivalState,
  region: string,
  now: number,
): { next: ArrivalState; fire: boolean } {
  if (!region || region === state.shown) {
    if (state.pending === '' && state.hits === 0) return { next: state, fire: false };
    return { next: { ...state, pending: '', hits: 0 }, fire: false };
  }
  const hits = region === state.pending ? state.hits + 1 : 1;
  if (hits < ARRIVAL_CONFIRM_TICKS || now - state.lastAt < ARRIVAL_COOLDOWN_MS) {
    // 冷却期内仍继续累计：冷却一过、只要人还站在这儿，下一拍就会正常弹出
    return { next: { ...state, pending: region, hits }, fire: false };
  }
  return { next: { shown: region, pending: '', hits: 0, lastAt: now }, fire: true };
}
