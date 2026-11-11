import { describe, expect, it } from 'bun:test';
import type { NavTarget } from '@niuma/shared-types';
import { Navigator } from '../navigator';

const TARGET: NavTarget = {
  id: 'workroom',
  name: '工作区',
  x: 200,
  y: 0,
  arrive: { x: 200, y: 0 },
};

const out = { x: 0, y: 0 };

function started(navigator: Navigator): Navigator {
  navigator.start(
    [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
    TARGET,
  );
  return navigator;
}

describe('自动寻路推进（ADR-0040）', () => {
  it('朝当前路点给出单位方向', () => {
    const navigator = started(new Navigator());
    expect(navigator.active).toBe(true);
    expect(navigator.steer(0, 0, out)).toBe('move');
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('进入 10px 就切下一个路点，不回头找已过的点', () => {
    const navigator = started(new Navigator());
    // 距离第一个路点 8px：应直接朝第二个路点，方向仍是 +x
    navigator.steer(92, 0, out);
    expect(out.x).toBeCloseTo(1, 6);
    // 距离最终落点 5px：判定到达并清零方向
    expect(navigator.steer(195, 0, out)).toBe('arrived');
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('路点全部走完但仍有偏差时继续朝落点', () => {
    const navigator = new Navigator();
    navigator.start([{ x: 190, y: 0 }], TARGET);
    navigator.steer(200, 0, out); // 落点 5px，先判到达
    expect(navigator.steer(200, 0, out)).toBe('arrived');

    navigator.start([{ x: 150, y: 0 }], TARGET);
    navigator.steer(150, 0, out); // 切完路点，仍在 50px 外
    expect(out.x).toBeCloseTo(1, 6);
  });

  it('原地不动超过 700ms 判定卡死，有位移就重置', () => {
    const navigator = started(new Navigator());
    expect(navigator.observe(300, 0, 0)).toBe('ok'); // 第一帧只记录位置
    expect(navigator.observe(300, 0, 0)).toBe('ok'); // 300ms
    expect(navigator.observe(300, 0, 0)).toBe('ok'); // 600ms
    expect(navigator.observe(300, 0, 0)).toBe('stuck'); // 900ms

    expect(navigator.observe(300, 20, 0)).toBe('ok'); // 有位移：重置计时
    expect(navigator.observe(300, 20, 0)).toBe('ok');
    expect(navigator.observe(300, 20, 0)).toBe('ok');
    expect(navigator.observe(300, 20, 0)).toBe('stuck');
  });

  it('取消是幂等的，取消后不再给方向', () => {
    const navigator = started(new Navigator());
    navigator.cancel();
    expect(navigator.active).toBe(false);
    navigator.cancel();
    expect(navigator.steer(0, 0, out)).toBe('arrived');
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('切换目标会从新路径起点重新推进', () => {
    const navigator = started(new Navigator());
    navigator.steer(92, 0, out); // 已经跳过第一个路点
    const next: NavTarget = { id: 'lounge', name: '休息室', x: -100, y: 0, arrive: { x: -100, y: 0 } };
    navigator.start([{ x: 80, y: 0 }], next);
    expect(navigator.target?.id).toBe('lounge');
    navigator.steer(0, 0, out);
    expect(out.x).toBeCloseTo(1, 6); // 朝新路点 +x
  });
});
