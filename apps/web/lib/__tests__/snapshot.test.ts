import { describe, expect, it } from 'bun:test';
import { DIRECTION, POSE } from '@niuma/shared-types';
import {
  SNAPSHOT_KEY,
  SNAPSHOT_VERSION,
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  toSnapshotPatch,
} from '../game/snapshot';
import type { StorageLike } from '../storage';

/** 浏览器 localStorage 的内存替身：Bun 运行时没有 Web Storage，只能注入 */
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

const HOME = { x: 1234.25, y: 678.5, direction: DIRECTION.Left, pose: POSE.Sit, seatId: 12 } as const;

describe('session snapshot', () => {
  it('returns null when the browser has nothing stored', () => {
    expect(loadSnapshot(memoryStorage())).toBeNull();
  });

  it('round-trips the resume fields the server needs', () => {
    const storage = memoryStorage();
    saveSnapshot(HOME, storage);

    const loaded = loadSnapshot(storage)!;
    expect(loaded.x).toBeCloseTo(HOME.x, 3);
    expect(loaded.y).toBeCloseTo(HOME.y, 3);
    expect(loaded.direction).toBe(HOME.direction);
    expect(loaded.pose).toBe(HOME.pose);
    expect(loaded.seatId).toBe(HOME.seatId);
    expect(loaded.v).toBe(SNAPSHOT_VERSION);
    expect(loaded.savedAt).toBeGreaterThan(0);
  });

  it('merges partial writes so a new field never wipes the position', () => {
    const storage = memoryStorage();
    saveSnapshot(HOME, storage);
    saveSnapshot({ seatId: 0 }, storage);

    const loaded = loadSnapshot(storage)!;
    expect(loaded.x).toBeCloseTo(HOME.x, 3);
    expect(loaded.seatId).toBe(0);
  });

  it('keeps fields written by modules this version does not know about', () => {
    const storage = memoryStorage();
    storage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ ...HOME, v: SNAPSHOT_VERSION, savedAt: 1, chatDraft: '摸鱼中' }),
    );

    const loaded = loadSnapshot(storage) as unknown as Record<string, unknown>;
    expect(loaded.chatDraft).toBe('摸鱼中');
  });

  it('drops a corrupt draft and clears the key instead of blocking entry', () => {
    const storage = memoryStorage();
    storage.setItem(SNAPSHOT_KEY, '{not json');

    expect(loadSnapshot(storage)).toBeNull();
    expect(storage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it('drops a snapshot whose version moved on', () => {
    const storage = memoryStorage();
    storage.setItem(SNAPSHOT_KEY, JSON.stringify({ ...HOME, v: 99, savedAt: 1 }));
    expect(loadSnapshot(storage)).toBeNull();
  });

  it('falls back to safe defaults for missing or hostile fields', () => {
    const storage = memoryStorage();
    storage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ v: SNAPSHOT_VERSION, savedAt: 1, x: 10, y: 20, direction: 99, pose: POSE.Walk, seatId: -3 }),
    );

    const loaded = loadSnapshot(storage)!;
    expect(loaded.direction).toBe(DIRECTION.Down);
    expect(loaded.pose).toBe(POSE.Idle);
    expect(loaded.seatId).toBe(0);
  });

  it('clears the snapshot on demand', () => {
    const storage = memoryStorage();
    saveSnapshot(HOME, storage);
    clearSnapshot(storage);
    expect(loadSnapshot(storage)).toBeNull();
  });

  it('never throws when the browser refuses to write', () => {
    const hostile: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    };
    expect(() => saveSnapshot(HOME, hostile)).not.toThrow();
  });

  it('ignores a non-finite position instead of teleporting into nowhere', () => {
    const storage = memoryStorage();
    storage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({ v: SNAPSHOT_VERSION, savedAt: 1, x: Number.NaN, y: 20, direction: 0, pose: 0, seatId: 0 }),
    );
    expect(loadSnapshot(storage)).toBeNull();
  });
});

describe('toSnapshotPatch', () => {
  it('normalises the transient walk pose before it reaches the disk', () => {
    const patch = toSnapshotPatch({
      x: 12.5,
      y: 34.5,
      direction: DIRECTION.Up,
      pose: POSE.Walk,
      seatId: 0,
    });
    expect(patch).toEqual({ x: 12.5, y: 34.5, direction: DIRECTION.Up, pose: POSE.Idle, seatId: 0 });
  });

  it('keeps the seat so the server can put the player back on the chair', () => {
    const patch = toSnapshotPatch({
      x: 1,
      y: 2,
      direction: DIRECTION.Left,
      pose: POSE.Sit,
      seatId: 7,
    });
    expect(patch.seatId).toBe(7);
    expect(patch.pose).toBe(POSE.Sit);
  });
});
