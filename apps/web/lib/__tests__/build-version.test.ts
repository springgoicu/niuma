import { describe, expect, it } from 'bun:test';
import { allowReloadForVersion, reloadUrl, shouldReloadForVersion } from '../build-version';
import type { StorageLike } from '../storage';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('版本比较', () => {
  it('只有服务端版本存在且与页面不同才重载', () => {
    expect(shouldReloadForVersion('abc', 'def')).toBe(true);
    expect(shouldReloadForVersion('abc', 'abc')).toBe(false);
    expect(shouldReloadForVersion('abc', '')).toBe(false);
    expect(shouldReloadForVersion('abc', undefined)).toBe(false);
  });
});

describe('重载地址', () => {
  it('写入 __v，并保留原有查询参数与 hash', () => {
    const url = new URL(reloadUrl('https://niuma.example/play?park=main#chat', 'v-1'));
    expect(url.pathname).toBe('/play');
    expect(url.searchParams.get('park')).toBe('main');
    expect(url.searchParams.get('__v')).toBe('v-1');
    expect(url.hash).toBe('#chat');
  });

  it('重复调用只覆盖 __v，不会叠加参数', () => {
    const once = reloadUrl('https://niuma.example/play?__v=old', 'new');
    const twice = reloadUrl(once, 'newer');
    const url = new URL(twice);
    expect(url.searchParams.getAll('__v')).toEqual(['newer']);
  });
});

describe('强刷防循环', () => {
  it('同一版本在冷却期内只放行一次', () => {
    const storage = memoryStorage();
    expect(allowReloadForVersion(storage, 'v-1', 1_000)).toBe(true);
    expect(allowReloadForVersion(storage, 'v-1', 2_000)).toBe(false);
    expect(allowReloadForVersion(storage, 'v-1', 11_000)).toBe(true);
  });

  it('同一版本最多尝试三次，之后彻底停下', () => {
    const storage = memoryStorage();
    expect(allowReloadForVersion(storage, 'v-1', 0, 10_000, 2)).toBe(true);
    expect(allowReloadForVersion(storage, 'v-1', 10_000, 10_000, 2)).toBe(true);
    expect(allowReloadForVersion(storage, 'v-1', 20_000, 10_000, 2)).toBe(false);
    expect(allowReloadForVersion(storage, 'v-1', 60_000, 10_000, 2)).toBe(false);
  });

  it('出现更新的版本时重置计数，不会被旧版本的失败拖住', () => {
    const storage = memoryStorage();
    expect(allowReloadForVersion(storage, 'v-1', 0, 10_000, 1)).toBe(true);
    expect(allowReloadForVersion(storage, 'v-1', 10_000, 10_000, 1)).toBe(false);
    expect(allowReloadForVersion(storage, 'v-2', 10_001, 10_000, 1)).toBe(true);
  });

  it('存储不可用时不限流，由页面重载自行终止', () => {
    expect(allowReloadForVersion(null, 'v-1', 0)).toBe(true);
    expect(allowReloadForVersion(null, 'v-1', 0)).toBe(true);
  });
});
