'use client';

import { TICK_MS } from '@niuma/shared-types';

/**
 * 远端回放的自适应抖动缓冲（ADR-0048，修订 ADR-0025 的固定 80ms）。
 *
 * 为什么要用 Tick 偏移而不是「包到达间隔」：
 * 服务端去脏后（ADR-0043），满屋子人坐着时整 Tick 不发包，到达间隔会是几百毫秒甚至几秒，
 * 直接拿它减 50ms 会把「没人动」误判成「网络在抖」。同步包头里的 tick 是服务端发送序号，
 * `arrival - tick × TICK_MS` 的差值只随「传输时延变化」移动，静止多久都不影响判断。
 *
 * 为什么 RTT 要直方图而不是排序：p95 每次 ping（1Hz）算一次，排序会每次分配一个新数组。
 * 24 个样本 + 4ms 桶足够稳，也足够便宜。
 */

/** 需求给定区间：好网压到 35ms，弱网最多 120ms */
export const INTERP_DELAY_MIN_MS = 35;
export const INTERP_DELAY_MAX_MS = 120;
/** 还没有任何同步包时的起点：取 55ms 覆盖一个 Tick，先不追求最低延迟 */
export const INTERP_DELAY_START_MS = 55;

/** 单个同步包的偏移突变上限：重连 / 时钟跳变不算网络抖动 */
const MAX_OFFSET_DELTA_MS = 200;
/** 抖动 EWMA 系数：1/8 约 8 个包（400ms）收敛，够快但不被单个尖峰带飞 */
const JITTER_ALPHA = 1 / 8;
/** RTT 样本窗口：24 个 × 1Hz ≈ 24s，覆盖一次短时拥塞 */
const RTT_SAMPLE_CAP = 24;
const RTT_BUCKET_MS = 4;
const RTT_BUCKET_COUNT = 256;
/** 目标延迟上升要快（避免抖动期插值饥饿），回落要慢（避免边界来回横跳） */
const RISE_ALPHA = 0.35;
const FALL_ALPHA = 0.03;

export class JitterBuffer {
  /** RTT 桶计数：窗口内最多 24 个样本，Uint8 足够 */
  private readonly rttBuckets = new Uint8Array(RTT_BUCKET_COUNT);
  /** RTT 环形窗口：只存最近 24 个样本，用来淘汰旧桶 */
  private readonly rttRing = new Uint16Array(RTT_SAMPLE_CAP);
  private rttAt = 0;
  private rttCount = 0;
  private rttP95 = 0;
  /** 传输时延变化的 EWMA（毫秒） */
  private jitter = 0;
  /** 上一个同步包的 `arrival - tick × TICK_MS` */
  private offset = 0;
  private hasOffset = false;
  private delay = INTERP_DELAY_START_MS;

  /** 当前回放延迟：session 每帧读它，不做任何分配 */
  get delayMs(): number {
    return this.delay;
  }

  /** 观测值只用于调试面板与单测 */
  get jitterMs(): number {
    return this.jitter;
  }

  get rttP95Ms(): number {
    return this.rttP95;
  }

  /** 公式给出的目标值，已钳到 35..120 */
  get targetMs(): number {
    const raw = this.rttP95 * 0.5 + this.jitter * 2;
    if (raw < INTERP_DELAY_MIN_MS) return INTERP_DELAY_MIN_MS;
    if (raw > INTERP_DELAY_MAX_MS) return INTERP_DELAY_MAX_MS;
    return raw;
  }

  /**
   * 收到一个同步包。`tick` 来自包头，`arrivalMs` 是本条包共用的到达时刻。
   * 20Hz 稳态下这里每包只做几次标量运算。
   */
  onSync(serverTick: number, arrivalMs: number): void {
    if (!Number.isFinite(serverTick) || !Number.isFinite(arrivalMs)) return;
    const offset = arrivalMs - serverTick * TICK_MS;
    if (!this.hasOffset) {
      this.hasOffset = true;
      this.offset = offset;
    } else {
      let delta = Math.abs(offset - this.offset);
      if (delta > MAX_OFFSET_DELTA_MS) delta = MAX_OFFSET_DELTA_MS;
      this.jitter += (delta - this.jitter) * JITTER_ALPHA;
      this.offset = offset;
    }
    this.applyTarget(this.targetMs);
  }

  /** 每个 PONG 一个 RTT 样本：更新 p95 与目标值（延迟本身仍由同步包推进） */
  onRtt(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    const rounded = Math.round(rttMs);
    const clamped = rounded > 1000 ? 1000 : rounded;
    const bucket = Math.min(RTT_BUCKET_COUNT - 1, (clamped / RTT_BUCKET_MS) | 0);

    if (this.rttCount === RTT_SAMPLE_CAP) {
      const evicted = this.rttRing[this.rttAt]!;
      const evictedBucket = Math.min(RTT_BUCKET_COUNT - 1, (evicted / RTT_BUCKET_MS) | 0);
      const next = this.rttBuckets[evictedBucket]! - 1;
      this.rttBuckets[evictedBucket] = next > 0 ? next : 0;
    } else {
      this.rttCount += 1;
    }

    this.rttRing[this.rttAt] = clamped;
    this.rttAt = (this.rttAt + 1) % RTT_SAMPLE_CAP;
    this.rttBuckets[bucket] = Math.min(255, this.rttBuckets[bucket]! + 1);
    this.computeP95();
  }

  /**
   * 重连或换服：tick 基准与接收时钟都换了，旧的 offset/jitter 不再可比。
   * RTT 样本保留——网络路径通常没变，重新攒 24 秒反而更慢。
   */
  reset(): void {
    this.offset = 0;
    this.hasOffset = false;
    this.jitter = 0;
    this.delay = INTERP_DELAY_START_MS;
  }

  /** 升快降慢的 EMA：每个同步包走一步 */
  private applyTarget(target: number): void {
    const alpha = target > this.delay ? RISE_ALPHA : FALL_ALPHA;
    this.delay += (target - this.delay) * alpha;
  }

  /** 桶是 4ms 宽，返回桶上界（偏保守），扫描 256 个桶不分配 */
  private computeP95(): void {
    if (this.rttCount === 0) {
      this.rttP95 = 0;
      return;
    }
    const need = Math.ceil(this.rttCount * 0.95);
    let seen = 0;
    for (let i = 0; i < RTT_BUCKET_COUNT; i += 1) {
      seen += this.rttBuckets[i]!;
      if (seen >= need) {
        this.rttP95 = i * RTT_BUCKET_MS + RTT_BUCKET_MS;
        return;
      }
    }
    this.rttP95 = RTT_BUCKET_COUNT * RTT_BUCKET_MS;
  }
}
