import { describe, expect, it } from 'bun:test';
import { retryDelayMs, withRetry } from '../async-retry';

const noSleep = async () => undefined;

describe('退避时长', () => {
  it('按 2 的幂递增并压到上限', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 300, jitterRatio: 0, random: () => 0.5 };
    expect(retryDelayMs(0, options)).toBe(100);
    expect(retryDelayMs(1, options)).toBe(200);
    expect(retryDelayMs(2, options)).toBe(300);
    expect(retryDelayMs(9, options)).toBe(300);
  });

  it('抖动落在 ±ratio 区间内', () => {
    const options = { baseDelayMs: 100, jitterRatio: 0.5 };
    expect(retryDelayMs(0, { ...options, random: () => 0 })).toBe(50);
    expect(retryDelayMs(0, { ...options, random: () => 1 })).toBe(150);
  });
});

describe('withRetry', () => {
  it('首次失败、第二次成功时返回结果', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return 'ok';
      },
      { attempts: 2, baseDelayMs: 1, sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('重试耗尽后抛出最后一个错误', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        { attempts: 3, baseDelayMs: 1, sleep: noSleep },
      ),
    ).rejects.toThrow('fail-3');
    expect(calls).toBe(3);
  });

  it('shouldRetry 返回 false 时立即停止', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('no-retry');
        },
        { attempts: 3, baseDelayMs: 1, sleep: noSleep, shouldRetry: () => false },
      ),
    ).rejects.toThrow('no-retry');
    expect(calls).toBe(1);
  });

  it('每次真正重试前回调一次 onRetry', async () => {
    const retried: number[] = [];
    await withRetry(
      async () => {
        throw new Error('x');
      },
      {
        attempts: 2,
        baseDelayMs: 1,
        sleep: noSleep,
        onRetry: (_error, nextAttempt) => retried.push(nextAttempt),
      },
    ).catch(() => undefined);
    expect(retried).toEqual([1]);
  });
});
