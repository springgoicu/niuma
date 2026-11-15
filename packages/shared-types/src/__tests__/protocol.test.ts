import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_BYTES,
  APPEARANCE_COLOR_KEYS,
  BOSS_FLAG_DIED,
  BOSS_FLAG_RESET,
  BOSS_MAX_HP,
  BOSS_PACKET_BYTES,
  CAREER_EXTENSION_MAGIC,
  CAREER_FIXED_BYTES,
  CAREER_MAX_BYTES,
  CHAT_HISTORY_FLAG,
  CHAT_HISTORY_MAX_PAGE,
  CHAT_HISTORY_PACKET_BUDGET,
  CHAT_REJECT_BYTES,
  CHAT_REJECT_REASON,
  DANMAKU_COLOR_COUNT,
  DANMAKU_META_BYTES,
  DANMAKU_MODE,
  DEVICE_EXTENSION_BYTES,
  DEVICE_EXTENSION_MAGIC,
  DIRECTION,
  ENTITY_ROLE_GUARD,
  LIMIT_KIND,
  MOVE_PACKET_BYTES,
  PONG_CLOCK_BYTES,
  POSE,
  QUEUE_REJECT_BYTES,
  QUEUE_REJECT_REASON,
  QUEUE_STATUS_BYTES,
  RESUME_BYTES,
  SYNC_ENTRY_BYTES,
  SYNC_ENTRY_BYTES_COMPACT,
  SYNC_FORMAT_COMPACT,
  SYNC_FORMAT_LEGACY,
  SYNC_HEADER_BYTES,
  VENT_PACKET_BYTES,
  RING_PHASE,
  JAIL_PACKET_BYTES,
  JAIL_PHASE,
  RING_VENT_FLAG_ELIMINATED,
  RING_VENT_FLAG_HIT,
  VENT_PACKET_WITH_FLAGS_BYTES,
  DEFAULT_APPEARANCE,
  decodeAppearance,
  decodeAppearanceBroadcast,
  decodeBoss,
  decodeCareer,
  decodeCareerBroadcast,
  decodeCareerReport,
  decodeChatBroadcast,
  decodeChatHistory,
  decodeChatSend,
  decodeChatHistoryRequest,
  decodeChatRejected,
  decodeDespawn,
  decodeHello,
  decodeJail,
  decodeMove,
  decodeNameBroadcast,
  decodePong,
  decodePongClock,
  decodeSpawn,
  decodeSetName,
  decodeSetStatus,
  decodeStatusBroadcast,
  decodeSystemNotice,
  decodeSync,
  decodeRing,
  decodeVent,
  decodeWelcome,
  dequantizeCoord,
  directionFromVector,
  encodeAppearance,
  encodeAppearanceBroadcast,
  encodeBoss,
  encodeChatBroadcast,
  encodeChatHistory,
  encodeChatHistoryRequest,
  encodeChatSend,
  encodeCareer,
  encodeCareerBroadcast,
  encodeCareerReport,
  encodeCareerSegment,
  encodeChatRejected,
  encodeDespawn,
  encodeHello,
  encodeJail,
  encodeMove,
  encodeNameBroadcast,
  encodePong,
  encodeQueueRejected,
  encodeQueueStatus,
  encodeSpawn,
  encodeRing,
  encodeSpawnInto,
  encodeSetName,
  encodeSetStatus,
  encodeStatusBroadcast,
  encodeSync,
  encodeSystemNotice,
  encodeVent,
  encodeWelcome,
  buildSpawnBody,
  readSync,
  readSyncTick,
  truncateName,
  truncateStatus,
  writeSyncEntry,
  writeSyncHeader,
  ByteWriter,
  OpCode,
  decodeQueueRejected,
  decodeQueueStatus,
  normalizeColor,
  normalizeDanmakuColor,
  normalizeDanmakuMode,
  packState,
  quantizeCoord,
  sanitizeAppearance,
  sanitizeEconomyProfile,
  isDeviceId,
  unpackState,
  SYSTEM_NOTICE_KIND,
  formatSystemNotice,
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

  it('发泄位不改变包长：state 无论置哪一位都还是 8 字节', () => {
    // bit6 换语义（ADR-0051）的前提就是「包长零变化」，这条是那份验收线的机器化
    const silent = encodeMove({ id: 7, x: 100, y: 200, state: packState(DIRECTION.Down, POSE.Idle, false) });
    const venting = encodeMove({
      id: 7,
      x: 100,
      y: 200,
      state: packState(DIRECTION.Down, POSE.Idle, false, true),
    });
    expect(venting.byteLength).toBe(silent.byteLength);
    expect(venting.byteLength).toBe(8);
    expect(unpackState(decodeMove(venting).state).vent).toBe(true);
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
          for (const vent of [false, true]) {
            for (const jump of [false, true]) {
              for (const wave of [false, true]) {
                const state = packState(direction, pose, moving, vent, jump, wave);
                expect(state).toBeLessThanOrEqual(0xff);
                expect(unpackState(state)).toEqual({ direction, pose, moving, vent, jump, wave });
              }
            }
          }
        }
      }
    }
  });

  it('发泄占 bit6、跳占 bit7、打招呼占 bit4：一次只置一位，互不吃掉', () => {
    expect(packState(DIRECTION.Down, POSE.Idle, false, true, false)).toBe(0b01000000);
    expect(packState(DIRECTION.Down, POSE.Idle, false, false, true)).toBe(0b10000000);
    // 打招呼复用 pose 字段的高位：姿态只有 2 bit，bit4 恒为 0
    expect(packState(DIRECTION.Down, POSE.Idle, false, false, false, true)).toBe(0b00010000);
    // 三位同时为真也只影响各自那一位，姿态与移动标志原样保留
    expect(unpackState(0b11010000 | packState(DIRECTION.Up, POSE.Sit, true))).toMatchObject({
      direction: DIRECTION.Up,
      pose: POSE.Sit,
      moving: true,
      vent: true,
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

  it('readSyncTick 与包头 tick 一致；空包也能读', () => {
    expect(readSyncTick(encodeSync(0x01020304, []))).toBe(0x01020304);
    expect(readSyncTick(encodeSync(7, [{ id: 1, x: 2, y: 3, state: 4 }]))).toBe(7);
  });

  it('readSyncTick 拒绝错误 opcode 与截断的包头', () => {
    expect(() => readSyncTick(encodeDespawn(1))).toThrow(/sync packet/);
    expect(() => readSyncTick(encodeSync(1, []).subarray(0, 4))).toThrow(/too short/);
  });
});

describe('发泄结算包', () => {
  it('9 字节定长，round-trip 出招者 / 受害者 / 权威坐标', () => {
    const packet = encodeVent(513, 258, 1234, 5678);
    expect(packet.byteLength).toBe(VENT_PACKET_BYTES);
    expect(packet.byteLength).toBe(9);
    expect(packet[0]).toBe(OpCode.S2C_VENT);
    expect(decodeVent(packet)).toEqual({ attackerId: 513, targetId: 258, x: 1234, y: 5678 });
  });

  it('空放：targetId = 0，坐标仍然可解（调用方不看）', () => {
    expect(decodeVent(encodeVent(7, 0, 0, 0))).toEqual({ attackerId: 7, targetId: 0, x: 0, y: 0 });
  });

  it('擂台命中追加 flags，普通命中仍保持 9 字节', () => {
    const plain = encodeVent(7, 8, 100, 200);
    expect(plain.byteLength).toBe(VENT_PACKET_BYTES);

    const ring = encodeVent(7, 8, 100, 200, RING_VENT_FLAG_HIT | RING_VENT_FLAG_ELIMINATED);
    expect(ring.byteLength).toBe(VENT_PACKET_WITH_FLAGS_BYTES);
    expect(decodeVent(ring)).toEqual({
      attackerId: 7,
      targetId: 8,
      x: 100,
      y: 200,
      ringHit: true,
      eliminated: true,
    });
  });

  it('拒绝错误 opcode 与错误长度', () => {
    expect(() => decodeVent(encodeDespawn(1))).toThrow(/must be 9 or 10 bytes/);
    expect(() => decodeVent(encodeVent(1, 1, 1, 1).subarray(0, 8))).toThrow(/must be 9 or 10 bytes/);
  });
});

describe('擂台快照包', () => {
  it('round-trip 阶段、对局、剩余时间与三个席位', () => {
    const packet = encodeRing({
      phase: RING_PHASE.Award,
      matchId: 7,
      remainingMs: 0,
      members: [
        { id: 1, name: '甲', hp: 6, eliminated: false, rank: 1 },
        { id: 2, name: '乙', hp: 0, eliminated: true, rank: 2 },
        { id: 3, name: '丙', hp: 0, eliminated: true, rank: 3 },
      ],
    });
    expect(packet[0]).toBe(OpCode.S2C_RING);
    expect(decodeRing(packet)).toEqual({
      phase: RING_PHASE.Award,
      matchId: 7,
      remainingMs: 0,
      members: [
        { id: 1, slot: 0, name: '甲', hp: 6, eliminated: false, rank: 1 },
        { id: 2, slot: 1, name: '乙', hp: 0, eliminated: true, rank: 2 },
        { id: 3, slot: 2, name: '丙', hp: 0, eliminated: true, rank: 3 },
      ],
    });
  });

  it('空擂台只有 9 字节头部', () => {
    expect(encodeRing({ phase: RING_PHASE.Idle, matchId: 0, remainingMs: 0, members: [] }).byteLength).toBe(9);
  });

  it('拒绝超容量、非法阶段与截断名字', () => {
    expect(() =>
      encodeRing({
        phase: RING_PHASE.Running,
        matchId: 1,
        remainingMs: 1,
        members: Array.from({ length: 4 }, (_, i) => ({
          id: i + 1,
          name: '牛',
          hp: 10,
          eliminated: false,
          rank: 0,
        })),
      }),
    ).toThrow(/supports 3 members/);

    const packet = encodeRing({
      phase: RING_PHASE.Running,
      matchId: 1,
      remainingMs: 1,
      members: [{ id: 1, name: '牛', hp: 10, eliminated: false, rank: 0 }],
    });
    const badPhase = packet.slice();
    badPhase[1] = 9;
    expect(() => decodeRing(badPhase)).toThrow(/phase out of range/);
    expect(() => decodeRing(packet.subarray(0, packet.byteLength - 2))).toThrow(/name length out of range/);
  });
});

describe('小黑屋处置包', () => {
  it('9 字节定长，五个阶段都能 round-trip', () => {
    const packet = encodeJail({
      entityId: 42,
      phase: JAIL_PHASE.Escort,
      self: true,
      seconds: 25,
      guardId: 3,
    });
    expect(packet.byteLength).toBe(JAIL_PACKET_BYTES);
    expect(packet.byteLength).toBe(9);
    expect(packet[0]).toBe(OpCode.S2C_JAIL);
    expect(decodeJail(packet)).toEqual({
      entityId: 42,
      phase: JAIL_PHASE.Escort,
      self: true,
      seconds: 25,
      guardId: 3,
    });
    for (const phase of Object.values(JAIL_PHASE)) {
      expect(decodeJail(encodeJail({ entityId: 7, phase, self: false, seconds: 0, guardId: 0 }).slice())).toEqual({
        entityId: 7,
        phase,
        self: false,
        seconds: 0,
        guardId: 0,
      });
    }
  });

  it('拒绝越界阶段、错误长度与错误 opcode', () => {
    expect(() => encodeJail({ entityId: 1, phase: 0, self: true, seconds: 0, guardId: 0 })).toThrow(
      /phase out of range/,
    );
    expect(() => encodeJail({ entityId: 1, phase: 9, self: true, seconds: 0, guardId: 0 })).toThrow(
      /phase out of range/,
    );
    const badPhase = encodeJail({ entityId: 1, phase: JAIL_PHASE.Warn, self: true, seconds: 0, guardId: 0 }).slice();
    badPhase[3] = 9;
    expect(() => decodeJail(badPhase)).toThrow(/phase out of range/);
    expect(() => decodeJail(new Uint8Array(8))).toThrow(/must be 9 bytes/);
  });
});

describe('发泄区老板血量包', () => {
  it('6 字节定长，round-trip 血量 / 出招者 / 状态位', () => {
    const packet = encodeBoss({ hp: 9500, attackerId: 513, died: false, reset: false });
    expect(packet.byteLength).toBe(BOSS_PACKET_BYTES);
    expect(packet.byteLength).toBe(6);
    expect(packet[0]).toBe(OpCode.S2C_BOSS);
    expect(decodeBoss(packet)).toEqual({ hp: 9500, attackerId: 513, died: false, reset: false });
  });

  it('归零与跨日重置各占一位，可同时出现', () => {
    expect(decodeBoss(encodeBoss({ hp: 0, attackerId: 7, died: true, reset: false }))).toEqual({
      hp: 0,
      attackerId: 7,
      died: true,
      reset: false,
    });
    expect(decodeBoss(encodeBoss({ hp: BOSS_MAX_HP, attackerId: 0, died: false, reset: true }))).toEqual({
      hp: BOSS_MAX_HP,
      attackerId: 0,
      died: false,
      reset: true,
    });
    expect(
      decodeBoss(encodeBoss({ hp: 0, attackerId: 0, died: true, reset: true })),
    ).toEqual({ hp: 0, attackerId: 0, died: true, reset: true });
  });

  it('解码端把越界血量夹回 0..10000', () => {
    // 坏包 / 旧服务端都可能写超上界；渲染层不应拿到 65535
    expect(decodeBoss(encodeBoss({ hp: 65535, attackerId: 1, died: false, reset: false })).hp).toBe(
      BOSS_MAX_HP,
    );
    expect(decodeBoss(encodeBoss({ hp: 0, attackerId: 1, died: false, reset: false })).hp).toBe(0);
  });

  it('拒绝错误 opcode 与错误长度', () => {
    expect(() => decodeBoss(encodeDespawn(1))).toThrow(/must be 6 bytes/);
    expect(() => decodeBoss(encodeVent(1, 1, 1, 1))).toThrow(/must be 6 bytes/);
    expect(() => decodeBoss(encodeBoss({ hp: 1, attackerId: 1, died: false, reset: false }).subarray(0, 5))).toThrow(
      /must be 6 bytes/,
    );
  });

  it('flags 只认低两位，未知位不改变语义', () => {
    const packet = new Uint8Array([OpCode.S2C_BOSS, 0xd2, 0x04, 0x02, 0x00, 0xf0]);
    const decoded = decodeBoss(packet);
    expect(decoded).toEqual({ hp: 1234, attackerId: 2, died: false, reset: false });
    expect(BOSS_FLAG_DIED).toBe(1);
    expect(BOSS_FLAG_RESET).toBe(2);
  });
});

describe('compact sync entry', () => {
  it('packs id 10bit + x/y 各 15bit(1/4px) + state 8bit 到 6 字节', () => {
    // id=1, x=8(1px), y=16(2px), state=0x25
    const packet = encodeSync(0, [{ id: 1, x: 8, y: 16, state: 0x25 }], SYNC_FORMAT_COMPACT);
    expect(packet.byteLength).toBe(SYNC_HEADER_BYTES + SYNC_ENTRY_BYTES_COMPACT);
    expect([...packet]).toEqual([
      OpCode.S2C_SYNC_ENTITIES,
      0, 0, 0, 0, // tick
      1, 0, // count
      1, // id 低 8 位
      16, // id 高位 2bit | x 低 6bit << 2
      0, // x 中 8bit
      16, // x 最高 1bit | y 低 7bit << 1
      0, // y 高 8bit
      0x25, // state
    ]);
  });

  it('round-trips the whole id / coordinate / state range', () => {
    const entities = [
      { id: 1023, x: 65534, y: 65534, state: 255 },
      { id: 1, x: 0, y: 0, state: 0 },
      { id: 500, x: 21456, y: 19568, state: 0b10100101 },
    ];
    const decoded = decodeSync(encodeSync(7, entities, SYNC_FORMAT_COMPACT), SYNC_FORMAT_COMPACT);
    expect(decoded).toEqual({ tick: 7, entities });
  });

  it('loses at most 1/8 px on odd quantized coordinates', () => {
    const packet = encodeSync(1, [{ id: 3, x: 101, y: 99, state: 0 }], SYNC_FORMAT_COMPACT);
    const decoded = decodeSync(packet, SYNC_FORMAT_COMPACT);
    expect(decoded.entities[0]!.x).toBe(100);
    expect(decoded.entities[0]!.y).toBe(98);
  });

  it('逐条访问器对两种格式给出同一组 1/8px 坐标', () => {
    // 取偶数定点：1/4px 能无损表达，两种格式才该给出完全相同的值
    const entities = [{ id: 888, x: 12346, y: 4320, state: 0b00110011 }];
    const compact: typeof entities = [];
    const legacy: typeof entities = [];
    readSync(
      encodeSync(9, entities, SYNC_FORMAT_COMPACT),
      (id, x, y, state) => compact.push({ id, x, y, state }),
      SYNC_FORMAT_COMPACT,
    );
    readSync(
      encodeSync(9, entities, SYNC_FORMAT_LEGACY),
      (id, x, y, state) => legacy.push({ id, x, y, state }),
      SYNC_FORMAT_LEGACY,
    );
    expect(compact).toEqual(legacy);
  });

  it('keeps decoding the legacy 7 byte format', () => {
    const packet = encodeSync(5, [{ id: 9, x: 65535, y: 65535, state: 255 }]);
    expect(packet.byteLength).toBe(SYNC_HEADER_BYTES + SYNC_ENTRY_BYTES);
    expect(decodeSync(packet).entities[0]).toEqual({ id: 9, x: 65535, y: 65535, state: 255 });
  });

  it('rejects a truncated compact packet instead of guessing the format', () => {
    const packet = encodeSync(1, [{ id: 1, x: 2, y: 3, state: 4 }], SYNC_FORMAT_COMPACT);
    expect(() =>
      readSync(packet.subarray(0, packet.byteLength - 1), () => {}, SYNC_FORMAT_COMPACT),
    ).toThrow(/payload mismatch/);
  });

  it('把 7 字节包当 6 字节读会直接报错，而不是把尾部字节当坐标', () => {
    const legacy = encodeSync(1, [{ id: 1, x: 2, y: 3, state: 4 }]);
    expect(() => readSync(legacy, () => {}, SYNC_FORMAT_COMPACT)).toThrow(/payload mismatch/);
  });
});

describe('hello 的同步格式能力段', () => {
  it('不声明能力段时与旧版逐字节相同，解码回落到 7 字节格式', () => {
    const packet = encodeHello('牛马', DEFAULT_APPEARANCE.cow);
    expect(decodeHello(packet).syncFormat).toBe(SYNC_FORMAT_LEGACY);
  });

  it('声明紧凑格式后追加 [0xfd][1]，落点与状态照常解析', () => {
    const resume = { x: 100, y: 200, direction: DIRECTION.Left, pose: POSE.Sit, seatId: 7 };
    const packet = encodeHello('牛马', DEFAULT_APPEARANCE.cow, resume, '摸鱼中', SYNC_FORMAT_COMPACT);
    const decoded = decodeHello(packet);
    expect(decoded.syncFormat).toBe(SYNC_FORMAT_COMPACT);
    expect(decoded.resume).toEqual(resume);
    expect(decoded.status).toBe('摸鱼中');
  });

  it('没有落点也没有状态时，能力段不会被误读成落点', () => {
    const packet = encodeHello('牛马', DEFAULT_APPEARANCE.cow, undefined, '', SYNC_FORMAT_COMPACT);
    const decoded = decodeHello(packet);
    expect(decoded.resume).toBeUndefined();
    expect(decoded.status).toBe('');
    expect(decoded.syncFormat).toBe(SYNC_FORMAT_COMPACT);
  });

  it('WELCOME 尾部回告服务端实际采用的条目格式', () => {
    const packet = encodeWelcome({
      entityId: 7,
      tick: 99,
      x: 100,
      y: 200,
      state: 5,
      syncFormat: SYNC_FORMAT_COMPACT,
    });
    expect(decodeWelcome(packet)).toEqual({
      entityId: 7,
      tick: 99,
      x: 100,
      y: 200,
      state: 5,
      syncFormat: SYNC_FORMAT_COMPACT,
    });
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

  const CAREER = {
    firstJoinDate: '2026-03-04',
    todayMinutes: 361,
    todayToiletMinutes: 88,
    todaySteps: 123_456,
    todayKnockdown: 21,
    todayVented: 13,
    todayOvertime: 1,
    ringGold: 3,
    ringSilver: 1,
    ringBronze: 2,
    province: '浙江',
  };

  it('round-trips career in HELLO after status and capability segments', () => {
    const decoded = decodeHello(
      encodeHello('牛', DEFAULT_APPEARANCE.cow, undefined, '摸鱼中', SYNC_FORMAT_COMPACT, CAREER),
    );
    expect(decoded.name).toBe('牛');
    expect(decoded.status).toBe('摸鱼中');
    expect(decoded.syncFormat).toBe(SYNC_FORMAT_COMPACT);
    expect(decoded.career).toEqual(CAREER);
  });

  it('omits career for an old client HELLO', () => {
    const decoded = decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow));
    expect(decoded.career).toBeUndefined();
  });

  it('reads career together with status and online seconds from SPAWN', () => {
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
        career: CAREER,
      }),
    );
    expect(decoded.status).toBe('摸鱼中');
    expect(decoded.onlineSec).toBe(90);
    expect(decoded.career).toEqual(CAREER);
  });

  it('reads career when online seconds segment is absent', () => {
    const decoded = decodeSpawn(
      encodeSpawn({
        id: 2,
        x: 0,
        y: 0,
        state: 0,
        name: '牛',
        appearance: DEFAULT_APPEARANCE.cow,
        career: CAREER,
      }),
    );
    expect(decoded.onlineSec).toBeUndefined();
    expect(decoded.status).toBe('');
    expect(decoded.career).toEqual(CAREER);
  });

  it('ignores a truncated career segment instead of reading past the buffer', () => {
    const packet = encodeSpawn({
      id: 4,
      x: 0,
      y: 0,
      state: 0,
      name: '牛',
      appearance: DEFAULT_APPEARANCE.cow,
      onlineSec: 7,
      career: CAREER,
    }).slice();
    const decoded = decodeSpawn(packet.subarray(0, packet.byteLength - 3));
    expect(decoded.onlineSec).toBe(7);
    expect(decoded.career).toBeUndefined();
  });

  it('cached body + online seconds + career matches whole-packet encoding', () => {
    const name = '夜班实习生';
    const body = buildSpawnBody(name, DEFAULT_APPEARANCE.horse);
    const writer = new ByteWriter(256);
    encodeSpawnInto(writer, 9, 100, 200, 7, body, 61, CAREER);
    const direct = encodeSpawn({
      id: 9,
      x: 100,
      y: 200,
      state: 7,
      name,
      appearance: DEFAULT_APPEARANCE.horse,
      onlineSec: 61,
      career: CAREER,
    });
    expect([...writer.finish()]).toEqual([...direct]);
  });

  it('cached career segment matches whole-packet encoding', () => {
    const name = '夜班实习生';
    const body = buildSpawnBody(name, DEFAULT_APPEARANCE.horse);
    const segment = encodeCareerSegment(CAREER);
    expect(segment[0]).toBe(CAREER_EXTENSION_MAGIC);
    expect(segment[1]).toBe(segment.byteLength - 2);
    const writer = new ByteWriter(256);
    encodeSpawnInto(writer, 9, 100, 200, 7, body, 61, undefined, segment);
    const direct = encodeSpawn({
      id: 9,
      x: 100,
      y: 200,
      state: 7,
      name,
      appearance: DEFAULT_APPEARANCE.horse,
      onlineSec: 61,
      career: CAREER,
    });
    expect([...writer.finish()]).toEqual([...direct]);
  });

  it('round-trips C2S career report and S2C career broadcast', () => {
    expect(decodeCareerReport(encodeCareerReport(CAREER))).toEqual(CAREER);
    expect(decodeCareerBroadcast(encodeCareerBroadcast({ entityId: 17, career: CAREER }))).toEqual({
      entityId: 17,
      career: CAREER,
    });
  });

  it('rejects malformed career payloads without throwing', () => {
    const payload = encodeCareer(CAREER);
    expect(decodeCareer(payload.subarray(0, CAREER_FIXED_BYTES - 1))).toBeUndefined();
    const wrongVersion = payload.slice();
    wrongVersion[0] = 99;
    expect(decodeCareer(wrongVersion)).toBeUndefined();
    expect(decodeCareer(new Uint8Array(CAREER_MAX_BYTES + 1))).toBeUndefined();
    expect(payload.byteLength).toBeLessThanOrEqual(CAREER_MAX_BYTES);
    expect(payload[0]).toBe(4);
    expect(encodeSpawn({
      id: 1,
      x: 0,
      y: 0,
      state: 0,
      name: '牛',
      appearance: DEFAULT_APPEARANCE.cow,
      career: CAREER,
    }).byteLength).toBeGreaterThan(CAREER_FIXED_BYTES);
    expect(CAREER_EXTENSION_MAGIC).toBe(0xfc);
  });

  it('round-trips despawn reason', () => {
    expect(decodeDespawn(encodeDespawn(12, 3))).toEqual({ id: 12, reason: 3 });
  });

  it('keeps multi-byte chat intact', () => {
    const packet = encodeChatBroadcast({
      entityId: 3,
      msgId: 512,
      colorIndex: 2,
      danmakuMode: DANMAKU_MODE.Top,
      text: '摸鱼中 🐟 别卷了',
    });
    expect(decodeChatBroadcast(packet)).toEqual({
      entityId: 3,
      msgId: 512,
      colorIndex: 2,
      danmakuMode: DANMAKU_MODE.Top,
      text: '摸鱼中 🐟 别卷了',
    });
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

  it('carries entity role for guards and omits it for everyone else', () => {
    const guard = decodeSpawn(
      encodeSpawn({
        id: 1,
        x: 0,
        y: 0,
        state: 0,
        name: '保安',
        appearance: DEFAULT_APPEARANCE.cow,
        role: ENTITY_ROLE_GUARD,
      }),
    );
    expect(guard.role).toBe(ENTITY_ROLE_GUARD);

    const worker = decodeSpawn(
      encodeSpawn({ id: 2, x: 0, y: 0, state: 0, name: '同事', appearance: DEFAULT_APPEARANCE.cow }),
    );
    expect(worker.role).toBeUndefined();
  });

  it('reads role together with status, career and likes', () => {
    const decoded = decodeSpawn(
      encodeSpawn({
        id: 3,
        x: 0,
        y: 0,
        state: 0,
        name: '保安',
        appearance: DEFAULT_APPEARANCE.cow,
        status: '执勤中',
        onlineSec: 90,
        career: CAREER,
        likes: 5,
        role: ENTITY_ROLE_GUARD,
      }),
    );
    expect(decoded.status).toBe('执勤中');
    expect(decoded.onlineSec).toBe(90);
    expect(decoded.career).toEqual(CAREER);
    expect(decoded.likes).toBe(5);
    expect(decoded.role).toBe(ENTITY_ROLE_GUARD);
  });

  it('cached body + role matches whole-packet encoding', () => {
    const name = '保安';
    const body = buildSpawnBody(name, DEFAULT_APPEARANCE.horse);
    const writer = new ByteWriter(256);
    encodeSpawnInto(writer, 9, 100, 200, 7, body, 61, CAREER, undefined, 5, ENTITY_ROLE_GUARD);
    const direct = encodeSpawn({
      id: 9,
      x: 100,
      y: 200,
      state: 7,
      name,
      appearance: DEFAULT_APPEARANCE.horse,
      onlineSec: 61,
      career: CAREER,
      likes: 5,
      role: ENTITY_ROLE_GUARD,
    });
    expect([...writer.finish()]).toEqual([...direct]);
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

describe('chat danmaku metadata', () => {
  it('writes the two metadata bytes right before the text length', () => {
    const packet = encodeChatBroadcast({
      entityId: 1,
      msgId: 2,
      colorIndex: 3,
      danmakuMode: DANMAKU_MODE.Bottom,
      text: 'hi',
    });
    // op(1) + entityId(2) + msgId(2) + 元数据(2) + len(2) + 正文(2)
    expect(packet.byteLength).toBe(7 + DANMAKU_META_BYTES + 2);
    expect(packet[5]).toBe(3);
    expect(packet[6]).toBe(DANMAKU_MODE.Bottom);
    expect(packet[7]! | (packet[8]! << 8)).toBe(2);
  });

  it('round-trips the send packet', () => {
    const text = '带薪拉屎中…';
    const packet = encodeChatSend({ colorIndex: 7, danmakuMode: DANMAKU_MODE.Top, text });
    expect(decodeChatSend(packet)).toEqual({ colorIndex: 7, danmakuMode: DANMAKU_MODE.Top, text });
    // op(1) + 元数据(2) + len(2) + 正文
    expect(packet.byteLength).toBe(3 + DANMAKU_META_BYTES + new TextEncoder().encode(text).length);
  });

  it('falls back to the default white for out-of-palette colors', () => {
    expect(normalizeDanmakuColor(3)).toBe(3);
    expect(normalizeDanmakuColor(DANMAKU_COLOR_COUNT)).toBe(0);
    expect(normalizeDanmakuColor(200)).toBe(0);
    expect(normalizeDanmakuColor(-1)).toBe(0);
    expect(normalizeDanmakuColor(Number.NaN)).toBe(0);
    // 编码端也不把脏值写进字节：接收端不该看到一个不存在的颜色
    const packet = encodeChatBroadcast({
      entityId: 1,
      msgId: 1,
      colorIndex: 99,
      danmakuMode: DANMAKU_MODE.Scroll,
      text: 'x',
    });
    expect(packet[5]).toBe(0);
    // 模式位被伪造时同样在解码端回落，而不是把 42 传进渲染层
    packet[6] = 42;
    expect(decodeChatBroadcast(packet).danmakuMode).toBe(DANMAKU_MODE.Scroll);
  });

  it('normalizes unknown modes to scroll', () => {
    expect(normalizeDanmakuMode(DANMAKU_MODE.Top)).toBe(DANMAKU_MODE.Top);
    expect(normalizeDanmakuMode(DANMAKU_MODE.Bottom)).toBe(DANMAKU_MODE.Bottom);
    expect(normalizeDanmakuMode(9)).toBe(DANMAKU_MODE.Scroll);
  });

  it('decodes tampered metadata through the same clamp', () => {
    const packet = encodeChatBroadcast({ entityId: 1, msgId: 1, colorIndex: 0, danmakuMode: 0, text: 'hi' });
    packet[5] = 200;
    packet[6] = 7;
    expect(decodeChatBroadcast(packet)).toMatchObject({
      colorIndex: 0,
      danmakuMode: DANMAKU_MODE.Scroll,
      text: 'hi',
    });
  });
});

describe('chat history', () => {
  it('round-trips flags, ageSec and multi-byte name/text', () => {
    const packet = encodeChatHistory({
      flags: CHAT_HISTORY_FLAG.Replace | CHAT_HISTORY_FLAG.HasMore,
      entries: [
        { msgId: 7, entityId: 42, ageSec: 12, name: '夜班实习生', text: '摸鱼中 🐟 别卷了' },
        { msgId: 8, entityId: 43, ageSec: 3, name: '阿牛', text: '我去倒杯水' },
      ],
    });
    expect(decodeChatHistory(packet)).toEqual({
      flags: CHAT_HISTORY_FLAG.Replace | CHAT_HISTORY_FLAG.HasMore,
      entries: [
        { msgId: 7, entityId: 42, ageSec: 12, name: '夜班实习生', text: '摸鱼中 🐟 别卷了' },
        { msgId: 8, entityId: 43, ageSec: 3, name: '阿牛', text: '我去倒杯水' },
      ],
    });
  });

  it('returns an empty page instead of throwing', () => {
    const packet = encodeChatHistory({ flags: CHAT_HISTORY_FLAG.Replace, entries: [] });
    // op(1) + flags(1) + count(1)：空页只发 3 字节，客户端靠它清掉上一个会话的残留
    expect(packet.byteLength).toBe(3);
    expect(packet[2]).toBe(0);
    expect(decodeChatHistory(packet)).toEqual({ flags: CHAT_HISTORY_FLAG.Replace, entries: [] });
  });

  it('stops at the packet budget instead of blowing past it', () => {
    // 10 条满长度中文正文 ≈ 4.8KB，远超 2KB 预算：只能装下前面几条
    const entries = Array.from({ length: 10 }, (_, i) => ({
      msgId: i + 1,
      entityId: 1,
      ageSec: 60,
      name: '实习生',
      text: '卷'.repeat(160),
    }));
    const packet = encodeChatHistory({ flags: 0, entries });
    expect(packet.byteLength).toBeLessThanOrEqual(CHAT_HISTORY_PACKET_BUDGET);
    const decoded = decodeChatHistory(packet);
    expect(decoded.entries.length).toBeGreaterThan(0);
    expect(decoded.entries.length).toBeLessThan(entries.length);
    // 被预算截断时编码器必须自己置 HasMore，否则客户端会以为「没有更早的了」
    expect(decoded.flags & CHAT_HISTORY_FLAG.HasMore).toBe(CHAT_HISTORY_FLAG.HasMore);
    // 截断必须只发生在页尾：已装下的条目内容完整
    expect(decoded.entries[0]).toEqual({ msgId: 1, entityId: 1, ageSec: 60, name: '实习生', text: '卷'.repeat(160) });
  });

  it('treats an outrunning text length as empty instead of reading out of bounds', () => {
    const packet = encodeChatHistory({
      flags: 0,
      entries: [{ msgId: 9, entityId: 3, ageSec: 5, name: 'a', text: 'hello' }],
    });
    // 正文长度字段偏移：op(1)+flags(1)+count(1)+头(9)+name(1)
    new DataView(packet.buffer, packet.byteOffset, packet.byteLength).setUint16(13, 0xffff, true);
    expect(decodeChatHistory(packet).entries).toEqual([
      { msgId: 9, entityId: 3, ageSec: 5, name: 'a', text: '' },
    ]);
  });

  it('rejects a wrong opcode', () => {
    expect(() =>
      decodeChatHistory(encodeChatBroadcast({ entityId: 1, msgId: 1, colorIndex: 0, danmakuMode: 0, text: 'hi' })),
    ).toThrow(
      /chat history/,
    );
  });

  it('round-trips the paging request and clamps the page size', () => {
    expect(decodeChatHistoryRequest(encodeChatHistoryRequest({ beforeMsgId: 512, limit: 10 }))).toEqual({
      beforeMsgId: 512,
      limit: 10,
    });
    expect(decodeChatHistoryRequest(encodeChatHistoryRequest({ beforeMsgId: 0, limit: 255 })).limit).toBe(
      CHAT_HISTORY_MAX_PAGE,
    );
    expect(() => decodeChatHistoryRequest(new Uint8Array([0x1e, 0, 0]))).toThrow(/4 bytes/);
  });
});

describe('system notice', () => {
  it('round-trips kind, subject and multi-byte text', () => {
    const packet = encodeSystemNotice({
      kind: SYSTEM_NOTICE_KIND.Enter,
      entityId: 42,
      text: '夜班实习生 进入了园区',
    });
    expect(decodeSystemNotice(packet)).toEqual({
      kind: SYSTEM_NOTICE_KIND.Enter,
      entityId: 42,
      text: '夜班实习生 进入了园区',
    });
  });

  it('keeps an unknown kind instead of throwing: 旧客户端靠文本也能显示', () => {
    const packet = encodeSystemNotice({ kind: 200, entityId: 0, text: '园区将在 5 分钟后维护' });
    expect(decodeSystemNotice(packet)).toEqual({ kind: 200, entityId: 0, text: '园区将在 5 分钟后维护' });
  });

  it('treats a length field that outruns the payload as an empty line', () => {
    const packet = encodeSystemNotice({ kind: SYSTEM_NOTICE_KIND.Leave, entityId: 7, text: '小明 离开了园区' });
    // 把长度字段改大：解码必须回空串，不能读到缓冲区外面
    const tampered = packet.slice();
    new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength).setUint16(4, 0xffff);
    expect(decodeSystemNotice(tampered)).toEqual({ kind: SYSTEM_NOTICE_KIND.Leave, entityId: 7, text: '' });
  });

  it('rejects a packet with the wrong opcode', () => {
    expect(() =>
      decodeSystemNotice(encodeChatBroadcast({ entityId: 1, msgId: 1, colorIndex: 0, danmakuMode: 0, text: 'hi' })),
    ).toThrow(
      /system notice/,
    );
  });
});

describe('system notice templates', () => {
  it('formats enter / leave by name', () => {
    expect(formatSystemNotice(SYSTEM_NOTICE_KIND.Enter, { name: '阿牛' })).toBe('阿牛 进入了园区');
    expect(formatSystemNotice(SYSTEM_NOTICE_KIND.Leave, { name: '阿牛' })).toBe('阿牛 离开了园区');
  });

  it('formats the on-duty reminder in minutes and whole hours', () => {
    expect(formatSystemNotice(SYSTEM_NOTICE_KIND.OnDuty, { minutes: 30 })).toBe(
      '你已经在岗 30 分钟，起来走动两步。',
    );
    expect(formatSystemNotice(SYSTEM_NOTICE_KIND.OnDuty, { minutes: 120 })).toBe(
      '你已经在岗 2 小时，起来走动两步。',
    );
  });

  it('returns null for unknown kinds or missing params', () => {
    expect(formatSystemNotice(99, { name: '阿牛' })).toBeNull();
    expect(formatSystemNotice(SYSTEM_NOTICE_KIND.Enter, {})).toBeNull();
    expect(formatSystemNotice(SYSTEM_NOTICE_KIND.OnDuty, { minutes: 0 })).toBeNull();
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

  it('改工牌名与广播包都能往返，超长名字按协议上限截断', () => {
    const name = '夜班实习生';
    expect(decodeSetName(encodeSetName(name))).toBe(name);

    const broadcast = encodeNameBroadcast(88, name);
    expect(decodeNameBroadcast(broadcast)).toEqual({ entityId: 88, name });

    // 与入场同一把尺子：16 字符封顶，多出来的部分不进包
    const long = '夜班加班实习生的老黄牛啊啊';
    expect(decodeSetName(encodeSetName(long))).toBe(truncateName(long));
    expect(decodeNameBroadcast(encodeNameBroadcast(1, long)).name).toBe(truncateName(long));

    // 空名不能变成兜底名：那等于「改名成默认工牌名」，服务端要靠空串识别「本次不改」
    expect(decodeSetName(encodeSetName(''))).toBe('');
    expect(decodeSetName(encodeSetName('   '))).toBe('');
    expect(decodeNameBroadcast(encodeNameBroadcast(1, '')).name).toBe('');
  });

  it('改名声明的长度超出负载时回退空串，不读包外字节', () => {
    // 伪造长度 255：与剩余字节不符，按「没改名」处理，既不抛错也不越界
    const forged = encodeSetName('牛马').slice();
    forged[1] = 0xff;
    forged[2] = 0x00;
    expect(decodeSetName(forged)).toBe('');

    const forgedBroadcast = encodeNameBroadcast(88, '牛马').slice();
    forgedBroadcast[3] = 0xff;
    forgedBroadcast[4] = 0xff;
    expect(decodeNameBroadcast(forgedBroadcast)).toEqual({ entityId: 88, name: '' });

    // 长度字段还在、内容少一字节：同样回退空串
    const truncated = encodeSetName('牛马').subarray(0, 4);
    expect(decodeSetName(truncated)).toBe('');
  });
});

describe('会话续算段（ADR-0060）', () => {
  const CAREER = {
    firstJoinDate: '2026-01-01',
    todayMinutes: 60,
    todayToiletMinutes: 5,
    todaySteps: 100,
    todayKnockdown: 0,
    todayVented: 0,
    todayOvertime: 0,
    ringGold: 0,
    ringSilver: 0,
    ringBronze: 0,
    province: '',
  };

  it('HELLO 带上次会话秒数时追加 [0xfa][u32]，正好 5 字节', () => {
    const legacy = encodeHello('牛', DEFAULT_APPEARANCE.cow);
    const carried = encodeHello('牛', DEFAULT_APPEARANCE.cow, undefined, '', SYNC_FORMAT_LEGACY, undefined, 3_600);
    expect(carried.byteLength).toBe(legacy.byteLength + 5);
    expect(decodeHello(carried).sessionSec).toBe(3_600);
    // 旧客户端 / 新的一次进园：一个字节都不多
    expect(decodeHello(legacy).sessionSec).toBe(0);
  });

  it('落点、状态、能力、考勤与会话五段互不串位', () => {
    const resume = { x: 100, y: 200, direction: DIRECTION.Left, pose: POSE.Sit, seatId: 7 };
    const decoded = decodeHello(
      encodeHello('牛', DEFAULT_APPEARANCE.cow, resume, '摸鱼中', SYNC_FORMAT_COMPACT, CAREER, 86_400),
    );
    expect(decoded.resume).toEqual(resume);
    expect(decoded.status).toBe('摸鱼中');
    expect(decoded.syncFormat).toBe(SYNC_FORMAT_COMPACT);
    expect(decoded.career).toEqual(CAREER);
    expect(decoded.sessionSec).toBe(86_400);
  });

  it('会话段被截断时回落到 0，不读包外字节', () => {
    const packet = encodeHello('牛', DEFAULT_APPEARANCE.cow, undefined, '', SYNC_FORMAT_LEGACY, undefined, 60);
    expect(decodeHello(packet.subarray(0, packet.byteLength - 2)).sessionSec).toBe(0);
  });

  it('WELCOME 回显采信的会话秒数，且排在格式字节之后', () => {
    const packet = encodeWelcome({
      entityId: 7,
      tick: 99,
      x: 1,
      y: 2,
      state: 5,
      syncFormat: SYNC_FORMAT_COMPACT,
      sessionSec: 120,
    });
    expect(decodeWelcome(packet)).toMatchObject({
      syncFormat: SYNC_FORMAT_COMPACT,
      sessionSec: 120,
    });
    // 旧客户端只读到 state + 格式字节（13B）就停：格式仍然是 1，不会错位
    expect(decodeWelcome(packet.subarray(0, 13)).syncFormat).toBe(SYNC_FORMAT_COMPACT);
    expect(decodeWelcome(packet.subarray(0, 13)).sessionSec).toBeUndefined();
  });

  it('没有会话段时 WELCOME 与旧包逐字节相同', () => {
    const plain = encodeWelcome({ entityId: 7, tick: 99, x: 1, y: 2, state: 0 });
    expect(plain.byteLength).toBe(12);
    expect(decodeWelcome(plain).sessionSec).toBeUndefined();
  });
});

describe('匿名设备段与 PONG 时钟段（ADR-0081）', () => {
  const DEVICE = 'a1b2c3d4e5f60718';
  const ECONOMY = sanitizeEconomyProfile({
    coins: 42,
    stats: { atkSpeedLv: 1, workEffLv: 0, critLv: 0, armorLv: 0 },
    inventory: { ice_americano: 2 },
    houseTier: 1,
  });

  it('HELLO 带设备号时只在尾部多 9 字节，老段照常量解析', () => {
    const plain = encodeHello('牛', DEFAULT_APPEARANCE.cow);
    const withDevice = encodeHello(
      '牛',
      DEFAULT_APPEARANCE.cow,
      undefined,
      '',
      SYNC_FORMAT_COMPACT,
      undefined,
      undefined,
      DEVICE,
    );
    expect(withDevice.byteLength).toBe(plain.byteLength + DEVICE_EXTENSION_BYTES);
    const decoded = decodeHello(withDevice);
    expect(decoded.deviceId).toBe(DEVICE);
    expect(decoded.syncFormat).toBe(SYNC_FORMAT_COMPACT);
  });

  it('不带设备号的 HELLO 解码成空串，与旧包逐字节相同', () => {
    expect(decodeHello(encodeHello('牛', DEFAULT_APPEARANCE.cow)).deviceId).toBe('');
  });

  it('设备号写成非法 hex 时整段被忽略，也不会让后面的经济段错位', () => {
    const packet = encodeHello(
      '牛',
      DEFAULT_APPEARANCE.cow,
      undefined,
      '',
      SYNC_FORMAT_COMPACT,
      undefined,
      undefined,
      DEVICE,
      ECONOMY,
    );
    // 把设备号首字节改成 'Z'：段还在，但内容不再是合法 hex
    const at = packet.lastIndexOf(DEVICE_EXTENSION_MAGIC);
    packet[at + 1] = 'Z'.charCodeAt(0);
    const decoded = decodeHello(packet);
    expect(decoded.deviceId).toBe('');
    expect(decoded.syncFormat).toBe(SYNC_FORMAT_COMPACT);
    expect(decoded.economy).toEqual(ECONOMY);
  });

  it('会话段与设备段同时在场时互不串位', () => {
    const decoded = decodeHello(
      encodeHello(
        '牛',
        DEFAULT_APPEARANCE.cow,
        undefined,
        '摸鱼中',
        SYNC_FORMAT_COMPACT,
        undefined,
        3_600,
        DEVICE,
      ),
    );
    expect(decoded.sessionSec).toBe(3_600);
    expect(decoded.deviceId).toBe(DEVICE);
    expect(decoded.status).toBe('摸鱼中');
  });

  it('PONG 带时钟段时多 6 字节，旧解码器仍只读 timestamp', () => {
    const plain = encodePong(1234);
    const stamped = encodePong(1234, { serverSec: 1_760_000_000, tzOffsetMin: 480 });
    expect(plain.byteLength).toBe(5);
    expect(stamped.byteLength).toBe(5 + PONG_CLOCK_BYTES);
    expect(decodePong(stamped)).toBe(1234);
    expect(decodePongClock(stamped)).toEqual({
      timestamp: 1234,
      serverSec: 1_760_000_000,
      tzOffsetMin: 480,
    });
  });

  it('西半球负偏移按 i16 补码往返', () => {
    const stamped = encodePong(7, { serverSec: 1_760_000_000, tzOffsetMin: -300 });
    expect(decodePongClock(stamped)?.tzOffsetMin).toBe(-300);
  });

  it('旧服务端的 5 字节 PONG 读不到时钟段', () => {
    expect(decodePongClock(encodePong(9))).toBeUndefined();
  });

  it('设备号常量只认 16 位小写 hex', () => {
    expect(isDeviceId(DEVICE)).toBe(true);
    expect(isDeviceId(DEVICE.toUpperCase())).toBe(false);
    expect(isDeviceId('a1b2c3')).toBe(false);
  });
});
