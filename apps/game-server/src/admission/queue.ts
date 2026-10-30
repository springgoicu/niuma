/**
 * FIFO 排队表：数组 + head 指针 + wsId → 下标索引。
 *
 * 删除（断线/超时）只打死亡标记，不搬数组；位次在一次每秒的快照遍历里顺序重算，
 * 所以单次入队/出队是 O(1)，位次刷新是「每秒 O(n)、摊还 O(1)」。
 * 死条目占比超过 1/4 时原地压缩一次，保证内存有界。
 */
export interface QueueEntry<T> {
  wsId: number;
  ticket: number;
  payload: T;
  enqueuedAt: number;
  /** 1 起的前方人数快照，由 refreshPositions 重算 */
  position: number;
  alive: boolean;
}

const COMPACT_THRESHOLD = 64;

export class FifoQueue<T> {
  private items: Array<QueueEntry<T> | null> = [];
  private head = 0;
  private live = 0;
  private readonly index = new Map<number, number>();
  private nextTicket = 1;

  get length(): number {
    return this.live;
  }

  has(wsId: number): boolean {
    return this.index.has(wsId);
  }

  /** 重复入队返回 null：调用方必须能区分「已在队列里」和「刚排上」 */
  enqueue(wsId: number, payload: T, now: number): QueueEntry<T> | null {
    if (this.index.has(wsId)) return null;
    const entry: QueueEntry<T> = {
      wsId,
      ticket: this.nextTicket,
      payload,
      enqueuedAt: now,
      position: this.live + 1,
      alive: true,
    };
    this.nextTicket = this.nextTicket >= 0xfffffffe ? 1 : this.nextTicket + 1;
    this.index.set(wsId, this.items.length);
    this.items.push(entry);
    this.live += 1;
    return entry;
  }

  peek(): QueueEntry<T> | null {
    this.skipDead();
    const entry = this.items[this.head];
    return entry ?? null;
  }

  /** 取队首并出队；队首可能是已标记死亡的条目，先跳过 */
  shift(): QueueEntry<T> | null {
    this.skipDead();
    const entry = this.items[this.head];
    if (!entry) return null;
    this.items[this.head] = null;
    this.head += 1;
    this.live -= 1;
    this.index.delete(entry.wsId);
    entry.alive = false;
    this.maybeCompact();
    return entry;
  }

  remove(wsId: number): boolean {
    const at = this.index.get(wsId);
    if (at === undefined) return false;
    const entry = this.items[at];
    if (!entry) return false;
    this.items[at] = null;
    this.index.delete(wsId);
    this.live -= 1;
    entry.alive = false;
    this.maybeCompact();
    return true;
  }

  positionOf(wsId: number): number {
    const at = this.index.get(wsId);
    if (at === undefined) return 0;
    return this.items[at]?.position ?? 0;
  }

  enqueuedAtOf(wsId: number): number {
    const at = this.index.get(wsId);
    if (at === undefined) return 0;
    return this.items[at]?.enqueuedAt ?? 0;
  }

  /** 按 FIFO 顺序遍历存活条目，仅用于每秒一次的快照推送 */
  *entries(): IterableIterator<QueueEntry<T>> {
    for (let at = this.head; at < this.items.length; at += 1) {
      const entry = this.items[at];
      if (entry) yield entry;
    }
  }

  /** 每秒调用一次：顺序重算位次，O(n) 摊到每个等待者身上就是 O(1) */
  refreshPositions(): void {
    let position = 1;
    for (let at = this.head; at < this.items.length; at += 1) {
      const entry = this.items[at];
      if (!entry) continue;
      entry.position = position;
      position += 1;
    }
  }

  clear(): void {
    this.items = [];
    this.head = 0;
    this.live = 0;
    this.index.clear();
  }

  private skipDead(): void {
    while (this.head < this.items.length && this.items[this.head] === null) this.head += 1;
  }

  private maybeCompact(): void {
    if (this.items.length < COMPACT_THRESHOLD || this.live * 4 > this.items.length) return;
    const kept: Array<QueueEntry<T> | null> = [];
    for (let at = this.head; at < this.items.length; at += 1) {
      const entry = this.items[at];
      if (entry) kept.push(entry);
    }
    this.items = kept;
    this.head = 0;
    this.index.clear();
    for (let at = 0; at < kept.length; at += 1) {
      const entry = kept[at];
      if (entry) this.index.set(entry.wsId, at);
    }
  }
}
