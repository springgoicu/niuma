import { describe, expect, it } from 'bun:test';
import { CHAT_OPEN_KEY, loadChatOpen, saveChatOpen } from '../chat-prefs';
import type { StorageLike } from '../storage';

/** Bun 运行时没有 Web Storage：用内存替身注入，行为与 localStorage 一致 */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  map: Map<string, string>;
} {
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

describe('聊天展开状态存储', () => {
  it('没有记录时默认收起', () => {
    expect(loadChatOpen(memoryStorage())).toBe(false);
    expect(loadChatOpen(null)).toBe(false);
  });

  it('写进去的布尔值能原样读回来', () => {
    const storage = memoryStorage();
    saveChatOpen(true, storage);
    expect(loadChatOpen(storage)).toBe(true);
    saveChatOpen(false, storage);
    expect(loadChatOpen(storage)).toBe(false);
  });

  it('坏 JSON 与非布尔字段一律当没有，并清掉脏数据', () => {
    const broken = memoryStorage({ [CHAT_OPEN_KEY]: '{oops' });
    expect(loadChatOpen(broken)).toBe(false);
    expect(broken.map.has(CHAT_OPEN_KEY)).toBe(false);

    const wrongShape = memoryStorage({ [CHAT_OPEN_KEY]: JSON.stringify({ open: 'yes' }) });
    expect(loadChatOpen(wrongShape)).toBe(false);
    expect(wrongShape.map.has(CHAT_OPEN_KEY)).toBe(false);
  });

  it('隐私模式 / 配额满时不抛，读取退回默认值', () => {
    expect(() => saveChatOpen(true, throwingStorage())).not.toThrow();
    expect(loadChatOpen(throwingStorage())).toBe(false);
  });
});
