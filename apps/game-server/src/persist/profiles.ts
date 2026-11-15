import { isDeviceId } from '@niuma/shared-types';

/**
 * 匿名档案（ADR-0081）。
 *
 * 园区没有账号，点赞与擂台战绩又要跨会话累计，所以只有这一个薄薄的键值表：
 * 键是客户端生成的匿名设备号，值是「收到多少赞 / 拿过几次名次」。
 * 它不是玩家资料库——考勤、行为统计、奖牌明细仍然只活在各浏览器里。
 *
 * 容量与过期都是为了控制 `world-state.json` 的体积：园区是公共场所，
 * 一台设备换一次浏览器就是一条新记录，不能无限长。
 */

export interface ProfileRecord {
  /** 8 字节设备号的 hex 形式（16 字符小写） */
  id: string;
  /** 最近一次进园时用的昵称：只用于调试与展示回退，改名会覆盖 */
  name: string;
  /** 累计收到的赞（人气口径） */
  likes: number;
  /** 擂台冠军 / 亚军 / 季军次数 */
  gold: number;
  silver: number;
  bronze: number;
  /** 最近一次进园时刻（毫秒），过期与淘汰都按它排序 */
  lastSeenAt: number;
}

/** 一条档案最多保留多久：90 天没进园就当陌生设备，下次进园重新计 */
export const PROFILE_TTL_MS = 90 * 86_400_000;
/** 单个字段的整数上限：防坏档与伪造包把计数写成天文数字 */
const MAX_COUNTER = 1_000_000;

function clampCounter(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNTER, Math.floor(value)));
}

export class ProfileBook {
  private readonly records = new Map<string, ProfileRecord>();
  readonly maxProfiles: number;

  constructor(maxProfiles = 512, entries?: readonly ProfileRecord[]) {
    this.maxProfiles = Math.max(1, Math.floor(maxProfiles));
    if (entries) {
      for (const entry of entries) this.ingest(entry);
    }
  }

  get size(): number {
    return this.records.size;
  }

  get(id: string | undefined): ProfileRecord | undefined {
    return id ? this.records.get(id) : undefined;
  }

  /**
   * 进园登记：不存在就建一条，存在就刷新昵称与最近时刻。
   * 非法设备号（旧客户端、伪造包）一律返回 undefined，调用方按匿名处理。
   */
  touch(id: string | undefined, name: string, now: number): ProfileRecord | undefined {
    if (!id || !isDeviceId(id)) return undefined;
    const existing = this.records.get(id);
    if (existing) {
      existing.name = name;
      existing.lastSeenAt = now;
      return existing;
    }
    const created: ProfileRecord = {
      id,
      name,
      likes: 0,
      gold: 0,
      silver: 0,
      bronze: 0,
      lastSeenAt: now,
    };
    this.records.set(id, created);
    this.prune(now);
    return created;
  }

  /** 收到一个赞：返回累计值，调用方直接拿它当工牌展示数 */
  addLike(id: string | undefined, now: number): number {
    const record = this.get(id);
    if (!record) return 0;
    record.likes = clampCounter(record.likes + 1);
    record.lastSeenAt = now;
    return record.likes;
  }

  /** 擂台名次入账：只记前三名，名次之外（含未完赛）忽略 */
  addRingMedal(id: string | undefined, rank: number, now: number): void {
    const record = this.get(id);
    if (!record || !Number.isInteger(rank)) return;
    if (rank === 1) record.gold = clampCounter(record.gold + 1);
    else if (rank === 2) record.silver = clampCounter(record.silver + 1);
    else if (rank === 3) record.bronze = clampCounter(record.bronze + 1);
    else return;
    record.lastSeenAt = now;
  }

  /**
   * 清掉过期与超量的档案。
   *
   * 顺序按 `lastSeenAt` 升序：先扔最久没来的，留下的是还在园区附近活动的人。
   * 每次 touch 都会顺带跑一次，所以容量天然不会超过 maxProfiles 太多。
   */
  prune(now: number): number {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (now - record.lastSeenAt > PROFILE_TTL_MS) {
        this.records.delete(id);
        removed += 1;
      }
    }
    if (this.records.size <= this.maxProfiles) return removed;
    const sorted = [...this.records.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const overflow = this.records.size - this.maxProfiles;
    for (let i = 0; i < overflow; i += 1) {
      this.records.delete(sorted[i]!.id);
      removed += 1;
    }
    return removed;
  }

  /**
   * 读档恢复：整表替换，逐条夹取区间。
   * 直接用 `records.set` 会让坏档里的天文数字原样复活，所以统一走 `ingest`。
   */
  restore(entries: readonly ProfileRecord[]): void {
    this.records.clear();
    for (const entry of entries) this.ingest(entry);
  }

  /** 落盘用的纯数据；非法条目在进入时就被挡掉了 */
  toJSON(): ProfileRecord[] {
    return [...this.records.values()];
  }

  private ingest(entry: ProfileRecord): void {
    if (!entry || !isDeviceId(entry.id)) return;
    this.records.set(entry.id, {
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name.slice(0, 48) : '',
      likes: clampCounter(entry.likes),
      gold: clampCounter(entry.gold),
      silver: clampCounter(entry.silver),
      bronze: clampCounter(entry.bronze),
      lastSeenAt: Number.isFinite(entry.lastSeenAt) ? entry.lastSeenAt : 0,
    });
  }
}
