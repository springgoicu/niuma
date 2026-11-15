import { describe, expect, it } from 'bun:test';
import { createGameClock, nextServerMidnight, resolveTzOffsetMin, serverHourOf } from './clock';

const DAY_MS = 86_400_000;

describe('resolveTzOffsetMin', () => {
  it('显式配置优先，缺省才取宿主机时区', () => {
    expect(resolveTzOffsetMin('480', 0)).toBe(480);
    expect(resolveTzOffsetMin('-300', 480)).toBe(-300);
    expect(resolveTzOffsetMin('', 480)).toBe(480);
    expect(resolveTzOffsetMin(undefined, 480)).toBe(480);
  });

  it('超出 ±14 小时的脏值被夹到现实极限', () => {
    expect(resolveTzOffsetMin('999999', 0)).toBe(840);
    expect(resolveTzOffsetMin('-999999', 0)).toBe(-840);
  });

  it('解析失败回落到缺省，不把园区切日算飞', () => {
    expect(resolveTzOffsetMin('Asia/Shanghai', 480)).toBe(480);
    expect(resolveTzOffsetMin('abc', 120)).toBe(120);
  });
});

describe('nextServerMidnight', () => {
  it('东八区：UTC 16:00 就是园区次日零点', () => {
    const evening = Date.UTC(2026, 10, 15, 15, 59, 0);
    expect(nextServerMidnight(evening, 480)).toBe(Date.UTC(2026, 10, 15, 16, 0, 0));
  });

  it('踩在零点整时推进到下一个零点，不会原地打转', () => {
    const midnight = Date.UTC(2026, 10, 15, 16, 0, 0);
    expect(nextServerMidnight(midnight, 480)).toBe(midnight + DAY_MS);
  });

  it('西五区零点对应 UTC 05:00', () => {
    const at = Date.UTC(2026, 10, 15, 6, 0, 0);
    expect(nextServerMidnight(at, -300)).toBe(Date.UTC(2026, 10, 16, 5, 0, 0));
  });

  it('固定偏移下一天恒等 24 小时', () => {
    const at = Date.UTC(2026, 2, 8, 3, 0, 0);
    expect(nextServerMidnight(at, 480) - at).toBeGreaterThan(0);
    const start = nextServerMidnight(at, 480);
    expect(nextServerMidnight(start, 480)).toBe(start + DAY_MS);
  });
});

describe('createGameClock', () => {
  it('注入 now 后所有派生时刻都跟着它走', () => {
    const at = Date.UTC(2026, 10, 15, 9, 30, 45);
    const clock = createGameClock(480, () => at);
    expect(clock.now()).toBe(at);
    expect(clock.serverSec()).toBe(Math.floor(at / 1000));
    expect(clock.nextMidnight()).toBe(Date.UTC(2026, 10, 15, 16, 0, 0));
    expect(clock.tzOffsetMin).toBe(480);
  });

  it('构造时就夹取偏移，运行期不会再变', () => {
    const clock = createGameClock(2_000, () => 0);
    expect(clock.tzOffsetMin).toBe(840);
  });

  it('serverSec 只发整秒，不发毫秒', () => {
    const clock = createGameClock(480, () => 1_760_000_000_999);
    expect(clock.serverSec()).toBe(1_760_000_000);
  });
});

describe('serverHourOf', () => {
  it('按园区时区读小时', () => {
    const at = Date.UTC(2026, 10, 15, 1, 30, 0);
    expect(serverHourOf(at, 480)).toBe(9);
    expect(serverHourOf(at, -300)).toBe(20);
  });
});
