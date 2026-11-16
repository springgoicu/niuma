import { describe, expect, it } from 'bun:test';
import {
  ACTIVITY_TTL_MS,
  FEED_HOLD_MS,
  FEED_QUEUE_MAX,
  FEED_RELEASE_MS,
  FEED_VISIBLE_MAX,
  countRecentActivities,
  emptyFeed,
  pushFeed,
  tickFeed,
  type ActivityItem,
} from '../activity-feed';

function item(key: number, tier = 2): ActivityItem {
  return { key, kind: 21, text: `事件 ${key}`, tier, x: 0, y: 0 };
}

describe('pushFeed', () => {
  it('同屏最多三条，多出来的排队', () => {
    let state = emptyFeed();
    for (let key = 1; key <= 4; key += 1) state = pushFeed(state, item(key), 0);
    expect(state.visible).toHaveLength(FEED_VISIBLE_MAX);
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]!.key).toBe(4);
  });

  it('强演出插队：挤掉最旧的一条，并把旧条放回队首', () => {
    let state = emptyFeed();
    for (let key = 1; key <= 3; key += 1) state = pushFeed(state, item(key), 0);
    state = pushFeed(state, item(99, 0), 10);
    expect(state.visible[0]!.item.key).toBe(99);
    expect(state.visible).toHaveLength(3);
    expect(state.queue[0]!.key).toBe(3);
  });

  it('队列上限生效：长时间挂后台不会攒出上千条', () => {
    let state = emptyFeed();
    for (let key = 1; key <= FEED_QUEUE_MAX + 8; key += 1) state = pushFeed(state, item(key), 0);
    expect(state.queue.length).toBeLessThanOrEqual(FEED_QUEUE_MAX);
  });
});

describe('tickFeed', () => {
  it('满 5 秒才过期，提前不消失', () => {
    let state = emptyFeed();
    state = pushFeed(state, item(1), 0);
    state = tickFeed(state, FEED_HOLD_MS - 1);
    expect(state.visible).toHaveLength(1);
    state = tickFeed(state, FEED_HOLD_MS);
    expect(state.visible).toHaveLength(0);
  });

  it('过期后每 1.2 秒只放行一条，不一次性涌上来', () => {
    let state = emptyFeed();
    for (let key = 1; key <= 6; key += 1) state = pushFeed(state, item(key), 0);
    state = tickFeed(state, FEED_HOLD_MS);
    expect(state.visible).toHaveLength(1);
    // 还在放行间隔内：队列不动
    state = tickFeed(state, FEED_HOLD_MS + FEED_RELEASE_MS - 1);
    expect(state.visible).toHaveLength(1);
    state = tickFeed(state, FEED_HOLD_MS + FEED_RELEASE_MS);
    expect(state.visible).toHaveLength(2);
  });

  it('没有任何变化时返回同一个引用，空闲时 React 不重渲染', () => {
    let state = emptyFeed();
    state = pushFeed(state, item(1), 0);
    const first = tickFeed(state, 10);
    const second = tickFeed(first, 20);
    expect(second).toBe(first);
  });
});

describe('countRecentActivities', () => {
  it('只数有效期内的条目', () => {
    const items = [
      { ...item(1), at: 0 },
      { ...item(2), at: 5_000 },
      { ...item(3), at: 9_000 },
    ];
    expect(countRecentActivities(items, 9_500, ACTIVITY_TTL_MS)).toBe(2);
    expect(countRecentActivities(items, 12_000, ACTIVITY_TTL_MS)).toBe(1);
  });
});
