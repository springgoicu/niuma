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

function swapAt(values: Float32Array, a: number, b: number): void {
  const t = values[a]!;
  values[a] = values[b]!;
  values[b] = t;
}

function insertionSort(values: Float32Array, left: number, right: number): void {
  for (let i = left + 1; i <= right; i += 1) {
    const value = values[i]!;
    let j = i - 1;
    while (j >= left && values[j]! > value) {
      values[j + 1] = values[j]!;
      j -= 1;
    }
    values[j + 1] = value;
  }
}

/**
 * 就地选出第 k 小（0 基）的值。
 *
 * 三数取中 + 三路划分（Hoare 双指针）：Tick 耗时经常出现大量相同值（空闲时全是 0.1ms），
 * 朴素二路划分在这种分布上会退化成 O(n²)；三路把等值元素一次分到两侧。
 * 再加一层深度保护，超出预算就退到插入排序兜底，保证最坏情况也有界。
 */
function selectKth(values: Float32Array, length: number, k: number): number {
  let left = 0;
  let right = length - 1;
  const maxDepth = 2 * Math.ceil(Math.log2(length + 1)) + 8;
  let depth = 0;

  while (right > left) {
    if (depth >= maxDepth) {
      insertionSort(values, left, right);
      return values[k]!;
    }
    depth += 1;

    const mid = (left + right) >>> 1;
    if (values[mid]! < values[left]!) swapAt(values, mid, left);
    if (values[right]! < values[left]!) swapAt(values, right, left);
    if (values[right]! < values[mid]!) swapAt(values, right, mid);
    const pivot = values[mid]!;

    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i]! < pivot) i += 1;
      while (values[j]! > pivot) j -= 1;
      if (i <= j) {
        swapAt(values, i, j);
        i += 1;
        j -= 1;
      }
    }
    // 划分后：[left..j] <= pivot <= [i..right]
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else return values[k]!;
  }
  return values[k]!;
}

/** 定长环形采样，用于 Tick 耗时与带宽的 p50/p95，不产生额外 GC */
export class RingSampler {
  private readonly samples: Float32Array;
  /** 分位数查询用的 scratch：与窗口同长，避免每次查询都拷出一份 JS 数组 */
  private readonly scratch: Float32Array;
  private cursor = 0;
  private filled = 0;

  constructor(capacity = 600) {
    this.samples = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  push(value: number): void {
    this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled += 1;
  }

  get count(): number {
    return this.filled;
  }

  /**
   * 分位数：把窗口拷进 scratch 后做快速选择，不排序、不分配。
   *
   * 原实现是 `Array.from(...).sort()`，每 500ms 在 Tick 定时器里造一个 1200 元素数组并全排，
   * `/health` 一次调三个分位数就是三次。选择算法把代价从 O(n log n) + 一次大分配
   * 降到 O(n) + 零分配，而结果仍是**精确**的——Tick p95 直接参与准入水位判定，
   * 这里不适合用直方图近似换速度。
   */
  percentile(p: number): number {
    if (this.filled === 0) return 0;
    const scratch = this.scratch;
    for (let i = 0; i < this.filled; i += 1) scratch[i] = this.samples[i]!;
    const k = Math.min(this.filled - 1, Math.max(0, Math.floor((this.filled - 1) * p)));
    return selectKth(scratch, this.filled, k);
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
