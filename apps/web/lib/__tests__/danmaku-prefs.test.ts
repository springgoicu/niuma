import { describe, expect, it } from 'bun:test';
import { DANMAKU_MODE } from '@niuma/shared-types';
import { loadDanmakuPrefs, saveDanmakuPrefs } from '../danmaku-prefs';
import {
  DANMAKU_PREF_KEY,
  DEFAULT_DANMAKU_PREFS,
  clampOpacity,
  coveredTrackCount,
  sanitizeDanmakuPrefs,
} from '../game/danmaku-prefs';
import type { StorageLike } from '../storage';

/** Bun 运行时没有 Web Storage：用内存替身注入，行为与 localStorage 一致 */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
}

describe('弹幕偏好存储', () => {
  it('没有记录时回默认值：开启、85%、全屏、默认白、滚动', () => {
    expect(loadDanmakuPrefs(memoryStorage())).toEqual(DEFAULT_DANMAKU_PREFS);
    expect(loadDanmakuPrefs(null)).toEqual(DEFAULT_DANMAKU_PREFS);
    expect(DEFAULT_DANMAKU_PREFS.opacity).toBe(0.85);
  });

  it('写进去的偏好能原样读回来', () => {
    const storage = memoryStorage();
    const prefs = {
      enabled: false,
      opacity: 0.4,
      coverage: 'compact' as const,
      colorIndex: 3,
      mode: DANMAKU_MODE.Bottom,
    };
    saveDanmakuPrefs(prefs, storage);
    expect(loadDanmakuPrefs(storage)).toEqual(prefs);
  });

  it('坏 JSON 一律当没有，并清掉脏数据', () => {
    const broken = memoryStorage({ [DANMAKU_PREF_KEY]: '{oops' });
    expect(loadDanmakuPrefs(broken)).toEqual(DEFAULT_DANMAKU_PREFS);
    expect(broken.map.has(DANMAKU_PREF_KEY)).toBe(false);
  });

  it('隐私模式 / 配额满时不抛，读取退回默认值', () => {
    expect(() => saveDanmakuPrefs(DEFAULT_DANMAKU_PREFS, throwingStorage())).not.toThrow();
    expect(loadDanmakuPrefs(throwingStorage())).toEqual(DEFAULT_DANMAKU_PREFS);
  });

  it('逐字段回落：坏字段不连带清掉还记得的颜色', () => {
    const storage = memoryStorage({
      [DANMAKU_PREF_KEY]: JSON.stringify({
        enabled: 'yes',
        opacity: 5,
        coverage: '全屏',
        colorIndex: 6,
        mode: 9,
      }),
    });
    expect(loadDanmakuPrefs(storage)).toEqual({
      enabled: true,
      opacity: 1,
      coverage: 'full',
      colorIndex: 6,
      mode: DANMAKU_MODE.Scroll,
    });
  });
});

describe('弹幕偏好纯函数', () => {
  it('不透明度夹在 20%~100%，非数字回默认', () => {
    expect(clampOpacity(0.05)).toBe(0.2);
    expect(clampOpacity(9)).toBe(1);
    expect(clampOpacity(0.856)).toBe(0.86);
    expect(clampOpacity(Number.NaN)).toBe(0.85);
  });

  it('颜色索引越界回落到默认白', () => {
    expect(sanitizeDanmakuPrefs({ colorIndex: 200 })?.colorIndex).toBe(0);
    expect(sanitizeDanmakuPrefs({ colorIndex: 7 })?.colorIndex).toBe(7);
  });

  it('覆盖区域映射到轨道数：全屏 / 上半屏 / 前 3 轨', () => {
    expect(coveredTrackCount('full', 10)).toBe(10);
    expect(coveredTrackCount('half', 10)).toBe(5);
    expect(coveredTrackCount('half', 9)).toBe(5);
    expect(coveredTrackCount('compact', 10)).toBe(3);
    expect(coveredTrackCount('full', 0)).toBe(0);
  });

  it('非对象脏数据返回 null，交给 readJson 清理', () => {
    expect(sanitizeDanmakuPrefs('nope')).toBeNull();
    expect(sanitizeDanmakuPrefs(42)).toBeNull();
    expect(sanitizeDanmakuPrefs(null)).toBeNull();
  });
});
