import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_BYTES,
  APPEARANCE_COLOR_KEYS,
  CHAT_REJECT_BYTES,
  CHAT_REJECT_REASON,
  DIRECTION,
  LIMIT_KIND,
  MOVE_PACKET_BYTES,
  POSE,
  QUEUE_REJECT_BYTES,
  QUEUE_REJECT_REASON,
  QUEUE_STATUS_BYTES,
  RESUME_BYTES,
  SYNC_ENTRY_BYTES,
  SYNC_HEADER_BYTES,
  DEFAULT_APPEARANCE,
  decodeAppearance,
  decodeAppearanceBroadcast,
  decodeChatBroadcast,
  decodeChatRejected,
  decodeDespawn,
  decodeHello,
  decodeMove,
  decodeSpawn,
  decodeSetStatus,
  decodeStatusBroadcast,
  decodeSync,
  decodeWelcome,
  dequantizeCoord,
  directionFromVector,
  encodeAppearance,
  encodeAppearanceBroadcast,
  encodeChatBroadcast,
  encodeChatRejected,
  encodeDespawn,
  encodeHello,
  encodeMove,
  encodeQueueRejected,
  encodeQueueStatus,
  encodeSpawn,
  encodeSpawnInto,
  encodeSetStatus,
  encodeStatusBroadcast,
  encodeSync,
  encodeWelcome,
  buildSpawnBody,
  readSync,
  truncateStatus,
  writeSyncEntry,
  writeSyncHeader,
  ByteWriter,
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

  /**
   * 逐条访问器是客户端唯一的热路径解析入口：它必须与 `decodeSync` 逐字节等价，
   * 否则服务端省下的分配会以「客户端少收一个实体」的形式还回来。
   */
  it('逐条访问器与 decodeSync 结果一致', () => {
    const entities = [
      { id: 65535, x: 0, y: 65535, state: 255 },
      { id: 7, x: 8191, y: 1, state: 0 },
      { id: 4242, x: 333, y: 444, state: 0b10101010 },
    ];
    const packet = encodeSync(7, entities);
    const seen: typeof entities = [];
    const count = readSync(packet, (id, x, y, state) => seen.push({ id, x, y, state }));

    expect(count).toBe(entities.length);
    expect(seen).toEqual(entities);
  });

  it('逐条访问器同样拒绝长度不符的包', () => {
    const packet = encodeSync(1, [{ id: 1, x: 2, y: 3, state: 4 }]);
    expect(() => readSync(packet.subarray(0, packet.byteLength - 1), () => {})).toThrow(/payload mismatch/);
  });

  it('标量写入与对象写入产出同一串字节', () => {
    const writer = new ByteWriter(64);
    writeSyncHeader(writer, 42, 2);
    writeSyncEntry(writer, 1, 10, 20, 4);
    writeSyncEntry(writer, 2, 30, 40, 5);
    const scalar = writer.finish();

    const expected = encodeSync(42, [
      { id: 1, x: 10, y: 20, state: 4 },
      { id: 2, x: 30, y: 40, state: 5 },
    ]);
    expect([...scalar]).toEqual([...expected]);
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

  /**
   * 入场补发改成「缓存不变部分 + 每次现写坐标」：两条路径必须产出完全一致的字节，
   * 否则老客户端会在新玩家入场时读错偏移。
   */
  it('缓存的 spawnBody 与整包编码产出同一串字节', () => {
    const name = '夜班实习生';
    const body = buildSpawnBody(name, DEFAULT_APPEARANCE.horse);

    const viaBody = new ByteWriter(128);
    encodeSpawnInto(viaBody, 9, 100, 200, 7, body);

    const direct = encodeSpawn({ id: 9, x: 100, y: 200, state: 7, name, appearance: DEFAULT_APPEARANCE.horse });
    expect([...viaBody.finish()]).toEqual([...direct]);
  });

  it('spawnBody 与坐标解耦：同一份 body 换坐标后位置跟着变', () => {
    const body = buildSpawnBody('牛', DEFAULT_APPEARANCE.cow);
    const writer = new ByteWriter(128);
    encodeSpawnInto(writer, 3, 11, 22, 0, body);
    const first = decodeSpawn(writer.finish());

    writer.reset();
    encodeSpawnInto(writer, 3, 99, 88, 0, body);
    const second = decodeSpawn(writer.finish());

    expect(first).toMatchObject({ x: 11, y: 22 });
    expect(second).toMatchObject({ x: 99, y: 88 });
  });

  it('carries online seconds in a trailing segment', () => {
    const decoded = decodeSpawn(
      encodeSpawn({
        id: 1,
        x: 10,
        y: 20,
        state: 0,
        name: '牛',
        appearance: DEFAULT_APPEARANCE.cow,
        onlineSec: 3725,
      }),
    );
    expect(decoded.onlineSec).toBe(3725);
  });

  it('reads status and online seconds from the same spawn packet', () => {
    const decoded = decodeSpawn(
      encodeSpawn({
        id: 2,
        x: 0,
        y: 0,
        state: 0,
        name: '牛',
        appearance: DEFAULT_APPEARANCE.cow,
        status: '摸鱼中',
        onlineSec: 90,
      }),
    );
    expect(decoded.status).toBe('摸鱼中');
    expect(decoded.onlineSec).toBe(90);
  });

  it('omits online seconds for an old server packet', () => {
    const decoded = decodeSpawn(
      encodeSpawn({ id: 3, x: 0, y: 0, state: 0, name: '牛', appearance: DEFAULT_APPEARANCE.cow }),
    );
    expect(decoded.onlineSec).toBeUndefined();
    expect(decoded.status).toBe('');
  });

  it('cached body + online seconds matches whole-packet encoding', () => {
    const name = '夜班实习生';
    const body = buildSpawnBody(name, DEFAULT_APPEARANCE.horse);
    const writer = new ByteWriter(128);
    encodeSpawnInto(writer, 9, 100, 200, 7, body, 61);
    const direct = encodeSpawn({
      id: 9,
      x: 100,
      y: 200,
      state: 7,
      name,
      appearance: DEFAULT_APPEARANCE.horse,
      onlineSec: 61,
    });
    expect([...writer.finish()]).toEqual([...direct]);
  });

  it('ignores a truncated online segment instead of reading past the buffer', () => {
    const packet = encodeSpawn({
      id: 4,
      x: 0,
      y: 0,
      state: 0,
      name: '牛',
      appearance: DEFAULT_APPEARANCE.cow,
      onlineSec: 7,
    }).slice();
    const decoded = decodeSpawn(packet.subarray(0, packet.byteLength - 2));
    expect(decoded.onlineSec).toBeUndefined();
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

describe('chat rejected', () => {
  it('encodes the reject reason in 2 bytes', () => {
    const packet = encodeChatRejected(CHAT_REJECT_REASON.Political);
    expect(packet.byteLength).toBe(CHAT_REJECT_BYTES);
    expect(decodeChatRejected(packet)).toEqual({ reason: CHAT_REJECT_REASON.Political });
    expect(decodeChatRejected(encodeChatRejected(CHAT_REJECT_REASON.RateLimited))).toEqual({
      reason: CHAT_REJECT_REASON.RateLimited,
    });
  });

  it('keeps unknown reasons raw so the client can show a generic hint', () => {
    expect(decodeChatRejected(encodeChatRejected(7))).toEqual({ reason: 7 });
  });

  it('rejects a wrong-length packet instead of decoding garbage', () => {
    expect(() => decodeChatRejected(new Uint8Array([0x1a]))).toThrow(/2 bytes/);
  });
});

describe('resume segment', () => {
  const resume = {
    x: 1234.25,
    y: 678.5,
    direction: DIRECTION.Left,
    pose: POSE.Sit,
    seatId: 12,
  } as const;

  it('round-trips the optional resume segment on hello', () => {
    const decoded = decodeHello(encodeHello('夜班实习生', DEFAULT_APPEARANCE.cow, resume));
    expect(decoded.resume).toBeDefined();
    expect(decoded.resume!.x).toBeCloseTo(resume.x, 3);
    expect(decoded.resume!.y).toBeCloseTo(resume.y, 3);
    expect(decoded.resume!.direction).toBe(resume.direction);
    expect(decoded.resume!.pose).toBe(resume.pose);
    expect(decoded.resume!.seatId).toBe(resume.seatId);
  });

  it('keeps the legacy hello at its original length when no resume is sent', () => {
    const legacyLength = 2 + new TextEncoder().encode('牛').length + APPEARANCE_BYTES;
    expect(encodeHello('牛', DEFAULT_APPEARANCE.cow).byteLength).toBe(legacyLength);
    expect(decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow)).resume).toBeUndefined();
  });

  it('ignores a truncated resume segment instead of reading past the buffer', () => {
    const packet = encodeHello('牛', DEFAULT_APPEARANCE.cow, resume);
    const truncated = packet.subarray(0, packet.byteLength - 3);
    expect(decodeHello(truncated).resume).toBeUndefined();
  });

  it('ignores an unknown resume version so a newer client cannot corrupt the spawn', () => {
    const packet = encodeHello('牛', DEFAULT_APPEARANCE.cow, resume).slice();
    packet[packet.byteLength - RESUME_BYTES] = 9;
    expect(decodeHello(packet).resume).toBeUndefined();
  });

  it('clamps out-of-world resume coordinates instead of trusting the client', () => {
    const decoded = decodeHello(
      encodeHello('牛', DEFAULT_APPEARANCE.cow, { ...resume, x: -100, y: 1e9 }),
    );
    expect(decoded.resume!.x).toBe(0);
    expect(decoded.resume!.y).toBeCloseTo(dequantizeCoord(quantizeCoord(1e9)), 3);
  });
});

describe('welcome packet', () => {
  it('carries the authoritative state byte', () => {
    const state = packState(DIRECTION.Left, POSE.Sit, false);
    const decoded = decodeWelcome(
      encodeWelcome({ entityId: 7, tick: 99, x: 100, y: 200, state }),
    );
    expect(decoded).toEqual({ entityId: 7, tick: 99, x: 100, y: 200, state });
  });

  it('accepts a legacy 11 byte welcome and falls back to the default state', () => {
    const legacy = encodeWelcome({ entityId: 7, tick: 99, x: 100, y: 200, state: 0 }).subarray(0, 11);
    expect(decodeWelcome(legacy)).toEqual({ entityId: 7, tick: 99, x: 100, y: 200, state: 0 });
  });
});

describe('status label', () => {
  it('钳到 16 显示宽：8 个汉字、16 个 ASCII、8 个 emoji 都刚好放得下', () => {
    expect(truncateStatus('一二三四五六七八')).toBe('一二三四五六七八');
    expect(truncateStatus('一二三四五六七八九')).toBe('一二三四五六七八');
    expect(truncateStatus('a'.repeat(16))).toBe('a'.repeat(16));
    expect(truncateStatus('a'.repeat(17))).toBe('a'.repeat(16));
    expect(truncateStatus('🐟'.repeat(8))).toBe('🐟'.repeat(8));
    expect(truncateStatus('🐟'.repeat(9))).toBe('🐟'.repeat(8));
    // 混排按显示宽算：两个「3 汉字 + 1 emoji」正好 16 宽，再来一个汉字就超了
    expect(truncateStatus('摸鱼中🐟')).toBe('摸鱼中🐟');
    expect(truncateStatus('摸鱼中🐟摸鱼中🐟')).toBe('摸鱼中🐟摸鱼中🐟');
    expect(truncateStatus('摸鱼中🐟摸鱼中🐟摸')).toBe('摸鱼中🐟摸鱼中🐟');
  });

  it('把控制字符压成空格并去掉首尾空白，空输入就是「没有状态」', () => {
    expect(truncateStatus('  开会\u0007中  ')).toBe('开会 中');
    expect(truncateStatus('   ')).toBe('');
    expect(truncateStatus('')).toBe('');
    expect(truncateStatus(undefined)).toBe('');
    expect(truncateStatus(null)).toBe('');
  });

  it('spawn 带上状态后仍能原样解出，且不破坏旧包长度', () => {
    const legacyBody = buildSpawnBody('夜班实习生', DEFAULT_APPEARANCE.cow);
    const statusBody = buildSpawnBody('夜班实习生', DEFAULT_APPEARANCE.cow, '摸鱼中🐟');
    const statusBytes = new TextEncoder().encode('摸鱼中🐟').length;
    expect(statusBody.byteLength).toBe(legacyBody.byteLength + 1 + statusBytes);

    const writer = new ByteWriter(256);
    encodeSpawnInto(writer, 9, 100, 200, 7, statusBody);
    expect(decodeSpawn(writer.finish())).toMatchObject({ id: 9, status: '摸鱼中🐟' });

    writer.reset();
    encodeSpawnInto(writer, 9, 100, 200, 7, legacyBody);
    expect(decodeSpawn(writer.finish()).status).toBe('');
  });

  it('hello 同时带 resume 与状态时两段互不串位', () => {
    const resume = { x: 1234.25, y: 678.5, direction: DIRECTION.Left, pose: POSE.Sit, seatId: 12 } as const;
    const decoded = decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow, resume, '加班中☕'));
    expect(decoded.status).toBe('加班中☕');
    expect(decoded.resume).toMatchObject({ direction: DIRECTION.Left, pose: POSE.Sit, seatId: 12 });
  });

  it('只有状态没有 resume 时，0xff 魔数不会被误读成 resume 版本', () => {
    const decoded = decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow, undefined, '请勿打扰'));
    expect(decoded.status).toBe('请勿打扰');
    expect(decoded.resume).toBeUndefined();
  });

  it('空状态不占字节：HELLO 与旧版逐字节一致', () => {
    const legacyLength = 2 + new TextEncoder().encode('牛').length + APPEARANCE_BYTES;
    expect(encodeHello('牛', DEFAULT_APPEARANCE.cow).byteLength).toBe(legacyLength);
    expect(encodeHello('牛', DEFAULT_APPEARANCE.cow, undefined, '   ').byteLength).toBe(legacyLength);
    expect(decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow)).status).toBe('');
  });

  it('状态段被截断时回退空串，不读包外字节', () => {
    const packet = encodeHello('牛', DEFAULT_APPEARANCE.cow, undefined, '加班中');
    // 砍掉最后 1 字节：长度字段还在，内容少一字节
    expect(decodeHello(packet.subarray(0, packet.byteLength - 1)).status).toBe('');
  });

  it('set status 与广播包都能往返，畸形长度按清除处理', () => {
    const text = '摸鱼中🐟';
    expect(decodeSetStatus(encodeSetStatus(text))).toBe(text);

    const broadcast = encodeStatusBroadcast(88, text);
    expect(decodeStatusBroadcast(broadcast)).toEqual({ entityId: 88, status: text });

    // 伪造长度 255：与剩余字节不符，直接当作没设置，既不抛错也不越界
    const forged = encodeSetStatus(text).slice();
    forged[1] = 0xff;
    forged[2] = 0x00;
    expect(decodeSetStatus(forged)).toBe('');

    const forgedBroadcast = encodeStatusBroadcast(88, text).slice();
    forgedBroadcast[3] = 0xff;
    forgedBroadcast[4] = 0xff;
    expect(decodeStatusBroadcast(forgedBroadcast)).toEqual({ entityId: 88, status: '' });
  });

  it('清除状态就是发空串，服务端收到的是空状态而不是兜底文案', () => {
    expect(decodeSetStatus(encodeSetStatus(''))).toBe('');
    expect(decodeStatusBroadcast(encodeStatusBroadcast(1, '')).status).toBe('');
  });
});
