import { describe, expect, it } from 'bun:test';
import { TICK_MS } from '@niuma/shared-types';
import { INTERP_DELAY_MAX_MS } from '../jitter';
import {
  MAX_EXTRAPOLATION_MS,
  RemoteTrack,
  SNAPSHOT_DEPTH,
  type RemoteSample,
} from '../interp';

/**
 * 回放缓冲守的是「抖动不能变成停顿」这条承诺。
 * 这里不测 Pixi，也不测会话：只验证给定一串带抖动的到达时间，
 * 采样出来的位置必须连续，且外推只在半步 Tick 内、低速时才发生。
 */
function makeSample(): RemoteSample {
  return { x: 0, y: 0, state: 0 };
}

describe('远端回放缓冲', () => {
  it('没有数据时采样失败，而不是返回 0 坐标', () => {
    const track = new RemoteTrack(8);
    expect(track.sample(0, 1000, makeSample())).toBe(false);
  });

  it('两帧之间做线性插值', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 0, 0, 0);
    track.push(0, 1100, 100, 50, 1);

    expect(track.sample(0, 1050, out)).toBe(true);
    expect(out.x).toBeCloseTo(50, 6);
    expect(out.y).toBeCloseTo(25, 6);
  });

  it('状态取左帧：姿态与位移来自同一个采样点，不会先迈步后位移', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 0, 0, 0b0000);
    track.push(0, 1100, 100, 0, 0b1111);

    // 区间内任意时刻都属于左帧描述的那一段
    track.sample(0, 1030, out);
    expect(out.state).toBe(0b0000);
    track.sample(0, 1099, out);
    expect(out.state).toBe(0b0000);
    // 到达右帧时刻才切换
    track.sample(0, 1100, out);
    expect(out.state).toBe(0b1111);
  });

  it('晚于最新帧时钳在最新帧，不外推', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 10, 10, 0);
    track.push(0, 1100, 20, 20, 0);

    expect(track.sample(0, 5000, out)).toBe(true);
    expect(out.x).toBe(20);
    // 外推会算出 20 + (5000-1100)/100 * 10 这种荒唐值
    expect(out.y).toBe(20);
  });

  it('早于最旧帧时钳在最旧帧', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 7, 8, 0);
    track.push(0, 1100, 9, 10, 0);

    track.sample(0, 0, out);
    expect(out.x).toBe(7);
    expect(out.y).toBe(8);
  });

  it('只有一帧时退化成立即显示，不抛异常', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 4, 5, 3);

    for (const t of [0, 1000, 99999]) {
      expect(track.sample(0, t, out)).toBe(true);
      expect(out.x).toBe(4);
      expect(out.state).toBe(3);
    }
  });

  it('抖动到达下输出单调连续：逐毫秒采样不会回退也不会跳变', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();

    // 匀速 100px/s，包间隔在 40~70ms 之间抖动，还夹一次丢包
    let at = 1000;
    let x = 0;
    track.push(0, at, x, 0, 0);
    for (const gap of [40, 65, 45, 70, 120, 50, 40, 60]) {
      at += gap;
      x += (100 * gap) / 1000;
      track.push(0, at, x, 0, 0);
    }

    let previous = Number.NEGATIVE_INFINITY;
    for (let t = at - 300; t <= at; t += 1) {
      track.sample(0, t, out);
      expect(out.x).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = out.x;
    }
  });

  it('环形写满后仍然只按最新几帧回放', () => {
    const track = new RemoteTrack(4, SNAPSHOT_DEPTH);
    const out = makeSample();
    // 写 10 帧，每帧 +10ms / +10px
    for (let i = 0; i < 10; i += 1) track.push(0, 1000 + i * 10, i * 10, 0, 0);

    // 深度 6：最新一帧是 1090 / x=90，最旧可回放的一帧是 1040 / x=40
    track.sample(0, 1070, out);
    expect(out.x).toBeCloseTo(70, 6);
    // 1095 越过最新帧 5ms，但上一段速度是 1000px/s，超过外推上限，直接钳位
    track.sample(0, 1095, out);
    expect(out.x).toBe(90);
    // 早于窗口的采样钳在窗口最旧帧，不会读到被覆盖的旧值
    track.sample(0, 1000, out);
    expect(out.x).toBe(40);
  });

  it('实体之间互不串味，离场后重置', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 1, 1, 0);
    track.push(0, 1100, 2, 2, 0);
    track.push(1, 1000, 100, 100, 0);
    track.push(1, 1100, 200, 200, 0);

    track.sample(0, 1050, out);
    expect(out.x).toBeCloseTo(1.5, 6);
    track.sample(1, 1050, out);
    expect(out.x).toBeCloseTo(150, 6);

    track.reset(0);
    expect(track.sample(0, 1050, out)).toBe(false);
    expect(track.sample(1, 1050, out)).toBe(true);
  });

  it('低速时越过最新帧做微外推，超过半步 Tick 立刻钳位', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    // 匀速 183px/s：最后一段的斜率就代表当前速度
    track.push(0, 1000, 0, 0, 1);
    track.push(0, 1050, 8.25, 4, 7);

    // 越过最新帧 10ms → 按速度补 10ms，位置连续
    track.sample(0, 1060, out);
    expect(out.x).toBeCloseTo(8.25 + (8.25 / 50) * 10, 6);
    expect(out.y).toBeCloseTo(4 + (4 / 50) * 10, 6);
    expect(out.state).toBe(7);

    // 越过 30ms > 25ms 上限 → 不外推，钳回最新帧
    track.sample(0, 1080, out);
    expect(out.x).toBe(8.25);
    expect(out.y).toBe(4);
  });

  it('上一段速度异常（座位吸附 / 传送）时不外推，避免冲出去再弹回来', () => {
    const track = new RemoteTrack(8);
    const out = makeSample();
    track.push(0, 1000, 0, 0, 0);
    track.push(0, 1050, 500, 0, 0);

    track.sample(0, 1060, out);
    expect(out.x).toBe(500);
    expect(out.y).toBe(0);
  });

  it('缓冲深度覆盖 120ms 延迟上限，微外推不超过半个 Tick', () => {
    expect(MAX_EXTRAPOLATION_MS).toBeLessThanOrEqual(TICK_MS / 2);
    // 120ms 延迟至少要夹住 3 帧；6 帧给抖动突发留余量
    expect((SNAPSHOT_DEPTH - 1) * TICK_MS).toBeGreaterThanOrEqual(INTERP_DELAY_MAX_MS);
  });
});
