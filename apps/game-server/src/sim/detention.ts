import {
  DIRECTION,
  ENTITY_ROLE_GUARD,
  ENTITY_ROLE_NURSE,
  JAIL_ANCHORS,
  JAIL_PHASE,
  POSE,
  SYSTEM_NOTICE_KIND,
  encodeJail,
  encodeSystemNotice,
  formatSystemNotice,
} from '@niuma/shared-types';
import type { SpatialGrid } from '../spatial/grid';
import { broadcastSystemNotice } from './notice';
import type { VentHitObserver } from './vent';
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
 *
 * 擂台赛（ADR-0075）是执法豁免区：名单内的玩家不进入判定，已确认的案子在
 * 报名那一刻撤销。豁免只读 `World.ring`，不新增第二份「谁在场上」的事实源。
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
  /**
   * 一张案子从确认算起的硬上限，防止任务异常丢失后永远挂着。
   * 覆盖「排队 12s + 追击 12s + 拖行上限 60s」再留 6s 余量（ADR-0080）。
   */
  CASE_TIMEOUT_MS: 90_000,
  /**
   * 拖行期间给目标的硬直；`npc/escort` 逐帧续期，到达 / 中止时清零。
   * 短于案子上限，所以任何停摆都会先让被押者恢复行动，而不是躺到案子超时。
   */
  DRAG_LOCK_MS: 5_000,
} as const;

/**
 * 零容忍角色（ADR-0090）：保安与护士被打一次即建案，普通同事仍不进执法。
 *
 * 改成集合而不是继续叠 `if`：这条口径还会随新职业扩展，规则收在一处才不会漂移。
 */
const ZERO_TOLERANCE_ROLES: ReadonlySet<number> = new Set([ENTITY_ROLE_GUARD, ENTITY_ROLE_NURSE]);

/** 打人触发执法（ADR-0074）：只统计擂台外的真人命中；零容忍角色单独一轮建案（ADR-0080 / 0090） */
export const ASSAULT = {
  /** 滑动窗口：2 分钟内的命中才累计 */
  WINDOW_MS: 120_000,
  /** 第 2 次只私下警告本人 */
  WARN_HITS: 2,
  /** 第 3 次确认：广播并派保安押送 */
  CONFIRM_HITS: 3,
  /** 账本清理节流：断线与过期记录不必每 Tick 扫 */
  PRUNE_MS: 5_000,
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

export class Detention implements VentHitObserver {
  private readonly world: World;
  private readonly grid: SpatialGrid;
  private readonly transport: Transport;
  private readonly escort: EscortPort;
  private readonly releaseSeat: (player: Player) => void;
  private readonly watches = new Map<number, CycleWatch>();
  private readonly cases = new Map<number, DetentionCase>();
  /** 打人账本：攻击者 id → 受害者 id → 窗口内的命中时刻 */
  private readonly attacks = new Map<number, Map<number, number[]>>();
  /** 上一次清理账本的时刻：按 `PRUNE_MS` 节流 */
  private assaultPruneAt = 0;

  constructor(options: DetentionOptions) {
    this.world = options.world;
    this.grid = options.grid;
    this.transport = options.transport;
    this.escort = options.escort;
    this.releaseSeat = options.releaseSeat;
  }

  /**
   * 发泄命中回调（ADR-0074 / ADR-0080）。
   *
   * 真人之间：把「攻击者 → 受害者」的命中时刻记进 2 分钟滑动窗口。
   * 零容忍角色（保安 / 护士）：命中一次直接建案，普通同事仍不进执法。
   * 命中几何、擂台隔离与入座免伤都留在 `sim/vent`；这里只认已经发生的命中。
   */
  onVentHit(attacker: Player, victim: Player, now: number): void {
    if (attacker.isNpc || attacker.wsId === 0) return;
    // 已在押送流程里的人不再累计：避免刚放出来就立刻被第二张单子带走
    if (this.cases.has(attacker.id)) return;

    if (victim.isNpc) {
      // 只认零容忍角色：普通同事被打不触发执法，保持园区 NPC 的中立身份
      if (!ZERO_TOLERANCE_ROLES.has(victim.role)) return;
      // 建案即清账本：与打人凑满 3 次的处理一致，押送结束后从零累计
      this.attacks.delete(attacker.id);
      this.openCase(attacker, now, SYSTEM_NOTICE_KIND.DetainedFight);
      return;
    }
    if (victim.wsId === 0) return;

    let perVictim = this.attacks.get(attacker.id);
    if (!perVictim) {
      perVictim = new Map();
      this.attacks.set(attacker.id, perVictim);
    }
    let hits = perVictim.get(victim.id);
    if (!hits) {
      hits = [];
      perVictim.set(victim.id, hits);
    }
    hits.push(now);
    const windowStart = now - ASSAULT.WINDOW_MS;
    while (hits.length > 0 && hits[0]! <= windowStart) hits.shift();

    if (hits.length >= ASSAULT.CONFIRM_HITS) {
      // 建案即清账本：押送途中与放出来之后都重新累计
      this.attacks.delete(attacker.id);
      this.openCase(attacker, now, SYSTEM_NOTICE_KIND.DetainedFight);
      return;
    }
    if (hits.length === ASSAULT.WARN_HITS) this.sendAssaultWarn(attacker);
  }

  /** 每个 Tick 在 NPC 推进之前调用：检测坐/站边沿，达阈值就派单 */
  observe(now: number): void {
    for (const player of this.world.players.values()) {
      if (player.isNpc || player.wsId === 0) continue;
      // 擂台赛期间保安不执法（ADR-0075）：不判定，并丢掉已有的循环计数，
      // 免得场内的坐站动作攒进下一轮观察窗、下场后立刻被翻旧账
      if (this.world.ring.has(player.id)) {
        this.watches.delete(player.id);
        continue;
      }
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
    if (now - this.assaultPruneAt >= ASSAULT.PRUNE_MS) {
      this.assaultPruneAt = now;
      this.pruneAttacks(now);
    }

    for (const [playerId, entry] of this.cases) {
      const player = this.world.get(playerId);
      if (!player || player.wsId === 0) {
        this.escort.cancel(playerId);
        this.cases.delete(playerId);
        continue;
      }

      // 上了擂台就退出执法域（ADR-0075）：既有案子就地撤销，保安原地松手，
      // 不再往围绳里追、也不把参赛者从场上拖走——围绳内的位置只归擂台裁决
      if (this.world.ring.has(playerId)) {
        this.abort(player, entry, 'cancelled');
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
    this.attacks.clear();
  }

  /**
   * 清理打人账本：断线 / 离场的攻击者整条丢掉，窗口外的命中时刻一并裁掉。
   *
   * 只在 `update` 里按 5 秒节流执行，稳态下账本通常为空，遍历成本接近零。
   */
  private pruneAttacks(now: number): void {
    const windowStart = now - ASSAULT.WINDOW_MS;
    for (const [attackerId, perVictim] of this.attacks) {
      const attacker = this.world.get(attackerId);
      if (!attacker || attacker.wsId === 0) {
        this.attacks.delete(attackerId);
        continue;
      }
      for (const [victimId, hits] of perVictim) {
        while (hits.length > 0 && hits[0]! <= windowStart) hits.shift();
        if (hits.length === 0) perVictim.delete(victimId);
      }
      if (perVictim.size === 0) this.attacks.delete(attackerId);
    }
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
    this.openCase(player, now, SYSTEM_NOTICE_KIND.Detained);
  }

  /**
   * 建案与派单的公共段：坐站骚扰与打人都走这一条，差异只在通播文案。
   * 已被同一个案子占住的人直接返回，避免两种判定在同一帧各建一张单。
   */
  private openCase(player: Player, now: number, noticeKind: number): void {
    if (this.cases.has(player.id)) return;

    const entry: DetentionCase = {
      player,
      phase: 'pending',
      guardId: 0,
      since: now,
      anchor: this.pickAnchor(),
    };
    this.cases.set(player.id, entry);

    const text = formatSystemNotice(noticeKind, { name: player.name });
    if (text) {
      broadcastSystemNotice(this.world, this.transport, player.known, noticeKind, text, player.id);
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

  /**
   * 打人警告：只发给动手的人，不经过 AOI 广播。
   *
   * 走系统提示而不是小黑屋阶段包，是因为 `JAIL_PHASE.Warn` 的客户端文案
   * 固定为坐站骚扰那一句；这里换的是判定来源，不是处置阶段。
   */
  private sendAssaultWarn(player: Player): void {
    if (player.wsId === 0) return;
    const text = formatSystemNotice(SYSTEM_NOTICE_KIND.AssaultWarn);
    if (!text) return;
    this.transport.send(
      player.wsId,
      encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.AssaultWarn, entityId: player.id, text }),
    );
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

