import { describe, expect, it } from 'bun:test';
import { DIRECTION, POSE } from '@niuma/shared-types';
import {
  JUMP_LIFT_PEAK,
  PONY_POSES,
  jumpLiftTexels,
  jumpShadowFor,
  ponyMotion,
  ponyPoseNameOf,
  ventLungeTexels,
  type PonyPoseName,
} from '../pony-motion';

describe('角色微动效', () => {
  it('位移只允许 0 或 -1：永远抬高，绝不陷进地面', () => {
    for (const pose of PONY_POSES) {
      for (let t = 0; t < 8000; t += 37) {
        const motion = ponyMotion(pose, t, 7);
        expect(motion.bobTexels === 0 || motion.bobTexels === -1).toBe(true);
        expect(Number.isInteger(motion.bobTexels)).toBe(true);
      }
    }
  });

  it('阴影形态只有三档，全部是整数索引', () => {
    for (const pose of PONY_POSES) {
      for (let t = 0; t < 4000; t += 23) {
        const { shadow } = ponyMotion(pose, t, 3);
        expect([0, 1, 2]).toContain(shadow);
      }
    }
  });

  it('纯函数：同一 (pose, t, netId) 每次结果一致', () => {
    for (const pose of PONY_POSES) {
      expect(ponyMotion(pose, 1234, 42)).toEqual(ponyMotion(pose, 1234, 42));
    }
  });

  it('待机会真的起伏：一个周期内既抬起也落回', () => {
    const samples = new Set<number>();
    for (let t = 0; t < 3400; t += 20) samples.add(ponyMotion('idle', t, 11).bobTexels);
    expect([...samples].sort()).toEqual([-1, 0]);
  });

  it('行走的起伏频率高于待机：同窗口内的抬起次数更多', () => {
    const count = (pose: PonyPoseName): number => {
      let rises = 0;
      let wasUp = false;
      for (let t = 0; t < 4000; t += 10) {
        const up = ponyMotion(pose, t, 5).bobTexels === -1;
        if (up && !wasUp) rises += 1;
        wasUp = up;
      }
      return rises;
    };
    expect(count('walk')).toBeGreaterThan(count('idle'));
  });

  it('坐与躺不做起伏：脚已经不在站立位上', () => {
    for (let t = 0; t < 5000; t += 17) {
      expect(ponyMotion('sit', t, 9).bobTexels).toBe(0);
      expect(ponyMotion('lie', t, 9).bobTexels).toBe(0);
    }
  });

  it('眨眼周期约 35 秒，抖动在 ±5 秒内', () => {
    const onsets: number[] = [];
    let wasBlinking = false;
    for (let t = 0; t <= 400_000; t += 5) {
      const blinking = ponyMotion('idle', t, 21).blinking;
      if (blinking && !wasBlinking) onsets.push(t);
      wasBlinking = blinking;
    }
    expect(onsets.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < onsets.length; i += 1) {
      const gap = onsets[i]! - onsets[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(30_000);
      expect(gap).toBeLessThanOrEqual(40_000);
    }
  });

  it('眨眼只持续 ~140ms，不会一直闭眼', () => {
    let blinkingSamples = 0;
    const total = 4000;
    for (let i = 0; i < total; i += 1) {
      if (ponyMotion('idle', i * 10, 13).blinking) blinkingSamples += 1;
    }
    // 40 秒窗口内约眨眼一次，占空比不到 1%
    expect(blinkingSamples).toBeLessThan(total * 0.01);
    expect(blinkingSamples).toBeGreaterThan(0);
  });

  it('不同 netId 的相位错开：不会同屏同时呼吸', () => {
    // 首个「抬起」时刻即相位；按 netId 哈希后应当散开
    const phaseOf = (netId: number): number => {
      for (let t = 0; t < 4000; t += 5) {
        if (ponyMotion('idle', t, netId).bobTexels === -1) return t;
      }
      return -1;
    };
    const phases = new Set([1, 2, 3, 4, 5, 6].map(phaseOf));
    expect(phases.size).toBeGreaterThan(1);
  });

  it('线协议姿态枚举准确映射到微动效姿态名', () => {
    expect(ponyPoseNameOf(POSE.Idle)).toBe('idle');
    expect(ponyPoseNameOf(POSE.Walk)).toBe('walk');
    expect(ponyPoseNameOf(POSE.Sit)).toBe('sit');
    expect(ponyPoseNameOf(POSE.Lie)).toBe('lie');
  });

  it('发泄前倾沿朝向走蓄力-前冲-回弹三段整数纹素', () => {
    const out = { x: 99, y: 99 };
    ventLungeTexels(40, 440, DIRECTION.Right, out);
    expect(out).toEqual({ x: -1, y: 0 });
    ventLungeTexels(180, 440, DIRECTION.Right, out);
    expect(out).toEqual({ x: 2, y: 0 });
    ventLungeTexels(320, 440, DIRECTION.Up, out);
    expect(out).toEqual({ x: 0, y: -1 });
    ventLungeTexels(440, 440, DIRECTION.Down, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe('跳跃弧线', () => {
  const DURATION = 440;

  it('起落都贴地，全程只抬高不下沉且为整数', () => {
    expect(jumpLiftTexels(-10, DURATION)).toBe(0);
    expect(jumpLiftTexels(0, DURATION)).toBe(0);
    expect(jumpLiftTexels(DURATION, DURATION)).toBe(0);
    expect(jumpLiftTexels(DURATION + 200, DURATION)).toBe(0);
    for (let t = 0; t <= DURATION; t += 4) {
      const lift = jumpLiftTexels(t, DURATION);
      expect(lift).toBeLessThanOrEqual(0);
      expect(Number.isInteger(lift)).toBe(true);
    }
  });

  it('中段触顶 -7：比图集的 5 纹素腾空多出一倍落差', () => {
    let peak = 0;
    for (let t = 0; t <= DURATION; t += 2) peak = Math.min(peak, jumpLiftTexels(t, DURATION));
    expect(peak).toBe(-JUMP_LIFT_PEAK);
  });

  it('先升后降：不会中途二次起跳', () => {
    const samples: number[] = [];
    for (let t = 0; t <= DURATION; t += 10) samples.push(jumpLiftTexels(t, DURATION));
    const minIndex = samples.indexOf(Math.min(...samples));
    for (let i = 1; i <= minIndex; i += 1) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
    for (let i = minIndex + 1; i < samples.length; i += 1) expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
  });

  it('阴影只在真正腾空时摊开', () => {
    expect(jumpShadowFor(0)).toBe(1);
    expect(jumpShadowFor(-3)).toBe(1);
    expect(jumpShadowFor(-4)).toBe(0);
    expect(jumpShadowFor(-JUMP_LIFT_PEAK)).toBe(0);
  });
});
