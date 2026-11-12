'use client';

import { TICK_MS } from '@niuma/shared-types';

/**
 * 远端实体的位置回放缓冲（ADR-0025 建立，ADR-0048 改为自适应延迟）。
 *
 * 服务端 20Hz 推送，网络抖动会让包早到或晚到。这里存几帧再按
 * `now - delay` 回放：只要延迟大于两包间隔，渲染时刻永远能夹在两帧之间，
 * 抖动被吸收成匀速位移；位置与 state 取自同一次采样，姿态不会跑在位移前面。
 *
 * 延迟不再是固定的 80ms：session 用 `JitterBuffer` 按 RTT p95 与传输抖动
 * 在 35~120ms 之间动态决定。低延迟段（小于一个 Tick）会周期性越过最新帧，
 * 因此 `sample` 允许一小段有上限的速度外推，把「停一下再窜一下」补成连续位移。
 */

/**
 * 环形深度。6 帧 ≈ 250ms 历史：120ms 延迟上限 + 一次抖动突发仍能夹住两帧。
 * 代价只是每实体多 2 帧的 TypedArray 空间，远小于一次瞬移的观感成本。
 */
export const SNAPSHOT_DEPTH = 6;

/** 越过最新帧时允许的最大外推：半个 Tick（25ms），步行速度下过冲 ≤4px */
export const MAX_EXTRAPOLATION_MS = TICK_MS / 2;
/** 上一段速度超过这个值（px/s）视为传送 / 座位吸附，直接钳位，不外推 */
export const MAX_EXTRAPOLATION_SPEED = 320;

/** 采样输出槽：帧循环里复用同一个对象，不产生分配 */
export interface RemoteSample {
  x: number;
  y: number;
  /** 打包后的 state 字节，与 `x/y` 来自同一帧 */
  state: number;
}

const EMPTY = -1;

/**
 * SoA 环形缓冲：按 `eid * depth + slot` 展平，容量与 ECS 实体上限一致。
 * 帧循环里只有下标运算，没有任何对象或数组分配。
 */
export class RemoteTrack {
  private readonly time: Float64Array;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly states: Uint8Array;
  /** 每个实体最新一帧的槽位，-1 表示还没收到过 */
  private readonly head: Int32Array;
  /** 每个实体当前已有帧数，上限 depth */
  private readonly filled: Uint8Array;

  constructor(
    private readonly capacity: number,
    private readonly depth: number = SNAPSHOT_DEPTH,
  ) {
    const size = capacity * depth;
    this.time = new Float64Array(size);
    this.xs = new Float32Array(size);
    this.ys = new Float32Array(size);
    this.states = new Uint8Array(size);
    this.head = new Int32Array(capacity).fill(EMPTY);
    this.filled = new Uint8Array(capacity);
  }

  /** 收到一包同步：写入最新槽位，覆盖最旧的一帧 */
  push(eid: number, at: number, x: number, y: number, state: number): void {
    const base = eid * this.depth;
    const head = this.head[eid]!;
    const slot = head === EMPTY ? 0 : (head + 1) % this.depth;
    const at2 = base + slot;
    this.time[at2] = at;
    this.xs[at2] = x;
    this.ys[at2] = y;
    this.states[at2] = state;
    this.head[eid] = slot;
    const count = this.filled[eid]!;
    if (count < this.depth) this.filled[eid] = count + 1;
  }

  /** 实体离场：清空，避免复用的 eid 带出上一个玩家的轨迹 */
  reset(eid: number): void {
    this.head[eid] = EMPTY;
    this.filled[eid] = 0;
  }

  /**
   * 采样 `renderTime` 时刻的位置与状态。
   *
   * 早于最旧帧 → 钳到最旧；晚于最新帧 → 最多外推 25ms，否则钳到最新
   * （无上限外推会把抖动放大成过冲，一次晚到的包会让角色先冲出去再弹回来）。
   * 返回 false 表示这个实体还没有任何同步数据。
   */
  sample(eid: number, renderTime: number, out: RemoteSample): boolean {
    const count = this.filled[eid]!;
    if (count === 0) return false;

    const depth = this.depth;
    const base = eid * this.depth;
    const head = this.head[eid]!;
    const newest = base + head;
    const newestTime = this.time[newest]!;

    if (renderTime >= newestTime) {
      if (this.extrapolate(base, head, count, newest, renderTime - newestTime, out)) return true;
      out.x = this.xs[newest]!;
      out.y = this.ys[newest]!;
      out.state = this.states[newest]!;
      return true;
    }

    const oldestSlot = (head - (count - 1) + depth) % depth;
    const oldest = base + oldestSlot;
    if (renderTime <= this.time[oldest]!) {
      out.x = this.xs[oldest]!;
      out.y = this.ys[oldest]!;
      out.state = this.states[oldest]!;
      return true;
    }

    // 由旧到新找夹住 renderTime 的两帧
    for (let age = count - 1; age >= 1; age -= 1) {
      const older = base + ((head - age + depth) % depth);
      const newer = base + ((head - (age - 1) + depth) % depth);
      const timeNewer = this.time[newer]!;
      if (renderTime > timeNewer) continue;

      const timeOlder = this.time[older]!;
      const span = timeNewer - timeOlder;
      const t = span > 0 ? (renderTime - timeOlder) / span : 1;
      out.x = this.xs[older]! + (this.xs[newer]! - this.xs[older]!) * t;
      out.y = this.ys[older]! + (this.ys[newer]! - this.ys[older]!) * t;
      // 状态取左帧：这一帧描述的是 renderTime 所在区间「开始时」的姿态，
      // 与位置一致。取右帧会让姿态比位移早到一个采样间隔。
      out.state = this.states[older]!;
      return true;
    }

    out.x = this.xs[newest]!;
    out.y = this.ys[newest]!;
    out.state = this.states[newest]!;
    return true;
  }

  /**
   * 最新帧之后的一小段速度外推。
   *
   * 只在延迟小于一个 Tick 时生效（35ms 段约占 70% 的帧），补的是渲染时刻
   * 到最新快照之间 0..25ms 的空隙。上一段速度超过步行上限时不外推：
   * 那通常是座位吸附或传送，外推会算出荒唐的位移。
   */
  private extrapolate(
    base: number,
    head: number,
    count: number,
    newest: number,
    ahead: number,
    out: RemoteSample,
  ): boolean {
    if (count < 2 || ahead > MAX_EXTRAPOLATION_MS) return false;
    const depth = this.depth;
    const previous = base + ((head - 1 + depth) % depth);
    const span = this.time[newest]! - this.time[previous]!;
    if (span <= 0) return false;

    const vx = (this.xs[newest]! - this.xs[previous]!) / span;
    const vy = (this.ys[newest]! - this.ys[previous]!) / span;
    // px/ms → px/s：服务端速度窗口上限约 165px/s，320 给吸附留足余量
    const speed = Math.sqrt(vx * vx + vy * vy) * 1000;
    if (speed > MAX_EXTRAPOLATION_SPEED) return false;

    out.x = this.xs[newest]! + vx * ahead;
    out.y = this.ys[newest]! + vy * ahead;
    out.state = this.states[newest]!;
    return true;
  }
}
