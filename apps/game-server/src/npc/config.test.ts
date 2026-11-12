import { describe, expect, it } from 'bun:test';
import { DEFAULT_NPC_CONFIG, MAX_NPC_COUNT, loadNpcConfig, parseNpcConfig } from './config';

describe('NPC 配置', () => {
  it('默认 10 位同事、发言与互动开启、种子按进程随机', () => {
    const config = loadNpcConfig({});
    expect(config.enabled).toBe(true);
    expect(config.count).toBe(10);
    expect(config.chat).toBe(true);
    expect(config.interact).toBe(true);
    expect(config.seed).toBeGreaterThanOrEqual(0);
    expect(config.speed.min).toBeLessThanOrEqual(config.speed.max);
  });

  it('环境变量可关停、可调数量与种子，数量有硬上限', () => {
    const off = loadNpcConfig({ GAME_NPC_ENABLED: '0', GAME_NPC_COUNT: '0', GAME_NPC_SEED: '12345' });
    expect(off.enabled).toBe(false);
    expect(off.count).toBe(0);
    expect(off.seed).toBe(12_345);

    const capped = loadNpcConfig({ GAME_NPC_COUNT: '9999' });
    expect(capped.count).toBe(MAX_NPC_COUNT);

    const bogus = loadNpcConfig({ GAME_NPC_COUNT: 'abc', GAME_NPC_SEED: 'xyz' });
    expect(bogus.count).toBe(DEFAULT_NPC_CONFIG.count);
    expect(bogus.seed).toBeGreaterThanOrEqual(0);
  });

  it('外置 JSON 只覆盖给定字段，其余保留默认', () => {
    const config = parseNpcConfig({
      speed: { min: 0.5, max: 0.8 },
      pauseMs: { normal: [4_000, 9_000] },
      chatDelayMs: { repeat: [300_000, 480_000] },
      socialIntervalMs: 800,
      regions: [{ id: 'plaza', weight: 9, radius: 360 }],
    });
    expect(config.speed).toEqual({ min: 0.5, max: 0.8 });
    expect(config.pauseMs.normal).toEqual([4_000, 9_000]);
    expect(config.pauseMs.short).toEqual(DEFAULT_NPC_CONFIG.pauseMs.short);
    expect(config.chatDelayMs.repeat).toEqual([300_000, 480_000]);
    expect(config.socialIntervalMs).toBe(800);
    expect(config.regions).toEqual([{ id: 'plaza', weight: 9, radius: 360 }]);
  });

  it('坏 JSON 与越界值整体退回默认：不阻断开服', () => {
    expect(parseNpcConfig(null)).toEqual(DEFAULT_NPC_CONFIG);
    expect(parseNpcConfig('not an object')).toEqual(DEFAULT_NPC_CONFIG);
    expect(parseNpcConfig({ speed: { min: 'fast', max: null } })).toEqual(DEFAULT_NPC_CONFIG);

    const clamped = parseNpcConfig({
      speed: { min: -5, max: 99 },
      pauseMs: { short: [9_999, 1_000] },
      socialIntervalMs: 0,
      regions: [{ id: '', weight: 1, radius: 500 }, { id: 'plaza', weight: 1, radius: 99_999 }],
    });
    expect(clamped.speed.min).toBeGreaterThanOrEqual(0.3);
    expect(clamped.speed.max).toBeLessThanOrEqual(1);
    // 上下界写反时自动纠正为升序
    expect(clamped.pauseMs.short).toEqual([1_000, 9_999]);
    expect(clamped.socialIntervalMs).toBeGreaterThanOrEqual(100);
    expect(clamped.regions).toEqual([{ id: 'plaza', weight: 1, radius: 1_200 }]);
  });

  it('速度上下界写反时按升序修正', () => {
    const config = parseNpcConfig({ speed: { min: 0.9, max: 0.5 } });
    expect(config.speed.min).toBeLessThanOrEqual(config.speed.max);
  });

  it('环境变量优先于 JSON：种子与数量不被文件覆盖', () => {
    const base = loadNpcConfig({ GAME_NPC_COUNT: '3', GAME_NPC_SEED: '77' });
    const merged = parseNpcConfig({ count: 99, seed: 1 }, base);
    expect(merged.count).toBe(3);
    expect(merged.seed).toBe(77);
  });
});
