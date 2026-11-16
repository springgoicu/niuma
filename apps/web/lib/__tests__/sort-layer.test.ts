import { describe, expect, it } from 'bun:test';
import { BAND_HEIGHT, bandIndexAt, depthWriteNeeded } from '../game/sort-layer';

describe('深度分层', () => {
  it('按 y 归 band，越界钳到两端', () => {
    expect(bandIndexAt(0, 0, BAND_HEIGHT, 4)).toBe(0);
    expect(bandIndexAt(BAND_HEIGHT - 1, 0, BAND_HEIGHT, 4)).toBe(0);
    expect(bandIndexAt(BAND_HEIGHT, 0, BAND_HEIGHT, 4)).toBe(1);
    expect(bandIndexAt(-500, 0, BAND_HEIGHT, 4)).toBe(0);
    expect(bandIndexAt(99999, 0, BAND_HEIGHT, 4)).toBe(3);
  });

  it('NaN 归第一个 band，单 band 模式恒返回 0', () => {
    expect(bandIndexAt(Number.NaN, 0, BAND_HEIGHT, 4)).toBe(0);
    expect(bandIndexAt(99999, 0, BAND_HEIGHT, 1)).toBe(0);
  });

  it('原点偏移参与换算', () => {
    expect(bandIndexAt(1000, 1000, BAND_HEIGHT, 4)).toBe(0);
    expect(bandIndexAt(1000 + BAND_HEIGHT, 1000, BAND_HEIGHT, 4)).toBe(1);
  });

  it('同 band 且深度值没变时不再写深度：静止角色每帧 0 次 setter', () => {
    // 站立 / 坐着的角色：y 恒定，parent 恒定 → 不该触发排序
    expect(depthWriteNeeded(true, 321, 321)).toBe(false);
    // 走动角色：y 变了 → 照旧写
    expect(depthWriteNeeded(true, 321, 322)).toBe(true);
    // 跨 band：无论深度值是否相同都要换父容器
    expect(depthWriteNeeded(false, 321, 321)).toBe(true);
    expect(depthWriteNeeded(false, 0, 0)).toBe(true);
  });

  it('浮点 y 只在值真正变化时才写', () => {
    expect(depthWriteNeeded(true, 0.5, 0.5)).toBe(false);
    expect(depthWriteNeeded(true, 0.5, 0.500001)).toBe(true);
  });
});
