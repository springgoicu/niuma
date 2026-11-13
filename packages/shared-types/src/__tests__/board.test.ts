import { describe, expect, it } from 'vitest';
import {
  BOARD_HEADER_BYTES,
  BOARD_MAX_NAME_BYTES,
  BOARD_METRIC,
  BOARD_METRIC_ALL,
  BOARD_TOP_N,
  clampBoardName,
  decodeBoard,
  decodeBoardRequest,
  encodeBoard,
  encodeBoardRequest,
  type BoardPacket,
} from '../board';

function packet(overrides: Partial<BoardPacket> = {}): BoardPacket {
  return {
    metric: BOARD_METRIC.TodayMinutes,
    online: 23,
    slacking: 7,
    selfRank: 3,
    selfValue: 12_345,
    rows: [
      { id: 7, name: '夜班实习生', value: 98_765 },
      { id: 9, name: '摸鱼办主任', value: 43_210 },
      { id: 11, name: '马场小工', value: 12_345 },
    ],
    ...overrides,
  };
}

describe('牛马榜请求包', () => {
  it('0 表示拉全部指标，7–11 各对应一个今日指标', () => {
    expect(decodeBoardRequest(encodeBoardRequest())).toBe(BOARD_METRIC_ALL);
    for (const metric of Object.values(BOARD_METRIC)) {
      expect(decodeBoardRequest(encodeBoardRequest(metric))).toBe(metric);
    }
  });

  it('未知指标、错 opcode 与短包一律返回 undefined', () => {
    // 1–6 是旧版在岗/周/摸鱼/击倒/步数/人气，新服务端不再接受，避免旧标签读新语义
    expect(decodeBoardRequest(new Uint8Array([0x24, 1]))).toBeUndefined();
    expect(decodeBoardRequest(new Uint8Array([0x24, 6]))).toBeUndefined();
    expect(decodeBoardRequest(new Uint8Array([0x24, 13]))).toBeUndefined();
    expect(decodeBoardRequest(new Uint8Array([0x25, 0]))).toBeUndefined();
    expect(decodeBoardRequest(new Uint8Array([0x24]))).toBeUndefined();
  });
});

describe('牛马榜快照包', () => {
  it('往返保留指标、园区现状、自己名次与中文昵称', () => {
    const decoded = decodeBoard(encodeBoard(packet()));
    expect(decoded).toEqual(packet());
  });

  it('空榜也能往返：用于新园区 / 全员未上报', () => {
    const empty = packet({ rows: [], online: 1, slacking: 0, selfRank: 0, selfValue: 0 });
    expect(decodeBoard(encodeBoard(empty))).toEqual(empty);
  });

  it('单包不超过字节预算', () => {
    const full = packet({
      rows: Array.from({ length: BOARD_TOP_N }, (_, index) => ({
        id: index + 1,
        name: '超长昵称测试牛马' + index,
        value: 1_000_000 - index,
      })),
    });
    expect(encodeBoard(full).length).toBeLessThanOrEqual(
      BOARD_HEADER_BYTES + BOARD_TOP_N * (7 + BOARD_MAX_NAME_BYTES),
    );
  });

  it('超长名字按 UTF-8 字节截断，不切坏多字节字符', () => {
    const emoji = '🐴'.repeat(16);
    const bytes = clampBoardName(emoji);
    expect(bytes.length).toBeLessThanOrEqual(BOARD_MAX_NAME_BYTES);
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('🐴'.repeat(12));
    expect(text.includes('\uFFFD')).toBe(false);

    const han = clampBoardName('牛'.repeat(20));
    expect(han.length).toBe(BOARD_MAX_NAME_BYTES);
    expect(new TextDecoder().decode(han)).toBe('牛'.repeat(16));
  });

  it('条目数超过上限、截断包与尾随字节都整条丢弃', () => {
    const encoded = encodeBoard(packet());
    const tooMany = encoded.slice();
    tooMany[6] = BOARD_TOP_N + 1;
    expect(decodeBoard(tooMany)).toBeUndefined();

    expect(decodeBoard(encoded.slice(0, encoded.length - 1))).toBeUndefined();

    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(decodeBoard(trailing)).toBeUndefined();
  });

  it('未知指标与错 opcode 返回 undefined', () => {
    const encoded = encodeBoard(packet());
    encoded[1] = 6;
    expect(decodeBoard(encoded)).toBeUndefined();
    expect(decodeBoard(new Uint8Array([BOARD_METRIC.TodayMinutes]))).toBeUndefined();
  });

  it('名字长度为 0 的条目被拒绝，不显示空工牌', () => {
    const encoded = encodeBoard(packet({ rows: [{ id: 1, name: 'x', value: 1 }] }));
    // 固定头 13B + id 2B + value 4B 之后是 nameLen
    encoded[BOARD_HEADER_BYTES + 6] = 0;
    expect(decodeBoard(encoded)).toBeUndefined();
  });

  it('数值钳到 u32 非负区间，不把负数写回成 4294967295', () => {
    const decoded = decodeBoard(
      encodeBoard(packet({ rows: [{ id: 1, name: '负数', value: -5 }], selfValue: -1 })),
    );
    expect(decoded?.rows[0]?.value).toBe(0);
    expect(decoded?.selfValue).toBe(0);
  });
});
