import { describe, expect, it } from 'vitest';
import { EMPTY_CAREER, type CareerSummary } from '../career';
import { LIKE_FLAG_SELF, MAX_LIKES } from '../like';
import { DEFAULT_APPEARANCE } from '../types';
import {
  decodeLike,
  decodeLikeRequest,
  decodeSpawn,
  encodeLike,
  encodeLikeRequest,
  encodeSpawn,
} from '../protocol';

const CAREER: CareerSummary = {
  ...EMPTY_CAREER,
  firstJoinDate: '2026-03-04',
  totalOnlineMinutes: 12_345,
  activeDays: 40,
  todayMinutes: 90,
  weekMinutes: 600,
  streakDays: 5,
  steps: 8_888,
  distanceM: 204,
  slackCount: 7,
  ventedCount: 2,
  knockdownCount: 4,
  overtimeCount: 3,
  province: '浙江',
  reportedOnlineSec: 120,
};

describe('工牌点赞包', () => {
  it('查询包只带 targetId，0 与坏包一律拒绝', () => {
    expect(decodeLikeRequest(encodeLikeRequest(42))).toBe(42);
    expect(decodeLikeRequest(encodeLikeRequest(0))).toBeUndefined();
    expect(decodeLikeRequest(new Uint8Array([0x27, 1, 0]))).toBeUndefined();
    expect(decodeLikeRequest(new Uint8Array([0x26, 1]))).toBeUndefined();
    expect(decodeLikeRequest(new Uint8Array([0x26, 1, 0, 0]))).toBeUndefined();
  });

  it('广播包往返保留目标、计数与 flag', () => {
    expect(decodeLike(encodeLike(7, 12, LIKE_FLAG_SELF))).toEqual({
      targetId: 7,
      likes: 12,
      flags: LIKE_FLAG_SELF,
    });
    expect(decodeLike(encodeLike(7, 0, 0))).toEqual({ targetId: 7, likes: 0, flags: 0 });
  });

  it('计数超过 u16 时停在 65535，不溢回 0', () => {
    expect(decodeLike(encodeLike(1, MAX_LIKES + 20, 0))?.likes).toBe(MAX_LIKES);
    expect(decodeLike(encodeLike(1, -5, 0))?.likes).toBe(0);
  });

  it('截断包与错 opcode 都返回 undefined，不把垃圾读成点赞', () => {
    const packet = encodeLike(9, 3, 1);
    expect(decodeLike(packet.slice(0, packet.length - 1))).toBeUndefined();
    expect(decodeLike(new Uint8Array([0x26, 9, 0, 3, 0, 1]))).toBeUndefined();
  });
});

describe('spawn 点赞尾段', () => {
  const base = {
    id: 3,
    x: 10,
    y: 20,
    state: 0,
    name: '夜班实习生',
    appearance: DEFAULT_APPEARANCE.cow,
  } as const;

  it('带点赞、在线秒、状态与考勤时各段互不串位', () => {
    const decoded = decodeSpawn(
      encodeSpawn({ ...base, status: '摸鱼中', onlineSec: 61, career: CAREER, likes: 9 }),
    );
    expect(decoded.status).toBe('摸鱼中');
    expect(decoded.onlineSec).toBe(61);
    expect(decoded.career).toEqual(CAREER);
    expect(decoded.likes).toBe(9);
  });

  it('只有点赞尾段也能读出来：0xfb 不会被当成状态长度', () => {
    const decoded = decodeSpawn(encodeSpawn({ ...base, likes: 7 }));
    expect(decoded.status).toBe('');
    expect(decoded.likes).toBe(7);
  });

  it('0 赞不写尾段，包体与旧版逐字节一致', () => {
    const withZero = encodeSpawn({ ...base, likes: 0 });
    const without = encodeSpawn(base);
    expect([...withZero]).toEqual([...without]);
    expect(decodeSpawn(without).likes).toBeUndefined();
  });

  it('截断的点赞尾段按没有点赞处理，不读到缓冲区外', () => {
    const packet = encodeSpawn({ ...base, onlineSec: 7, likes: 9 }).slice();
    const decoded = decodeSpawn(packet.subarray(0, packet.byteLength - 1));
    expect(decoded.onlineSec).toBe(7);
    expect(decoded.likes).toBeUndefined();
  });
});
