import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_PARK,
  PARK_ID_PATTERN,
  parseParkHealth,
  resolvePark,
  sanitizeParks,
  toHealthUrl,
  toWsUrl,
  type ParkEntry,
} from '../park';

const A: ParkEntry = { id: 'a', name: '一号园区', ws: '/ws', health: '/health' };
const B: ParkEntry = { id: 'b', name: '二号园区', ws: 'wss://b.test/ws', health: 'https://b.test/health' };

describe('sanitizeParks', () => {
  it('keeps well-formed entries in configuration order', () => {
    expect(sanitizeParks([A, B])).toEqual([A, B]);
  });

  it('drops ids that do not match the whitelist pattern', () => {
    const raw = [
      { id: 'A', name: '大写', ws: '/ws', health: '/health' },
      { id: '', name: '空', ws: '/ws', health: '/health' },
      { id: 'x'.repeat(33), name: '过长', ws: '/ws', health: '/health' },
      { id: 'has space', name: '空格', ws: '/ws', health: '/health' },
      { id: 42, name: '数字', ws: '/ws', health: '/health' },
      A,
    ];
    expect(sanitizeParks(raw)).toEqual([A]);
  });

  it('drops entries missing an endpoint so no card can be rendered for them', () => {
    const raw = [
      { id: 'no-ws', name: '缺 ws', health: '/health' },
      { id: 'no-health', name: '缺 health', ws: '/ws' },
      { id: 'blank', name: '空串', ws: '   ', health: '/health' },
    ];
    expect(sanitizeParks(raw)).toEqual([]);
  });

  it('keeps the first entry when two share an id', () => {
    const raw = [A, { ...B, id: 'a' }];
    expect(sanitizeParks(raw)).toEqual([A]);
  });

  it('falls back to the id when no name is given', () => {
    const parks = sanitizeParks([{ id: 'east', ws: '/ws', health: '/health' }]);
    expect(parks[0]!.name).toBe('east');
  });

  it('returns an empty list for garbage instead of throwing', () => {
    for (const raw of [null, undefined, 42, 'a', {}, []]) {
      expect(sanitizeParks(raw)).toEqual([]);
    }
  });
});

describe('resolvePark', () => {
  it('resolves a known id without falling back', () => {
    expect(resolvePark([A, B], 'b')).toEqual({ park: B, fallback: false });
  });

  it('falls back to the first park when the id is not in the whitelist', () => {
    expect(resolvePark([A, B], 'gone')).toEqual({ park: A, fallback: true });
  });

  it('treats an invalid id as "no preference" rather than a fallback', () => {
    for (const id of [null, undefined, '', 'A', 'wss://evil.test/ws']) {
      expect(resolvePark([A, B], id)).toEqual({ park: A, fallback: false });
    }
  });

  it('synthesises the single park when the list is empty', () => {
    expect(resolvePark([], 'b')).toEqual({ park: DEFAULT_PARK, fallback: true });
    expect(resolvePark([], null)).toEqual({ park: DEFAULT_PARK, fallback: false });
  });
});

describe('endpoint normalisation', () => {
  it('turns a relative path into the current origin', () => {
    expect(toWsUrl('/ws', 'https://niuma.test')).toBe('wss://niuma.test/ws');
    expect(toWsUrl('/ws', 'http://localhost:3000')).toBe('ws://localhost:3000/ws');
    expect(toHealthUrl('/health', 'https://niuma.test')).toBe('https://niuma.test/health');
    expect(toHealthUrl('/health', 'http://localhost:3000')).toBe('http://localhost:3000/health');
  });

  it('rewrites http(s) endpoints to ws(s) and back', () => {
    expect(toWsUrl('https://b.test/ws', 'https://niuma.test')).toBe('wss://b.test/ws');
    expect(toWsUrl('http://127.0.0.1:3001/ws', 'https://niuma.test')).toBe('ws://127.0.0.1:3001/ws');
    expect(toHealthUrl('wss://b.test/health', 'https://niuma.test')).toBe('https://b.test/health');
  });

  it('accepts protocol-relative endpoints so configs need not hardcode https', () => {
    expect(toWsUrl('//b.test/ws', 'https://niuma.test')).toBe('wss://b.test/ws');
    expect(toWsUrl('//b.test/ws', 'http://localhost:3000')).toBe('ws://b.test/ws');
  });

  it('leaves an already-correct wss endpoint untouched', () => {
    expect(toWsUrl('wss://b.test/ws', 'https://niuma.test')).toBe('wss://b.test/ws');
  });

  it('returns the raw string when it cannot be parsed, so config errors surface loudly', () => {
    expect(toWsUrl('http://[', 'https://niuma.test')).toBe('http://[');
  });
});

describe('parseParkHealth', () => {
  const body = {
    ok: true,
    parkId: 'b',
    parkName: '二号园区',
    online: 12,
    admission: {
      gateOpen: true,
      capacity: 60,
      queueLength: 3,
      utilizationPermille: 421,
    },
  };

  it('reads the fields the picker renders', () => {
    expect(parseParkHealth(body, 38)).toEqual({
      parkId: 'b',
      parkName: '二号园区',
      online: 12,
      capacity: 60,
      queued: 3,
      gateOpen: true,
      utilizationPermille: 421,
      rttMs: 38,
    });
  });

  it('defaults a closed gate and missing counters without failing the probe', () => {
    expect(parseParkHealth({ online: 0 }, 12)).toEqual({
      parkId: '',
      parkName: '',
      online: 0,
      capacity: 0,
      queued: 0,
      gateOpen: true,
      utilizationPermille: 0,
      rttMs: 12,
    });
    expect(parseParkHealth({ online: 5, admission: { gateOpen: false } }, 9)?.gateOpen).toBe(false);
  });

  it('rejects a response without a usable online count', () => {
    for (const raw of [null, 'x', 42, {}, { online: -1 }, { online: 'x' }, { online: Number.NaN }]) {
      expect(parseParkHealth(raw, 10)).toBeNull();
    }
  });

  it('keeps capacity at least equal to online when the server omits it', () => {
    expect(parseParkHealth({ online: 7 }, 10)?.capacity).toBe(7);
  });

  it('exposes the id pattern used by the whitelist, the inline script and nginx', () => {
    expect(PARK_ID_PATTERN.test('a')).toBe(true);
    expect(PARK_ID_PATTERN.test('park-02')).toBe(true);
    expect(PARK_ID_PATTERN.test('Park')).toBe(false);
    expect(PARK_ID_PATTERN.test('a/b')).toBe(false);
  });
});
