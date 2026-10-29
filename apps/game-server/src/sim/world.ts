import {
  DEFAULT_APPEARANCE,
  DIRECTION,
  MAX_ENTITIES,
  POSE,
  ByteWriter,
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
  /** 世界坐标（像素浮点）；上线传输时才量化 */
  x = 0;
  y = 0;
  state = 0;
  direction: Direction = DIRECTION.Down;
  pose: Pose = POSE.Idle;
  moving = false;
  dirty = false;
  needsViewRefresh = false;
  lastMoveAt = 0;
  chatWindowStart = 0;
  chatCount = 0;
  /** 当前视野内的实体 id，与对方集合保持对称 */
  known = new Set<number>();
  /** 每人一个可复用发送缓冲，避免每 Tick 新建 */
  syncWriter = new ByteWriter(2048);
  /** 本 Tick 已写入同步包的实体数量 */
  syncCount = 0;

  reset(): void {
    this.id = 0;
    this.wsId = 0;
    this.name = '';
    this.appearance = DEFAULT_APPEARANCE.cow;
    this.x = 0;
    this.y = 0;
    this.state = 0;
    this.direction = DIRECTION.Down;
    this.pose = POSE.Idle;
    this.moving = false;
    this.dirty = false;
    this.needsViewRefresh = false;
    this.lastMoveAt = 0;
    this.chatWindowStart = 0;
    this.chatCount = 0;
    this.known.clear();
  }

  applyState(direction: Direction, pose: Pose, moving: boolean): void {
    this.direction = direction;
    this.pose = pose;
    this.moving = moving;
    this.state = packState(direction, pose, moving);
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

  create(name: string, appearance: CharacterAppearance, wsId: number, x: number, y: number): Player | null {
    if (this.players.size >= MAX_ENTITIES) return null;
    const player = this.pool.pop() ?? new Player();
    player.reset();
    player.id = this.nextId;
    player.wsId = wsId;
    player.name = name;
    player.appearance = appearance;
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
