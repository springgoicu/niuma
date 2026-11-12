import {
  ACTION,
  BOARD_METRIC_ALL,
  CHAT_HISTORY_FLAG,
  LIKE_FLAG_SELF,
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_REJECT_REASON,
  DEFAULT_APPEARANCE,
  EMPTY_CAREER,
  GRAZE_COOLDOWN_MS,
  MOVE_SPEED,
  NAV_TARGETS,
  QUEUE_REJECT_REASON,
  SHRINE_ALTAR,
  SIT_RANGE,
  STATE_BITS,
  TEA_STATION,
  SYSTEM_NOTICE_KIND,
  VENT_COOLDOWN_MS,
  VENT_STUN_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  dequantizeCoord,
  directionFromVector,
  findNearestSeat,
  formatSystemNotice,
  packState,
  quantizeCoord,
  readSync,
  readSyncTick,
  regionAt,
  resolveMotionInto,
  seatById,
  seatPose,
  unpackState,
  type BoardMetric,
  type BoardPacket,
  type CareerSummary,
  type LikePacket,
  type CharacterAppearance,
  type ChatHistoryPacket,
  type ChatPacket,
  type DanmakuMode,
  type Direction,
  type MotionTarget,
  type NavTargetId,
  type Pose,
  type QueueStatusPacket,
  type ResumeState,
  type SeatInstance,
  type SeatKind,
  type SeatStateEntry,
  type SpawnPacket,
  type Species,
  type SyncFormat,
  type SystemNoticePacket,
  type VentEventPacket,
  type WelcomePacket,
} from '@niuma/shared-types';
import { NetClient } from '../net/client';
import { withCareerDelta, type BoardEntry, type PlayerBadge } from './badge';
import { ventOutcome } from './vent-outcome';
import { advanceOnDuty } from './duty';
import { toSnapshotPatch } from './snapshot';
import { resolveInteraction, type InteractionIntent, type InteractionState } from './actions';
import { HINT } from './hint-copy';
import { buildClipTracks, buildOverlayTracks, frameAt, overlayTrackFor, phaseOffset, type ClipTrack } from './clip';
import { seatLift } from './seat-art';
import { NEVER_SENT, shouldSendMove, type MoveSample } from './move-send';
import { Ecs, Local, Motion, POSE, Position } from './ecs';
import type { RemoteSample } from './interp';
import { JitterBuffer } from './jitter';
import { ACTION_BY_CODE, directionFromMask, type ActionKey } from './input';
import type { ViewportInfo } from './runtime/control-channel';
import type { AudioEvent, EngineEnv, SessionProfile } from './runtime/engine-env';
import {
  facesBulletin,
  isBulletinHit,
  isNearBulletin,
  isNearRankBoard,
  isNearShrine,
  isNearTeaStation,
  nearestInteractivePropInto,
  pickGrazeLine,
  pickLine,
  pickVentLine,
  pickVentVictimLine,
  snoreDue,
  type InteractiveTarget,
} from './interactions';
import { DEFAULT_DANMAKU_PREFS, type DanmakuPrefs } from './danmaku-prefs';
import { localDateKey } from './local-date';
import { BOW_DURATION_MS, bowTexelsAt, jumpLiftTexels, jumpShadowFor } from './pony-motion';
import { Navigator } from './navigator';
import { findPath } from './pathfinding';
import { GameRenderer } from './renderer';

export interface ChatEntry {
  id: number;
  name: string;
  text: string;
  at: number;
  self: boolean;
  /**
   * `system` 是进园 / 离园 / 在岗提醒这类自动播报：没有名字列，也不弹头顶气泡。
   * 缺省视为普通聊天，旧数据与旧服务端都不用改。
   */
  kind?: 'chat' | 'system';
  /**
   * 来自进园补发或上翻：不弹头顶气泡，UI 会在历史与实时之间画一条分隔线。
   * 缺省是实时消息，旧数据不用改。
   */
  history?: boolean;
  /** 系统消息的模板编号（SYSTEM_NOTICE_KIND），供样式与将来的静音开关使用 */
  systemKind?: number;
}

export interface SessionStats {
  fps: number;
  ping: number;
  x: number;
  y: number;
  nearby: number;
  backend: string;
  /** 本地角色所在园区区域名；未入场为空串 */
  region: string;
  /** 本地会话已在线秒数；未入场为 0，断线时 UI 显示 --:-- */
  onlineSec: number;
  /** 本地玩家收到的工牌点赞数：本人档案用，随 2Hz 推送 */
  likes: number;
  /** 视野内本周工时榜（最多 5 条） */
  board: BoardEntry[];
  /** 本地玩家在视野榜里的名次；未上榜为 null */
  rank: number | null;
}

export interface WorldSnapshot {
  x: number;
  y: number;
  region: string;
  points: Array<{ x: number; y: number; self: boolean }>;
}

export interface SessionCallbacks {
  onStatus(status: 'connecting' | 'queued' | 'online' | 'offline' | 'error', detail?: string): void;
  /** 排队位次快照；null 表示离开队列（入场、被拒或断线） */
  onQueue(status: QueueStatusPacket | null): void;
  /** 被准入拒绝，0 表示解除拒绝态 */
  onRejected(reason: number): void;
  onStats(stats: SessionStats): void;
  onChat(entry: ChatEntry): void;
  /** 历史聊天页：`replace` 时整表替换（首屏 / 重连），否则整页前插 */
  onChatHistory(entries: ChatEntry[], meta: { replace: boolean; hasMore: boolean }): void;
  /** 附近可用座位、当前入座或被拦下的动作提示；null 表示不显示 */
  onHint(hint: string | null): void;
  /** 本地姿态、入座状态与座位种类：动作按钮据此显示激活 / 不可用态，只在变化时回调 */
  onLocalState(state: { pose: Pose; seated: boolean; seatKind: SeatKind | null }): void;
  /** 自动寻路目标：`null` 表示没有在导航（到达、取消、被打断都会回调） */
  onNav(nav: { id: NavTargetId; name: string } | null): void;
  /** 本地被创飞：行为统计用；旁观他人挨打不算自己的抗压记录 */
  onVentHit?(local: boolean): void;
  /** 本地成功击倒他人：空放不回调，旁观互殴也不回调 */
  onVentDealt?(): void;
  /** 在公告栏旁按了 F：宿主据此打开榜单面板并主动拉一次快照 */
  onBoardOpen?(): void;
  /** 在放假告示板旁按 F 或点击牌面：宿主据此展开软木看板（ADR-0060） */
  onBulletinOpen?(): void;
  /** 牛马榜快照（一个指标一条），宿主按 metric 归并后交给面板 */
  onBoard?(packet: BoardPacket): void;
  /** 工牌点赞变化：目标、计数与「是不是你点的」，宿主据此刷新档案弹窗 */
  onLike?(packet: LikePacket): void;
}

/** 一次会话绑定的园区：构造后不再变化，重连与落盘都以它为准 */
export interface GameSessionOptions {
  /** 园区 WebSocket 端点；缺省时退回 NetClient 的同源推导 */
  wsUrl?: string;
  /** 园区 id：落点快照按它分区，换园区时不会把上一座的座位带过去 */
  parkId?: string;
}

const STATS_INTERVAL = 500;
/** 座位提示刷新间隔：足够跟手，又不必每帧扫描座位表 */
const SEAT_HINT_INTERVAL = 150;
/** 互动节流：连按 F 的两次气泡至少隔这么久 */
const INTERACT_COOLDOWN_MS = 900;
/** 瞬时提示的保留时长：房间里的环境提示晚一步再抢回这一行 */
const HINT_HOLD_MS = 1600;
/**
 * 上香飘字（ADR-0061）：三句一起升起。
 * 写成多行而不是轮播，是因为「祈求暴富 / 无 Bug / 功德 +1」是一整套念词，拆开就散了。
 */
const INCENSE_FLOAT_TEXT = '🙏 祈求暴富\n保佑本周无 Bug\n功德 +1';
/** 当日首香的淡金光晕时长：60 秒，只在本机可见 */
const INCENSE_AURA_MS = 60_000;
/**
 * 会话快照的落盘间隔。
 *
 * localStorage 是同步 API，不能进每帧路径；2s 一次已经足够精确——
 * 即使浏览器直接被杀掉，最多也只在关页面前有 2s 的位移丢失。
 */
const SNAPSHOT_INTERVAL_MS = 2000;

/**
 * 本地玩家与服务端坐标的最大合法偏差（像素）。
 *
 * 服务端不自行推进位置，sync 里的坐标天然是「客户端上包位置」，
 * 落后 RTT/2 + 一个 Tick + 发送间隔。按 165px/s 与 250ms 单向延迟算约 58px，
 * 取 128px 给抖动与高延迟链路留余量；只有超过它才说明真的失步
 * （限速截断、地形求解分叉、传送），此时一次性对齐。
 */
const LOCAL_DRIFT_LIMIT = 128;
const LOCAL_DRIFT_LIMIT_SQ = LOCAL_DRIFT_LIMIT * LOCAL_DRIFT_LIMIT;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class GameSession {
  private readonly renderer = new GameRenderer();
  /** 弹幕偏好：宿主注入初值，运行期由设置面板更新（ADR-0056） */
  private danmakuPrefs: DanmakuPrefs = { ...DEFAULT_DANMAKU_PREFS };
  /**
   * 最近一次上香的自然日（ADR-0061）。初值由宿主从 localStorage 带进来，
   * 换日即自动失效——不需要任何清理逻辑，也不需要服务端状态。
   */
  private incenseDay = '';
  /** 上香动作的起始时刻：作揖包络按它算，0 表示当前没有在作揖 */
  private prayAt = -1;
  /** 本地上香计数：只用来轮换三句飘字，不做累计展示 */
  private incenseCount = 0;
  private readonly ecs = new Ecs();
  private readonly tracks = buildClipTracks();
  /** 叠加动作轨表：发泄按姿态分三条，跳一条；帧循环里只做下标访问 */
  private readonly overlays = buildOverlayTracks(this.tracks);
  /** wire 姿态（Idle/Walk/Sit/Lie）→ 基础轨，顺序与 shared-types 的 POSE 一致 */
  private readonly baseTracks: ReadonlyArray<ClipTrack> = [
    this.tracks.idle!,
    this.tracks.walk!,
    this.tracks.sit!,
    this.tracks.lie!,
  ];
  /**
   * 手动输入输出槽：每帧从控制块解算一次，之后 stepLocal 直接读。
   * 与 `navVector` 分开，寻路方向不会覆盖手按方向。
   */
  private readonly manual = { x: 0, y: 0 };
  /** 摇杆输出槽：控制块读出的定点值，帧循环里复用 */
  private readonly touch = { x: 0, y: 0 };
  /** 视口输出槽：每帧从控制块读一次，尺寸没变时 `readViewport` 直接返回 false */
  private readonly viewport: ViewportInfo = { width: 0, height: 0, dpr: 1 };
  /** 自动寻路：路点推进与卡死判定都在 Navigator 里，会话只负责启停 */
  private readonly navigator = new Navigator();
  /** 导航方向的复用槽位：与手动输入分开，互不覆盖 */
  private readonly navVector = { x: 0, y: 0 };
  private readonly names = new Map<number, string>();
  /** netId → 物种：工牌与点击详情共用，换装广播时同步 */
  private readonly speciesById = new Map<number, Species>();
  /** netId → 常驻状态；空串表示没设置 */
  private readonly statusById = new Map<number, string>();
  /**
   * netId → 入场包携带的已在线秒数 + 本地接收时刻。
   * 用「收到时的秒数 + 本地时钟增量」而不是服务端绝对时间，规避两端时钟偏差。
   */
  private readonly onlineById = new Map<number, { sec: number; at: number }>();
  /** 本地入场成功时刻（performance.now）：自己的在线时长从 WELCOME 起算 */
  private welcomeAt = 0;
  /**
   * 断线那一刻的在岗秒数（ADR-0060）：只在第一次 onClose 取一次，
   * 重连反复失败时不会把离线时间也累计进去；下次 WELCOME 后归零。
   */
  private reconnectCarrySec = 0;
  /** 座位占用镜像：seatId → 占用者的 netId，以服务端广播为准 */
  private readonly seatOwner = new Map<number, number>();
  /** 反向镜像：netId → seatId，用于把入座抬升算到正确的角色上（ADR-0032） */
  private readonly entitySeat = new Map<number, number>();
  /** 本地所坐 / 所躺的座位（0 表示未入座）：预测后由服务端广播校正 */
  private localSeat = 0;
  /** 已发出入座 / 上床请求且尚未起身：只有此时服务端的占座结果才会吸附本地角色 */
  private seatIntent = false;
  private seatHint: string | null = null;
  private seatHintAt = 0;
  /** 瞬时提示（被拦下 / 附近没东西）的展示截止时刻：期间不被环境提示覆盖 */
  private hintUntil = 0;
  /** 互动节流与台词轮转序号：连按同一台机器也要隔一拍 */
  private interactAt = 0;
  private interactCount = 0;
  /** 设施查询输出槽：F 键在按键栈里调用，不为一次查询造字面量 */
  private readonly interactTarget: InteractiveTarget = { kind: 'vending', x: 0, y: 0 };
  /** 咀嚼节流与台词轮转：本地与服务端共用 500ms 口径（ADR-0048） */
  private grazeAt = 0;
  private grazeCount = 0;
  /**
   * 发泄节流与出招窗口。
   *
   * `ventAt` 与服务端同一把尺子（VENT_COOLDOWN_MS）：本地先挡一道，连点不会白发包。
   * `ventLockUntil` 是本地位移锁——出招的 440ms 内不许走动，否则角色会「边滑边撞」。
   */
  private ventAt = 0;
  private ventLockUntil = 0;
  /** 被创飞后的硬直截止时刻：期间位移被冻结，姿态钉在躺姿（ADR-0051） */
  private stunUntil = 0;
  /** 躺床计时：lieAt 是躺下时刻，snoreAt 是上一次「Zzz…」 */
  private lieAt = 0;
  private snoreAt = 0;
  /** 上次上报给 UI 的本地姿态与入座状态，用来去重 */
  private localPose = -1;
  private localSeated = false;
  private localSeatKind: SeatKind | null = null;
  private net: NetClient | null = null;
  private localId = 0;
  /** 系统消息的负序号：与聊天 msgId 分开，列表 key 不会撞 */
  private systemSeq = 0;
  /** 园区公告只播一次：断线重连重建世界时不再重复刷屏 */
  private renovationNoticed = false;
  /** 下一个该播报的在岗档位下标；每次 WELCOME 归零 */
  private onDutyCursor = 0;
  /**
   * 当前工牌名：重连后 `handleWelcome` 重建本地角色时要用它。
   * 与状态同理，不能读 `start()` 的 profile 闭包——游戏内改过名字就是旧值。
   */
  private name = '';
  /**
   * 当前状态：重连后 `handleWelcome` 重建本地角色时要用它。
   * 不能读 `start()` 的 profile 闭包——那是入场瞬间的快照，游戏内改过状态就是旧值。
   */
  private status = '';
  /** 本地物种：工牌与换装展示用，入场时锁定、运行期不变 */
  private species: Species = 'cow';
  /** 本地外观：分享卡要画立绘；换装广播时同步 */
  private localAppearance: CharacterAppearance | null = null;
  /** 本地考勤摘要：由宿主组装，随 HELLO / 补报上行 */
  private localCareer: CareerSummary | null = null;
  /** netId → 远端外观：分享卡与档案徽标共用，despawn 时清理 */
  private readonly appearanceById = new Map<number, CharacterAppearance>();
  /** netId → 远端考勤摘要；旧服务端或未上报时没有条目 */
  private readonly careerById = new Map<number, CareerSummary>();
  /** netId → 工牌点赞数：spawn 尾段与 S2C_LIKE 共同维护（ADR-0057） */
  private readonly likesById = new Map<number, number>();
  /** 当前连接已点赞过的目标：S2C_LIKE flag1 点亮，despawn 时清理 */
  private readonly likedTargets = new Set<number>();
  /** 本地玩家收到的赞：随 2Hz stats 推给本人档案 */
  private localLikes = 0;
  /** 视野内本周工时榜与名次：缓存 2 秒，不在 20Hz / 4Hz 推送里重复排序 */
  private careerBoard: BoardEntry[] = [];
  private readonly rankById = new Map<number, number>();
  private boardAt = 0;
  private boardDirty = true;
  private elapsed = 0;
  private movementSendTime = 0;
  /**
   * 上一次真正发出去的三元组。复用同一个对象：60fps 下每帧新建一个字面量
   * 就是每秒 60 个短命对象，正是这个仓库的帧循环一直避免的东西。
   */
  private readonly lastSentMove: MoveSample = { x: NEVER_SENT, y: NEVER_SENT, state: NEVER_SENT };
  private clientMoveSequence = 0;
  /** 距离上次落盘的累计时长：只在 tick 里累加，不在帧内碰 localStorage */
  private snapshotAt = 0;
  private statsAt = 0;
  private frames = 0;
  private fps = 60;
  private ping = 0;
  private disposed = false;
  /** 自适应回放延迟：RTT p95 + 传输抖动，替代固定的 INTERP_DELAY_MS */
  private readonly jitter = new JitterBuffer();
  /** 采样输出槽：帧循环里复用，不产生分配 */
  private readonly sample: RemoteSample = { x: 0, y: 0, state: 0 };
  /** 位移解算输出槽：与服务端共用同一个零分配变体 */
  private readonly motion: MotionTarget = { x: 0, y: 0 };
  /** 收到同步包的本地时刻：一条包里的所有条目共用一个时间戳，避免逐条读时钟 */
  private syncAt = 0;

  constructor(
    private readonly callbacks: SessionCallbacks,
    private readonly env: EngineEnv,
    private readonly options: GameSessionOptions = {},
  ) {}

  get backend(): string {
    return this.renderer.backend;
  }

  async start(profile: SessionProfile, resume?: ResumeState): Promise<void> {
    this.callbacks.onStatus('connecting');
    // 首帧就用真实视口：宿主在 start 之前已经把尺寸写进控制块
    this.env.readViewport(this.viewport);
    // 初值来自宿主（localStorage 只能在主线程读）；Worker 里由 init 消息带进来
    this.danmakuPrefs = { ...this.env.danmakuPrefs };
    this.incenseDay = this.env.incenseDay;
    await this.renderer.init({
      canvas: this.env.canvas,
      width: this.viewport.width,
      height: this.viewport.height,
      dpr: this.viewport.dpr,
      search: this.env.search,
      fontsReady: () => this.env.fontsReady(),
      danmaku: this.danmakuPrefs,
    });
    if (this.disposed) return;
    this.renderer.app.ticker.add(this.tick);
    this.statsAt = performance.now();

    // 端点由 /play 按园区白名单解析后传进来；没传时才退回 NetClient 的默认推导
    this.net = new NetClient({
      // socket 打开不代表入场：真正的在线由 WELCOME 决定，中间可能隔着一条排队
      onOpen: () => this.callbacks.onStatus('connecting', '等待准入'),
      // 断线时先落盘并刷新 resume：重连后服务端能把人放回断开处，
      // 同时保留最后一份排队快照，面板转为「重连中」而不是把人踢回空白页
      onClose: () => {
        // 断线续算（ADR-0060）：只在第一次断开时取基准。
        // 重连反复失败会反复触发 onClose，每次都取的话会把离线时间也算进在岗。
        if (this.reconnectCarrySec === 0) {
          this.reconnectCarrySec = this.onlineSecOf(this.localId);
          this.net?.setSessionSec(this.reconnectCarrySec);
        }
        this.persistNow();
        this.callbacks.onStatus('offline', '连接中断，正在重连');
        // 部署会重启游戏服：断线即查版本，避免带着旧地图重连后撞上空气墙。
        // 走 env 而不是直接调：Worker 模式下版本检查得回到主线程做。
        this.env.requestBuildCheck();
      },
      onQueue: (status) => {
        this.callbacks.onQueue(status);
        this.callbacks.onStatus('queued', '排队中');
      },
      onRejected: (reason) => {
        this.callbacks.onQueue(null);
        this.callbacks.onRejected(reason);
        this.callbacks.onStatus(
          'error',
          reason === QUEUE_REJECT_REASON.WaitTimeout ? '排队超时，请重新排队' : '园区已满，请稍后再来',
        );
      },
      onWelcome: (packet) => this.handleWelcome(packet, profile),
      onSpawn: (packet) => this.handleSpawn(packet),
      onDespawn: (id) => this.handleDespawn(id),
      onSync: (data, format) => this.handleSync(data, format),
      onChat: (packet) => this.handleChat(packet),
      onChatHistory: (packet) => this.handleChatHistory(packet),
      onSystemNotice: (packet) => this.handleSystemNotice(packet),
      onChatRejected: (reason) => {
        // 服务端权威拦截的回执：正常路径被本地预检挡住了，走到这里基本是词库不同步或伪造包
        this.showHint(
          reason === CHAT_REJECT_REASON.RateLimited
            ? '说得太快，缓一口气再说'
            : '这句话里有不能发的词，换个说法',
        );
      },
      onAppearance: (id, appearance) => {
        this.speciesById.set(id, appearance.species);
        this.appearanceById.set(id, appearance);
        if (id === this.localId) {
          this.species = appearance.species;
          this.localAppearance = appearance;
        }
        this.renderer.setAppearance(id, appearance);
      },
      onStatus: (id, status) => {
        if (id === this.localId) this.status = status;
        else this.statusById.set(id, status);
        this.renderer.setStatus(id, status);
      },
      onName: (id, name) => {
        // 名字表与渲染层一起换：牛马榜、点选档案、聊天弹幕都从 names 取名字
        this.names.set(id, name);
        this.renderer.setName(id, name);
      },
      onCareer: (id, career) => this.handleCareer(id, career),
      onBoard: (packet) => this.handleBoard(packet),
      onLike: (packet) => this.handleLike(packet),
      onSeatState: (entries) => this.handleSeatState(entries),
      onGraze: (id) => this.handleGraze(id),
      onVent: (packet) => this.handleVent(packet),
      onPing: (rtt) => {
        this.ping = rtt;
        this.jitter.onRtt(rtt);
      },
    }, this.options.wsUrl);

    this.name = profile.name;
    this.status = profile.status ?? '';
    this.species = profile.appearance.species;
    this.localAppearance = profile.appearance;
    this.localCareer = profile.career ?? null;
    this.boardDirty = true;
    this.net.connect(profile.name, profile.appearance, resume, this.status, this.localCareer ?? undefined);
    this.callbacks.onStatus('connecting', '握手');
  }

  private handleWelcome(packet: WelcomePacket, profile: SessionProfile): void {
    this.callbacks.onQueue(null);
    this.callbacks.onRejected(0);
    this.clearWorld();
    this.localId = packet.entityId;
    this.movementSendTime = 0;
    // 换了一条连接就得重新握手：新连接的上行基准从「还没发过」开始
    this.lastSentMove.x = NEVER_SENT;
    this.lastSentMove.y = NEVER_SENT;
    this.lastSentMove.state = NEVER_SENT;
    this.clientMoveSequence = 0;
    this.snapshotAt = 0;
    // 换连接后 tick 基准与接收时钟都变了：只清传输偏移，RTT 样本保留（ADR-0048）
    this.jitter.reset();
    // 会话续算（ADR-0060）：服务端回显它采信的秒数，本地把走秒基准往前挪，
    // 断线重连后接着算而不是归零；旧服务端不回显时缺席，退化成「重连归零」。
    const carrySec = Math.max(0, Math.floor(packet.sessionSec ?? 0));
    this.welcomeAt = performance.now() - carrySec * 1000;
    // 本地摘要的增量基线必须与服务端写进 career 的值一致，
    // 否则视野榜会把上一段会话的工时再加一遍。
    if (this.localCareer) this.localCareer = { ...this.localCareer, reportedOnlineSec: carrySec };
    // 在岗提醒从续算后的位置继续：重连回来不该把「在岗 8 小时」再播一遍
    this.onDutyCursor = advanceOnDuty(carrySec, 0).cursor;
    // 新会话已经开始计时，下一次断线要重新取基准
    this.reconnectCarrySec = 0;
    this.names.set(packet.entityId, this.name);
    this.speciesById.set(packet.entityId, profile.appearance.species);
    const x = dequantizeCoord(packet.x);
    const y = dequantizeCoord(packet.y);
    const eid = this.ecs.spawn(packet.entityId, x, y);
    this.ecs.markLocal(packet.entityId);
    // 朝向与姿态以服务端裁决为准：座位恢复、座位被占降级、落水回岸都体现在 state 里
    const restored = unpackState(packet.state);
    Motion.direction[eid] = restored.direction;
    Motion.pose[eid] = restored.pose;
    Motion.since[eid] = this.elapsed;
    this.net?.setEntityId(packet.entityId);
    void this.renderer.addEntity(
      packet.entityId,
      this.name,
      profile.appearance,
      this.status,
      x,
      y,
    );
    this.renderer.updateCamera(x, y);
    this.callbacks.onStatus('online', this.renderer.backend);
    // 园区公告（ADR-0044）：入场成功后播一条，只在本机列表里出现，不走协议也不发给别人
    if (!this.renovationNoticed) {
      this.renovationNoticed = true;
      const notice = formatSystemNotice(SYSTEM_NOTICE_KIND.Renovation);
      if (notice) this.pushSystemNotice(SYSTEM_NOTICE_KIND.Renovation, notice);
    }
  }

  private handleSpawn(packet: SpawnPacket): void {
    const { id, name, appearance, status } = packet;
    if (this.names.has(id)) return;
    this.names.set(id, name);
    this.speciesById.set(id, appearance.species);
    this.appearanceById.set(id, appearance);
    this.statusById.set(id, status ?? '');
    if (packet.career) this.careerById.set(id, packet.career);
    if (packet.likes !== undefined) this.likesById.set(id, packet.likes);
    this.boardDirty = true;
    // 旧服务端不带在线秒数：从 0 起算，退化为「首次看到」，不显示假的长时长
    this.onlineById.set(id, { sec: packet.onlineSec ?? 0, at: performance.now() });
    const x = dequantizeCoord(packet.x);
    const y = dequantizeCoord(packet.y);
    const eid = this.ecs.spawn(id, x, y);
    // 先塞一帧快照：回放缓冲有时间戳，不塞的话这个人在延迟窗口内没有数据可采样。
    // 坐标取自 spawn 包，姿态与叠加位则由随后的 sync 校正。
    this.ecs.remote.push(eid, performance.now(), x, y, packet.state);
    void this.renderer.addEntity(id, name, appearance, status ?? '', x, y);
  }

  private handleDespawn(id: number): void {
    this.names.delete(id);
    this.speciesById.delete(id);
    this.appearanceById.delete(id);
    this.careerById.delete(id);
    this.likesById.delete(id);
    this.likedTargets.delete(id);
    this.statusById.delete(id);
    this.onlineById.delete(id);
    this.entitySeat.delete(id);
    this.boardDirty = true;
    this.ecs.despawn(id);
    this.renderer.removeEntity(id);
  }

  /** 补报后的摘要广播：只更新远端缓存，自己的档案仍以本地 store 为准。 */
  private handleCareer(id: number, career: CareerSummary): void {
    if (id === this.localId) return;
    this.careerById.set(id, career);
    this.boardDirty = true;
  }

  /**
   * 更新并上报本地考勤摘要。
   *
   * 宿主在入场后、geo 就绪后与每 60 秒调用一次；服务端会把它转给正在围观的人。
   */
  updateCareer(career: CareerSummary): void {
    this.localCareer = career;
    this.boardDirty = true;
    this.net?.sendCareer(career);
  }

  /**
   * 拉取园区牛马榜（ADR-0054）。
   *
   * 默认一次要全部指标：五条小包换来页签切换零往返。面板打开、手动刷新与
   * 20 秒自动刷新都走这里；离线时 sendBoard 是空操作，宿主保留上一份快照。
   */
  requestBoard(metric: BoardMetric | typeof BOARD_METRIC_ALL = BOARD_METRIC_ALL): void {
    this.net?.sendBoard(metric);
  }

  private handleBoard(packet: BoardPacket): void {
    this.callbacks.onBoard?.(packet);
  }

  /**
   * 给看得见的人点个赞（ADR-0057）：只发意图，计数与「是否已赞」由服务端裁决。
   * 离线时是空操作，面板上的 pending 态由 UI 自己超时收回。
   */
  like(targetId: number): void {
    this.net?.sendLike(targetId);
  }

  /**
   * 点赞广播：目标与目标视野内的人收 flag0，点赞者本人收 flag1。
   * 自己收到的赞另存 `localLikes`，随 stats 推给本人档案；`likedTargets`
   * 只在 flag1 时点亮，别人点赞不会误标成「你已点赞」。
   */
  private handleLike(packet: LikePacket): void {
    this.likesById.set(packet.targetId, packet.likes);
    if ((packet.flags & LIKE_FLAG_SELF) !== 0) this.likedTargets.add(packet.targetId);
    if (packet.targetId === this.localId) this.localLikes = packet.likes;
    // 与榜单同一条纪律：状态留在会话里，通知主线程去刷新对应的 UI
    this.callbacks.onLike?.(packet);
  }

  /**
   * 视野内本周工时榜。零持久化下只能统计当前在线且已上报的人；
   * 缓存 2 秒，避免 2Hz 的工牌推送每次都重新排序。
   */
  private ensureBoard(now = performance.now()): void {
    if (!this.boardDirty && now - this.boardAt < 2_000) return;
    this.boardDirty = false;
    this.boardAt = now;
    const entries: BoardEntry[] = [];
    for (const [id, name] of this.names) {
      const career = id === this.localId ? this.localCareer : this.careerById.get(id);
      if (!career) continue;
      const effective = withCareerDelta(career, this.onlineSecOf(id));
      entries.push({ id, name, weekMinutes: effective.weekMinutes, self: id === this.localId });
    }
    entries.sort((a, b) => b.weekMinutes - a.weekMinutes || a.id - b.id);
    this.rankById.clear();
    for (let index = 0; index < entries.length; index += 1) {
      this.rankById.set(entries[index]!.id, index + 1);
    }
    this.careerBoard = entries.slice(0, 5);
  }

  /**
   * 点击 / 轻点舞台。
   *
   * 点人只弹工牌，不触发出招：出招只认按键与动作栏按钮，
   * 点选用来查看对方，两种意图不该撞在同一个手势上。
   * 点空白与点到自己返回 null；自己的工牌常显在 HUD，不需要再弹一份重复的详情。
   */
  pickAt(stageX: number, stageY: number): PlayerBadge | null {
    /**
     * 先判放假告示板（ADR-0060）：牌面是静态地标，不在角色命中表里。
     * 点击命中牌面但人还站在 64px 外时只给一句提示，不隔空开面板——
     * 这条规则与 F 键的距离门完全一致。
     */
    const localEid = this.ecs.get(this.localId);
    if (localEid) {
      const point = this.renderer.worldPointAt(stageX, stageY);
      if (point && isBulletinHit(point.x, point.y)) {
        if (isNearBulletin(Position.x[localEid]!, Position.y[localEid]!)) {
          this.callbacks.onBulletinOpen?.();
        } else {
          this.showHint('走近一点再看');
        }
        return null;
      }
    }
    const id = this.renderer.pickEntityAt(stageX, stageY);
    if (id === null || id === this.localId) return null;
    return this.badgeOf(id);
  }

  /** 会话口径的已在线秒数：本地从 WELCOME 起算，远端在入场包秒数上叠加本地增量 */
  private onlineSecOf(id: number): number {
    if (id === this.localId) {
      if (this.welcomeAt <= 0) return 0;
      return Math.max(0, Math.floor((performance.now() - this.welcomeAt) / 1000));
    }
    const entry = this.onlineById.get(id);
    if (!entry) return 0;
    return entry.sec + Math.max(0, Math.floor((performance.now() - entry.at) / 1000));
  }

  /**
   * 工牌展示模型：本地与远端共用一份，UI 不再自行拼字段。
   * 实体已经离开世界（despawn / 断线）时返回 null，调用方据此自动关闭详情。
   */
  badgeOf(id: number): PlayerBadge | null {
    const eid = this.ecs.get(id);
    if (!eid) return null;
    const local = id === this.localId;
    const x = Position.x[eid]!;
    const y = Position.y[eid]!;
    const seatId = this.entitySeat.get(id) ?? (local && this.localSeat !== 0 ? this.localSeat : undefined);
    const seat = seatId ? seatById(seatId) : undefined;
    const species = local ? this.species : this.speciesById.get(id) ?? 'cow';
    const appearance = (local ? this.localAppearance : this.appearanceById.get(id)) ?? DEFAULT_APPEARANCE[species];
    const career = local ? this.localCareer : this.careerById.get(id);
    this.ensureBoard();
    const badge: PlayerBadge = {
      id,
      name: this.names.get(id) ?? '匿名牛马',
      species,
      appearance,
      status: local ? this.status : this.statusById.get(id) ?? '',
      region: regionAt(x, y),
      onlineSec: this.onlineSecOf(id),
      pose: Motion.pose[eid] as Pose,
      moving: Motion.moving[eid] === 1,
      seated: seat !== undefined,
      seatKind: seat?.kind ?? null,
      likes: local ? this.localLikes : (this.likesById.get(id) ?? 0),
      liked: this.likedTargets.has(id),
      board: this.careerBoard,
      rank: this.rankById.get(id) ?? null,
    };
    if (career) badge.career = career;
    return badge;
  }

  /**
   * 同步包：逐条写进回放缓冲，不建数组、不建对象。
   *
   * 本地玩家不进缓冲——它的位置由确定性预测给出，服务端的坐标只是回声。
   */
  private handleSync(data: Uint8Array, format: SyncFormat): void {
    this.syncAt = performance.now();
    readSync(data, this.visitSync, format);
    // 包解析成功后再采样：坏包不应该污染抖动估计。
    // tick 是服务端发送序号，静止人群长时间不发包也不会被误判成抖动（ADR-0043 / 0048）。
    this.jitter.onSync(readSyncTick(data), this.syncAt);
  }

  /**
   * `readSync` 的访问器。做成实例字段而不是每次传箭头函数：
   * 每包新建一个闭包同样是 20Hz 的稳态分配。
   */
  private readonly visitSync = (id: number, qx: number, qy: number, state: number): void => {
    const eid = this.ecs.get(id);
    if (eid === 0) return;
    const x = dequantizeCoord(qx);
    const y = dequantizeCoord(qy);

    if (id === this.localId) {
      const dx = x - Position.x[eid]!;
      const dy = y - Position.y[eid]!;
      // 移动中以本地预测为准，只在偏差超过合法延迟上限时一次性对齐（ADR-0021）。
      // 逐包按比例拉回会把这层延迟变成 20Hz 的位置锯齿，直接传到相机上。
      if (dx * dx + dy * dy > LOCAL_DRIFT_LIMIT_SQ) {
        Position.x[eid] = x;
        Position.y[eid] = y;
      }
      return;
    }

    this.ecs.remote.push(eid, this.syncAt, x, y, state);
  };

  /** 远端叠加位：只在 0 → 1 的那一刻记起始时刻，1 → 0 立刻停 */
  private applyOverlayBit(eid: number, flag: Uint8Array, since: Float64Array, active: boolean): void {
    if (!active) {
      flag[eid] = 0;
      return;
    }
    if (flag[eid] === 1) return;
    flag[eid] = 1;
    since[eid] = this.elapsed;
  }

  /**
   * 座位广播：镜像占用表并同步工位显示器。
   * 本人的座位以服务端为准：被占走（抢座失败）则退回地面坐，服务端分到别的座位则吸附过去。
   */
  private handleSeatState(entries: ReadonlyArray<SeatStateEntry>): void {
    for (const entry of entries) {
      const seat = seatById(entry.seatId);
      if (!seat) continue;
      const previous = this.seatOwner.get(entry.seatId);
      if (entry.occupant === 0) {
        this.seatOwner.delete(entry.seatId);
        if (previous !== undefined) this.entitySeat.delete(previous);
      } else {
        // 座位换了人：旧占用者的反向映射要一起清掉，否则他会一直按「坐在椅子上」抬着
        if (previous !== undefined && previous !== entry.occupant) this.entitySeat.delete(previous);
        this.seatOwner.set(entry.seatId, entry.occupant);
        this.entitySeat.set(entry.occupant, entry.seatId);
      }
      this.renderer.setSeatOccupied(entry.seatId, entry.occupant !== 0);

      if (entry.occupant === this.localId) {
        // 入场恢复入座时 seatIntent 还是 false，本地镜像也必须跟上；
        // 否则按方向键不会触发起身，服务端会一直替你占着这张椅子
        if (this.localSeat !== entry.seatId) this.sitAt(seat);
      } else if (entry.seatId === this.localSeat) {
        // 预测的座位被别人先占走：本地退回地面坐，随后服务端若分到新座位会再吸附过去
        this.localSeat = 0;
        this.entitySeat.delete(this.localId);
      }
    }
  }

  /**
   * 入座抬升（ADR-0032）：只抬身体，不改位置与深度键。
   * 座位来源是服务端全园广播的占用表 + 本地 sitAt 的预测；地面坐 / 躺没有座位，抬升为 0。
   */
  private syncSeatLift(netId: number, eid: number): void {
    const pose = Motion.pose[eid]!;
    if (pose !== POSE.Sit && pose !== POSE.Lie) {
      this.renderer.setSeatLift(netId, 0);
      return;
    }
    const seatId = this.entitySeat.get(netId);
    if (seatId === undefined) {
      this.renderer.setSeatLift(netId, 0);
      return;
    }
    const seat = seatById(seatId);
    this.renderer.setSeatLift(netId, seat ? seatLift(seat.kind, seat.facing) : 0);
  }

  /**
   * 吸附到座位：位置与朝向都按座位锚点，姿态由座位种类决定（床落躺、其余落坐）。
   * 叠加动作一并清掉；上床时重置打呼计时，躺下 5s 后才第一次冒「Zzz…」。
   */
  private sitAt(seat: SeatInstance): void {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;
    this.localSeat = seat.id;
    this.entitySeat.set(this.localId, seat.id);
    Position.x[eid] = seat.x;
    Position.y[eid] = seat.y;
    Motion.direction[eid] = seat.facing;
    this.setLocalPose(eid, seatPose(seat.kind));
    this.clearOverlays(eid);
    Motion.moving[eid] = 0;
    if (seat.kind === 'bed') {
      this.lieAt = this.elapsed;
      this.snoreAt = this.elapsed;
    }
  }

  /**
   * 起身：本地立即回到站立，并通知服务端释放座位。
   * 地面坐 / 躺也要把姿态归零（与服务端 `SeatRegistry.stand` 同一套语义，ADR-0023）。
   */
  private standUp(): void {
    const eid = this.ecs.get(this.localId);
    const hadSeat = this.localSeat !== 0;
    const posed = eid !== 0 && (Motion.pose[eid] === POSE.Sit || Motion.pose[eid] === POSE.Lie);
    this.localSeat = 0;
    this.entitySeat.delete(this.localId);
    this.seatIntent = false;
    this.lieAt = 0;
    this.snoreAt = 0;
    // 只有「坐 / 躺 / 占座」才需要回到站立：行走中的跳跃不打断走路循环
    if (!hadSeat && !posed) return;
    if (eid) {
      this.setLocalPose(eid, POSE.Idle);
      Motion.moving[eid] = 0;
    }
    this.net?.sendAction(this.localId, ACTION.Stand);
  }

  /** 就近找一类空座：`bed` 为 true 只找床，false 只找坐位 */
  private findSeat(bed: boolean): SeatInstance | undefined {
    const eid = this.ecs.get(this.localId);
    if (!eid) return undefined;
    return findNearestSeat(
      Position.x[eid]!,
      Position.y[eid]!,
      (id) => !this.seatOwner.has(id),
      SIT_RANGE,
      (seat) => (seat.kind === 'bed') === bed,
    );
  }

  private setLocalPose(eid: number, pose: Pose): void {
    if (Motion.pose[eid] !== pose) {
      Motion.pose[eid] = pose;
      Motion.since[eid] = this.elapsed;
    }
  }

  private clearOverlays(eid: number): void {
    Motion.vent[eid] = 0;
    Motion.jump[eid] = 0;
    Motion.wave[eid] = 0;
  }

  /**
   * 环境提示：已入座 → 附近床 → 附近坐位 → 放假告示板 → 牛马榜 → 附近设施，
   * 只显示优先级最高的一条。
   * 瞬时提示（被拦下 / 附近没东西）在 `hintUntil` 之前不被覆盖。
   *
   * 告示板要求「在 64px 内且面朝板面」（ADR-0060）；牛马榜仍是纯距离判定，
   * 两者相距 272px，不会出现两条提示抢位。
   */
  private updateSeatHint(eid: number): void {
    if (this.elapsed < this.hintUntil) return;
    let hint: string | null = null;
    if (this.localSeat !== 0) {
      hint = '移动即可起身';
    } else {
      const x = Position.x[eid]!;
      const y = Position.y[eid]!;
      const direction = Motion.direction[eid]! as Direction;
      const isFree = (id: number) => !this.seatOwner.has(id);
      const seat = findNearestSeat(x, y, isFree, SIT_RANGE, (item) => item.kind !== 'bed');
      const bed = findNearestSeat(x, y, isFree, SIT_RANGE, (item) => item.kind === 'bed');
      if (seat) hint = seat.kind === 'toilet' ? HINT.toilet : HINT.seat;
      else if (bed) hint = HINT.bed;
      else if (isNearBulletin(x, y) && facesBulletin(x, y, direction)) hint = HINT.bulletin;
      else if (isNearRankBoard(x, y)) hint = HINT.board;
      // 国风玄学两处（ADR-0061）：与 `interact()` 的判定顺序严格一致，
      // 否则会出现「提示说续杯、按下去却在接水」
      else if (isNearShrine(x, y)) hint = HINT.shrine;
      else if (isNearTeaStation(x, y)) hint = HINT.tea;
      else if (nearestInteractivePropInto(this.interactTarget, x, y)) hint = HINT.interact;
    }
    if (hint === this.seatHint) return;
    this.seatHint = hint;
    this.callbacks.onHint(hint);
  }

  /**
   * 躺床打呼：只在床位躺姿冒「Zzz…」，躺下 5s 后每 9s 一次。
   * 起身 / 移动经 `standUp` 清掉计时，不需要另设状态机。
   */
  private updateSnore(eid: number): void {
    if (this.localSeat === 0) return;
    const seat = seatById(this.localSeat);
    if (seat?.kind !== 'bed' || Motion.pose[eid] !== POSE.Lie) return;
    if (!snoreDue(POSE.Lie, 'bed', this.elapsed - this.lieAt, this.elapsed - this.snoreAt)) return;
    this.snoreAt = this.elapsed;
    this.renderer.showBubble(this.localId, 'Zzz…');
  }

  /** 本地姿态镜像：只在变化时回调一次，动作条据此切换高亮与不可用态 */
  private emitLocalState(eid: number): void {
    const pose = Motion.pose[eid]!;
    const seated = this.localSeat !== 0;
    const seatKind = seated ? seatById(this.localSeat)?.kind ?? null : null;
    if (pose === this.localPose && seated === this.localSeated && seatKind === this.localSeatKind) return;
    this.localPose = pose;
    this.localSeated = seated;
    this.localSeatKind = seatKind;
    this.callbacks.onLocalState({ pose: pose as Pose, seated, seatKind });
  }

  /**
   * 聊天上屏（ADR-0056）。
   *
   * 聊天不再弹头顶气泡：屏幕空间弹幕是唯一表现，频道列表是完整记录。
   * Zzz / 发泄 / 互动 / 咀嚼这些非聊天台词仍走 `renderer.showBubble`。
   */
  private handleChat(packet: ChatPacket): void {
    const { entityId, msgId, text } = packet;
    // 自己的名字也在 names 里（WELCOME 时写入），弹幕上显示真名而不是「我」；
    // 频道列表仍用「我」做第一人称标记。
    const name = this.names.get(entityId) ?? '匿名牛马';
    this.renderer.showDanmaku({
      name,
      species: this.speciesById.get(entityId),
      text,
      colorIndex: packet.colorIndex,
      danmakuMode: packet.danmakuMode,
    });
    this.callbacks.onChat({
      id: msgId,
      name: entityId === this.localId ? '我' : name,
      text,
      at: Date.now(),
      self: entityId === this.localId,
    });
  }

  /**
   * 历史页：只落进频道列表，不弹头顶气泡。
   *
   * `ageSec` 是服务端口径的「距今秒数」，这里用本地时钟还原成毫秒时间戳——
   * 直接信任服务端绝对时间的话，两端时钟不一致会让历史消息显示成「未来」。
   */
  private handleChatHistory(packet: ChatHistoryPacket): void {
    const now = Date.now();
    const entries: ChatEntry[] = packet.entries.map((entry) => ({
      id: entry.msgId,
      // 历史条目自带昵称快照：发送者可能早已离场，名字表里查不到
      name: entry.name,
      text: entry.text,
      at: now - entry.ageSec * 1000,
      self: entry.entityId === this.localId,
      history: true,
    }));
    this.callbacks.onChatHistory(entries, {
      replace: (packet.flags & CHAT_HISTORY_FLAG.Replace) !== 0,
      hasMore: (packet.flags & CHAT_HISTORY_FLAG.HasMore) !== 0,
    });
  }

  /** 服务端播报（进园 / 离园）：不弹气泡，只落进频道列表 */
  private handleSystemNotice(packet: SystemNoticePacket): void {
    if (packet.text.length === 0) return;
    this.pushSystemNotice(packet.kind, packet.text);
  }

  /**
   * 系统消息与聊天共用一条消息管道（`onChat` → `game-ui.messages`），
   * 区别只在 `kind`：不弹头顶气泡、不占名字列，id 用负数避开服务端 msgId。
   */
  private pushSystemNotice(kind: number, text: string): void {
    this.callbacks.onChat({
      id: --this.systemSeq,
      name: '',
      text,
      at: Date.now(),
      self: false,
      kind: 'system',
      systemKind: kind,
    });
  }

  /**
   * 在岗提醒：跟着 500ms 统计节拍检查一次，跨过一档播一条。
   *
   * 后台标签页会停掉渲染循环，恢复时可能一次跨过好几档——
   * 只播最高的那一档，不补发一串过时提醒。
   */
  private checkOnDuty(onlineSec: number): void {
    const tick = advanceOnDuty(onlineSec, this.onDutyCursor);
    this.onDutyCursor = tick.cursor;
    if (tick.minutes === 0) return;
    const text = formatSystemNotice(SYSTEM_NOTICE_KIND.OnDuty, { minutes: tick.minutes });
    if (text) this.pushSystemNotice(SYSTEM_NOTICE_KIND.OnDuty, text);
  }

  /**
   * 落盘当前本地状态。
   *
   * 调用点只有三处：2s 节流、页面隐藏 / 卸载、断线重连前。
   * 写入失败（配额满 / 隐私模式）由 storage 层吞掉——缓存只是体验增强，不能挡住进服。
   */
  private readonly persistNow = (): void => {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;
    const patch = toSnapshotPatch({
      x: Position.x[eid]!,
      y: Position.y[eid]!,
      direction: Motion.direction[eid]! as Direction,
      pose: Motion.pose[eid]! as Pose,
      seatId: this.localSeat,
    });
    // 落盘交给平台层：主线程直接写 localStorage，Worker 写进控制块由主线程落盘。
    // `park` 的园区分区逻辑留在主线程（Worker 不认识存档格式）
    this.env.writeSnapshot(patch);
    // 重连时服务端拿到的必须是最后一次落盘的落点，而不是首次入场时的旧快照
    this.net?.setResume({ ...patch });
  };

  private clearWorld(): void {
    // 重连 / 换世界后旧路径的路点已经失效，必须先停掉导航再清实体
    this.cancelNavigation();
    // 旧世界的弹幕不该漂进新世界：它们没有实体可归属，留着只会读成「有人在说话」
    this.renderer.clearDanmaku();
    for (const id of this.names.keys()) {
      this.ecs.despawn(id);
      this.renderer.removeEntity(id);
    }
    this.names.clear();
    this.speciesById.clear();
    this.appearanceById.clear();
    this.careerById.clear();
    this.likesById.clear();
    this.likedTargets.clear();
    this.localLikes = 0;
    this.statusById.clear();
    this.onlineById.clear();
    this.rankById.clear();
    this.careerBoard = [];
    this.boardDirty = true;
    this.welcomeAt = 0;
    for (const seatId of this.seatOwner.keys()) this.renderer.setSeatOccupied(seatId, false);
    this.seatOwner.clear();
    this.entitySeat.clear();
    this.localSeat = 0;
    this.seatIntent = false;
    this.seatHint = null;
    this.hintUntil = 0;
    this.interactAt = 0;
    this.lieAt = 0;
    this.snoreAt = 0;
    this.prayAt = -1;
    // 换连接后旧的硬直 / 出招窗口都失去意义：新角色从站立开始
    this.stunUntil = 0;
    this.ventLockUntil = 0;
    this.ventAt = 0;
    this.localId = 0;
    this.localPose = -1;
    this.localSeated = false;
    this.localSeatKind = null;
  }

  /** 被拒后由用户显式重试：重置拒绝态并立刻重连，不等指数退避 */
  retry(): void {
    this.callbacks.onRejected(0);
    this.callbacks.onQueue(null);
    this.callbacks.onStatus('connecting', '重新排队');
    this.net?.retry();
  }

  /** 发言：颜色与模式随包上行，服务端钳制后广播，所有人看到同一份外观 */
  sendChat(text: string, colorIndex: number, danmakuMode: DanmakuMode): void {
    if (text.trim().length === 0) return;
    this.net?.sendChat({ colorIndex, danmakuMode, text });
  }

  /** 设置面板变更：开关 / 不透明度 / 覆盖区域立即作用到渲染层 */
  setDanmakuPrefs(prefs: DanmakuPrefs): void {
    this.danmakuPrefs = { ...prefs };
    this.renderer.setDanmakuPrefs(this.danmakuPrefs);
  }

  /** 上翻更早的聊天；`beforeMsgId = 0` 表示重新要最新一页（首屏语义） */
  requestHistory(beforeMsgId: number): void {
    this.net?.sendChatHistory(beforeMsgId, CHAT_HISTORY_PAGE_SIZE);
  }

  setAppearance(appearance: CharacterAppearance): void {
    this.localAppearance = appearance;
    this.net?.sendAppearance(appearance);
    if (this.localId) this.renderer.setAppearance(this.localId, appearance);
  }

  /**
   * 改常驻状态：本机先乐观上屏，服务端回执再对齐（打码后的文本可能不同）。
   * 空串即清除。
   */
  setStatus(status: string): void {
    this.status = status;
    this.net?.sendStatus(status);
    if (this.localId) this.renderer.setStatus(this.localId, status);
  }

  /**
   * 改工牌名：本机先乐观上屏，服务端回执再对齐（打码后的名字可能不同）。
   * 名字表必须一起改，否则牛马榜与聊天弹幕还叫旧名。
   */
  setName(name: string): void {
    this.name = name;
    this.net?.sendName(name);
    if (this.localId) {
      this.names.set(this.localId, name);
      this.renderer.setName(this.localId, name);
    }
  }

  /**
   * 自动寻路（ADR-0040）：以当前本地位置为起点，点一次只跑一次 A*。
   * 入座时先起身；找不到路就明确提示，不把人顶在墙上。
   */
  navigateTo(id: NavTargetId): void {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;
    if (this.localSeat !== 0) this.standUp();
    const target = NAV_TARGETS.find((item) => item.id === id);
    if (!target) return;
    const path = findPath(Position.x[eid]!, Position.y[eid]!, target.arrive.x, target.arrive.y);
    if (path === null) {
      this.cancelNavigation();
      this.showHint('找不到过去的路，试着手动走过去');
      return;
    }
    this.navigator.start(path, target);
    this.callbacks.onNav({ id: target.id, name: target.name });
  }

  /** 取消自动寻路：幂等，没有在导航时不触发回调 */
  cancelNavigation(): void {
    if (!this.navigator.active) return;
    this.navigator.cancel();
    this.callbacks.onNav(null);
  }

  /** 到达落点：停掉导航并给一句确认，避免玩家以为还在走 */
  private finishNavigation(): void {
    const name = this.navigator.target?.name;
    this.navigator.cancel();
    this.callbacks.onNav(null);
    if (name) this.showHint(`已到达${name}`);
  }

  /**
   * 动作入口：判定统一交给 `resolveInteraction`，这里只执行意图。
   * 坐 / 躺 / 起身 / 被拦 / 互动只有一处规则，桌面动作条与触屏动作盘共用。
   */
  perform(action: ActionKey): void {
    const eid = this.ecs.get(this.localId);
    if (!eid) return;
    // 倒地硬直期间不接受任何动作：起身只能等硬直结束（ADR-0051）
    if (this.elapsed < this.stunUntil) return;
    // 任何动作都先夺回控制权：坐着 / 躺着 / 跳跃 / 互动都不该被自动寻路拽着走
    this.cancelNavigation();
    this.applyIntent(eid, resolveInteraction(action, this.interactionState(eid)));
  }

  /** 把当前姿态、座位与附近设施打包成裁决输入（只在按键时调用，可接受两次座位扫描） */
  private interactionState(eid: number): InteractionState {
    const seat = this.localSeat !== 0 ? seatById(this.localSeat) : undefined;
    const isFree = (id: number) => !this.seatOwner.has(id);
    const x = Position.x[eid]!;
    const y = Position.y[eid]!;
    return {
      pose: Motion.pose[eid] as Pose,
      seated: this.localSeat !== 0,
      seatKind: seat?.kind ?? null,
      moving: Motion.moving[eid] === 1,
      seatAvailable: findNearestSeat(x, y, isFree, SIT_RANGE, (item) => item.kind !== 'bed') !== undefined,
      bedAvailable: findNearestSeat(x, y, isFree, SIT_RANGE, (item) => item.kind === 'bed') !== undefined,
    };
  }

  private applyIntent(eid: number, intent: InteractionIntent): void {
    switch (intent.kind) {
      case 'sit-seat': {
        const seat = this.findSeat(false);
        if (!seat) {
          this.sitGround(eid);
          return;
        }
        this.seatIntent = true;
        this.sitAt(seat);
        this.net?.sendAction(this.localId, ACTION.Sit);
        return;
      }
      case 'lie-bed': {
        const bed = this.findSeat(true);
        if (!bed) {
          this.lieGround(eid);
          return;
        }
        this.seatIntent = true;
        this.sitAt(bed);
        this.net?.sendAction(this.localId, ACTION.Lie);
        return;
      }
      case 'sit-ground':
        this.sitGround(eid);
        return;
      case 'lie':
        this.lieGround(eid);
        return;
      case 'stand':
        this.standUp();
        return;
      case 'jump':
        // 坐 / 躺先起身再跳：跳跃是位移动作，躺着原地起跳读不懂。
        // 行走中直接起跳：pose 与 moving 都不动，跳跃帧播完自然接回走路循环。
        this.standUp();
        if (Motion.pose[eid] !== POSE.Walk && Motion.pose[eid] !== POSE.Idle) {
          this.setLocalPose(eid, POSE.Idle);
        }
        this.startOverlay(eid, 'jump');
        return;
      case 'vent': {
        // 与服务端同一把尺子：本地先挡一道，连点不会白发包（ADR-0051）
        if (this.elapsed < this.ventAt) return;
        this.ventAt = this.elapsed + VENT_COOLDOWN_MS;
        // 行走中也要能出招：先把姿态从 Walk 落回 Idle，`overlayTrackFor` 才会给叠加轨，
        // 再用 ventLockUntil 冻结位移——否则就是「一边滑步一边头槌」
        if (Motion.pose[eid] === POSE.Walk || Motion.moving[eid] === 1) {
          this.setLocalPose(eid, POSE.Idle);
        }
        Motion.moving[eid] = 0;
        this.startOverlay(eid, 'vent');
        this.ventLockUntil = this.elapsed + this.overlays.ventMs;
        // 先播破空音：命中与否要等服务端结算（半个 RTT 之后），那一声「砰」随后补上
        this.emitAudio({
          kind: 'vent',
          x: Position.x[eid]!,
          y: Position.y[eid]!,
          hit: false,
          local: true,
        });
        // 台词按 netId 取：旁观者从 state 位的上升沿算出同一句，各窗口画面一致
        this.renderer.showBubble(this.localId, pickVentLine(this.localId));
        return;
      }
      case 'wave':
        // 打招呼只在站定时触发：图集没有行走挥手帧，套到脚步上就是滑步
        if (Motion.pose[eid] === POSE.Walk || Motion.moving[eid] === 1) return;
        this.startOverlay(eid, 'wave');
        Motion.moving[eid] = 0;
        return;
      case 'interact':
        this.interact(eid);
        return;
      case 'graze':
        this.graze(eid);
        return;
      case 'blocked':
        this.showHint(intent.hint);
        return;
    }
  }

  private sitGround(eid: number): void {
    this.setLocalPose(eid, POSE.Sit);
    // 切姿势会打断叠加动作
    this.clearOverlays(eid);
    Motion.moving[eid] = 0;
    this.net?.sendAction(this.localId, ACTION.Sit);
  }

  private lieGround(eid: number): void {
    this.setLocalPose(eid, POSE.Lie);
    this.clearOverlays(eid);
    Motion.moving[eid] = 0;
    this.net?.sendAction(this.localId, ACTION.Lie);
  }

  /**
   * 与最近的售货机 / 饮水机 / 咖啡机互动：本地冒一句气泡，并在设施坐标上发声（ADR-0024 / 0048）。
   * 900ms 节流：连按 F 不刷屏，也不至于把台词吞掉。
   *
   * 两块公告板都不是设施：不冒气泡、不播机器音，直接把面板交给宿主（ADR-0054 / 0058）。
   * 按键只判距离不判朝向——提示已经告诉玩家「面朝它」能按键，真按下去时别再拦一道。
   *
   * 查询写进复用槽位，不在按键栈里造 `{kind,x,y}`；设施在 56px 内，空间音效的
   * 距离衰减几乎满音量，pan 由它相对玩家的左右偏移决定。
   */
  private interact(eid: number): void {
    if (this.elapsed < this.interactAt) return;
    const x = Position.x[eid]!;
    const y = Position.y[eid]!;
    if (isNearBulletin(x, y)) {
      this.interactAt = this.elapsed + INTERACT_COOLDOWN_MS;
      this.callbacks.onBulletinOpen?.();
      return;
    }
    if (isNearRankBoard(x, y)) {
      this.interactAt = this.elapsed + INTERACT_COOLDOWN_MS;
      this.callbacks.onBoardOpen?.();
      return;
    }
    // 国风玄学两处（ADR-0061）排在设施之前：茶台就贴在饮水机旁，
    // 优先级写反了会出现「提示说续杯、按下去却在接水」。感应区已经收窄到 48px，
    // 站在饮水机西侧仍然按得到 cooler。
    if (isNearShrine(x, y)) {
      this.offerIncense(eid);
      return;
    }
    if (isNearTeaStation(x, y)) {
      this.brewTea();
      return;
    }
    const target = this.interactTarget;
    if (!nearestInteractivePropInto(target, x, y)) {
      this.showHint('附近没有可互动的设施');
      return;
    }
    this.interactAt = this.elapsed + INTERACT_COOLDOWN_MS;
    this.emitAudio({ kind: 'interact', target: target.kind, x: target.x, y: target.y });
    this.renderer.showBubble(this.localId, pickLine(target.kind, this.interactCount));
    this.interactCount += 1;
  }

  /**
   * 上香（ADR-0061）：作揖 + 磬音 + 财神金光 + 头顶金色飘字。
   *
   * 「当天首次」只按本地自然日判定，凭据存在 localStorage 里（`incense-day.ts`）：
   * 零服务端持久化，别人看不到你的光晕，「功德 +1」也只做当次提示、不成账。
   */
  private offerIncense(eid: number): void {
    this.interactAt = this.elapsed + INTERACT_COOLDOWN_MS;
    this.prayAt = this.elapsed;
    const x = Position.x[eid]!;
    const y = Position.y[eid]!;
    this.renderer.flashShrine();
    this.emitAudio({ kind: 'incense', x: SHRINE_ALTAR.x, y: SHRINE_ALTAR.y });
    this.renderer.showFloatText(x, y, INCENSE_FLOAT_TEXT);

    const today = localDateKey();
    if (this.incenseDay === today) return;
    this.incenseDay = today;
    this.env.writeIncenseDay(today);
    this.renderer.grantAura(this.localId, INCENSE_AURA_MS);
  }

  /**
   * 续杯（ADR-0061）。
   *
   * 「消除疲倦状态」落在仓库里真实存在的两处疲倦表现上：被创飞后的硬直
   * `stunUntil`，与躺床打盹的计时 `snoreAt`。不新增精力条——那会变成一套
   * 需要服务端同步的状态机，与零持久化冲突。
   */
  private brewTea(): void {
    this.interactAt = this.elapsed + INTERACT_COOLDOWN_MS;
    this.emitAudio({ kind: 'tea', x: TEA_STATION.x, y: TEA_STATION.y });
    this.showHint('咕嘟咕嘟… 喝了一大口枸杞黄芪老参茶！');
    this.stunUntil = 0;
    this.snoreAt = this.elapsed;
    this.renderer.showBubble(this.localId, '防脱发指数 +10% ｜ 气血恢复中');
  }

  /** 作揖包络：只在 900ms 窗口内逐帧写下沉量，窗口结束补一次归零 */
  private updatePray(): void {
    if (this.prayAt < 0) return;
    const since = this.elapsed - this.prayAt;
    if (since >= BOW_DURATION_MS) {
      this.prayAt = -1;
      this.renderer.setBow(this.localId, 0);
      return;
    }
    this.renderer.setBow(this.localId, bowTexelsAt(since));
  }

  /**
   * 咀嚼（G）：本地立即发声 + 冒气泡，同时把一次性事件发给服务端，
   * 由服务端按视野广播给附近玩家（ADR-0048）。
   *
   * state 字节已满，所以它不进 20Hz 同步包；这也意味着它没有远端姿态，
   * 其他人只会听到按方位衰减的咀嚼声。旧服务端会忽略未知 action，本地照常发声。
   */
  private graze(eid: number): void {
    if (this.elapsed < this.grazeAt) return;
    this.grazeAt = this.elapsed + GRAZE_COOLDOWN_MS;
    const x = Position.x[eid]!;
    const y = Position.y[eid]!;
    this.emitAudio({ kind: 'chew', x, y, local: true });
    this.renderer.showBubble(this.localId, pickGrazeLine(this.grazeCount));
    this.grazeCount += 1;
    this.net?.sendAction(this.localId, ACTION.Graze);
  }

  /** 附近玩家咀嚼：按该实体当前的插值位置发声，服务端已做 500ms 限频 */
  private handleGraze(id: number): void {
    const eid = this.ecs.get(id);
    if (!eid) return;
    this.emitAudio({ kind: 'chew', x: Position.x[eid]!, y: Position.y[eid]!, local: false });
  }

  /**
   * 发泄结算（ADR-0051）：服务端裁定「谁打到了谁、对方落在哪」。
   *
   * 这条包不能省，因为本地玩家的姿态是客户端预测的——Tick 里的 state 对自己不生效，
   * 不在这里强制落地就会出现「别人看我躺着，我自己还站着」。同理，击退只有 32px，
   * 低于本地和解的 128px 漂移阈值，光等 Tick 回正会先被拉开再被拽回。
   */
  private handleVent(packet: VentEventPacket): void {
    if (packet.targetId === 0) return;
    const x = dequantizeCoord(packet.x);
    const y = dequantizeCoord(packet.y);
    // 行为统计只认服务端归因：被击倒记「被喷」，成功击倒他人记「击倒」
    const outcome = ventOutcome(packet, this.localId);
    if (outcome === 'hit') this.callbacks.onVentHit?.(true);
    if (outcome === 'dealt') this.callbacks.onVentDealt?.();
    const targetEid = this.ecs.get(packet.targetId);
    // 钝击音挂在这条包上：谁被打都该听到「砰」，声源取服务端给的落点
    this.emitAudio({
      kind: 'vent',
      x,
      y,
      hit: true,
      local: packet.targetId === this.localId,
    });
    this.renderer.showBubble(packet.targetId, pickVentVictimLine(packet.targetId));
    this.renderer.setStun(packet.targetId, VENT_STUN_MS);
    if (!targetEid) return;

    if (packet.targetId === this.localId) {
      // 本人直接采用权威坐标：这一步是「无抖动拉回」的全部秘密
      Position.x[targetEid] = x;
      Position.y[targetEid] = y;
      this.setLocalPose(targetEid, POSE.Lie);
      Motion.moving[targetEid] = 0;
      this.clearOverlays(targetEid);
      // 本地硬直从「收到」开始算：比服务端的起始晚半个 RTT，所以客户端永远不会
      // 提前把输入发出去被服务端拒掉
      this.stunUntil = this.elapsed + VENT_STUN_MS;
      this.ventLockUntil = 0;
      if (this.localSeat !== 0) {
        // 被创飞即失去座位：服务端那边已经释放，本地镜像跟上，免得起身后还占着椅子
        this.localSeat = 0;
        this.entitySeat.delete(this.localId);
        this.seatIntent = false;
      }
      return;
    }

    // 旁观者：坐标与躺姿随 Tick 到达，这里只把这一帧的踏步状态收掉，
    // 免得远端在倒地那一帧还挂着走路循环
    Motion.moving[targetEid] = 0;
  }

  /**
   * 发声入口。
   *
   * 听者坐标随事件一起带出去，而不是让平台层自己每帧同步：Worker 里位置每帧
   * 都在变，主线程没有别的同步来源；同时这也把「一次发声」变成一个自足的、
   * 可序列化的事件，跨线程不需要任何额外状态。
   */
  private emitAudio(event: AudioEvent): void {
    const eid = this.ecs.get(this.localId);
    this.env.emitAudio(event, eid ? Position.x[eid]! : 0, eid ? Position.y[eid]! : 0);
  }

  /** 瞬时提示：1.6s 内不被环境提示覆盖，足够读完一句 */
  private showHint(text: string): void {
    this.hintUntil = this.elapsed + HINT_HOLD_MS;
    this.seatHint = text;
    this.callbacks.onHint(text);
  }

  /** 三个叠加动作互斥：后按的打断先按的，连按从第 0 帧重播 */
  private startOverlay(eid: number, kind: 'vent' | 'jump' | 'wave'): void {
    Motion.vent[eid] = kind === 'vent' ? 1 : 0;
    Motion.jump[eid] = kind === 'jump' ? 1 : 0;
    Motion.wave[eid] = kind === 'wave' ? 1 : 0;
    if (kind === 'jump') Motion.jumpSince[eid] = this.elapsed;
    else if (kind === 'wave') Motion.waveSince[eid] = this.elapsed;
    else Motion.ventSince[eid] = this.elapsed;
  }

  /**
   * 当前该画哪一列：叠加动作（跳 > 发泄）→ 基础姿态 → 时间轴 → 每实体相位偏移。
   * 姿态从不因叠加动作改写，所以「坐着发泄完还是坐着」不需要任何回滚逻辑。
   */
  private columnFor(netId: number, eid: number): number {
    const pose = Motion.pose[eid]! as Pose;
    const jumping = Motion.jump[eid] === 1;
    const venting = Motion.vent[eid] === 1;
    const waving = Motion.wave[eid] === 1;
    const overlay = overlayTrackFor(this.overlays, pose, venting, jumping, waving);
    const track = overlay ?? this.baseTracks[pose] ?? this.tracks.idle!;
    // 起始时刻与 overlayTrackFor 的优先级同序：跳 > 打招呼 > 发泄（三者互斥，正常只命中一个）
    const since =
      overlay === null
        ? Motion.since[eid]!
        : jumping
          ? Motion.jumpSince[eid]!
          : waving
            ? Motion.waveSince[eid]!
            : Motion.ventSince[eid]!;
    return frameAt(track, this.elapsed - since + phaseOffset(netId, track));
  }

  /** 本地叠加动作到期清位：下一包 move 就把位降下去，远端不会残留冲撞 / 抬手帧 */
  private expireLocalOverlays(eid: number): void {
    if (Motion.vent[eid] === 1 && this.elapsed - Motion.ventSince[eid]! >= this.overlays.ventMs) {
      Motion.vent[eid] = 0;
    }
    if (Motion.jump[eid] === 1 && this.elapsed - Motion.jumpSince[eid]! >= this.overlays.jumpMs) {
      Motion.jump[eid] = 0;
    }
    if (Motion.wave[eid] === 1 && this.elapsed - Motion.waveSince[eid]! >= this.overlays.waveMs) {
      Motion.wave[eid] = 0;
    }
  }

  /**
   * 本地玩家：输入 → 确定性预测。零网络延迟，贴墙滑行与门洞通行手感完全不变。
   */
  private stepLocal(eid: number, dt: number): void {
    this.expireLocalOverlays(eid);

    // 倒地硬直与出招窗口都要冻结位移：前者是「躺在地上动不了」，
    // 后者是「正在头槌，脚不该还在地上滑」（ADR-0051）
    const frozen = this.elapsed < this.stunUntil || this.elapsed < this.ventLockUntil;

    // 本帧手按方向：tick 里已经解算好，这里只读复用槽位
    const manual = this.manual;
    let vx = frozen ? 0 : manual.x;
    let vy = frozen ? 0 : manual.y;
    // 手动输入永远优先：一按方向键 / 摇杆就收回控制权，并停掉自动寻路
    if (!frozen && (vx !== 0 || vy !== 0)) {
      this.cancelNavigation();
    } else if (this.navigator.active && !frozen) {
      if (this.navigator.steer(Position.x[eid]!, Position.y[eid]!, this.navVector) === 'arrived') {
        this.finishNavigation();
      } else {
        vx = this.navVector.x;
        vy = this.navVector.y;
      }
    }

    const moving = vx !== 0 || vy !== 0;
    // 座位上一按方向键就起身：位置留在椅子旁，之后按正常移动走
    if (moving && this.localSeat !== 0) this.standUp();

    if (moving) {
      const prevX = Position.x[eid]!;
      const prevY = Position.y[eid]!;
      const nextX = clamp(prevX + vx * MOVE_SPEED * dt, 0, WORLD_WIDTH - 1);
      const nextY = clamp(prevY + vy * MOVE_SPEED * dt, 0, WORLD_HEIGHT - 1);
      // 与服务端同一个求解函数：本地预测不会出现「先穿墙再被拉回」
      resolveMotionInto(this.motion, prevX, prevY, nextX, nextY);
      const advanced = Math.abs(this.motion.x - prevX) + Math.abs(this.motion.y - prevY) > 0.01;
      Position.x[eid] = this.motion.x;
      Position.y[eid] = this.motion.y;
      Motion.direction[eid] = directionFromVector(vx, vy, Motion.direction[eid] as Direction);
      // 顶在围栏上时原地踏步会露馅：没有实际位移就当站定
      if (advanced) {
        // 走动打断发泄与打招呼（都没有行走帧）；跳跃是位移动作，不能在这里清位，
        // 否则「边走边跳」按下即被自己掐掉。出招窗口内已被 `frozen` 挡住位移，
        // 所以这条不会把刚按下的发泄掐掉
        Motion.vent[eid] = 0;
        Motion.wave[eid] = 0;
        if (Motion.pose[eid] !== POSE.Walk) {
          Motion.pose[eid] = POSE.Walk;
          Motion.since[eid] = this.elapsed;
        }
        Motion.moving[eid] = 1;
      } else {
        if (Motion.pose[eid] === POSE.Walk) {
          Motion.pose[eid] = POSE.Idle;
          Motion.since[eid] = this.elapsed;
        }
        Motion.moving[eid] = 0;
      }
    } else {
      if (Motion.pose[eid] === POSE.Walk) {
        Motion.pose[eid] = POSE.Idle;
        Motion.since[eid] = this.elapsed;
      }
      Motion.moving[eid] = 0;
    }

    // 贴着墙角走不动时不能永远顶着：连续 700ms 没有位移就交还控制权
    if (
      this.navigator.active &&
      this.navigator.observe(dt * 1000, Position.x[eid]!, Position.y[eid]!) === 'stuck'
    ) {
      const name = this.navigator.target?.name ?? '目标';
      this.cancelNavigation();
      this.showHint(`去${name}的路上被挡住了，试试手动走过去`);
    }
  }

  /**
   * 远端实体：按固定延迟采样位置与状态，然后一次性喂给渲染层。
   *
   * 位置与 state 取自同一个采样点，所以「先迈步后位移」的错位不会出现。
   * 采样本身不贵，但换纹理与重排深度只在可见时做——那才是真正的开销。
   */
  private stepRemote(eid: number, renderTime: number): void {
    const netId = this.ecs.netOf[eid]!;
    if (this.ecs.remote.sample(eid, renderTime, this.sample)) {
      const state = this.sample.state;
      Position.x[eid] = this.sample.x;
      Position.y[eid] = this.sample.y;
      Motion.direction[eid] = state & STATE_BITS.direction;

      const pose = (state >> STATE_BITS.poseShift) & STATE_BITS.pose;
      if (Motion.pose[eid] !== pose) {
        Motion.pose[eid] = pose;
        Motion.since[eid] = this.elapsed;
      }
      Motion.moving[eid] = (state & STATE_BITS.moving) !== 0 ? 1 : 0;
      // 远端发泄：只在 0→1 的上升沿播破空音并冒台词，按其实时位置做声像与衰减（ADR-0048）。
      // 与动画同源（都来自 state 位），所以「听到挥空」与「看到冲撞」不会错位。
      const wasVenting = Motion.vent[eid] === 1;
      this.applyOverlayBit(eid, Motion.vent, Motion.ventSince, (state & STATE_BITS.vent) !== 0);
      this.applyOverlayBit(eid, Motion.jump, Motion.jumpSince, (state & STATE_BITS.jump) !== 0);
      this.applyOverlayBit(eid, Motion.wave, Motion.waveSince, (state & STATE_BITS.wave) !== 0);
      if (!wasVenting && Motion.vent[eid] === 1) {
        this.emitAudio({
          kind: 'vent',
          x: this.sample.x,
          y: this.sample.y,
          hit: false,
          local: false,
        });
        // 台词由 netId 决定，全场每个窗口算出的都是同一句
        this.renderer.showBubble(netId, pickVentLine(netId));
      }
    }

    if (!this.renderer.updateEntity(netId, Position.x[eid]!, Position.y[eid]!)) return;

    this.renderer.setPose(netId, Motion.direction[eid]!, this.columnFor(netId, eid));
    this.syncSeatLift(netId, eid);
    // 跳跃弧线：图集只负责姿势与 5 纹素腾空，剩下的落差与阴影由客户端叠
    const jumping = Motion.jump[eid] === 1;
    const lift = jumping
      ? jumpLiftTexels(this.elapsed - Motion.jumpSince[eid]!, this.overlays.jumpMs)
      : 0;
    this.renderer.setJump(netId, lift, jumpShadowFor(lift));
  }

  /** 本地玩家永远在画面中心，不做可见性判定 */
  private commitLocalView(eid: number): void {
    const netId = this.ecs.netOf[eid]!;
    this.renderer.updateLocalEntity(netId, Position.x[eid]!, Position.y[eid]!);
    this.renderer.setPose(netId, Motion.direction[eid]!, this.columnFor(netId, eid));
    this.syncSeatLift(netId, eid);
    const jumping = Motion.jump[eid] === 1;
    const lift = jumping
      ? jumpLiftTexels(this.elapsed - Motion.jumpSince[eid]!, this.overlays.jumpMs)
      : 0;
    this.renderer.setJump(netId, lift, jumpShadowFor(lift));
  }

  /**
   * 上行移动：有变化才发，静止降到 4Hz 保活。
   *
   * 服务端的广播是变化驱动的，所以「发得勤」并不等于「别人看得见」：玩家在工位上
   * 坐着时每帧发的都是同一份三元组，只会白烧上行、服务端解析与 GC。
   *
   * 但**叠加位到期必须立刻发**：叫唤 / 跳 / 挥手的结束只体现在 state 的某一位掉下来，
   * 远端没有自己的过期计时器，漏了这一包就会一直循环播放（ADR-0018）。
   * `expireLocalOverlays` 在 `stepLocal` 里已经清位，所以这里每帧重算 state 就能捕获到它。
   *
   * 不再补发积压：服务端速度窗口封顶后，一帧一个最新坐标比补发一串过期坐标更准。
   */
  private sendMove(eid: number): void {
    const x = quantizeCoord(Position.x[eid]!);
    const y = quantizeCoord(Position.y[eid]!);
    const state = packState(
      Motion.direction[eid]! as Direction,
      Motion.pose[eid]! as Pose,
      Motion.moving[eid] === 1,
      Motion.vent[eid] === 1,
      Motion.jump[eid] === 1,
      Motion.wave[eid] === 1,
    );
    if (!shouldSendMove(this.lastSentMove, x, y, state, this.movementSendTime)) return;
    this.movementSendTime = 0;
    this.lastSentMove.x = x;
    this.lastSentMove.y = y;
    this.lastSentMove.state = state;
    this.clientMoveSequence = (this.clientMoveSequence + 1) & 0xffff;
    this.net?.sendMove(x, y, state, this.clientMoveSequence, Math.floor(performance.now()) >>> 0);
  }

  private tick = (ticker: { deltaMS: number }): void => {
    const dtMs = Math.min(ticker.deltaMS, 50);
    const dt = dtMs / 1000;
    const now = performance.now();
    this.elapsed += dtMs;
    this.frames += 1;

    // 视口：主线程由 ResizeObserver 写进控制块，这里只在真变化时重建倍率与文字位图。
    // 高刷屏上每帧无脑 resize 会重建 backing store，等于自废帧率。
    if (this.env.readViewport(this.viewport) && this.viewport.width > 0 && this.viewport.height > 0) {
      this.renderer.resize(this.viewport.width, this.viewport.height, this.viewport.dpr);
    }

    // 输入：掩码 + 摇杆解算一次，动作环在本帧内排空（正常 0–1 个，容量 4）
    const control = this.env.control;
    control.readTouch(this.touch);
    directionFromMask(control.readKeys(), this.touch.x, this.touch.y, this.manual);
    for (let code = control.takeAction(); code !== 0; code = control.takeAction()) {
      const action = ACTION_BY_CODE[code];
      if (action) this.perform(action);
    }

    const localEid = this.ecs.get(this.localId);
    if (localEid) {
      this.stepLocal(localEid, dt);
      this.emitLocalState(localEid);
    }

    // 自适应回放：好网 35ms、弱网最多 120ms，由同步包的传输偏移与 RTT p95 共同决定。
    // 抖动大时延迟抬升吸收突发，稳定后缓慢回落到跟手区间（ADR-0048，修订 ADR-0025）
    const renderTime = now - this.jitter.delayMs;

    // 一趟遍历同时完成：远端采样 → 状态变化检测 → 喂渲染层。
    // 原来这里是四趟（叠加位到期、插值、渲染同步、遮挡），每趟都是全实体扫描。
    for (const eid of this.ecs.entities()) {
      if (Local.flag[eid] === 1) {
        this.commitLocalView(eid);
        continue;
      }
      this.stepRemote(eid, renderTime);
    }

    if (localEid) {
      this.renderer.updateCamera(Position.x[localEid]!, Position.y[localEid]!);
      this.movementSendTime += dtMs;
      this.sendMove(localEid);
      this.snapshotAt += dtMs;
      if (this.snapshotAt >= SNAPSHOT_INTERVAL_MS) {
        this.snapshotAt = 0;
        this.persistNow();
      }
    }

    this.renderer.tickBubbles(dtMs);

    if (localEid) {
      this.seatHintAt += dtMs;
      if (this.seatHintAt >= SEAT_HINT_INTERVAL) {
        this.seatHintAt = 0;
        this.updateSeatHint(localEid);
      }
      this.updateSnore(localEid);
      // 上香作揖：同样挂在本地帧节拍上，900ms 包络走完补一次归零
      this.updatePray();
    }

    if (now - this.statsAt >= STATS_INTERVAL) {
      const windowMs = now - this.statsAt;
      this.fps = Math.round((this.frames * 1000) / windowMs);
      this.frames = 0;
      this.statsAt = now;
      const onlineSec = this.onlineSecOf(this.localId);
      this.ensureBoard(now);
      this.callbacks.onStats({
        fps: this.fps,
        ping: this.ping,
        x: localEid ? Math.round(Position.x[localEid]!) : 0,
        y: localEid ? Math.round(Position.y[localEid]!) : 0,
        nearby: this.names.size,
        backend: this.renderer.backend,
        region: localEid ? regionAt(Position.x[localEid]!, Position.y[localEid]!) : '',
        onlineSec,
        likes: this.localLikes,
        board: this.careerBoard,
        rank: this.rankById.get(this.localId) ?? null,
      });
      // 在岗提醒跟着统计节拍走：500ms 一次足够准，也不必为它单开一个计时器
      this.checkOnDuty(onlineSec);
    }
  };

  /**
   * 小地图快照：世界绝对坐标，4Hz 调用，不进入渲染循环。
   * 返回绝对坐标而不是相对坐标，是因为小地图要同时画地形与玩家，得共用一套世界变换。
   */
  worldSnapshot(limit = 128): WorldSnapshot {
    const localEid = this.ecs.get(this.localId);
    if (!localEid) return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, region: '', points: [] };
    const x = Position.x[localEid]!;
    const y = Position.y[localEid]!;
    const points: WorldSnapshot['points'] = [];
    for (const netId of this.names.keys()) {
      const eid = this.ecs.get(netId);
      if (!eid) continue;
      points.push({
        x: netId === this.localId ? x : Position.x[eid]!,
        y: netId === this.localId ? y : Position.y[eid]!,
        self: netId === this.localId,
      });
      if (points.length >= limit) break;
    }
    return { x, y, region: regionAt(x, y), points };
  }

  /**
   * 切后台 / 回前台。
   *
   * 只停渲染循环，不碰 WebSocket：断线重连要重新入场、重放落点，代价远大于
   * 留一条空闲连接。停止时把计时基准清掉，避免回前台第一帧累计出一个大 delta。
   */
  setSuspended(suspended: boolean): void {
    if (this.disposed) return;
    const ticker = this.renderer.app.ticker;
    if (suspended) {
      ticker.stop();
      return;
    }
    if (!ticker.started) ticker.start();
  }

  stop(): void {
    this.disposed = true;
    this.cancelNavigation();
    // 关页面前的最后一道保险：pagehide 没来得及触发时（路由内跳转）也能落盘
    this.persistNow();
    this.net?.dispose();
    this.net = null;
    this.renderer.app.ticker.remove(this.tick);
    this.renderer.destroy();
  }
}
