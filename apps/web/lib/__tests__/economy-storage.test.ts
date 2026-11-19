import { ECONOMY_STORAGE_KEY, emptyEconomyProfile } from '@niuma/shared-types';
import { describe, expect, it } from 'vitest';
import { loadEconomy, saveEconomy } from '../economy';
import type { StorageLike } from '../storage';

function memoryStorage(): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
  };
}

describe('economy storage', () => {
  it('空存储返回零资产档案', () => {
    expect(loadEconomy(memoryStorage())).toEqual(emptyEconomyProfile());
  });

  it('写入后能读回同一份资产', () => {
    const storage = memoryStorage();
    saveEconomy(
      {
        coins: 1234,
        stats: { atkSpeedLv: 3, workEffLv: 2, critLv: 1, armorLv: 4 },
        unlockedCosmetics: ['hat'],
        inventory: { ice_americano: 2, slack_shield: 1 },
        dailyQuests: { day: '2026-11-15', progress: { punch: 2 }, claimed: [] },
      },
      storage,
    );
    const loaded = loadEconomy(storage);
    expect(loaded.coins).toBe(1234);
    expect(loaded.stats.atkSpeedLv).toBe(0);
    expect(loaded.inventory).toEqual({ ice_americano: 2, slack_shield: 1 });
  });

  it('坏档与越界值被清洗而不是原样读回', () => {
    const storage = memoryStorage();
    storage.raw.set(
      ECONOMY_STORAGE_KEY,
      JSON.stringify({ coins: -8, stats: { atkSpeedLv: 99 }, inventory: { hack: 999 } }),
    );
    const loaded = loadEconomy(storage);
    expect(loaded.coins).toBe(0);
    expect(loaded.stats.atkSpeedLv).toBe(0);
    expect(loaded.inventory).toEqual({});
  });
});
