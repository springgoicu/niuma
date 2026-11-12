import { describe, expect, it } from 'bun:test';
import { TICK_MS } from '@niuma/shared-types';
import {
  INTERP_DELAY_MAX_MS,
  INTERP_DELAY_MIN_MS,
  INTERP_DELAY_START_MS,
  JitterBuffer,
} from '../jitter';

/**
 * 自适应缓冲守的是「好网更跟手、弱网不饿死」。
 * 这里用固定序列模拟，不依赖真实计时器：tick 与到达时刻都是可控的标量。
 */
function feedSync(buffer: JitterBuffer, count: number, latencyMs: number, wobble = 0): void {
  for (let i = 1; i <= count; i += 1) {
    const tick = i;
    const arrival = 1000 + tick * TICK_MS + latencyMs + (i % 2 === 0 ? wobble : -wobble);
    buffer.onSync(tick, arrival);
  }
}

describe('自适应抖动缓冲', () => {
  it('没有样本时从 55ms 起步，不冒进也不拖沓', () => {
    const buffer = new JitterBuffer();
    expect(buffer.delayMs).toBe(INTERP_DELAY_START_MS);
    expect(buffer.jitterMs).toBe(0);
    expect(buffer.rttP95Ms).toBe(0);
  });

  it('好网（RTT 20ms、时延稳定）收敛到 35ms 下限', () => {
    const buffer = new JitterBuffer();
    for (let i = 0; i < 24; i += 1) buffer.onRtt(20);
    feedSync(buffer, 400, 10);
    expect(buffer.delayMs).toBeGreaterThanOrEqual(INTERP_DELAY_MIN_MS);
    expect(buffer.delayMs).toBeLessThan(INTERP_DELAY_MIN_MS + 0.5);
    expect(buffer.targetMs).toBe(INTERP_DELAY_MIN_MS);
  });

  it('高 RTT（300ms）把缓冲拉长，但封顶 120ms', () => {
    const buffer = new JitterBuffer();
    buffer.onRtt(300);
    feedSync(buffer, 200, 150);
    expect(buffer.delayMs).toBeGreaterThan(INTERP_DELAY_MAX_MS - 1);
    expect(buffer.delayMs).toBeLessThanOrEqual(INTERP_DELAY_MAX_MS);
  });

  it('RTT 只在 p95 上生效，单个离群值不会把所有人拖慢', () => {
    const buffer = new JitterBuffer();
    for (let i = 0; i < 23; i += 1) buffer.onRtt(20);
    buffer.onRtt(500);
    // 24 个样本的 p95 是第 23 小：仍然落在 20ms 的桶里
    expect(buffer.rttP95Ms).toBeLessThanOrEqual(28);
  });

  it('时延忽左忽右时目标延迟随抖动抬升，但不超过上限', () => {
    const buffer = new JitterBuffer();
    // 相邻包偏移差 60ms：EWMA 会收敛到 60 附近，2 × 60 已经超过上限
    feedSync(buffer, 200, 0, 30);
    expect(buffer.jitterMs).toBeGreaterThan(40);
    expect(buffer.delayMs).toBeLessThanOrEqual(INTERP_DELAY_MAX_MS);
    expect(buffer.targetMs).toBeCloseTo(INTERP_DELAY_MAX_MS, 6);
  });

  it('轻抖动的目标值等于公式值，不额外加保险', () => {
    const buffer = new JitterBuffer();
    // 偏移差 20ms → jitter ≈ 20 → 2 × 20 = 40ms
    feedSync(buffer, 200, 0, 10);
    expect(buffer.targetMs).toBeGreaterThan(39);
    expect(buffer.targetMs).toBeLessThan(41);
  });

  it('上升快、回落慢：同样 10 个包，拉长的幅度远大于回缩', () => {
    const buffer = new JitterBuffer();
    buffer.onRtt(300);
    // 10 个稳定包：目标 120，上升 alpha 0.35 已经走完大半
    feedSync(buffer, 10, 150);
    const high = buffer.delayMs;
    const rise = high - INTERP_DELAY_START_MS;

    // 网络恢复：p95 降到 20ms，目标回到 35，但下降 alpha 只有 0.03
    for (let i = 0; i < 24; i += 1) buffer.onRtt(20);
    for (let i = 11; i <= 20; i += 1) buffer.onSync(i, 1000 + i * TICK_MS + 150);
    const drop = high - buffer.delayMs;

    expect(rise).toBeGreaterThan(40);
    expect(drop).toBeLessThan(rise / 2);
  });

  it('重连后重置传输偏移，不从旧会话的抖动里恢复', () => {
    const buffer = new JitterBuffer();
    feedSync(buffer, 200, 0, 30);
    expect(buffer.jitterMs).toBeGreaterThan(0);

    buffer.reset();
    expect(buffer.delayMs).toBe(INTERP_DELAY_START_MS);
    expect(buffer.jitterMs).toBe(0);
    // 重置后的第一条包只建立基准，不产生抖动
    buffer.onSync(1, 5000);
    expect(buffer.jitterMs).toBe(0);
  });

  it('延迟永远落在 35..120 之间', () => {
    const buffer = new JitterBuffer();
    for (let i = 1; i <= 400; i += 1) {
      buffer.onRtt((i * 37) % 900);
      buffer.onSync(i, 1000 + i * TICK_MS + ((i % 7) - 3) * 40);
      expect(buffer.delayMs).toBeGreaterThanOrEqual(INTERP_DELAY_MIN_MS);
      expect(buffer.delayMs).toBeLessThanOrEqual(INTERP_DELAY_MAX_MS);
    }
  });

  it('非法输入不污染状态', () => {
    const buffer = new JitterBuffer();
    buffer.onSync(Number.NaN, 1000);
    buffer.onRtt(Number.NaN);
    buffer.onRtt(-5);
    expect(buffer.jitterMs).toBe(0);
    expect(buffer.rttP95Ms).toBe(0);
    expect(buffer.delayMs).toBe(INTERP_DELAY_START_MS);
  });
});
