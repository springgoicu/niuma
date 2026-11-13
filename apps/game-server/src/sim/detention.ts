import {
  DIRECTION,
  JAIL_ANCHORS,
  JAIL_PHASE,
  POSE,
  SYSTEM_NOTICE_KIND,
  encodeJail,
  formatSystemNotice,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import { broadcastSystemNotice } from './notice';
import type { Transport } from './view';
import type { Player, World } from './world';

/**
 * 小黑屋处置（ADR-0072）：
 *
 * 只负责「判定 → 派单 → 押送到反省点 → 立即放人」。**没有禁足计时**：
 * 人一被送进屋里就恢复自由，移动、聊天、坐下都照常，屋子本身保留为普通空房。
 *
 * 判定只认真人玩家的完整 `Sit → Idle` 循环，坐在椅子或地上都算；躺下不算。
 * 只在姿态跃迁时做一次 56px 邻域查询，稳态成本是每 Tick 一次姿态比较。
 */

/** 判定阈值：全部是「正常玩家碰不到」的边界，不需要按人数调整 */
export const DETENTION = {
  /** 坐下 / 站起瞬间，必须有另一名角色在这个半径内 */
  WITNESS_RANGE_PX: 56,
  /** 滑动窗口：只看最近 8 秒的循环 */
  CYCLE_WINDOW_MS: 8_000,
  /** 坐姿持续下限：防止连点坐下/起身刷阈值 */
  CYCLE_MIN_MS: 150,
  /** 坐姿持续上限：坐久了起来不算「反复坐下站起」 */
  CYCLE_MAX_MS: 1_200,
  /** 相邻两轮循环的最小间隔 */
  MIN_GAP_MS: 150,
  /** 循环点离第一个点的最大漂移，超出清零 */
  ANCHOR_DRIFT_PX: 32,
  /** 第 3 次循环只警告本人 */
  WARN_CYCLES: 3,
  /** 第 6 次循环确认 */
  CONFIRM_CYCLES: 6,
  /** 或 3 秒内第 4 次循环 */
  RATE_WINDOW_MS: 3_000,
  RATE_CYCLES: 4,
  /** 排队等保安的上限；超时按证据不足放人 */
  DISPATCH_TIMEOUT_MS: 12_000,
  /** 一张案子从确认算起的硬上限，防止任务异常丢失后永远挂着 */
  CASE_TIMEOUT_MS: 40_000,
  /** 拖行期间给目标的硬直上限；到达 / 中止时清零，不作为禁足时长 */
  DRAG_LOCK_MS: 45_000,
} as const;

/** 保安押送端口：`sim` 只发「派给谁 / 取消谁」，不接触 NpcAgent */
export interface EscortPort {
  /** 返回接单保安的实体 id；0 表示全部在忙，下 Tick 再试 */
  dispatch(targetId: number, now: number): number;
  /** 目标已释放 / 断线，清掉保安身上的任务 */
  cancel(targetId: number): void;
}

/** 保安任务回报：追击中抓到、送到反省点、或异常中止 */
export type EscortEvent =
  | { kind: 'grab'; guardId: number; targetId: number; now: number }
  | { kind: 'arrive'; guardId: number; targetId: number; now: number }
  | {
      kind: 'abort';
      guardId: number;
      targetId: number;
      now: number;
      reason: 'timeout' | 'missing' | 'stuck' | 'cancelled';
    };

export interface DetentionOptions {
  world: World;
  grid: SpatialGrid;
  transport: Transport;
  escort: EscortPort;
  /** 释放座位并广播：由 server 注入，detention 不认识 SeatRegistry */
  releaseSeat(player: Player): void;
}

type CasePhase = 'pending' | 'chasing' | 'dragging';

interface DetentionCase {
  player: Player;
  phase: CasePhase;
  /** 0 表示还没派到保安（全部在忙） */
  guardId: number;
  /** 确认时刻：用于排队与整案超时 */
  since: number;
  /** 反省点下标：确认时占位，避免多人同格 */
  anchor: number;
}

/**
 * 单个玩家的循环观察窗。
 *
 * `anchor` 为 null 表示还没有有效的第一个循环点；姿态变化以外的字段
 * 只在「完成一次坐→站」时更新，避免每 Tick 计算。
 */
interface CycleWatch {
  pose: number;
  sitAt: number;
  /** 坐下那一刻是否有人围观 */
  sitWitness: boolean;
  /** 最近 8 秒内有效循环的完成时刻 */
  cycles: number[];
  anchorX: number | null;
  anchorY: number | null;
  warned: boolean;
  lastActivityAt: number;
}

export class Detention {
  private readonly world: World;
  private readonly grid: SpatialGrid;
  private readonly transport: Transport;
  private readonly escort: EscortPort;
  private readonly releaseSeat: (player: Player) => void;
  private readonly watches = new Map<number, CycleWatch>();
  private readonly cases = new Map<number, DetentionCase>();

  constructor(options: DetentionOptions) {
    this.world = options.world;
    this.grid = options.grid;
    this.transport = options.transport;
    this.escort = options.escort;
    this.releaseSeat = options.releaseSeat;
  }

  /** 每个 Tick 在 NPC 推进之前调用：检测坐/站边沿，达阈值就派单 */
  observe(now: number): void {
    for (const player of this.world.players.values()) {
      if (player.isNpc || player.wsId === 0) continue;
      // 已在押送流程里的玩家不再重复判定，避免同一段窗口派给两个保安
      if (this.cases.has(player.id)) {
        this.watches.delete(player.id);
        continue;
      }

      let watch = this.watches.get(player.id);
      if (!watch) {
        watch = {
          pose: player.pose,
          sitAt: 0,
          sitWitness: false,
          cycles: [],
          anchorX: null,
          anchorY: null,
          warned: false,
          lastActivityAt: now,
        };
        this.watches.set(player.id, watch);
        continue;
      }

      if (player.pose !== watch.pose) {
        watch.lastActivityAt = now;
        if (player.pose === POSE.Sit) {
          watch.sitAt = now;
          watch.sitWitness = this.hasWitness(player);
        } else if (watch.pose === POSE.Sit && player.pose === POSE.Idle) {
          this.finishCycle(player, watch, now);
          watch.sitAt = 0;
        } else if (watch.pose === POSE.Sit) {
          // 坐下后直接躺下 / 被创飞：这不是「起身」，整轮作废
          watch.sitAt = 0;
        }
        watch.pose = player.pose;
      }
    }
  }

  /** 每个 Tick 在 NPC 推进之后调用：排队派单、断线清理、超时兜底 */
  update(now: number): void {
    for (const [playerId, entry] of this.cases) {
      const player = this.world.get(playerId);
      if (!player || player.wsId === 0) {
        this.escort.cancel(playerId);
        this.cases.delete(playerId);
        continue;
      }

      if (entry.phase === 'pending') {
        if (now - entry.since >= DETENTION.DISPATCH_TIMEOUT_MS) {
          this.abort(player, entry);
          continue;
        }
        this.tryDispatch(player, entry, now);
        continue;
      }

      if (now - entry.since >= DETENTION.CASE_TIMEOUT_MS) {
        this.abort(player, entry);
      }
    }

    // 观察窗只保留最近有动作的人；离线 / 挂机的人不常驻内存
    for (const [playerId, watch] of this.watches) {
      const player = this.world.get(playerId);
      if (!player || player.wsId === 0 || now - watch.lastActivityAt > DETENTION.CYCLE_WINDOW_MS) {
        this.watches.delete(playerId);
      }
    }
  }

  /** 保安任务回报；找不到对应案子说明是迟到事件，直接忽略 */
  handleEscort(event: EscortEvent): void {
    const entry = this.cases.get(event.targetId);
    if (!entry) return;
    if (entry.guardId !== 0 && entry.guardId !== event.guardId) return;

    const player = this.world.get(event.targetId);
    if (!player) {
      this.cases.delete(event.targetId);
      return;
    }

    if (event.kind === 'grab') {
      if (entry.phase === 'dragging') return;
      entry.phase = 'dragging';
      // 拖行期间用 stun 做输入硬直（不是禁足）：目标不能移动 / 发泄 / 抢座
      this.releaseSeat(player);
      player.stunUntil = event.now + DETENTION.DRAG_LOCK_MS;
      player.applyState(player.direction, POSE.Lie, false);
      player.markDirtyIfChanged();
      this.broadcast(player, JAIL_PHASE.Escort, 0, entry.guardId);
      return;
    }

    if (event.kind === 'arrive') {
      this.placeInJail(player, entry, event.now);
      this.broadcast(player, JAIL_PHASE.Released, 0, event.guardId);
      this.cases.delete(event.targetId);
      return;
    }

    this.abort(player, entry, event.reason);
  }

  /** 断线 / 关服：把保安任务与观察窗一起清掉，不广播任何包 */
  dispose(): void {
    for (const [playerId] of this.cases) this.escort.cancel(playerId);
    this.cases.clear();
    this.watches.clear();
  }

  private finishCycle(player: Player, watch: CycleWatch, now: number): void {
    const duration = now - watch.sitAt;
    if (duration < DETENTION.CYCLE_MIN_MS || duration > DETENTION.CYCLE_MAX_MS) return;
    if (!watch.sitWitness || !this.hasWitness(player)) return;
    const previous = watch.cycles[watch.cycles.length - 1];
    if (previous !== undefined && now - previous < DETENTION.MIN_GAP_MS) return;

    if (watch.anchorX === null || watch.anchorY === null) {
      watch.anchorX = player.x;
      watch.anchorY = player.y;
    } else if (Math.hypot(player.x - watch.anchorX, player.y - watch.anchorY) > DETENTION.ANCHOR_DRIFT_PX) {
      // 位置漂移太大：前面几轮不是同一个地方，整体清零，以这一轮为新起点
      watch.cycles.length = 0;
      watch.warned = false;
      watch.anchorX = player.x;
      watch.anchorY = player.y;
    }

    watch.cycles.push(now);
    const windowStart = now - DETENTION.CYCLE_WINDOW_MS;
    while (watch.cycles.length > 0 && watch.cycles[0]! <= windowStart) watch.cycles.shift();

    if (watch.cycles.length < DETENTION.WARN_CYCLES) {
      watch.warned = false;
    } else if (!watch.warned) {
      watch.warned = true;
      this.sendWarn(player);
    }

    const rateStart = now - DETENTION.RATE_WINDOW_MS;
    let recent = 0;
    for (let index = watch.cycles.length - 1; index >= 0; index -= 1) {
      if (watch.cycles[index]! < rateStart) break;
      recent += 1;
    }

    if (
      watch.cycles.length >= DETENTION.CONFIRM_CYCLES ||
      recent >= DETENTION.RATE_CYCLES
    ) {
      this.confirm(player, watch, now);
    }
  }

  private confirm(player: Player, watch: CycleWatch, now: number): void {
    watch.cycles.length = 0;
    watch.warned = false;
    watch.anchorX = null;
    watch.anchorY = null;
    watch.pose = player.pose;
    this.watches.delete(player.id);

    const entry: DetentionCase = {
      player,
      phase: 'pending',
      guardId: 0,
      since: now,
      anchor: this.pickAnchor(),
    };
    this.cases.set(player.id, entry);

    const text = formatSystemNotice(SYSTEM_NOTICE_KIND.Detained, { name: player.name });
    if (text) {
      broadcastSystemNotice(
        this.world,
        this.transport,
        player.known,
        SYSTEM_NOTICE_KIND.Detained,
        text,
        player.id,
      );
    }

    // 就近派单，本 Tick 内保安即可起步；全忙就排队，下 Tick 由 update 重试
    if (!this.tryDispatch(player, entry, now)) {
      entry.phase = 'pending';
    }
  }

  private tryDispatch(player: Player, entry: DetentionCase, now: number): boolean {
    const guardId = this.escort.dispatch(player.id, now);
    if (guardId === 0) return false;
    entry.guardId = guardId;
    entry.phase = 'chasing';
    this.broadcast(player, JAIL_PHASE.Dispatch, 0, guardId);
    return true;
  }

  private abort(
    player: Player,
    entry: DetentionCase,
    reason: 'timeout' | 'missing' | 'stuck' | 'cancelled' = 'timeout',
  ): void {
    this.escort.cancel(player.id);
    if (entry.phase === 'dragging') {
      // 半路放人：清硬直、恢复站姿。位置不传送，保安原地松手
      player.stunUntil = 0;
      player.applyState(player.direction, POSE.Idle, false);
      player.markDirtyIfChanged();
    }
    this.cases.delete(player.id);
    this.broadcast(player, JAIL_PHASE.Released, 0, entry.guardId);
    console.log(
      `[jail] abort player=${player.id} phase=${entry.phase} reason=${reason} guard=${entry.guardId}`,
    );
  }

  /**
   * 到达反省点：把位置钉在空位上，立刻清硬直、落站姿。
   * 没有 30 秒倒计时，也没有 `jailUntil`——下一步就能自己走出去。
   */
  private placeInJail(player: Player, entry: DetentionCase, now: number): void {
    const anchor = JAIL_ANCHORS[entry.anchor] ?? JAIL_ANCHORS[1]!;
    player.seat = 0;
    player.stunUntil = 0;
    player.lastMoveAt = now;
    player.x = anchor.x;
    player.y = anchor.y;
    player.applyState(DIRECTION.Up, POSE.Idle, false);
    player.markDirtyIfChanged();
    if (this.grid.update(player.id, player.x, player.y)) player.needsViewRefresh = true;
  }

  /** 三个反省位里挑一个当前没被别的案子占用的 */
  private pickAnchor(): number {
    const used = new Set<number>();
    for (const entry of this.cases.values()) used.add(entry.anchor);
    for (let index = 0; index < JAIL_ANCHORS.length; index += 1) {
      if (!used.has(index)) return index;
    }
    return 1;
  }

  /** 56px 内是否有另一名角色；不区分真人与 NPC，保安自己也算围观者 */
  private hasWitness(player: Player): boolean {
    const rangeSq = DETENTION.WITNESS_RANGE_PX * DETENTION.WITNESS_RANGE_PX;
    for (const other of this.world.players.values()) {
      if (other.id === player.id) continue;
      const dx = other.x - player.x;
      const dy = other.y - player.y;
      if (dx * dx + dy * dy <= rangeSq) return true;
    }
    return false;
  }

  /** 警告只发本人：旁人既不该知道「保安盯上你了」，也不该看到黄条 */
  private sendWarn(player: Player): void {
    const packet = encodeJail({
      entityId: player.id,
      phase: JAIL_PHASE.Warn,
      self: true,
      seconds: 0,
      guardId: 0,
    });
    this.transport.send(player.wsId, packet);
  }

  /**
   * 阶段包要发两份：本人那份 `self=1` 才会被客户端当成「我的处置」，
   * 旁人收到 `self=0` 只画头顶气泡，不会误锁自己的移动。
   */
  private broadcast(player: Player, phase: number, seconds: number, guardId: number): void {
    if (player.wsId !== 0) {
      this.transport.send(
        player.wsId,
        encodeJail({ entityId: player.id, phase, self: true, seconds, guardId }),
      );
    }
    const other = encodeJail({ entityId: player.id, phase, self: false, seconds, guardId });
    for (const id of player.known) {
      const viewer = this.world.get(id);
      if (viewer && viewer.wsId !== 0) this.transport.send(viewer.wsId, other);
    }
  }
}

