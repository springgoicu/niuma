/**
 * 全园区播报条的排队规则（ADR-0112）。
 *
 * 纯函数、不碰 React、不碰时钟：调用方把 `now` 传进来，测试才能把 5 秒停留
 * 与 1.2 秒放行压成毫秒级断言。服务端已经做过去重与限流，这里的队列只负责
 * 「同时最多三条、强演出插队」这一层，不再重复降噪。
 */

/** 同屏最多三条：再多就会盖住画面中心，也读不过来 */
export const FEED_VISIBLE_MAX = 3;
/** 每条停留 5 秒后淡出；与设计稿一致，少于 4 秒读不完一句带名字的话 */
export const FEED_HOLD_MS = 5_000;
/** 队列放行间隔：三条同时过期时不要一次性涌上来 */
export const FEED_RELEASE_MS = 1_200;
/** 队列上限：超出丢最旧的，防止长时间挂后台攒出上千条 */
export const FEED_QUEUE_MAX = 12;
/** 事件在小地图与页脚计数里的有效期：与播报条停留时长错开，远处也能看到方向 */
export const ACTIVITY_TTL_MS = 6_000;

export interface ActivityItem {
  /** 客户端自增 key：React 列表 key 与「是否新事件」判定都靠它 */
  key: number;
  kind: number;
  text: string;
  /** 0 强演出 / 1 生活 / 2 常规，决定色带与读屏策略 */
  tier: number;
  x: number;
  y: number;
}

export interface FeedSlot {
  item: ActivityItem;
  /** 进入可见区的那一刻：淡出按它算，不走服务端时间 */
  shownAt: number;
}

export interface FeedState {
  visible: FeedSlot[];
  queue: ActivityItem[];
  /** 下一次允许从队列放行的时刻；0 表示可以立即放行 */
  nextReleaseAt: number;
}

export function emptyFeed(): FeedState {
  return { visible: [], queue: [], nextReleaseAt: 0 };
}

/**
 * 写入一条新播报。
 *
 * 强演出（tier 0）挤掉最旧的可见条目直接上屏：救护车、押送这类事件错过就
 * 没有第二次；普通条目在满员时进队列，等 `tickFeed` 逐条放行。
 */
export function pushFeed(state: FeedState, item: ActivityItem, now: number): FeedState {
  const visible = state.visible.slice();
  const queue = state.queue.slice();

  if (item.tier === 0) {
    if (visible.length >= FEED_VISIBLE_MAX) {
      const dropped = visible.pop();
      if (dropped) queue.unshift(dropped.item);
    }
    visible.unshift({ item, shownAt: now });
  } else if (visible.length < FEED_VISIBLE_MAX && queue.length === 0) {
    visible.push({ item, shownAt: now });
  } else {
    queue.push(item);
    if (queue.length > FEED_QUEUE_MAX) queue.shift();
  }

  return { visible, queue, nextReleaseAt: state.nextReleaseAt };
}

/**
 * 每 250ms 推一次：先过期再放行。
 *
 * 没有任何变化时返回同一个引用，React 的 `setState` 会跳过重渲染——空闲时
 * 这条定时器不产生任何代价。
 */
export function tickFeed(state: FeedState, now: number): FeedState {
  let changed = false;
  let visible = state.visible;
  let queue = state.queue;
  let nextReleaseAt = state.nextReleaseAt;

  const alive = visible.filter((slot) => now - slot.shownAt < FEED_HOLD_MS);
  if (alive.length !== visible.length) {
    visible = alive;
    changed = true;
  }

  if (queue.length > 0 && visible.length < FEED_VISIBLE_MAX) {
    if (now >= nextReleaseAt) {
      visible = visible.slice();
      queue = queue.slice();
      while (queue.length > 0 && visible.length < FEED_VISIBLE_MAX) {
        const item = queue.shift()!;
        visible.push({ item, shownAt: now });
        nextReleaseAt = now + FEED_RELEASE_MS;
        // 一次只放一条：第二条要等下一轮，避免同时涌上来
        break;
      }
      changed = true;
    }
  } else if (queue.length === 0 && nextReleaseAt !== 0) {
    // 队列空了就把放行闸门复位，下一条新事件不必空等 1.2 秒
    nextReleaseAt = 0;
    changed = true;
  }

  if (!changed) return state;
  return { visible, queue, nextReleaseAt };
}

/** 小地图页脚的「动态 N」：只数还在有效期内的条目，不额外起定时器 */
export function countRecentActivities(
  items: ReadonlyArray<ActivityItem & { at: number }>,
  now: number,
  ttlMs: number,
): number {
  let count = 0;
  for (const item of items) {
    if (now - item.at < ttlMs) count += 1;
  }
  return count;
}
