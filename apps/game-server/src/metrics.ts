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
