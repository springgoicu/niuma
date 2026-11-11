import { describe, expect, it } from 'bun:test';
import { HOME_VISITED_KEY, homeAutoEnterScript } from '../auto-enter';
import { PROFILE_KEY } from '../profile';
import type { StorageLike } from '../storage';

const ORIGIN = 'https://niuma.test';

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

/** 隐私模式下的 storage：读也抛、写也抛 */
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

interface HarnessOptions {
  /** 传 undefined 表示没有存档，null 表示 key 存在但值为空 */
  profile?: string | null;
  visited?: boolean;
  referrer?: string;
  readyState?: 'loading' | 'interactive' | 'complete';
  localThrows?: boolean;
  sessionThrows?: boolean;
}

/**
 * 真跑一遍脚本：`new Function` 把三个全局换成假对象，
 * 不引 jsdom，也能覆盖到脚本的每一个短路分支。
 */
function run(options: HarnessOptions = {}) {
  const replaced: string[] = [];
  const local = memoryStorage();
  const session = memoryStorage();
  if (options.profile !== undefined && options.profile !== null) {
    local.setItem(PROFILE_KEY, options.profile);
  }
  if (options.visited) session.setItem(HOME_VISITED_KEY, '1');

  const fakeWindow = {
    localStorage: options.localThrows ? throwingStorage() : local,
    sessionStorage: options.sessionThrows ? throwingStorage() : session,
  };
  const fakeDocument = {
    referrer: options.referrer ?? '',
    readyState: options.readyState ?? 'loading',
  };
  const fakeLocation = {
    origin: ORIGIN,
    replace: (url: string) => {
      replaced.push(url);
    },
  };

  new Function('window', 'document', 'location', homeAutoEnterScript())(
    fakeWindow,
    fakeDocument,
    fakeLocation,
  );

  return { replaced, session, marked: session.getItem(HOME_VISITED_KEY) === '1' };
}

const profileJson = JSON.stringify({ name: '夜班实习生', appearance: {}, status: '' });

describe('首页自动进园', () => {
  it('重新打开站点且本地有存档时直达 /play，并记下本次会话已处理首页', () => {
    const result = run({ profile: profileJson });
    expect(result.replaced).toEqual(['/play']);
    expect(result.marked).toBe(true);
  });

  it('没有存档的新访客留在首页，但会话标记照写，之后整页回首页不会再被判断', () => {
    const result = run({ profile: undefined });
    expect(result.replaced).toEqual([]);
    expect(result.marked).toBe(true);
  });

  it('同一会话内再次执行（刷新首页）不再跳转', () => {
    const result = run({ profile: profileJson, visited: true });
    expect(result.replaced).toEqual([]);
  });

  it('同源 referrer 视为站内导航，留在首页', () => {
    for (const referrer of [`${ORIGIN}/play`, `${ORIGIN}/create`, `${ORIGIN}/`]) {
      const result = run({ profile: profileJson, referrer });
      expect(result.replaced).toEqual([]);
    }
  });

  it('空 referrer（输入域名 / 书签）与跨域 referrer 都算重新打开', () => {
    expect(run({ profile: profileJson, referrer: '' }).replaced).toEqual(['/play']);
    expect(run({ profile: profileJson, referrer: 'https://example.com/share' }).replaced).toEqual(['/play']);
  });

  it('存档不是合法 JSON 时不跳，交给 /play 的 loadProfile 去清坏数据', () => {
    const result = run({ profile: '{broken' });
    expect(result.replaced).toEqual([]);
    expect(result.marked).toBe(true);
  });

  it('存档能解析但不是对象（数组 / 字符串 / null）时不跳', () => {
    for (const profile of ['[]', '"夜班实习生"', 'null', '0']) {
      expect(run({ profile }).replaced).toEqual([]);
    }
  });

  it('localStorage 不可用时不跳也不抛', () => {
    const result = run({ profile: profileJson, localThrows: true });
    expect(result.replaced).toEqual([]);
  });

  it('sessionStorage 不可用时按已访问处理，宁可少跳一次也不反复打扰', () => {
    const result = run({ profile: profileJson, sessionThrows: true });
    expect(result.replaced).toEqual([]);
  });

  it('非解析阶段执行（React 客户端插入）不跳，避免站内导航回首页被弹走', () => {
    for (const readyState of ['interactive', 'complete'] as const) {
      const result = run({ profile: profileJson, readyState });
      expect(result.replaced).toEqual([]);
      expect(result.marked).toBe(false);
    }
  });

  it('脚本里的存档 key 与 lib/profile.ts 保持一致，不随版本漂移', () => {
    const script = homeAutoEnterScript();
    expect(script).toContain(PROFILE_KEY);
    expect(script).toContain(HOME_VISITED_KEY);
    expect(script).toContain('/play');
  });
});
