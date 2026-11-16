import { ACTIVITY_REPORTABLE, activityTierOf, encodeActivity, formatActivity, regionAt } from '@niuma/shared-types';
import type { Player, World } from './world';
import type { Transport } from './view';

/**
 * 全园区交互播报中枢（ADR-0112）。
 *
 * 所有触发点只调用一次 `emit()`：分级、去重、令牌桶与「该发给谁」都收在这里，
 * sim 模块不需要知道对方看得见看不见。稳态下每条事件都是 O(在线人数)，
 * 没有逐帧扫描，也没有排队定时器。
 */

/** 去重窗口：同一主角同一事件在这个窗口内只发一次 */
const TIER_WINDOW_MS: Record<'dramatic' | 'life' | 'routine', number> = {
  // 强演出可能由两个触发点先后命中（倒下 + 派车），留一个小窗防止重复
  dramatic: 500,
  life: 2_000,
  routine: 4_000,
};

/** 全局令牌桶：40 条/秒；桶空时强演出照发，生活类与常规类直接丢 */
const BUCKET_CAPACITY = 40;
const BUCKET_REFILL_PER_MS = BUCKET_CAPACITY / 1_000;

/** 客户端上报的最小间隔：1 秒 1 条，连按 F 也只留第一条 */
const REPORT_INTERVAL_MS = 1_000;

/** 去重键把主角与事件编号压进一个整数：省一次字符串哈希 */
function dedupKey(actorId: number, kind: number): number {
  return actorId * 256 + (kind & 0xff);
}

export class ActivityHub {
  private readonly world: World;
  private readonly transport: Transport;
  /** 主角 + 事件 → 上次发送时刻 */
  private readonly lastSentAt = new Map<number, number>();
  /** 主角 → 上次上报时刻（只挡客户端上报，不影响服务端权威事件） */
  private readonly lastReportAt = new Map<number, number>();
  private tokens = BUCKET_CAPACITY;
  private lastRefillAt: number;

  constructor(world: World, transport: Transport, now: number) {
    this.world = world;
    this.transport = transport;
    this.lastRefillAt = now;
  }

  /**
   * 服务端权威事件：主角必须还在名册里。
   *
   * `dramatic` / `routine` 跳过「已经看得见主角」的接收者——他们眼前就是
   * 完整动画，再刷一条文字等于同一件事说两遍。
   */
  emit(kind: number, actorId: number, now: number): void {
    const actor = this.world.get(actorId);
    if (!actor) return;
    const tier = activityTierOf(kind);
    const key = dedupKey(actorId, kind);
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < TIER_WINDOW_MS[tier]) return;

    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
    } else if (tier !== 'dramatic') {
      // 桶空：生活类与常规类直接丢，强演出不受影响
      return;
    }

    const text = formatActivity(kind, { name: actor.name, region: regionAt(actor.x, actor.y) });
    if (!text) return;

    this.lastSentAt.set(key, now);
    this.deliver(kind, tier, actor, text);
  }

  /**
   * 客户端上报本机私有互动。
   *
   * 只接受白名单里的纯观感事件（上香 / 设施 / 场所台词 / 常规动作），
   * 坐标一律取服务端权威位置，客户端发来的 `sub` 只作展示细分。
   * 即使被伪造，最坏结果也只是多一句文案，不影响任何判定。
   */
  report(actor: Player, kind: number, now: number): boolean {
    if (!ACTIVITY_REPORTABLE.has(kind)) return false;
    const last = this.lastReportAt.get(actor.id);
    if (last !== undefined && now - last < REPORT_INTERVAL_MS) return false;
    this.lastReportAt.set(actor.id, now);
    this.emit(kind, actor.id, now);
    return true;
  }

  /** 玩家离场：清掉他的去重记录，避免 id 复用后第一条被误吞 */
  forget(actorId: number): void {
    for (const key of this.lastSentAt.keys()) {
      if (Math.floor(key / 256) === actorId) this.lastSentAt.delete(key);
    }
    this.lastReportAt.delete(actorId);
  }

  private refill(now: number): void {
    if (now <= this.lastRefillAt) return;
    this.tokens = Math.min(BUCKET_CAPACITY, this.tokens + (now - this.lastRefillAt) * BUCKET_REFILL_PER_MS);
    this.lastRefillAt = now;
  }

  private deliver(kind: number, tier: string, actor: Player, text: string): void {
    // 同一句话只编码一次：接收者可能上百个，逐人重编码等于上百次 TextEncoder
    const packet = encodeActivity({ kind, actorId: actor.id, x: actor.x, y: actor.y, text });
    for (const viewer of this.world.players.values()) {
      // NPC 没有 socket；本人不需要自己的播报
      if (viewer.wsId === 0 || viewer.id === actor.id) continue;
      // 生活类演出只在本机播放，身边人也看不到，因此不排除 AOI
      if (tier !== 'life' && viewer.known.has(actor.id)) continue;
      this.transport.send(viewer.wsId, packet);
    }
  }
}
