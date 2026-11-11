import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  MAX_ENTITIES,
  POSE,
  ByteWriter,
  buildSpawnBody,
  packState,
  type CharacterAppearance,
  type Direction,
  type Pose,
} from '@niuma/shared-types';

export class Player {
  id = 0;
  wsId = 0;
  name = '';
  appearance: CharacterAppearance = DEFAULT_APPEARANCE.cow;
  /** 常驻状态：空串表示没设置，只活在内存里，不进任何持久层 */
  status = '';
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
  /** 叫唤 / 跳 / 打招呼：客户端上传的一次性标志，服务端只保存与回传，不做到期计时 */
  emote = false;
  jump = false;
  wave = false;
  dirty = false;
  needsViewRefresh = false;
  lastMoveAt = 0;
  lastClientMoveSequence = -1; // 上次处理的移动包序号（用于防重复）
  chatWindowStart = 0;
  chatCount = 0;
  /** 上一次状态变更的时间戳：广播节流用，防伪造包把它当放大器 */
  lastStatusAt = 0;
  /** 上一次拉取历史的时刻：上翻请求的节流窗口，防止滚动抖动刷穿服务端 */
  lastHistoryAt = 0;
  /** 当前占用的座位 id，0 表示站立或地面坐 */
  seat = 0;
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

  reset(): void {
    this.id = 0;
    this.wsId = 0;
    this.name = '';
    this.appearance = DEFAULT_APPEARANCE.cow;
    this.status = '';
    this.joinedAt = 0;
    this.x = 0;
    this.y = 0;
    this.state = 0;
    this.direction = DIRECTION.Down;
    this.pose = POSE.Idle;
    this.moving = false;
    this.emote = false;
    this.jump = false;
    this.wave = false;
    this.seat = 0;
    this.dirty = false;
    this.needsViewRefresh = false;
    this.lastMoveAt = 0;
    this.lastClientMoveSequence = -1;
    this.chatWindowStart = 0;
    this.chatCount = 0;
    this.lastStatusAt = 0;
    this.lastHistoryAt = 0;
    this.spawnBodyCache = null;
    this.known.clear();
  }

  applyState(
    direction: Direction,
    pose: Pose,
    moving: boolean,
    emote = false,
    jump = false,
    wave = false,
  ): void {
    this.direction = direction;
    this.pose = pose;
    this.moving = moving;
    this.emote = emote;
    this.jump = jump;
    this.wave = wave;
    // state 是回传的唯一来源：一律重打包，不把客户端字节原样透传
    this.state = packState(direction, pose, moving, emote, jump, wave);
  }
}

/** 进程内世界：没有数据库、没有快照、断开即回收 */
export class World {
  readonly players = new Map<number, Player>();
  private readonly pool: Player[] = [];
  private nextId = 1;

  get size(): number {
    return this.players.size;
  }

  create(
    name: string,
    appearance: CharacterAppearance,
    wsId: number,
    x: number,
    y: number,
    status = '',
    joinedAt = Date.now(),
  ): Player | null {
    if (this.players.size >= MAX_ENTITIES) return null;
    const player = this.pool.pop() ?? new Player();
    player.reset();
    player.id = this.nextId;
    player.wsId = wsId;
    player.name = name;
    player.appearance = appearance;
    player.status = status;
    player.joinedAt = joinedAt;
    player.x = x;
    player.y = y;
    player.applyState(DIRECTION.Down, POSE.Idle, false);
    player.needsViewRefresh = true;
    this.nextId = this.nextId >= 0xfffe ? 1 : this.nextId + 1;
    this.players.set(player.id, player);
    return player;
  }

  destroy(id: number): Player | undefined {
    const player = this.players.get(id);
    if (!player) return undefined;
    this.players.delete(id);
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
