import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyClockEpoch,
  applyClockSample,
  isServerClockSynced,
  resetServerClock,
  serverNow,
  serverTzOffsetMin,
  subscribeClockJump,
} from '../server-clock';

/** 一个足够远的整秒 epoch，避免与真实时间混淆 */
const SEC = 1_760_000_000;

beforeEach(() => {
  resetServerClock();
});

describe('applyClockSample', () => {
  it('首个样本建立基准：补回半秒截断与半程 RTT', () => {
    applyClockSample({ serverSec: SEC, rttMs: 40, tzOffsetMin: 480 });
    expect(isServerClockSynced()).toBe(true);
    const drift = serverNow() - (SEC * 1000 + 500 + 20);
    expect(drift).toBeGreaterThanOrEqual(0);
    expect(drift).toBeLessThan(50);
    expect(serverTzOffsetMin()).toBe(480);
  });

  it('只往前走：两次采样的间隔按单调时钟计入', () => {
    applyClockSample({ serverSec: SEC, tzOffsetMin: 0 });
    const first = serverNow();
    const spinner = Date.now();
    while (Date.now() - spinner < 5) {
      // 忙等 5ms：不依赖 fake timer，也能证明 `serverNow()` 会自己走
    }
    expect(serverNow()).toBeGreaterThan(first);
  });

  it('小偏差走 EMA 收敛，不会一步到位', () => {
    applyClockSample({ serverSec: SEC, tzOffsetMin: 0 });
    // 目标比推算值快 600ms（低于 1s 阈值，走平滑）
    applyClockSample({ serverSec: SEC + 1, rttMs: 0, tzOffsetMin: 0 });
    const target = (SEC + 1) * 1000 + 500;
    expect(serverNow()).toBeLessThan(target);
  });

  it('偏差超过 1s 直接对齐：本机时钟错得多也立刻纠正', () => {
    applyClockSample({ serverSec: SEC, tzOffsetMin: 0 });
    applyClockSample({ serverSec: SEC + 3_600, tzOffsetMin: 0 });
    expect(Math.abs(serverNow() - (SEC + 3_600) * 1000)).toBeLessThan(1_000);
  });

  it('非法样本被忽略，不会把时钟打到 1970', () => {
    applyClockSample({ serverSec: SEC, tzOffsetMin: 480 });
    const before = serverNow();
    applyClockSample({ serverSec: 0, tzOffsetMin: 480 });
    applyClockSample({ serverSec: Number.NaN, tzOffsetMin: 480 });
    expect(serverNow()).toBeGreaterThanOrEqual(before);
    expect(serverTzOffsetMin()).toBe(480);
  });

  it('时区偏移做区间夹取，脏值不会把切日算飞', () => {
    applyClockSample({ serverSec: SEC, tzOffsetMin: 20_000 });
    expect(serverTzOffsetMin()).toBe(840);
    applyClockSample({ serverSec: SEC, tzOffsetMin: Number.NaN });
    expect(serverTzOffsetMin()).toBe(0);
  });
});

describe('applyClockEpoch', () => {
  it('Worker 转发来的绝对时刻直接落地', () => {
    applyClockEpoch(SEC * 1000 + 500, 480);
    expect(isServerClockSynced()).toBe(true);
    expect(Math.abs(serverNow() - (SEC * 1000 + 500))).toBeLessThan(50);
    expect(serverTzOffsetMin()).toBe(480);
  });

  it('非法时刻忽略，已经对过的时钟保持不变', () => {
    applyClockEpoch(SEC * 1000, 480);
    const before = serverNow();
    applyClockEpoch(0, 480);
    applyClockEpoch(Number.NaN, 480);
    expect(serverNow()).toBeGreaterThanOrEqual(before);
  });
});

describe('subscribeClockJump', () => {
  it('大跳变通知订阅者，退订后不再回调', () => {
    const listener = vi.fn();
    const off = subscribeClockJump(listener);
    applyClockSample({ serverSec: SEC, tzOffsetMin: 0 });
    expect(listener).not.toHaveBeenCalled();
    // 往前推两小时：不是网络抖动，是时钟真的错了
    applyClockSample({ serverSec: SEC + 7_200, tzOffsetMin: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    applyClockSample({ serverSec: SEC + 14_400, tzOffsetMin: 0 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('订阅方抛错不影响对时链路', () => {
    const off = subscribeClockJump(() => {
      throw new Error('boom');
    });
    applyClockSample({ serverSec: SEC, tzOffsetMin: 0 });
    expect(() => applyClockSample({ serverSec: SEC + 7_200, tzOffsetMin: 0 })).not.toThrow();
    expect(isServerClockSynced()).toBe(true);
    off();
  });
});

describe('resetServerClock', () => {
  it('清空基准后回退到本机时间，等下一次样本重建', () => {
    applyClockSample({ serverSec: SEC + 86_400, tzOffsetMin: 480 });
    resetServerClock();
    expect(isServerClockSynced()).toBe(false);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(1_000);
  });
});
