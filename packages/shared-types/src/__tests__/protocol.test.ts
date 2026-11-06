import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_BYTES,
  APPEARANCE_COLOR_KEYS,
  DIRECTION,
  LIMIT_KIND,
  MOVE_PACKET_BYTES,
  POSE,
  QUEUE_REJECT_BYTES,
  QUEUE_REJECT_REASON,
  QUEUE_STATUS_BYTES,
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
  encodeQueueRejected,
  encodeQueueStatus,
  encodeSpawn,
  encodeSync,
  decodeQueueRejected,
  decodeQueueStatus,
  normalizeColor,
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
    expect(() => decodeMove(new Uint8Array(7))).toThrow(/8 or 14 bytes/);
  });

  it('reuses the caller-owned object on the hot path', () => {
    const target = { id: 0, x: 0, y: 0, state: 0 };
    const result = decodeMove(encodeMove({ id: 7, x: 8, y: 16, state: 3 }), target);
    expect(result).toBe(target);
    expect(target).toEqual({ id: 7, x: 8, y: 16, state: 3 });
  });

  it('can encode and decode with clientSequence and clientTimestampMs', () => {
    // 使用一个 u32 可以表示的时间戳值
    const clientTimestampMs = 1699079559; // 低于 2^32
    const packet = { id: 42, x: 1234, y: 5678, state: 0b00100101, clientSequence: 12345, clientTimestampMs };
    const encoded = encodeMove(packet);
    expect(encoded.byteLength).toBe(14); // 8 base + 6 timing
    const decoded = decodeMove(encoded);
    expect(decoded.id).toBe(42);
    expect(decoded.x).toBe(1234);
    expect(decoded.y).toBe(5678);
    expect(decoded.state).toBe(0b00100101);
    expect(decoded.clientSequence).toBe(12345);
    expect(decoded.clientTimestampMs).toBe(clientTimestampMs);
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
  it('packs direction, pose and the four flags without collisions', () => {
    for (const direction of [DIRECTION.Down, DIRECTION.Left, DIRECTION.Right, DIRECTION.Up]) {
      for (const pose of [POSE.Idle, POSE.Walk, POSE.Sit, POSE.Lie]) {
        for (const moving of [false, true]) {
          for (const emote of [false, true]) {
            for (const jump of [false, true]) {
              for (const wave of [false, true]) {
                const state = packState(direction, pose, moving, emote, jump, wave);
                expect(state).toBeLessThanOrEqual(0xff);
                expect(unpackState(state)).toEqual({ direction, pose, moving, emote, jump, wave });
              }
            }
          }
        }
      }
    }
  });

  it('叫唤占 bit6、跳占 bit7、打招呼占 bit4：一次只置一位，互不吃掉', () => {
    expect(packState(DIRECTION.Down, POSE.Idle, false, true, false)).toBe(0b01000000);
    expect(packState(DIRECTION.Down, POSE.Idle, false, false, true)).toBe(0b10000000);
    // 打招呼复用 pose 字段的高位：姿态只有 2 bit，bit4 恒为 0
    expect(packState(DIRECTION.Down, POSE.Idle, false, false, false, true)).toBe(0b00010000);
    // 三位同时为真也只影响各自那一位，姿态与移动标志原样保留
    expect(unpackState(0b11010000 | packState(DIRECTION.Up, POSE.Sit, true))).toMatchObject({
      direction: DIRECTION.Up,
      pose: POSE.Sit,
      moving: true,
      emote: true,
      jump: true,
      wave: true,
    });
  });

  it('姿势只占 bit2-3：bit4 置位不会被读成 pose=4', () => {
    for (const pose of [POSE.Idle, POSE.Walk, POSE.Sit, POSE.Lie]) {
      const state = packState(DIRECTION.Left, pose, false, false, false, true);
      expect(unpackState(state).pose).toBe(pose);
      expect(unpackState(state).wave).toBe(true);
    }
  });

  it('derives a stable direction from the input vector', () => {
    expect(directionFromVector(0, 1, DIRECTION.Up)).toBe(DIRECTION.Down);
    expect(directionFromVector(-3, 1, DIRECTION.Down)).toBe(DIRECTION.Left);
    expect(directionFromVector(0, 0, DIRECTION.Up)).toBe(DIRECTION.Up);
  });
});

describe('appearance codec', () => {
  it('always encodes to 32 bytes', () => {
    expect(encodeAppearance(DEFAULT_APPEARANCE.cow).byteLength).toBe(APPEARANCE_BYTES);
    expect(encodeAppearance(DEFAULT_APPEARANCE.horse).byteLength).toBe(32);
  });

  it('keeps 11 independent colour slots on the wire', () => {
    expect(APPEARANCE_COLOR_KEYS.length).toBe(11);
    const colors = { ...DEFAULT_APPEARANCE.cow.colors };
    APPEARANCE_COLOR_KEYS.forEach((key, index) => {
      // 每槽取不同值，错位一格就会在下面往返时暴露
      colors[key] = (0x204060 + index * 0x0a0b0c) & 0xffffff;
    });
    const decoded = decodeAppearance(encodeAppearance({ ...DEFAULT_APPEARANCE.cow, colors }));
    const normalized = sanitizeAppearance({ ...DEFAULT_APPEARANCE.cow, colors });
    for (const key of APPEARANCE_COLOR_KEYS) {
      expect(decoded.colors[key]).toBe(normalized.colors[key]);
    }
  });

  it('rejects a legacy 20 byte buffer instead of reading past it', () => {
    expect(() => decodeAppearance(new Uint8Array(20))).toThrow();
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
      colors: { ...DEFAULT_APPEARANCE.cow.colors, body: 0xffffff, pattern: -1, hoof: 0x123456, eyes: 0 },
      parts: { patternId: 99, snoutId: -4, tailId: 88, hornId: 42 },
      cosmetics: { headwear: '<script>', eyewear: 'sun', neckwear: 'scarf', hairstyle: 'afro' },
    });
    expect(dirty.parts.patternId).toBeLessThan(3);
    expect(dirty.parts.tailId).toBeLessThan(2);
    expect(dirty.parts.hornId).toBeLessThan(4);
    expect(dirty.colors.pattern).toBe(0);
    expect(dirty.colors.hoof).toBe(normalizeColor(0x123456));
    expect(dirty.cosmetics.headwear).toBe('none');
    expect(dirty.cosmetics.eyewear).toBe('sun');
    expect(dirty.cosmetics.neckwear).toBe('scarf');
    expect(dirty.cosmetics.hairstyle).toBe('afro');
  });

  it('falls back to none when a cosmetic byte is past the end of its catalog', () => {
    const bytes = encodeAppearance(DEFAULT_APPEARANCE.cow);
    // 28 是眼镜槽、30 是发型槽（27 头饰 / 29 颈饰 / 31 保留）；越界必须回落 none 而不是抛错
    bytes[28] = 9;
    bytes[30] = 9;
    const decoded = decodeAppearance(bytes);
    expect(decoded.cosmetics.eyewear).toBe('none');
    expect(decoded.cosmetics.hairstyle).toBe('none');
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

describe('queue packets', () => {
  const status = {
    ticket: 0xdeadbeef,
    position: 37,
    length: 128,
    etaSec: 96,
    capacity: 60,
    dominant: LIMIT_KIND.Bandwidth,
    utilizationPermille: 923,
  } as const;

  it('is exactly 16 bytes and round-trips every field', () => {
    const packet = encodeQueueStatus(status);
    expect(packet.byteLength).toBe(QUEUE_STATUS_BYTES);
    expect(packet.byteLength).toBe(16);
    expect(decodeQueueStatus(packet)).toEqual(status);
  });

  it('clamps the utilization gauge into 0..1000 permille', () => {
    expect(decodeQueueStatus(encodeQueueStatus({ ...status, utilizationPermille: 4200 })).utilizationPermille).toBe(1000);
    expect(decodeQueueStatus(encodeQueueStatus({ ...status, utilizationPermille: -8 })).utilizationPermille).toBe(0);
    expect(decodeQueueStatus(encodeQueueStatus({ ...status, utilizationPermille: Number.NaN })).utilizationPermille).toBe(0);
  });

  it('rejects a truncated queue status instead of decoding garbage', () => {
    const packet = encodeQueueStatus(status);
    expect(() => decodeQueueStatus(packet.subarray(0, QUEUE_STATUS_BYTES - 1))).toThrow(/16 bytes/);
  });

  it('encodes the reject reason in 2 bytes and downgrades unknown reasons', () => {
    const full = encodeQueueRejected(QUEUE_REJECT_REASON.QueueFull);
    expect(full.byteLength).toBe(QUEUE_REJECT_BYTES);
    expect(decodeQueueRejected(full)).toEqual({ reason: QUEUE_REJECT_REASON.QueueFull });
    expect(decodeQueueRejected(encodeQueueRejected(QUEUE_REJECT_REASON.WaitTimeout))).toEqual({
      reason: QUEUE_REJECT_REASON.WaitTimeout,
    });
    expect(decodeQueueRejected(encodeQueueRejected(9))).toEqual({ reason: QUEUE_REJECT_REASON.QueueFull });
  });
});
