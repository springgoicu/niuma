import type { LoadWatermark } from './watermark';

/**
 * 闸门状态机：滞回 + AIMD + 过载熔断。
 *
 * 单一阈值会在水位线附近反复开合，玩家看到排队屏闪烁；所以闭合与重开用两个不同的阈值。
 * 容量不写死：稳定期缓慢扩容，越界时按比例收缩，让上限跟着真实负载走。
 */
export interface GovernorConfig {
  /** 容量上限（基准值），扩容不会超过它 */
  maxOnline: number;
  /** 容量下限，收缩不会低于它 */
  minCapacity: number;
  /** 超过该水位关闸 */
  highWatermark: number;
  /** 低于该水位才重新开闸 */
  lowWatermark: number;
  /** 每次扩容增加的人数 */
  capacityStep: number;
  /** 越界时容量乘以该系数 */
  shrinkRatio: number;
  /** 连续稳定多久才扩容（毫秒） */
  stableMs: number;
  /** 收缩最短间隔（毫秒），避免过载时瞬间塌到下限 */
  shrinkIntervalMs: number;
  /** Tick p95 超过预算多少倍算危险 */
  breakerFactor: number;
  /** 连续多少次采样触发熔断 */
  breakerStrikes: number;
}

export type GovernorEventKind = 'closed' | 'opened' | 'grown' | 'shrunk' | 'tripped';

export interface GovernorEvent {
  kind: GovernorEventKind;
  capacity: number;
  utilization: number;
}

export class AdmissionGovernor {
  private capacity: number;
  private gateOpen = true;
  private tripped = false;
  private strikes = 0;
  private stableSince = 0;
  /** 初始化为 -Infinity：冷启动就过载时第一次采样允许立刻收缩 */
  private lastShrinkAt = Number.NEGATIVE_INFINITY;
  private initialized = false;

  constructor(private readonly config: GovernorConfig) {
    this.capacity = config.maxOnline;
  }

  get open(): boolean {
    return this.gateOpen;
  }

  /** 当前准入容量：决定「在线人数」这一维的上限，也参与队列上限推导 */
  get limit(): number {
    return this.capacity;
  }

  get breakerTripped(): boolean {
    return this.tripped;
  }

  update(watermark: LoadWatermark, now: number): GovernorEvent | null {
    if (!this.initialized) {
      this.initialized = true;
      this.stableSince = now;
    }

    // 熔断只看 Tick：它是「闸门内的人已经卡了」的唯一直接证据
    if (watermark.ratios.tick >= this.config.breakerFactor) {
      this.strikes += 1;
      if (!this.tripped && this.strikes >= this.config.breakerStrikes) {
        this.tripped = true;
        this.gateOpen = false;
        return this.shrink(now, 'tripped', watermark);
      }
    } else {
      this.strikes = 0;
      this.tripped = false;
    }

    // 容量收缩只由「带宽 / 人数」这种持续型超载驱动；
    // Tick 是噪声较大的瞬时指标，交给上面的熔断计数处理，避免一次长帧就把容量砍掉。
    const sustained = Math.max(watermark.ratios.bandwidth, watermark.ratios.players);
    if (sustained >= 1) {
      this.gateOpen = false;
      return this.shrink(now, 'shrunk', watermark);
    }

    if (this.gateOpen && watermark.utilization >= this.config.highWatermark) {
      this.gateOpen = false;
      this.stableSince = now;
      return { kind: 'closed', capacity: this.capacity, utilization: watermark.utilization };
    }

    if (!this.gateOpen && !this.tripped && watermark.utilization <= this.config.lowWatermark) {
      this.gateOpen = true;
      this.stableSince = now;
      return { kind: 'opened', capacity: this.capacity, utilization: watermark.utilization };
    }

    // 只有「低水位 + 闸门开着」的连续稳定期才扩容，否则重置计时，避免锯齿
    if (!this.gateOpen || this.tripped || watermark.utilization > this.config.lowWatermark) {
      this.stableSince = now;
      return null;
    }

    if (now - this.stableSince >= this.config.stableMs && this.capacity < this.config.maxOnline) {
      this.capacity = Math.min(this.config.maxOnline, this.capacity + this.config.capacityStep);
      this.stableSince = now;
      return { kind: 'grown', capacity: this.capacity, utilization: watermark.utilization };
    }

    return null;
  }

  private shrink(now: number, kind: GovernorEventKind, watermark: LoadWatermark): GovernorEvent | null {
    // 过载时每个采样都收缩会把容量瞬间打到下限，必须限速
    if (now - this.lastShrinkAt < this.config.shrinkIntervalMs) return null;
    this.lastShrinkAt = now;
    this.gateOpen = false;
    // 下限可能被配置得比上限还大（压测时常见），先夹住再收缩，避免容量反被抬高
    const floor = Math.min(this.config.maxOnline, this.config.minCapacity);
    const next = Math.min(this.config.maxOnline, Math.max(floor, Math.floor(this.capacity * this.config.shrinkRatio)));
    if (next === this.capacity) return null;
    this.capacity = next;
    return { kind, capacity: this.capacity, utilization: watermark.utilization };
  }
}
