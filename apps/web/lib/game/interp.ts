'use client';

/**
 * 远端实体的位置回放缓冲。
 *
 * 服务端 20Hz 推送，网络抖动会让包早到或晚到。原来的做法是「收到就播到最新」：
 * 在 50ms 内从上一位置线性追到新位置，追完就停在目标上等下一包。
 * 于是抖动直接映射成画面上的「停一下再窜一下」，而且姿态与位移是两条通路
 * （姿态立刻生效、位移才慢慢追），会出现原地踏步再迈出去。
 *
 * 这里改成标准做法：先存几帧，再按 `now - INTERP_DELAY_MS` 回放。
 * 只要延迟大于两包间隔，渲染时刻永远能夹在两帧之间，抖动被吸收成匀速位移；
 * 位置与 state 取自同一次采样，姿态不会跑在位移前面。
 *
 * 代价是别人看到的你晚 80ms。对「看同事在园区里走」几乎无感，
 * 换来的是抖动下的连续行走——这正是当前最大的体感问题。
 */

/**
 * 回放延迟。服务端 Tick 间隔是 50ms，取 80ms 留出 ±30ms 的抖动余量：
 * 再小会在包里出现空隙时退化成停顿，再大则明显拖慢「谁先看到谁」的时机。
 */
export const INTERP_DELAY_MS = 80;

/** 环形深度。4 帧 ≈ 200ms 历史，足够覆盖一次连续丢两包的情况 */
export const SNAPSHOT_DEPTH = 4;

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
   * 早于最旧帧 → 钳到最旧；晚于最新帧 → 钳到最新（**不外推**：
   * 外推会把抖动放大成过冲，一次晚到的包会让角色先冲出去再弹回来）。
   * 返回 false 表示这个实体还没有任何同步数据。
   */
  sample(eid: number, renderTime: number, out: RemoteSample): boolean {
    const count = this.filled[eid]!;
    if (count === 0) return false;

    const depth = this.depth;
    const base = eid * this.depth;
    const head = this.head[eid]!;
    const newest = base + head;
    const oldestSlot = (head - (count - 1) + depth) % depth;
    const oldest = base + oldestSlot;

    if (renderTime >= this.time[newest]!) {
      out.x = this.xs[newest]!;
      out.y = this.ys[newest]!;
      out.state = this.states[newest]!;
      return true;
    }
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
}
