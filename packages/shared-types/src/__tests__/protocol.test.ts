import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_BYTES,
  DIRECTION,
  MOVE_PACKET_BYTES,
  POSE,
  SYNC_ENTRY_BYTES,
  SYNC_HEADER_BYTES,
  DEFAULT_APPEARANCE,
  decodeAppearance,
  decodeAppearanceBroadcast,
  decodeChatBroadcast,
  decodeDespawn,
  decodeHello,
  decodeMove,
  decodeSpawn,
  decodeSync,
  dequantizeCoord,
  directionFromVector,
  encodeAppearance,
  encodeAppearanceBroadcast,
  encodeChatBroadcast,
  encodeDespawn,
  encodeHello,
  encodeMove,
  encodeSpawn,
  encodeSync,
  packState,
  quantizeCoord,
  sanitizeAppearance,
  unpackState,
} from '../index';

describe('move packet', () => {
  it('is exactly 8 bytes', () => {
    const packet = encodeMove({ id: 42, x: 1234, y: 5678, state: 0b00100101 });
    expect(packet.byteLength).toBe(MOVE_PACKET_BYTES);
    expect(packet.byteLength).toBe(8);
  });

  it('round-trips every field', () => {
    const decoded = decodeMove(encodeMove({ id: 65535, x: 0, y: 65535, state: 255 }));
    expect(decoded).toEqual({ id: 65535, x: 0, y: 65535, state: 255 });
  });

  it('rejects a truncated packet instead of silently decoding', () => {
    expect(() => decodeMove(new Uint8Array(7))).toThrow(/8 bytes/);
  });

  it('reuses the caller-owned object on the hot path', () => {
    const target = { id: 0, x: 0, y: 0, state: 0 };
    const result = decodeMove(encodeMove({ id: 7, x: 8, y: 16, state: 3 }), target);
    expect(result).toBe(target);
    expect(target).toEqual({ id: 7, x: 8, y: 16, state: 3 });
  });
});

describe('fixed point quantization', () => {
  it('keeps 1/8 px precision within half a step', () => {
    for (const value of [0, 0.4, 12.34, 4096.99, 8191.5]) {
      const round = dequantizeCoord(quantizeCoord(value));
      expect(Math.abs(round - value)).toBeLessThanOrEqual(1 / 16);
    }
  });

  it('clamps out of world coordinates', () => {
    expect(quantizeCoord(-500)).toBe(0);
    expect(quantizeCoord(Number.NaN)).toBe(0);
    expect(quantizeCoord(999999)).toBe(65535);
    expect(dequantizeCoord(65535)).toBeCloseTo(8191.875, 3);
  });
});

describe('state byte', () => {
  it('packs direction, pose and moving flag without collisions', () => {
    for (const direction of [DIRECTION.Down, DIRECTION.Left, DIRECTION.Right, DIRECTION.Up]) {
      for (const pose of [POSE.Idle, POSE.Walk, POSE.Sit, POSE.Lie, POSE.Emote]) {
        for (const moving of [false, true]) {
          const state = packState(direction, pose, moving);
          expect(unpackState(state)).toEqual({ direction, pose, moving });
        }
      }
    }
  });

  it('derives a stable direction from the input vector', () => {
    expect(directionFromVector(0, 1, DIRECTION.Up)).toBe(DIRECTION.Down);
    expect(directionFromVector(-3, 1, DIRECTION.Down)).toBe(DIRECTION.Left);
    expect(directionFromVector(0, 0, DIRECTION.Up)).toBe(DIRECTION.Up);
  });
});

describe('appearance codec', () => {
  it('always encodes to 20 bytes', () => {
    expect(encodeAppearance(DEFAULT_APPEARANCE.cow).byteLength).toBe(APPEARANCE_BYTES);
    expect(encodeAppearance(DEFAULT_APPEARANCE.horse).byteLength).toBe(20);
  });

  it('round-trips both species losslessly in 565 space', () => {
    for (const species of ['cow', 'horse'] as const) {
      const source = sanitizeAppearance(DEFAULT_APPEARANCE[species]);
      expect(decodeAppearance(encodeAppearance(source))).toEqual(source);
    }
  });

  it('drops unknown cosmetics and out-of-range parts instead of trusting the client', () => {
    const dirty = sanitizeAppearance({
      species: 'cow',
      colors: { body: 0xffffff, pattern: -1, hoof: 0x123456, eyes: 0, extra: 0 },
      parts: { patternId: 99, snoutId: -4, tailId: 88, hornId: 42 },
      cosmetics: { headwear: '<script>', eyewear: 'sun', neckwear: 'scarf', backItem: 'briefcase' },
    });
    expect(dirty.parts.patternId).toBeLessThan(3);
    expect(dirty.parts.tailId).toBeLessThan(2);
    expect(dirty.parts.hornId).toBeLessThan(4);
    expect(dirty.cosmetics.headwear).toBe('none');
    expect(dirty.cosmetics.eyewear).toBe('sun');
    expect(dirty.cosmetics.neckwear).toBe('scarf');
  });

  it('falls back to none when a cosmetic byte is past the end of its catalog', () => {
    const bytes = encodeAppearance(DEFAULT_APPEARANCE.cow);
    // 16 是眼镜槽：旧协议里这一格是领带（0-4），4 在新目录里已越界，必须回落 none 而不是抛错
    bytes[16] = 4;
    expect(decodeAppearance(bytes).cosmetics.eyewear).toBe('none');
  });

  it('keeps local preview identical to the wire colour', () => {
    const appearance = sanitizeAppearance({
      ...DEFAULT_APPEARANCE.cow,
      colors: { ...DEFAULT_APPEARANCE.cow.colors, body: 0x4fe3c1 },
    });
    const decoded = decodeAppearance(encodeAppearance(appearance));
    expect(decoded.colors.body).toBe(appearance.colors.body);
  });
});

describe('sync packet', () => {
  it('uses a 7 byte header plus 7 bytes per entity', () => {
    const entities = [
      { id: 1, x: 10, y: 20, state: 4 },
      { id: 2, x: 30, y: 40, state: 5 },
      { id: 3, x: 50, y: 60, state: 6 },
    ];
    const packet = encodeSync(99, entities);
    expect(packet.byteLength).toBe(SYNC_HEADER_BYTES + entities.length * SYNC_ENTRY_BYTES);
    expect(decodeSync(packet)).toEqual({ tick: 99, entities });
  });

  it('rejects a payload whose count does not match its length', () => {
    const packet = encodeSync(1, [{ id: 1, x: 2, y: 3, state: 4 }]);
    expect(() => decodeSync(packet.subarray(0, packet.byteLength - 1))).toThrow(/payload mismatch/);
  });
});

describe('spawn / despawn / chat / hello', () => {
  it('carries name and appearance through a spawn packet', () => {
    const packet = encodeSpawn({
      id: 9,
      x: 100,
      y: 200,
      state: 7,
      name: '牛马实习生',
      appearance: DEFAULT_APPEARANCE.horse,
    });
    const decoded = decodeSpawn(packet);
    expect(decoded.id).toBe(9);
    expect(decoded.name).toBe('牛马实习生');
    expect(decoded.appearance.species).toBe('horse');
    expect(decoded.appearance.colors.body).toBe(sanitizeAppearance(DEFAULT_APPEARANCE.horse).colors.body);
  });

  it('round-trips despawn reason', () => {
    expect(decodeDespawn(encodeDespawn(12, 3))).toEqual({ id: 12, reason: 3 });
  });

  it('keeps multi-byte chat intact', () => {
    const packet = encodeChatBroadcast({ entityId: 3, msgId: 512, text: '摸鱼中 🐟 别卷了' });
    expect(decodeChatBroadcast(packet)).toEqual({ entityId: 3, msgId: 512, text: '摸鱼中 🐟 别卷了' });
  });

  it('routes hello through appearance validation', () => {
    const hello = decodeHello(encodeHello('  实习生<7>号  ', DEFAULT_APPEARANCE.cow));
    expect(hello.name).toBe('实习生<7>号');
    expect(hello.appearance.species).toBe('cow');
    expect(decodeHello(encodeHello('', DEFAULT_APPEARANCE.cow)).name.length).toBeGreaterThan(0);
  });

  it('broadcasts appearance updates for a single entity', () => {
    const packet = encodeAppearanceBroadcast(77, DEFAULT_APPEARANCE.cow);
    const decoded = decodeAppearanceBroadcast(packet);
    expect(decoded.entityId).toBe(77);
    expect(decoded.appearance.species).toBe('cow');
  });
});
