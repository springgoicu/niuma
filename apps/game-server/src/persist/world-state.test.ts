import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOSS_MAX_HP } from '@niuma/shared-types';
import { ProfileBook, PROFILE_TTL_MS } from './profiles';
import {
  openWorldStateStore,
  WORLD_STATE_VERSION,
  WorldStateStore,
  type WorldStateParts,
} from './world-state';

const DEVICE = 'a1b2c3d4e5f60718';
const OTHER = '00112233445566aa';
const NOW = 1_700_000_000_000;

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempPath(name = 'world-state.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'niuma-state-'));
  dirs.push(dir);
  return join(dir, name);
}

const PARTS: WorldStateParts = {
  boss: { hp: 123, resetAt: NOW + 3_600_000 },
  ring: {
    matchId: 41,
    nextMatchId: 42,
    lastMatch: { matchId: 40, endedAt: NOW - 1_000, top: [{ name: '牛马', rank: 1, hp: 33 }] },
  },
  villas: { villas: [] },
  wallets: [],
};

function storeAt(path: string, overrides: Partial<WorldStateParts> = {}): WorldStateStore {
  return new WorldStateStore({
    path,
    saveDelayMs: 1_000,
    profileCapacity: 8,
    tzOffsetMin: 480,
    now: () => NOW,
    collect: () => ({ ...PARTS, ...overrides }),
    warn: () => {},
  });
}

describe('openWorldStateStore', () => {
  it('路径留空即整体关闭持久化', () => {
    expect(
      openWorldStateStore({
        path: '   ',
        collect: () => PARTS,
        tzOffsetMin: 480,
        now: () => NOW,
      }),
    ).toBeNull();
  });
});

describe('WorldStateStore 往返', () => {
  it('落盘后能原样读回，且带版本号与时区', async () => {
    const path = tempPath();
    const store = storeAt(path);
    store.markDirty();
    await store.flush();
    store.dispose();

    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(raw.version).toBe(WORLD_STATE_VERSION);
    expect(raw.tzOffsetMin).toBe(480);

    const reopened = storeAt(path);
    const loaded = reopened.load();
    expect(loaded?.boss).toEqual(PARTS.boss);
    expect(loaded?.ring.matchId).toBe(41);
    expect(loaded?.ring.lastMatch?.top[0]?.name).toBe('牛马');
    reopened.dispose();
  });

  it('没有变更就不写盘：markDirty 是唯一入口', async () => {
    const path = tempPath();
    const store = storeAt(path);
    await store.flush();
    expect(existsSync(path)).toBe(false);
    store.dispose();
  });

  it('flushSync 在退出路径上留下最后一帧', () => {
    const path = tempPath();
    const store = storeAt(path);
    store.markDirty();
    store.flushSync();
    store.dispose();
    expect(JSON.parse(readFileSync(path, 'utf8')).ring.nextMatchId).toBe(42);
  });

  it('先写临时文件再改名：读到的永远是完整 JSON', async () => {
    const path = tempPath();
    const store = storeAt(path);
    store.markDirty();
    await store.flush();
    const names = readdirSync(join(path, '..'));
    expect(names).toContain('world-state.json');
    expect(names).not.toContain('world-state.json.tmp');
    store.dispose();
  });

  it('v3 钱包段往返：余额 / 托管 / 装扮都进快照', async () => {
    const path = tempPath();
    const wallets = [
      {
        id: DEVICE,
        name: '牛马',
        coins: 321,
        stats: { atkSpeedLv: 1, workEffLv: 2, critLv: 3, armorLv: 4 },
        inventory: { ice_americano: 2 },
        unlockedCosmetics: ['top'],
        escrow: [{ key: 'dice:0:1', amount: 10 }],
        importedAt: NOW,
        lastSeenAt: NOW,
      },
    ];
    const store = storeAt(path, { wallets });
    store.markDirty();
    await store.flush();
    store.dispose();

    const reopened = storeAt(path);
    const loaded = reopened.load();
    expect(loaded?.wallets).toEqual(wallets);
    reopened.dispose();
  });

  it('v2 档没有钱包段：按空账本接管，不当坏档', () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        savedAt: NOW,
        tzOffsetMin: 480,
        boss: { hp: 1, resetAt: NOW + 60_000 },
        ring: { matchId: 1, nextMatchId: 2, lastMatch: null },
        villas: { villas: [] },
        profiles: [],
      }),
      'utf8',
    );
    const store = storeAt(path);
    const loaded = store.load();
    expect(loaded?.wallets).toEqual([]);
    expect(loaded?.version).toBe(WORLD_STATE_VERSION);
    store.dispose();
  });

  it('主档写坏时优先从 .bak 恢复', async () => {
    const path = tempPath();
    const store = storeAt(path);
    store.markDirty();
    await store.flush();
    // 第二次覆盖前会把上一份主档留成备份
    store.markDirty();
    await store.flush();
    store.dispose();
    expect(existsSync(`${path}.bak`)).toBe(true);

    writeFileSync(path, '{ broken', 'utf8');
    const reopened = storeAt(path);
    const loaded = reopened.load();
    expect(loaded?.ring.matchId).toBe(41);
    reopened.dispose();
  });
});

describe('读档容错', () => {
  it('坏 JSON 被改名隔离，开服不受影响', () => {
    const path = tempPath();
    writeFileSync(path, '{ this is not json', 'utf8');
    const store = storeAt(path);
    expect(store.load()).toBeNull();
    expect(readdirSync(join(path, '..')).some((name) => name.startsWith('world-state.json.bad-'))).toBe(true);
    store.dispose();
  });

  it('版本不符当作没有档，同样隔离留证', () => {
    const path = tempPath();
    writeFileSync(path, JSON.stringify({ ...PARTS, version: 99, profiles: [] }), 'utf8');
    const store = storeAt(path);
    expect(store.load()).toBeNull();
    expect(readdirSync(join(path, '..')).some((name) => name.startsWith('world-state.json.bad-'))).toBe(true);
    store.dispose();
  });

  it('越界数值夹取，不因一条坏字段整档作废', () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        savedAt: NOW,
        tzOffsetMin: 480,
        boss: { hp: 99_999, resetAt: NOW + 60_000 },
        ring: { matchId: -5, nextMatchId: 0, lastMatch: null },
        profiles: [],
      }),
      'utf8',
    );
    const store = storeAt(path);
    const loaded = store.load();
    expect(loaded?.boss.hp).toBe(BOSS_MAX_HP);
    expect(loaded?.ring.matchId).toBe(0);
    expect(loaded?.ring.nextMatchId).toBe(1);
    // v1 档没有豪宅段：按空豪宅接管，不当成坏档隔离
    expect(loaded?.villas.villas).toEqual([]);
    store.dispose();
  });

  it('非法设备号的档案被丢弃，有效档案带夹取后的计数', () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        savedAt: NOW,
        tzOffsetMin: 480,
        boss: { hp: 1, resetAt: NOW + 60_000 },
        ring: { matchId: 1, nextMatchId: 2, lastMatch: null },
        profiles: [
          { id: DEVICE, name: '牛马', likes: 5_000_000, gold: -3, silver: 1.9, bronze: 0, lastSeenAt: NOW },
          { id: 'not-a-device', name: '幽灵', likes: 9, gold: 9, silver: 9, bronze: 9, lastSeenAt: NOW },
        ],
      }),
      'utf8',
    );
    const store = storeAt(path);
    const loaded = store.load();
    expect(loaded?.profiles).toHaveLength(1);
    store.hydrateProfiles(loaded);
    const record = store.profiles.get(DEVICE);
    expect(record?.likes).toBe(1_000_000);
    expect(record?.gold).toBe(0);
    expect(record?.silver).toBe(1);
    expect(store.profiles.get('not-a-device')).toBeUndefined();
    store.dispose();
  });

  it('停机太久：读档时按 90 天口径先淘汰一轮', () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        savedAt: NOW,
        tzOffsetMin: 480,
        boss: { hp: 1, resetAt: NOW + 60_000 },
        ring: { matchId: 1, nextMatchId: 2, lastMatch: null },
        profiles: [
          { id: DEVICE, name: '旧', likes: 3, gold: 0, silver: 0, bronze: 0, lastSeenAt: NOW - PROFILE_TTL_MS - 1 },
          { id: OTHER, name: '新', likes: 3, gold: 0, silver: 0, bronze: 0, lastSeenAt: NOW },
        ],
      }),
      'utf8',
    );
    const store = storeAt(path);
    store.hydrateProfiles(store.load());
    expect(store.profiles.get(DEVICE)).toBeUndefined();
    expect(store.profiles.get(OTHER)?.likes).toBe(3);
    store.dispose();
  });
});

describe('ProfileBook', () => {
  it('非法设备号一律当匿名：既不建档也不累加', () => {
    const book = new ProfileBook(8);
    expect(book.touch('', '牛马', NOW)).toBeUndefined();
    expect(book.touch('ABCDEF0123456789', '牛马', NOW)).toBeUndefined();
    expect(book.addLike(DEVICE, NOW)).toBe(0);
    expect(book.size).toBe(0);
  });

  it('容量上限按「最久未见」淘汰，留下活跃档案', () => {
    const book = new ProfileBook(2);
    book.touch(DEVICE, '早', NOW - 10_000);
    book.touch(OTHER, '晚', NOW);
    const third = 'ffeeddccbbaa0099';
    book.touch(third, '最新', NOW + 1_000);
    expect(book.size).toBe(2);
    expect(book.get(DEVICE)).toBeUndefined();
    expect(book.get(OTHER)).toBeDefined();
    expect(book.get(third)).toBeDefined();
  });

  it('赞与名次只在有档案时入账，名次只记前三', () => {
    const book = new ProfileBook(8);
    book.touch(DEVICE, '牛马', NOW);
    expect(book.addLike(DEVICE, NOW)).toBe(1);
    book.addRingMedal(DEVICE, 4, NOW);
    expect(book.get(DEVICE)?.bronze).toBe(0);
    book.addRingMedal(DEVICE, 3, NOW);
    expect(book.get(DEVICE)).toEqual({
      id: DEVICE,
      name: '牛马',
      likes: 1,
      gold: 0,
      silver: 0,
      bronze: 1,
      lastSeenAt: NOW,
    });
  });
});
