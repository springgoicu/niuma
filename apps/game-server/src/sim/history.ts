/**
 * 园区频道的历史缓冲：进程内定长环形数组，不写盘、不进库（ADR-0004）。
 *
 * 容量与时长双上限一起生效：条数管内存（200 条 × 一条消息），
 * 时长管「重开标签页看到一小时前的话」这种失真。
 *
 * 只在入场补发与显式上翻两条路径上读取，20Hz Tick 不碰它，所以这里的
 * `live()` 每次建一个数组是可接受的——它不是热路径。
 */

export interface ChatLine {
  msgId: number;
  entityId: number;
  /** 发送时的昵称快照：发送者可能已经离场，客户端名字表里查不到 */
  name: string;
  text: string;
  /** 服务端毫秒时间戳；编码时才换算成 ageSec */
  at: number;
}

export interface ChatPage {
  /** 时间从旧到新 */
  lines: ChatLine[];
  /** 本页之外还有更早的消息 */
  hasMore: boolean;
}

export class ChatHistory {
  private readonly slots: (ChatLine | null)[];
  private readonly capacity: number;
  private readonly ttlMs: number;
  /** 下一条要写的位置 */
  private head = 0;
  private size = 0;

  constructor(capacity: number, ttlMs: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.ttlMs = Math.max(1, Math.floor(ttlMs));
    this.slots = new Array<ChatLine | null>(this.capacity).fill(null);
  }

  /** 广播成功后写入；容量满时覆盖最旧的一格 */
  add(line: ChatLine): void {
    this.slots[this.head] = line;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** 最新一页；`hasMore` 表示这页之外还有更早的 */
  latestPage(limit: number, now: number): ChatPage {
    const live = this.live(now);
    const take = this.clampLimit(limit);
    const start = Math.max(0, live.length - take);
    return { lines: live.slice(start), hasMore: start > 0 };
  }

  /**
   * `msgId` 之前的一页。
   *
   * 游标找不到（已被淘汰、或伪造了一个不存在的 id）时返回空页且 `hasMore = false`：
   * 让客户端停在「没有更早的消息了」，而不是继续发请求。
   */
  before(msgId: number, limit: number, now: number): ChatPage {
    const live = this.live(now);
    let end = -1;
    for (let i = live.length - 1; i >= 0; i -= 1) {
      if (live[i]!.msgId === msgId) {
        end = i;
        break;
      }
    }
    if (end <= 0) return { lines: [], hasMore: false };
    const start = Math.max(0, end - this.clampLimit(limit));
    return { lines: live.slice(start, end), hasMore: start > 0 };
  }

  /** 未过期的条目，从旧到新 */
  private live(now: number): ChatLine[] {
    const out: ChatLine[] = [];
    // 未写满时最旧的一条在 0；写满后最旧的一条在 head
    const first = this.size === this.capacity ? this.head : 0;
    for (let i = 0; i < this.size; i += 1) {
      const line = this.slots[(first + i) % this.capacity];
      if (line && now - line.at <= this.ttlMs) out.push(line);
    }
    return out;
  }

  private clampLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return 1;
    return Math.min(Math.floor(limit), this.capacity);
  }
}
