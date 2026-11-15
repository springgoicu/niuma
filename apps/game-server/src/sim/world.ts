import { BossRuntime } from './boss';
import { RingRuntime } from './ring';
import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  EMPTY_CAREER,
  MAX_ENTITIES,
  MAX_ENTITY_ID,
  PATIENT_STATE,
  POSE,
  SYNC_FORMAT_LEGACY,
  ByteWriter,
  buildSpawnBody,
  emptyStats,
  encodeCareerSegment,
  packState,
  quantizeCoord,
  sanitizeEconomyProfile,
  type CareerSummary,
  type CharacterAppearance,
  type Direction,
  type EconomyProfile,
  type EconomyStats,
  type PatientState,
  type Pose,
  type SyncFormat,
} from '@niuma/shared-types';

export class Player {
  id = 0;
  wsId = 0;
  /**
   * 服务端 NPC：没有连接（wsId = 0），也不计入人数容量、榜单与在线统计。
   *
   * 其余字段与真人完全同构——NPC 复用同一套 AOI、同步与地形碰撞，
   * 「是不是 NPC」只影响准入与展示口径，不影响实体行为。
   */
  isNpc = false;
  /** 实体角色：0 普通 / 1 保安。随 spawn 包下发给客户端画警灯 */
  role = 0;
  name = '';
  appearance: CharacterAppearance = DEFAULT_APPEARANCE.cow;
  /** 常驻状态：空串表示没设置，只活在内存里，不进任何持久层 */
  status = '';
  /** 本人自报的考勤摘要：只用于工牌展示，不参与任何权威判定，进程重启即清空 */
  career: CareerSummary = { ...EMPTY_CAREER };
  /** 上一次考勤补报的时刻：按连接限频，防止伪造包把视野广播当放大器 */
  lastCareerAt = 0;
  /**
   * 收到的工牌点赞数（ADR-0057 / ADR-0081）：入场时从匿名档案预置，点赞时回写档案。
   * 只用于展示与「人气」榜，不参与任何权威判定；没带设备号的老客户端退化为会话计数。
   */
  likes = 0;
  /**
   * 匿名设备号（ADR-0081）：8 字节随机数的 hex，只当点赞 / 战绩的聚合键。
   *
   * 它不是账号、不做认证、也不回显给其他玩家；重连会拿到新的 Player，
   * 因此这里只承载「同一个浏览器」的连续性，不承载任何会话状态。
   */
  deviceId = '';
  /** 谁点过我：一个连接对同一目标只能点一次；点赞者离开时从所有目标里清掉 */
  readonly likedBy = new Set<number>();
  /** 上一次点赞时刻：按连接限频，防止伪造包把点赞广播当放大器 */
  lastLikeAt = 0;
  /** 上一次拉取牛马榜的时刻：榜单是按需查询，同样要限频防放大（ADR-0054） */
  lastBoardAt = 0;
  /** 摘要编码后的尾部段：与 spawnBody 同一套缓存纪律，补报时失效 */
  private careerSegmentCache: Uint8Array | null = null;
  /**
   * 入场时刻（毫秒）。在线时长按会话口径结算，断线重连会拿到新的 Player，
   * 因此这里不承担跨会话身份；进程重启即清零（ADR-0004）。
   */
  joinedAt = 0;
  /** 世界坐标（像素浮点）；上线传输时才量化 */
  x = 0;
  y = 0;
  state = 0;
  direction: Direction = DIRECTION.Down;
  pose: Pose = POSE.Idle;
  moving = false;
  /**
   * 发泄 / 跳 / 打招呼：客户端上传的一次性标志，服务端只保存与回传，不做到期计时。
   *
   * 发泄位同时是「出招意图」：真正的命中裁决在 Tick 里由 `resolveVents` 完成，
   * 客户端无法自证打到了谁。
   */
  vent = false;
  /**
   * 发泄位的 0→1 边沿标记。
   *
   * 客户端把位保持一整个播放窗口（440ms ≈ 9 个 Tick），若每 Tick 都结算，
   * 一次出招会连打九次。边沿标记只让「第一次看到为真」的那 Tick 进结算，
   * 由 `resolveVents` 消费后清零。
   */
  ventPending = false;
  jump = false;
  /** 跳跃闪避截止时刻：头槌命中判定读它，0 表示不在无敌帧 */
  jumpUntilMs = 0;
  wave = false;
  dirty = false;
  needsViewRefresh = false;
  /**
   * 上一次**真正发出去**的量化坐标与 state（同步条目里的三元组）。
   *
   * 去脏判定拿它做基准：坐着不动的玩家每个 Tick 都发一遍 MOVE，但三元组一模一样，
   * 再广播就只是把同样的 7 个字节重复给所有观察者。初始值 -1 保证首次移动一定入包。
   */
  lastBroadcastQx = -1;
  lastBroadcastQy = -1;
  lastBroadcastState = -1;
  /** 该连接收哪种同步条目：由 HELLO 能力段决定，旧客户端保持 7 字节 */
  syncFormat: SyncFormat = SYNC_FORMAT_LEGACY;
  lastMoveAt = 0;
  lastClientMoveSequence = -1; // 上次处理的移动包序号（用于防重复）
  chatWindowStart = 0;
  chatCount = 0;
  /**
   * 上一次真正发出的聊天时刻。
   *
   * 与 5s/3 条窗口是两层不同的东西：窗口管「一段时间能说几句」，
   * 冷却管「两句之间至少隔多久」。后者挡住的是按住回车连刷——
   * 那种情况下三条会在 200ms 内全部离网，把频道刷成一片。
   */
  lastChatAt = 0;
  /** 冷却窗口内被拒的次数；短时间内反复撞墙说明是脚本，不是手速快 */
  chatStrikes = 0;
  chatStrikeStart = 0;
  /** 临时禁言截止时刻；0 表示未禁言。禁言只拦上行，不踢线 */
  chatMutedUntil = 0;
  /** 上一次状态变更的时间戳：广播节流用，防伪造包把它当放大器 */
  lastStatusAt = 0;
  /** 上一次改名的时间戳：改名同样是视野广播，需要独立的节流窗口 */
  lastRenameAt = 0;
  /** 上一次拉取历史的时刻：上翻请求的节流窗口，防止滚动抖动刷穿服务端 */
  lastHistoryAt = 0;
  /**
   * 上一次发泄结算的时刻。
   *
   * 一次性事件绕过 state 位，必须由服务端限频防伪造包放大；
   * 这里还兼作边沿闸门的第二道保险：限频窗口内的重复上报一律不结算，连点也刷不出第二下。
   */
  lastVentAt = 0;

  // ---- 牛马币经济（ADR-0082）：永久层在浏览器 localStorage，这里的值是本次进园的权威 ----
  /** 可用余额（已扣除托管中的赌注） */
  coins = 0;
  stats: EconomyStats = emptyStats();
  inventory: Record<string, number> = {};
  houseTier = 0;
  /** 已解锁的外观件与家具（`furn:<id>`）：装扮货架与公寓家具共用这条清单 */
  unlockedCosmetics: string[] = [];
  /** 已冻结赌注：从 coins 扣出但尚未裁决，退款按这个数原路返还 */
  escrowedCoins = 0;
  /**
   * 正在参与的互动 id，0 表示空闲。
   *
   * 邀请表、对局表、打赏与道具都读这一个字段判忙碌——绝不允许出现
   * 「邀请说空闲、对局说占用」的第二份真相。
   */
  busyMatchId = 0;
  /** 待回应的邀请 id，0 表示没有；与 busyMatchId 一起构成「忙碌」判定 */
  pendingInviteId = 0;
  /**
   * 统一 Buff 表（ADR-0085）：`BuffType → expiresAt`（毫秒）。
   *
   * 冰美式、摸鱼护盾、降薪贴、滑倒、保安盯梢都写这一张表，
   * 到期由 Tick 的 `pruneBuffs` 单遍清理；判定层（移动 / 冷却 / 击倒）只读
   * 下面的乘子缓存，不在 20Hz 路径上遍历它。
   */
  activeBuffs = new Map<number, number>();
  /**
   * 整蛊保护截止：命中一次控制类整蛊（香蕉皮 / 降薪贴）后写入，
   * 60 秒内同目标不再吃第二次控制——防恶意无限控死。
   *
   * 用单个时间戳而不是 Map：保护对「控制类」整体生效，
   * 按道具分别计时反而会让人用两件道具各控一次。
   */
  trickGuardUntil = 0;
  /** 护盾层数：每次被 E 撞飞或整蛊消耗 1 层，归零时同时撤掉 Shield 状态 */
  shieldCharges = 0;
  /** 移速乘子缓存（`applyMove` 只读它）：由 `sim/buffs` 在状态变更时重算 */
  speedMul = 1;
  /** 发泄冷却乘子缓存（`resolveVents` 只读它） */
  ventCdMul = 1;
  /** 大喇叭限频时间戳 */
  lastShoutAt = 0;
  /** 互动包限频时间戳：邀请 / 打赏 / 道具 / 购买共用同一个闸门 */
  lastP2PAt = 0;
  /** 上一次搬砖结算时刻：工位搬砖的最小间隔靠它，重发包刷不出双份工资（ADR-0088） */
  lastWorkClaimAt = 0;

  // ---- 每日悬赏（ADR-0088）----
  /**
   * 进度所属的园区日期键 `YYYY-MM-DD`。
   *
   * 换日时整表清零：悬赏是「今天这三件事」，不是累计成就；断线即回收，
   * 与钱包同一条「服务端不记得你是谁」的口径。
   */
  questDay = '';
  questProgress: Record<number, number> = {};
  questClaimed = new Set<number>();

  /** 进园落位：HELLO 经济段是不可信输入，必须再过一次 sanitize */
  applyEconomy(profile: EconomyProfile | undefined): void {
    const clean = sanitizeEconomyProfile(profile);
    this.coins = clean.coins;
    this.stats = clean.stats;
    this.inventory = clean.inventory;
    this.houseTier = clean.houseTier;
    this.unlockedCosmetics = [...clean.unlockedCosmetics];
    this.escrowedCoins = 0;
    this.busyMatchId = 0;
    this.pendingInviteId = 0;
    // 本次进园是全新会话：上一局残留的 Buff / 护盾 / 整蛊保护一律不继承
    this.activeBuffs.clear();
    this.trickGuardUntil = 0;
    this.shieldCharges = 0;
    this.speedMul = 1;
    this.ventCdMul = 1;
    this.lastShoutAt = 0;
    this.lastP2PAt = 0;
  }

  /** 发钱包同步包时读的快照：只带服务端权威字段，每日任务留在本地 */
  economyProfile(): EconomyProfile {
    return sanitizeEconomyProfile({
      coins: this.coins,
      stats: this.stats,
      inventory: this.inventory,
      houseTier: this.houseTier,
      unlockedCosmetics: this.unlockedCosmetics,
    });
  }

  /**
   * 倒地硬直截止时刻（毫秒）。期间姿态被强制为躺姿、位置不接受客户端上报。
   * 由 `resolveVents` 写入，`applyMove` 读取。
   */
  stunUntil = 0;
  /** 15 秒内的受击计数与上次命中 Tick（会话态，不落盘） */
  recentHits = 0;
  lastHitTick = -10000;
  /** 治愈后的工伤保护截止（毫秒与 Tick 双写：前者供判定，后者供协议/调试） */
  immunityUntilMs = 0;
  immunityUntilTick = 0;
  /** 昏迷：强制躺倒、封禁移动与技能，直到护士完成治疗或在队列超时后就地包扎 */
  incapacitated = false;
  /** 正在被哪辆救护车拖拽；0 表示未被挂载 */
  carriedBy = 0;
  /** 当前占用座位的护理阶段：0 无 / 2 治疗中（供 Tick 状态广播去重） */
  patientState: PatientState = PATIENT_STATE.None;
  patientUntil = 0;
  /** 当前占用的座位 id，0 表示站立或地面坐 */
  seat = 0;
  /**
   * 所在房间频道：0 = 园区，1..6 = 牛马公寓的房间。
   *
   * 房间是同一段坐标上的不同频道：同频道互相可见，跨频道与屋外互不可见。
   * 视野过滤在 `refreshView` 里做，移动与碰撞完全复用园区的实现。
   */
  roomId = 0;
  /** 八角笼连胜：同一人连续拿冠军的次数，断线或换人夺冠即清零 */
  ringStreak = 0;
  /** 当前视野内的实体 id，与对方集合保持对称 */
  known = new Set<number>();
  /** 每人一个可复用发送缓冲，避免每 Tick 新建 */
  syncWriter = new ByteWriter(2048);
  /**
   * 入场包缓冲。每个玩家同一时刻只有一份在飞，所以按人持有就不会出现
   * 「一次循环里反复覆写同一个缓冲再发出去」的别名问题。
   */
  spawnWriter = new ByteWriter(320);
  /** 本 Tick 已写入同步包的实体数量 */
  syncCount = 0;
  /** 名字 + 外观编码后的不变部分，见 `spawnBody` */
  private spawnBodyCache: Uint8Array | null = null;

  /**
   * 入场资料的「不变部分」。名字、外观与状态在一局内很长时间不变，缓存后入场补发从
   * O(视野人数) 次编码降到 O(1) 次——这是 200 人同秒涌入那次长帧的根因。
   */
  get spawnBody(): Uint8Array {
    if (this.spawnBodyCache === null) {
      this.spawnBodyCache = buildSpawnBody(this.name, this.appearance, this.status);
    }
    return this.spawnBodyCache;
  }

  /** 名字、外观或状态变更后必须调用，否则新入场者会看到上一套帽子、配色与状态 */
  markSpawnDirty(): void {
    this.spawnBodyCache = null;
  }

  /** 考勤摘要的尾部段：与 spawnBody 一样只编码一次，补报时显式失效 */
  get careerSegment(): Uint8Array {
    if (this.careerSegmentCache === null) {
      this.careerSegmentCache = encodeCareerSegment(this.career);
    }
    return this.careerSegmentCache;
  }

  markCareerDirty(): void {
    this.careerSegmentCache = null;
  }

  /**
   * 三元组去脏：只有观测者看得出差别时才置 dirty。
   *
   * 基准是上一次**真正广播出去**的量化坐标与 state（由 `runTick` 回写）。
   * 真人客户端 20Hz 上报移动包、NPC 每 Tick 推进位置，都会经过这一道；
   * 站着不动、朝向未变时一个字节都不发。
   */
  markDirtyIfChanged(): void {
    if (
      quantizeCoord(this.x) !== this.lastBroadcastQx ||
      quantizeCoord(this.y) !== this.lastBroadcastQy ||
      this.state !== this.lastBroadcastState
    ) {
      this.dirty = true;
    }
  }

  reset(): void {
    this.id = 0;
    this.wsId = 0;
    this.isNpc = false;
    this.role = 0;
    this.name = '';
    this.appearance = DEFAULT_APPEARANCE.cow;
    this.status = '';
    this.career = { ...EMPTY_CAREER };
    this.careerSegmentCache = null;
    this.lastCareerAt = 0;
    this.lastBoardAt = 0;
    this.likes = 0;
    this.deviceId = '';
    this.likedBy.clear();
    this.lastLikeAt = 0;
    this.joinedAt = 0;
    this.x = 0;
    this.y = 0;
    this.state = 0;
    this.direction = DIRECTION.Down;
    this.pose = POSE.Idle;
    this.moving = false;
    this.vent = false;
    this.ventPending = false;
    this.jump = false;
    this.jumpUntilMs = 0;
    this.wave = false;
    this.seat = 0;
    this.roomId = 0;
    this.ringStreak = 0;
    this.dirty = false;
    this.needsViewRefresh = false;
    this.lastBroadcastQx = -1;
    this.lastBroadcastQy = -1;
    this.lastBroadcastState = -1;
    this.syncFormat = SYNC_FORMAT_LEGACY;
    this.lastMoveAt = 0;
    this.lastClientMoveSequence = -1;
    this.chatWindowStart = 0;
    this.chatCount = 0;
    this.lastChatAt = 0;
    this.chatStrikes = 0;
    this.chatStrikeStart = 0;
    this.chatMutedUntil = 0;
    this.lastStatusAt = 0;
    this.lastRenameAt = 0;
    this.lastHistoryAt = 0;
    this.lastVentAt = 0;
    this.coins = 0;
    this.stats = emptyStats();
    this.inventory = {};
    this.houseTier = 0;
    this.unlockedCosmetics = [];
    this.escrowedCoins = 0;
    this.busyMatchId = 0;
    this.pendingInviteId = 0;
    // 对象池复用：Buff / 护盾 / 整蛊保护必须逐项归零，否则下一个玩家会继承上一个人的贴纸
    this.activeBuffs.clear();
    this.trickGuardUntil = 0;
    this.shieldCharges = 0;
    this.speedMul = 1;
    this.ventCdMul = 1;
    this.lastShoutAt = 0;
    this.lastP2PAt = 0;
    this.lastWorkClaimAt = 0;
    this.questDay = '';
    this.questProgress = {};
    this.questClaimed.clear();
    this.stunUntil = 0;
    this.recentHits = 0;
    this.lastHitTick = -10000;
    this.immunityUntilMs = 0;
    this.immunityUntilTick = 0;
    this.incapacitated = false;
    this.carriedBy = 0;
    this.patientState = 0;
    this.patientUntil = 0;
    this.spawnBodyCache = null;
    this.known.clear();
  }

  applyState(
    direction: Direction,
    pose: Pose,
    moving: boolean,
    vent = false,
    jump = false,
    wave = false,
  ): void {
    // 边沿检测必须发生在覆盖之前：客户端把 vent 位保持一整个播放窗口，
    // 只有 0→1 那一次才该进命中结算（见 `resolveVents`）
    if (vent && !this.vent) this.ventPending = true;
    this.direction = direction;
    this.pose = pose;
    this.moving = moving;
    this.vent = vent;
    this.jump = jump;
    this.wave = wave;
    // state 是回传的唯一来源：一律重打包，不把客户端字节原样透传
    this.state = packState(direction, pose, moving, vent, jump, wave);
  }
}

/**
 * 世界：实体与共享运行态的容器。
 *
 * 老板与擂台由外部构造后注入：它们的时区与恢复数据来自进程级配置与快照
 * （ADR-0081），不再各自偷偷读 `Date.now()` / 本地时区。
 */
export class World {
  readonly players = new Map<number, Player>();
  /** 发泄区老板：静态地标，不占实体 id，也不进入 AOI 与同步快照 */
  readonly boss: BossRuntime;
  /** 发泄区擂台：状态机；重启后按快照恢复局号，但不复活进行中的比赛 */
  readonly ring: RingRuntime;

  constructor(boss = new BossRuntime(), ring = new RingRuntime()) {
    this.boss = boss;
    this.ring = ring;
  }
  private readonly pool: Player[] = [];
  private nextId = 1;
  /** 真人数：准入、排队与在线统计的唯一口径，NPC 永不参与 */
  private humanCount = 0;
  private npcTotal = 0;

  /** 总实体数（真人 + NPC）：AOI、实体 id 与内存上限的口径 */
  get size(): number {
    return this.players.size;
  }

  get humans(): number {
    return this.humanCount;
  }

  get npcCount(): number {
    return this.npcTotal;
  }

  create(
    name: string,
    appearance: CharacterAppearance,
    wsId: number,
    x: number,
    y: number,
    status = '',
    joinedAt = Date.now(),
    deviceId = '',
  ): Player | null {
    if (this.players.size >= MAX_ENTITIES) return null;
    // 与紧凑条目的 10 bit id 对齐：回绕点必须在 MAX_ENTITY_ID 上，否则 id 会被位表截断成别人。
    // id 空间比旧版小了一个数量级，长时间运行后 nextId 会绕回仍在使用的号段，必须跳过占用的号
    let id = this.nextId;
    while (this.players.has(id)) {
      id = id >= MAX_ENTITY_ID ? 1 : id + 1;
      if (id === this.nextId) return null;
    }
    this.nextId = id >= MAX_ENTITY_ID ? 1 : id + 1;

    const player = this.pool.pop() ?? new Player();
    player.reset();
    player.id = id;
    player.wsId = wsId;
    player.name = name;
    player.appearance = appearance;
    player.status = status;
    player.joinedAt = joinedAt;
    player.deviceId = deviceId;
    player.x = x;
    player.y = y;
    player.applyState(DIRECTION.Down, POSE.Idle, false);
    player.needsViewRefresh = true;
    this.players.set(player.id, player);
    this.humanCount += 1;
    return player;
  }

  /**
   * 创建一个服务端 NPC：wsId = 0，没有连接，不计入真人口径。
   *
   * 其余字段与真人完全同构，因此 AOI、去脏广播、地形碰撞、聊天与工牌渲染
   * 全部走既有路径；`humans` / `npcCount` 只影响准入与展示。
   */
  createNpc(
    name: string,
    appearance: CharacterAppearance,
    x: number,
    y: number,
    status = '',
    joinedAt = Date.now(),
    career?: CareerSummary,
    role = 0,
  ): Player | null {
    const player = this.create(name, appearance, 0, x, y, status, joinedAt);
    if (!player) return null;
    player.isNpc = true;
    player.role = role;
    // create 已按真人记账，这里改成 NPC：两边都必须是 O(1)
    this.humanCount -= 1;
    this.npcTotal += 1;
    if (career) {
      player.career = career;
      player.markCareerDirty();
    }
    return player;
  }

  destroy(id: number): Player | undefined {
    const player = this.players.get(id);
    if (!player) return undefined;
    this.players.delete(id);
    // 必须在 reset 之前判断：reset 会把 isNpc 归零
    if (player.isNpc) this.npcTotal = Math.max(0, this.npcTotal - 1);
    else this.humanCount = Math.max(0, this.humanCount - 1);
    // 点赞去重集合只记 liker id：玩家离开后从所有目标里清掉，
    // 避免实体 id 复用后新玩家顶着旧 id 无法点赞（ADR-0057）。
    for (const other of this.players.values()) other.likedBy.delete(id);
    player.reset();
    if (this.pool.length < 256) this.pool.push(player);
    return player;
  }

  get(id: number): Player | undefined {
    return this.players.get(id);
  }

  getByWsId(wsId: number): Player | undefined {
    for (const player of this.players.values()) {
      if (player.wsId === wsId) return player;
    }
    return undefined;
  }
}
