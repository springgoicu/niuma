import { describe, expect, it } from 'bun:test';
import {
  APPEARANCE_BYTES,
  MOVE_PACKET_BYTES,
  MOVE_PACKET_WITH_TIMING_BYTES,
  OpCode,
} from '@niuma/shared-types';
import { PACKET_MALFORMED, PACKET_OK, PACKET_UNKNOWN, checkPacket } from './guard';

/** 按 opcode 起一个指定总长的包，内容全 0，只在需要时写声明长度字段 */
function packet(op: number, length: number, declaredAt?: number, declared?: number): Uint8Array {
  const data = new Uint8Array(length);
  if (length > 0) data[0] = op;
  if (declaredAt !== undefined && declared !== undefined && declaredAt + 1 < length) {
    data[declaredAt] = declared & 0xff;
    data[declaredAt + 1] = (declared >> 8) & 0xff;
  }
  return data;
}

describe('入站包长度闸门', () => {
  it('移动包只接受 8 / 14 字节两种', () => {
    expect(checkPacket(OpCode.C2S_MOVE, packet(OpCode.C2S_MOVE, MOVE_PACKET_BYTES))).toBe(PACKET_OK);
    expect(
      checkPacket(OpCode.C2S_MOVE, packet(OpCode.C2S_MOVE, MOVE_PACKET_WITH_TIMING_BYTES)),
    ).toBe(PACKET_OK);
  });

  it('截断的移动包被拦下，而不是抛异常', () => {
    for (const len of [1, 7, 9, 13, 15, 64]) {
      expect(checkPacket(OpCode.C2S_MOVE, packet(OpCode.C2S_MOVE, len))).toBe(PACKET_MALFORMED);
    }
  });

  it('定长包长度必须精确相等', () => {
    expect(checkPacket(OpCode.C2S_PING, packet(OpCode.C2S_PING, 5))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_PING, packet(OpCode.C2S_PING, 4))).toBe(PACKET_MALFORMED);
    // 多一个字节也算伪造：正常客户端不会在 5 字节的 ping 后面挂尾巴
    expect(checkPacket(OpCode.C2S_PING, packet(OpCode.C2S_PING, 6))).toBe(PACKET_MALFORMED);
    expect(checkPacket(OpCode.C2S_LIKE, packet(OpCode.C2S_LIKE, 3))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_BOARD, packet(OpCode.C2S_BOARD, 2))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_ACTION, packet(OpCode.C2S_ACTION, 4))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_CHAT_HISTORY, packet(OpCode.C2S_CHAT_HISTORY, 4))).toBe(
      PACKET_OK,
    );
  });

  it('HELLO 有最小长度下限（昵称 + 固定外观段）', () => {
    const min = 2 + APPEARANCE_BYTES;
    expect(checkPacket(OpCode.C2S_HELLO, packet(OpCode.C2S_HELLO, min))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_HELLO, packet(OpCode.C2S_HELLO, min + 20))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_HELLO, packet(OpCode.C2S_HELLO, min - 1))).toBe(
      PACKET_MALFORMED,
    );
    expect(checkPacket(OpCode.C2S_HELLO, packet(OpCode.C2S_HELLO, 3))).toBe(PACKET_MALFORMED);
  });

  it('变长包按声明的长度字段校验，声明比实际长就拒绝', () => {
    // SET_STATUS: [op][len u16][utf8]
    expect(checkPacket(OpCode.C2S_SET_STATUS, packet(OpCode.C2S_SET_STATUS, 5, 1, 2))).toBe(
      PACKET_OK,
    );
    expect(checkPacket(OpCode.C2S_SET_STATUS, packet(OpCode.C2S_SET_STATUS, 5, 1, 20))).toBe(
      PACKET_MALFORMED,
    );
    // 声明比实际短是合法的（多出来的字节由 decoder 丢弃）
    expect(checkPacket(OpCode.C2S_SET_STATUS, packet(OpCode.C2S_SET_STATUS, 9, 1, 2))).toBe(
      PACKET_OK,
    );

    // CHAT: [op][color][mode][len u16][utf8]，长度字段在偏移 3
    expect(checkPacket(OpCode.C2S_CHAT, packet(OpCode.C2S_CHAT, 8, 3, 3))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_CHAT, packet(OpCode.C2S_CHAT, 8, 3, 600))).toBe(PACKET_MALFORMED);

    // CAREER: [op][len u8][payload]，长度字段在偏移 1、占 1 字节
    expect(checkPacket(OpCode.C2S_CAREER, packet(OpCode.C2S_CAREER, 10, 1, 8))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_CAREER, packet(OpCode.C2S_CAREER, 10, 1, 200))).toBe(
      PACKET_MALFORMED,
    );
  });

  it('长度不足头部的变长包直接拒绝', () => {
    expect(checkPacket(OpCode.C2S_CHAT, packet(OpCode.C2S_CHAT, 4))).toBe(PACKET_MALFORMED);
    expect(checkPacket(OpCode.C2S_SET_NAME, packet(OpCode.C2S_SET_NAME, 2))).toBe(PACKET_MALFORMED);
  });

  it('播报上报只接受 3 字节，多一字节即判伪造', () => {
    expect(checkPacket(OpCode.C2S_ACTIVITY, packet(OpCode.C2S_ACTIVITY, 3))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_ACTIVITY, packet(OpCode.C2S_ACTIVITY, 4))).toBe(PACKET_MALFORMED);
    expect(checkPacket(OpCode.C2S_ACTIVITY, packet(OpCode.C2S_ACTIVITY, 2))).toBe(PACKET_MALFORMED);
  });

  it('不认识的 opcode 只丢弃不断线', () => {
    // 服务端下发的 opcode 被反弹回来、或未来版本新增的包，都不该断线
    expect(checkPacket(OpCode.S2C_WELCOME, packet(OpCode.S2C_WELCOME, 12))).toBe(PACKET_UNKNOWN);
    expect(checkPacket(0x39, packet(0x39, 8))).toBe(PACKET_UNKNOWN);
    expect(checkPacket(0, new Uint8Array(0))).toBe(PACKET_UNKNOWN);
  });

  it('GTA 扩展包（0x60..0x6d）定长与变长长度校验全部准确', () => {
    expect(checkPacket(OpCode.C2S_FISHING, packet(OpCode.C2S_FISHING, 3))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_FISHING, packet(OpCode.C2S_FISHING, 2))).toBe(PACKET_MALFORMED);
    expect(checkPacket(OpCode.C2S_VEHICLE_ACTION, packet(OpCode.C2S_VEHICLE_ACTION, 4))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_CLEAR_STAR, packet(OpCode.C2S_CLEAR_STAR, 3))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_CPR, packet(OpCode.C2S_CPR, 3))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_GRAFFITI, packet(OpCode.C2S_GRAFFITI, 2))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_GIG_ACTION, packet(OpCode.C2S_GIG_ACTION, 4))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_VILLA_CUSTOMIZE, packet(OpCode.C2S_VILLA_CUSTOMIZE, 10, 3, 6))).toBe(PACKET_OK);
    expect(checkPacket(OpCode.C2S_VILLA_CUSTOMIZE, packet(OpCode.C2S_VILLA_CUSTOMIZE, 6, 3, 12))).toBe(
      PACKET_MALFORMED,
    );
  });
});
