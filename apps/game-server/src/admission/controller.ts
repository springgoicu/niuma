import {
  LIMIT_KIND,
  QUEUE_REJECT_REASON,
  QUEUE_STATUS_INTERVAL_MS,
  TICK_RATE,
  type CharacterAppearance,
  type LimitKind,
  type QueueRejectReason,
  type QueueStatusPacket,
  type ResumeState,
  type SyncFormat,
} from '@niuma/shared-types';
import { AdmissionGovernor, type GovernorConfig, type GovernorEvent } from './governor';
import { FifoQueue, type QueueEntry } from './queue';
import { measureLoad, toPermille, type LoadSample, type LoadWatermark } from './watermark';

/** 握手载荷：排队期间只暂存在队列里，被放行时才真正进世界 */
export interface HelloPayload {
  name: string;
  appearance: CharacterAppearance;
  /** 常驻状态：排队期间跟着载荷一起等，放行时才真正上屏；空串表示没设置 */
  status: string;
  /** 上一次会话的落点；缺席表示旧客户端或压测机器人，按随机出生点处理 */
  resume?: ResumeState;
  /** 客户端声明的同步条目格式；旧客户端与压测机器人缺席，按 7 字节处理 */
  syncFormat?: SyncFormat;
}

export interface AdmissionConfig extends GovernorConfig {
  enabled: boolean;
  maxEgressKbps: number;
  tickBudgetMs: number;
  /** 每 Tick 最多放行人数：开闸瞬间涌入会把首次视野结算压成长帧 */
  admitPerTick: number;
  /** 队列上限 = clamp(容量 × ratio, min, max)，随 AIMD 容量一起变化 */
  queueRatio: number;
  queueMin: number;
  queueMax: number;
  /** 排队最长等待，超过即劝退，避免无限堆积 */
  queueMaxWaitMs: number;
  /** 采样间隔：p95 是 O(n log n)，不能进 20Hz 路径 */
  sampleIntervalMs: number;
}

export type AdmissionDecision =
  | { kind: 'admit'; source: 'direct' | 'queue' }
  | { kind: 'queued'; status: QueueStatusPacket }
  | { kind: 'reject'; reason: QueueRejectReason };

export interface AdmittedPlayer {
  wsId: number;
  payload: HelloPayload;
  ticket: number;
  waitedMs: number;
}

export interface DrainResult {
  admitted: AdmittedPlayer[];
  expired: AdmittedPlayer[];
}

export interface AdmissionSnapshot {
  mode: 'adaptive' | 'off';
  gateOpen: boolean;
  breakerTripped: boolean;
  capacity: number;
  queueLength: number;
  queueCapacity: number;
  utilizationPermille: number;
  dominant: LimitKind;
  ratios: { bandwidth: number; players: number; tick: number };
}

/** 闸门关闭时没有吞吐，ETA 只能作为量级提示：额外加一段「等水位回落」的固定值 */
const CLOSED_GATE_ETA_SEC = 15;
const MAX_ETA_SEC = 1800;

export class AdmissionController {
  private readonly queue = new FifoQueue<HelloPayload>();
  private readonly governor: AdmissionGovernor;
  private watermark: LoadWatermark | null = null;
  private lastSampleAt = 0;
  private lastSnapshotAt = 0;

  constructor(private readonly config: AdmissionConfig) {
    this.governor = new AdmissionGovernor(config);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get gateOpen(): boolean {
    return this.governor.open;
  }

  /** 动态队列上限：容量越大允许排的人越多，但始终夹在 [queueMin, queueMax] 内 */
  queueCapacity(): number {
    const derived = Math.round(this.governor.limit * this.config.queueRatio);
    return Math.min(this.config.queueMax, Math.max(this.config.queueMin, derived));
  }

  /** 采样水位并驱动状态机；调用频率由 sampleIntervalMs 决定，与 Tick 解耦 */
  observe(now: number, sample: LoadSample): GovernorEvent | null {
    if (this.watermark && now - this.lastSampleAt < this.config.sampleIntervalMs) return null;
    this.lastSampleAt = now;
    this.watermark = measureLoad(sample, {
      maxEgressKbps: this.config.maxEgressKbps,
      maxOnline: this.config.maxOnline,
      tickBudgetMs: this.config.tickBudgetMs,
    });
    return this.governor.update(this.watermark, now);
  }

  /**
   * 入场裁决。三条规则决定它是不是「直接进」：
   * 1) 闸门开着；2) 还有名额；3) 没人排队（不能插队）。
   */
  decide(wsId: number, payload: HelloPayload, online: number, now: number): AdmissionDecision {
    if (!this.config.enabled) return { kind: 'admit', source: 'direct' };

    if (this.queue.has(wsId)) {
      const existing = this.statusOfWs(wsId, online);
      return existing ? { kind: 'queued', status: existing } : { kind: 'admit', source: 'direct' };
    }

    const roomLeft = online < this.governor.limit;
    if (this.governor.open && roomLeft && this.queue.length === 0) {
      return { kind: 'admit', source: 'direct' };
    }

    if (this.queue.length >= this.queueCapacity()) {
      return { kind: 'reject', reason: QUEUE_REJECT_REASON.QueueFull };
    }

    const entry = this.queue.enqueue(wsId, payload, now);
    // 竞态兜底：同一 wsId 已在队列里，按已排队处理，绝不重复占位
    if (!entry) {
      const status = this.statusOfWs(wsId, online);
      return status ? { kind: 'queued', status } : { kind: 'admit', source: 'direct' };
    }
    return { kind: 'queued', status: this.statusOfEntry(entry, online) };
  }

  /** 每 Tick 调用：先淘汰超时者，再按 admitPerTick 限速放行 */
  drain(now: number, online: number): DrainResult {
    const admitted: AdmittedPlayer[] = [];
    const expired: AdmittedPlayer[] = [];
    const gateOpen = !this.config.enabled || this.governor.open;
    const capacity = this.config.enabled ? this.governor.limit : Number.MAX_SAFE_INTEGER;

    while (this.queue.length > 0) {
      const entry = this.queue.peek();
      if (!entry) break;
      const waitedMs = now - entry.enqueuedAt;

      if (waitedMs > this.config.queueMaxWaitMs) {
        this.queue.shift();
        expired.push({ wsId: entry.wsId, payload: entry.payload, ticket: entry.ticket, waitedMs });
        continue;
      }

      if (!gateOpen) break;
      if (online + admitted.length >= capacity) break;
      if (admitted.length >= this.config.admitPerTick) break;

      this.queue.shift();
      admitted.push({ wsId: entry.wsId, payload: entry.payload, ticket: entry.ticket, waitedMs });
    }

    return { admitted, expired };
  }

  /** 每秒一次的位次快照；顺带重算位次，保证 UI 上的数字与队列真实顺序一致 */
  statuses(now: number, online: number): Array<{ wsId: number; status: QueueStatusPacket }> {
    if (this.queue.length === 0) return [];
    if (now - this.lastSnapshotAt < QUEUE_STATUS_INTERVAL_MS) return [];
    this.lastSnapshotAt = now;
    this.queue.refreshPositions();
    const out: Array<{ wsId: number; status: QueueStatusPacket }> = [];
    for (const entry of this.queue.entries()) {
      out.push({ wsId: entry.wsId, status: this.statusOfEntry(entry, online) });
    }
    return out;
  }

  /** 断线立即释放位次；返回是否确实在队列里，便于日志区分 */
  drop(wsId: number): boolean {
    return this.queue.remove(wsId);
  }

  isQueued(wsId: number): boolean {
    return this.queue.has(wsId);
  }

  /** 排队中的人发来 HELLO 时不该再占一个位次 */
  ticketOf(wsId: number): number {
    return this.queue.has(wsId) ? this.statusOfWs(wsId, 0)?.ticket ?? 0 : 0;
  }

  snapshot(online: number): AdmissionSnapshot {
    const watermark = this.watermark;
    return {
      mode: this.config.enabled ? 'adaptive' : 'off',
      gateOpen: this.governor.open,
      breakerTripped: this.governor.breakerTripped,
      capacity: this.governor.limit,
      queueLength: this.queue.length,
      queueCapacity: this.queueCapacity(),
      utilizationPermille: toPermille(watermark?.utilization ?? (online >= this.governor.limit ? 1 : 0)),
      dominant: watermark?.dominant ?? LIMIT_KIND.None,
      ratios: watermark?.ratios ?? { bandwidth: 0, players: 0, tick: 0 },
    };
  }

  private statusOfWs(wsId: number, online: number): QueueStatusPacket | null {
    for (const entry of this.queue.entries()) {
      if (entry.wsId === wsId) return this.statusOfEntry(entry, online);
    }
    return null;
  }

  private statusOfEntry(entry: QueueEntry<HelloPayload>, online: number): QueueStatusPacket {
    const position = Math.max(1, entry.position);
    return {
      ticket: entry.ticket,
      position,
      length: this.queue.length,
      etaSec: this.etaSec(position, online),
      capacity: this.governor.limit,
      dominant: this.watermark?.dominant ?? LIMIT_KIND.None,
      utilizationPermille: toPermille(this.watermark?.utilization ?? 0),
    };
  }

  private etaSec(position: number, online: number): number {
    const throughput = Math.max(1, this.config.admitPerTick * TICK_RATE);
    const freeSlots = Math.max(0, this.governor.limit - online);
    const ahead = Math.max(0, position - freeSlots);
    const closedPenalty = this.governor.open ? 0 : CLOSED_GATE_ETA_SEC;
    return Math.min(MAX_ETA_SEC, Math.ceil(ahead / throughput) + closedPenalty);
  }
}
