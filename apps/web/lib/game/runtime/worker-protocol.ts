import type {
  BoardMetric,
  BoardPacket,
  CareerSummary,
  CharacterAppearance,
  ChatSendPacket,
  InteractRejectPacket,
  ItemEffectPacket,
  ItemRejectPacket,
  LikePacket,
  LoudspeakerPacket,
  PlayerEffectPacket,
  ShoutRejectPacket,
  NavTargetId,
  P2PActionRequest,
  P2PDuelStatePacket,
  P2PInviteNotifyPacket,
  P2PInviteRequest,
  P2PInviteResultPacket,
  P2PMatchPacket,
  P2PRespondRequest,
  P2PShowdownPacket,
  Pose,
  ShopBuyRequest,
  TipPacket,
  TipRequest,
  UseItemRequest,
  WalletSyncPacket,
  QueueStatusPacket,
  ResumeState,
  RingPacket,
  SeatKind,
  ApartmentRequest,
  ArenaBetRequest,
  ArenaPoolPacket,
  DiceBetRequest,
  DiceStatePacket,
  VillaRequest,
  VillaStatePacket,
  BossShockPacket,
  EventClaimResult,
  QuestStatePacket,
  WorkResultPacket,
  WorldEventPacket,
} from '@niuma/shared-types';
import type { PlayerBadge } from '../badge';
import type { DanmakuPrefs } from '../danmaku-prefs';
import type { ChatEntry, SessionStats } from '../session';
import type { ControlMessage, SnapshotPatch } from './control-channel';
import type { AudioEvent, SessionProfile } from './engine-env';

/**
 * 主线程 ↔ 渲染线程的有向消息。
 *
 * 纪律：**高频、每帧都要读最新值的量一律不进这里**——它们走
 * `control-channel.ts` 的定长块。这里只放低频事件（连接状态、聊天、工牌、
 * 姿态提示、导航、音效）与一次性指令（尺寸之外的初始化、暂停、销毁）。
 * 每条消息最多携带一段文本，且都发生在事件驱动路径上，不会卡渲染循环。
 */

export type EngineStatus = 'connecting' | 'queued' | 'online' | 'offline' | 'error';

export type MainToWorker =
  | {
      t: 'init';
      canvas: OffscreenCanvas;
      /** 共享内存可用时非空：输入不再需要任何消息 */
      control: SharedArrayBuffer | null;
      profile: SessionProfile;
      resume: ResumeState | undefined;
      wsUrl: string;
      parkId: string;
      /** 主线程的 location.search，Worker 没有 window 可取 */
      search: string;
      width: number;
      height: number;
      dpr: number;
      /** 弹幕偏好初值：localStorage 只能在主线程读 */
      danmaku: DanmakuPrefs;
      /** 最近一次上香的自然日（ADR-0061）：同样只能主线程读 */
      incenseDay: string;
      /** 匿名设备号（ADR-0081）：Worker 里 localStorage 不可用，只能由主线程带进来 */
      deviceId: string;
    }
  /** 小地图画布：可能晚于 init 到达，Worker 侧只换绘制目标 */
  | { t: 'minimap'; canvas: OffscreenCanvas }
  /** 发言：颜色与模式随包上行，渲染线程不关心 UI 状态 */
  | { t: 'chat'; packet: ChatSendPacket }
  /** 弹幕设置变更：总开关 / 不透明度 / 覆盖区域 */
  | { t: 'danmaku'; prefs: DanmakuPrefs }
  | { t: 'history'; cursor: number }
  | { t: 'status'; text: string }
  /** 改工牌名：与状态同一条低速通道 */
  | { t: 'name'; text: string }
  | { t: 'appearance'; appearance: CharacterAppearance }
  /** 考勤摘要补报：geo 就绪后与 60 秒心跳各发一次 */
  | { t: 'career'; career: CareerSummary }
  /** 拉取牛马榜：0 表示全部指标 */
  | { t: 'board'; metric: BoardMetric | 0 }
  /** 工牌点赞：服务端裁决，重复请求幂等 */
  | { t: 'like'; id: number }
  /** 牛马币互动（ADR-0082 / ADR-0083）：上行只带意图，裁决在服务端 */
  | { t: 'p2pInvite'; request: P2PInviteRequest }
  | { t: 'p2pRespond'; request: P2PRespondRequest }
  | { t: 'p2pAction'; request: P2PActionRequest }
  | { t: 'tip'; request: TipRequest }
  | { t: 'useItem'; request: UseItemRequest }
  | { t: 'shopBuy'; request: ShopBuyRequest }
  /** 大喇叭文案：编码侧截到 30 字，服务端再过一次审核（ADR-0085） */
  | { t: 'shout'; text: string }
  /** 热区建筑（ADR-0087）：上行只带意图 */
  | { t: 'diceBet'; request: DiceBetRequest }
  | { t: 'villa'; request: VillaRequest }
  | { t: 'arenaBet'; request: ArenaBetRequest }
  | { t: 'apartment'; request: ApartmentRequest }
  /** 打工产出与随机事件（ADR-0088）：上行只带意图 */
  | { t: 'claimWork'; combo: number }
  /** 搬砖终端开关：只驱动工位专注光，不上网络、不进协议 */
  | { t: 'working'; active: boolean }
  | { t: 'claimQuest'; questId: number }
  | { t: 'claimEvent'; index: number }
  | { t: 'navigate'; id: NavTargetId }
  /** 回中央广场：广场不是场所，上行只报一个意图，终点是出生点 */
  | { t: 'navigateHome' }
  | { t: 'cancelNav' }
  | { t: 'pick'; x: number; y: number }
  /** 订阅 / 退订某人的工牌：`null` 表示收起详情 */
  | { t: 'inspect'; id: number | null }
  | { t: 'retry' }
  | { t: 'pause'; paused: boolean }
  /** 无共享内存时的输入降级通道 */
  | { t: 'control'; message: ControlMessage }
  | { t: 'dispose' };

export type WorkerToMain =
  | { t: 'ready'; backend: string }
  /**
   * `code` 是给宿主看的机器可读分类，缺省表示普通状态。
   * `atlas-version`：图集版本与客户端布局不一致，页面已过期，应受控换图。
   */
  | { t: 'status'; status: EngineStatus; detail: string; code?: 'atlas-version' }
  | { t: 'queue'; queue: QueueStatusPacket | null }
  | { t: 'rejected'; reason: number }
  | { t: 'stats'; stats: SessionStats }
  | { t: 'chat'; entry: ChatEntry }
  | { t: 'history'; entries: ChatEntry[]; replace: boolean; hasMore: boolean }
  | { t: 'hint'; hint: string | null }
  | {
      t: 'localState';
      pose: Pose;
      seated: boolean;
      seatKind: SeatKind | null;
      /** 座位组：坐进赌桌圆凳即自动入局，主线程据此派生面板开关（ADR-0093） */
      seatGroup: string | null;
    }
  /** 导航目标：`'plaza'` 是客户端的「回中央广场」，不占共享场所 id */
  | { t: 'nav'; nav: { id: NavTargetId | 'plaza'; name: string } | null }
  | { t: 'picked'; id: number | null; badge?: PlayerBadge | null }
  | { t: 'badge'; id: number; badge: PlayerBadge | null }
  /** 本地被创飞：行为统计只需一个布尔量 */
  | { t: 'ventHit'; local: boolean }
  /** 本地成功击倒他人：击倒数 +1 */
  | { t: 'ventDealt' }
  /** 老板被打倒：`local` 表示最后一脚是不是自己踢的（ADR-0070） */
  | { t: 'bossDown'; local: boolean }
  /** 跨日老板回满血：主线程收起顶部提示 */
  | { t: 'bossReset' }
  /** 在公告栏旁按了 F：主线程打开榜单面板并请求快照 */
  | { t: 'boardOpen' }
  /** 在放假告示板旁按 F / 点击牌面：主线程展开软木看板（ADR-0059） */
  | { t: 'bulletinOpen' }
  /** 擂台快照：低频事件（阶段变化 / 扣血 / 1Hz 心跳），`receivedAt` 是服务器时刻，供 HUD 递减 */
  | { t: 'ring'; packet: RingPacket | null; receivedAt: number }
  /**
   * 服务器时钟样本（ADR-0081）：Worker 侧 1Hz 收到 pong，转发到主线程时按 5s 节流，
   * 只传「此刻的服务器毫秒 + 园区时区」。两侧单调时钟基准不同，所以传绝对时刻而不是偏移。
   */
  | { t: 'clock'; epochMs: number; tzOffsetMin: number }
  /** 牛马榜快照：一个指标一条，主线程按 metric 归并 */
  | { t: 'board'; packet: BoardPacket }
  /** 钱包快照：主线程据此落盘并刷新 HUD（ADR-0082） */
  | { t: 'wallet'; packet: WalletSyncPacket }
  | { t: 'p2pInvite'; packet: P2PInviteNotifyPacket }
  | { t: 'p2pInviteResult'; packet: P2PInviteResultPacket }
  | { t: 'p2pMatch'; packet: P2PMatchPacket }
  | { t: 'p2pShowdown'; packet: P2PShowdownPacket }
  | { t: 'p2pDuelState'; packet: P2PDuelStatePacket }
  | { t: 'tip'; packet: TipPacket }
  | { t: 'itemEffect'; packet: ItemEffectPacket }
  /** 玩家特效（ADR-0085）：脚底风 / 护盾环 / 贴纸 / 滑倒 / 保安盯梢 */
  | { t: 'playerEffect'; packet: PlayerEffectPacket }
  /** 全服大喇叭：主线程渲染置顶金色横幅 */
  | { t: 'loudspeaker'; packet: LoudspeakerPacket }
  | { t: 'shoutReject'; packet: ShoutRejectPacket }
  | { t: 'itemReject'; packet: ItemRejectPacket }
  /** 互动被拒（ADR-0104）：赌桌 / 擂台 / 别墅 / 搬砖 / 悬赏的统一回执 */
  | { t: 'interactReject'; packet: InteractRejectPacket }
  /** 茶台按 F：主线程打开商店并切到指定页签（ADR-0085 / ADR-0087 增加装扮页签） */
  | { t: 'shopOpen'; tab: 'stats' | 'items' | 'cosmetics' }
  /** 赌桌 / 八角笼 / 豪宅的「按 F 开面板」意图 */
  | { t: 'diceOpen'; table: number }
  | { t: 'arenaBetOpen' }
  | { t: 'villaOpen'; villa: number }
  /** 热区建筑的下行快照 */
  | { t: 'dice'; packet: DiceStatePacket }
  | { t: 'villa'; packet: VillaStatePacket }
  | { t: 'arenaPool'; packet: ArenaPoolPacket }
  /** 打工产出与随机事件（ADR-0088） */
  | { t: 'workOpen' }
  | { t: 'workResult'; packet: WorkResultPacket }
  | { t: 'questState'; packet: QuestStatePacket }
  | { t: 'worldEvent'; packet: WorldEventPacket }
  | { t: 'eventClaim'; packet: EventClaimResult }
  | { t: 'bossShock'; packet: BossShockPacket }
  /** 工牌点赞变化：主线程更新工牌与已赞集合 */
  | { t: 'like'; packet: LikePacket }
  /** 发声请求：`AudioContext` 只能在主线程，所以连听者坐标一起带回来 */
  | { t: 'audio'; event: AudioEvent; listenerX: number; listenerY: number }
  /** 仅在无共享内存时使用：主线程据此落盘 */
  | { t: 'snapshot'; patch: SnapshotPatch }
  /** 上香后写回本地日期键（ADR-0061）：零服务端状态，只记在本机 */
  | { t: 'incenseDay'; day: string }
  /** Worker 遇到断线等情况，请求主线程做一次构建版本检查 */
  | { t: 'build-check' };
