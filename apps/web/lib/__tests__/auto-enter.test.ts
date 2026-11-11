import { describe, expect, it } from 'bun:test';
import { HOME_VISITED_KEY, homeAutoEnterScript } from '../auto-enter';
import { PARK_ID_PATTERN, PARK_PREF_KEY } from '../park';
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
  /** `niuma:park:v1` 的原始字符串 */
  park?: string;
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
  if (options.park !== undefined) local.setItem(PARK_PREF_KEY, options.park);
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
const parkJson = (id: string) => JSON.stringify({ id, savedAt: 1 });

describe('首页自动进园', () => {
  it('选过园区时直接进那一座，并记下本次会话已处理首页', () => {
    const result = run({ profile: profileJson, park: parkJson('b') });
    expect(result.replaced).toEqual(['/play?park=b']);
    expect(result.marked).toBe(true);
  });

  it('有工牌但没选过园区时去选园页，而不是猜一个园区', () => {
    expect(run({ profile: profileJson }).replaced).toEqual(['/enter']);
  });

  it('没有存档的新访客留在首页，但会话标记照写，之后整页回首页不会再被判断', () => {
    const result = run({ profile: undefined });
    expect(result.replaced).toEqual([]);
    expect(result.marked).toBe(true);
  });

  it('同一会话内再次执行（刷新首页）不再跳转', () => {
    const result = run({ profile: profileJson, park: parkJson('b'), visited: true });
    expect(result.replaced).toEqual([]);
  });

  it('同源 referrer 视为站内导航，留在首页', () => {
    for (const referrer of [`${ORIGIN}/play`, `${ORIGIN}/create`, `${ORIGIN}/`]) {
      const result = run({ profile: profileJson, park: parkJson('b'), referrer });
      expect(result.replaced).toEqual([]);
    }
  });

  it('空 referrer（输入域名 / 书签）与跨域 referrer 都算重新打开', () => {
    expect(run({ profile: profileJson, park: parkJson('b'), referrer: '' }).replaced).toEqual(['/play?park=b']);
    expect(
      run({ profile: profileJson, park: parkJson('b'), referrer: 'https://example.com/share' }).replaced,
    ).toEqual(['/play?park=b']);
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

  it('园区存档坏了就落到选园页，绝不拼出可疑路径', () => {
    const broken = [
      '{broken',
      '[]',
      'null',
      JSON.stringify({ id: 'A' }),
      JSON.stringify({ id: 'a/b' }),
      JSON.stringify({ id: 'wss://evil.test/ws' }),
      JSON.stringify({}),
    ];
    for (const park of broken) {
      expect(run({ profile: profileJson, park }).replaced).toEqual(['/enter']);
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

  it('脚本里的 key 与白名单正则和模块保持一致，不随版本漂移', () => {
    const script = homeAutoEnterScript();
    expect(script).toContain(PROFILE_KEY);
    expect(script).toContain(HOME_VISITED_KEY);
    expect(script).toContain(PARK_PREF_KEY);
    expect(script).toContain(PARK_ID_PATTERN.toString());
    expect(script).toContain('/play');
    expect(script).toContain('/enter');
  });
});
