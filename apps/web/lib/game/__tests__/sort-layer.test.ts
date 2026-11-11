import { describe, expect, it } from 'bun:test';
import { bandIndexAt } from '../sort-layer';

/**
 * 分桶的正确性只取决于一件事：**band 顺序必须等价于 y 顺序**。
 * 只要这条成立，无论树冠向上伸出多高，跨 band 的遮挡关系都不会错，
 * 所以这里守的是「同一个 y 永远落到同一个 band、且更大的 y 不会落到更早的 band」。
 */
const ORIGIN_Y = 100;
const BAND_HEIGHT = 256;
const BAND_COUNT = 12;

function index(y: number): number {
  return bandIndexAt(y, ORIGIN_Y, BAND_HEIGHT, BAND_COUNT);
}

describe('深度分层', () => {
  it('按 y 单调递增落桶：更大的 y 不会落到更早的 band', () => {
    let previous = -1;
    for (let y = 0; y <= 4000; y += 7) {
      const band = index(y);
      expect(band).toBeGreaterThanOrEqual(previous);
      previous = band;
    }
  });

  it('同一个 y 永远落到同一个 band（静态物体只归一次桶）', () => {
    for (const y of [100, 355, 356, 1234, 9999]) {
      expect(index(y)).toBe(index(y));
    }
  });

  it('band 边界左侧归当前 band，右侧归下一个', () => {
    // origin 100 + 2 * 256 = 612
    expect(index(611)).toBe(1);
    expect(index(612)).toBe(2);
  });

  it('越界钳到两端，不会返回负下标或越界下标', () => {
    expect(index(-9999)).toBe(0);
    expect(index(ORIGIN_Y - 1)).toBe(0);
    expect(index(1e9)).toBe(BAND_COUNT - 1);
  });

  it('单容器回退模式恒为 0：所有东西回到同一个容器里按 zIndex 排', () => {
    for (const y of [-500, 0, 1234, 1e6]) {
      expect(bandIndexAt(y, ORIGIN_Y, BAND_HEIGHT, 1)).toBe(0);
    }
  });

  it('异常输入不会算出 NaN 下标', () => {
    expect(index(Number.NaN)).toBe(0);
    expect(index(Number.POSITIVE_INFINITY)).toBe(BAND_COUNT - 1);
  });
});
