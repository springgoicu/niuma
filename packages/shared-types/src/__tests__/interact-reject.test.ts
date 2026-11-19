import { describe, expect, it } from 'vitest';
import {
  INTERACT_ACTION,
  INTERACT_REASON,
  INTERACT_REJECT_BYTES,
  OpCode,
  decodeInteractReject,
  decodeVillaState,
  decodeWalletSync,
  encodeInteractReject,
  encodeVillaState,
  encodeWalletSync,
  type VillaPacket,
} from '../index';

describe('互动拒绝回执（ADR-0104）', () => {
  it('3 字节定长往返', () => {
    const packet = encodeInteractReject({
      action: INTERACT_ACTION.VillaBuy,
      reason: INTERACT_REASON.NotSeated,
    });
    expect(packet.byteLength).toBe(INTERACT_REJECT_BYTES);
    expect(packet[0]).toBe(OpCode.S2C_INTERACT_REJECT);
    expect(decodeInteractReject(packet)).toEqual({
      action: INTERACT_ACTION.VillaBuy,
      reason: INTERACT_REASON.NotSeated,
    });
  });

  it('未知 action / reason 原样透传，客户端自己兜底文案', () => {
    const packet = Uint8Array.of(OpCode.S2C_INTERACT_REJECT, 0xfe, 0xff);
    expect(decodeInteractReject(packet)).toEqual({ action: 0xfe, reason: 0xff });
  });

  it('截断包直接报错', () => {
    const packet = encodeInteractReject({ action: 1, reason: 1 });
    expect(() => decodeInteractReject(packet.subarray(0, 2))).toThrow(/at least/);
  });
});

describe('钱包同步包的装扮尾段（ADR-0104）', () => {
  it('带装扮时往返，并把未知 id 丢掉', () => {
    const packet = encodeWalletSync({
      coins: 120,
      stats: { atkSpeedLv: 1, workEffLv: 2, critLv: 3, armorLv: 4 },
      reason: 0,
      inventory: {},
      unlockedCosmetics: ['top', 'crown', 'not_a_real_sku'],
    });
    const decoded = decodeWalletSync(packet);
    expect(decoded.coins).toBe(120);
    expect(decoded.unlockedCosmetics).toEqual(['top', 'crown']);
  });

  it('空装扮段表示服务端确认一件也没有', () => {
    const packet = encodeWalletSync({
      coins: 0,
      stats: { atkSpeedLv: 0, workEffLv: 0, critLv: 0, armorLv: 0 },
      reason: 0,
      inventory: {},
      unlockedCosmetics: [],
    });
    expect(decodeWalletSync(packet).unlockedCosmetics).toEqual([]);
  });

  it('没有装扮段的旧包不产生字段，客户端保持本地值', () => {
    const packet = encodeWalletSync({
      coins: 0,
      stats: { atkSpeedLv: 0, workEffLv: 0, critLv: 0, armorLv: 0 },
      reason: 0,
      inventory: {},
    });
    expect(decodeWalletSync(packet).unlockedCosmetics).toBeUndefined();
  });

  it('装扮段被截断时只收下读得到的部分，不抛错', () => {
    const packet = encodeWalletSync({
      coins: 0,
      stats: { atkSpeedLv: 0, workEffLv: 0, critLv: 0, armorLv: 0 },
      reason: 0,
      inventory: {},
      unlockedCosmetics: ['top', 'crown'],
    });
    const truncated = packet.subarray(0, packet.byteLength - 1);
    expect(decodeWalletSync(truncated).unlockedCosmetics).toEqual(['top']);
  });
});

describe('别墅归属标志（ADR-0104）', () => {
  const base: VillaPacket = {
    id: 0,
    ownerId: 0,
    ownerName: '离线房主',
    locked: true,
    owned: true,
    mine: false,
    pending: 0,
  };

  it('离线房主仍算已拥有，收包人归属按 mine 单独表达', () => {
    const packet = encodeVillaState({ villas: [base] });
    expect(decodeVillaState(packet).villas[0]).toEqual(base);
  });

  it('无主院两个标志都为 false', () => {
    const empty: VillaPacket = { ...base, ownerName: '', locked: false, owned: false, mine: false };
    const packet = encodeVillaState({ villas: [empty] });
    expect(decodeVillaState(packet).villas[0]).toEqual(empty);
  });

  it('房主本人看到 mine = true', () => {
    const mine: VillaPacket = { ...base, owned: true, mine: true };
    const packet = encodeVillaState({ villas: [mine] });
    expect(decodeVillaState(packet).villas[0]!.mine).toBe(true);
  });
});
