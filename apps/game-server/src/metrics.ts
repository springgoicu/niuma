/**
 * 出口字节速率：50ms 环形桶 + 1.15s 窗口。
 * 处在每 Tick 数千次 `record` 的热路径上，只用 TypedArray，不产生任何对象。
 */
export class EgressMeter {
  private readonly bytes: Float64Array;
  private readonly stamps: Int32Array;
  private readonly spanMs: number;

  constructor(
    private readonly bucketMs = 50,
    bucketCount = 24,
  ) {
    this.bytes = new Float64Array(bucketCount);
    this.stamps = new Int32Array(bucketCount).fill(-1);
    this.spanMs = bucketMs * (bucketCount - 1);
  }

  record(size: number, now = Date.now()): void {
    if (size <= 0) return;
    const bucket = Math.floor(now / this.bucketMs);
    const at = bucket % this.bytes.length;
    if (this.stamps[at] !== bucket) {
      this.stamps[at] = bucket;
      this.bytes[at] = 0;
    }
    this.bytes[at] += size;
  }

  /** KB/s（1 KB = 1024 B），窗口内总字节除以窗口秒数 */
  kbps(now = Date.now()): number {
    const bucket = Math.floor(now / this.bucketMs);
    let total = 0;
    for (let at = 0; at < this.bytes.length; at += 1) {
      const stamp = this.stamps[at]!;
      if (stamp < 0 || bucket - stamp >= this.bytes.length) continue;
      total += this.bytes[at]!;
    }
    return total / (this.spanMs / 1000) / 1024;
  }
}

/** 定长环形采样，用于 Tick 耗时与带宽的 p50/p95，不产生额外 GC */
export class RingSampler {
  private readonly samples: Float32Array;
  private cursor = 0;
  private filled = 0;

  constructor(capacity = 600) {
    this.samples = new Float32Array(capacity);
  }

  push(value: number): void {
    this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled += 1;
  }

  get count(): number {
    return this.filled;
  }

  percentile(p: number): number {
    if (this.filled === 0) return 0;
    const view = Array.from(this.samples.subarray(0, this.filled)).sort((a, b) => a - b);
    const index = Math.min(view.length - 1, Math.max(0, Math.floor((view.length - 1) * p)));
    return view[index]!;
  }

  average(): number {
    if (this.filled === 0) return 0;
    let total = 0;
    for (let i = 0; i < this.filled; i += 1) total += this.samples[i]!;
    return total / this.filled;
  }

  max(): number {
    let value = 0;
    for (let i = 0; i < this.filled; i += 1) value = Math.max(value, this.samples[i]!);
    return value;
  }
}
