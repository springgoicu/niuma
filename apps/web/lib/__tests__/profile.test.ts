import { describe, expect, it } from 'bun:test';
import { DEFAULT_APPEARANCE } from '@niuma/shared-types';
import {
  LEGACY_PROFILE_KEY,
  PROFILE_KEY,
  defaultAppearance,
  describeProfileName,
  loadProfile,
  saveProfile,
} from '../profile';
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

const profile = { name: '夜班实习生', appearance: defaultAppearance('horse'), status: '' };

describe('工牌名状态', () => {
  it('空串与纯空白都算没填，不会被审核换成兜底名', () => {
    for (const raw of ['', '   ', '\n\t']) {
      const status = describeProfileName(raw);
      expect(status.empty).toBe(true);
      expect(status.trimmed).toBe('');
      expect(status.blocked).toBe(false);
      expect(status.masked).toBe(false);
    }
  });

  it('正常名字原样通过，显示宽度按全角 2 计', () => {
    const status = describeProfileName('  夜班实习生  ');
    expect(status).toMatchObject({
      trimmed: '夜班实习生',
      empty: false,
      blocked: false,
      masked: false,
      displayUnits: 10,
      tooWide: false,
    });
  });

  it('整条拒绝的名字只报 blocked，不与打码混淆', () => {
    const status = describeProfileName('示例敏感词甲');
    expect(status.blocked).toBe(true);
    expect(status.masked).toBe(false);
  });

  it('脏话只报 masked，名字仍可上岗', () => {
    const status = describeProfileName('傻逼实习生');
    expect(status.masked).toBe(true);
    expect(status.blocked).toBe(false);
  });

  it('超过 16 显示宽时提示头顶截断，半角字符按 1 计', () => {
    expect(describeProfileName('abcdefghijklmnop').tooWide).toBe(false);
    expect(describeProfileName('abcdefghijklmnopq').tooWide).toBe(true);
    // 8 个汉字正好 16 显示宽，不属于超宽
    expect(describeProfileName('夜班加班实习生牛').tooWide).toBe(false);
    expect(describeProfileName('夜班加班实习生牛马').tooWide).toBe(true);
  });
});

describe('profile storage', () => {
  it('returns null when neither storage has a draft', () => {
    expect(loadProfile(memoryStorage(), memoryStorage())).toBeNull();
  });

  it('writes to local storage so closing the tab keeps the badge', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    saveProfile(profile, local);

    expect(local.getItem(PROFILE_KEY)).not.toBeNull();
    expect(session.getItem(LEGACY_PROFILE_KEY)).toBeNull();
    expect(loadProfile(local, session)?.name).toBe(profile.name);
  });

  it('promotes a legacy sessionStorage draft into local storage and deletes it', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    session.setItem(LEGACY_PROFILE_KEY, JSON.stringify(profile));

    const loaded = loadProfile(local, session)!;
    expect(loaded.name).toBe(profile.name);
    expect(loaded.appearance.species).toBe('horse');
    expect(local.getItem(PROFILE_KEY)).not.toBeNull();
    expect(session.getItem(LEGACY_PROFILE_KEY)).toBeNull();
  });

  it('prefers the local draft over a stale legacy one', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    saveProfile({ ...profile, name: '新工牌' }, local);
    session.setItem(LEGACY_PROFILE_KEY, JSON.stringify({ ...profile, name: '旧工牌' }));

    expect(loadProfile(local, session)?.name).toBe('新工牌');
  });

  it('drops a corrupt draft and still falls back to the legacy one', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    local.setItem(PROFILE_KEY, '{broken');
    session.setItem(LEGACY_PROFILE_KEY, JSON.stringify(profile));

    expect(loadProfile(local, session)?.name).toBe(profile.name);
    expect(local.getItem(PROFILE_KEY)).not.toBeNull();
  });

  it('sanitises the restored appearance through the shared codec', () => {
    const local = memoryStorage();
    local.setItem(
      PROFILE_KEY,
      JSON.stringify({ name: '牛', appearance: { ...DEFAULT_APPEARANCE.cow, cosmetics: { headwear: '<script>' } } }),
    );

    expect(loadProfile(local, memoryStorage())?.appearance.cosmetics.headwear).toBe('none');
  });
});
