import { describe, expect, it } from 'vitest';
import {
  CAREER_FIXED_BYTES,
  CAREER_MAX_BYTES,
  CAREER_VERSION,
  EMPTY_CAREER,
  MAX_COUNT,
  MAX_DAY_MINUTES,
  MAX_STEPS,
  hasCareerReport,
  sanitizeCareer,
  type CareerSummary,
} from '../career';
import { decodeCareer, encodeCareer } from '..';

const encoder = new TextEncoder();

function makeCareer(overrides: Partial<CareerSummary> = {}): CareerSummary {
  return {
    ...EMPTY_CAREER,
    firstJoinDate: '2026-03-04',
    province: '浙江',
    todayMinutes: 361,
    todayToiletMinutes: 88,
    todaySteps: 123_456,
    todayKnockdown: 21,
    todayVented: 13,
    todayOvertime: 1,
    ...overrides,
  };
}

/** 构造一份 ADR-0060 时代的 v2 摘要，验证老包只映射语义确定的今日字段 */
function encodeV2(todayMinutes: number, province: string): Uint8Array {
  const provinceBytes = encoder.encode(province);
  const bytes = new Uint8Array(36 + provinceBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 2);
  view.setUint16(1, 20_000, true);
  view.setUint32(3, 999_999, true);
  view.setUint16(7, 10, true);
  view.setUint16(9, todayMinutes, true);
  view.setUint16(11, 1_234, true);
  view.setUint16(13, 82, true);
  view.setUint32(15, 999_999, true);
  view.setUint32(19, 88_888, true);
  view.setUint16(23, 77, true);
  view.setUint16(25, 55, true);
  view.setUint16(27, 33, true);
  view.setUint16(29, 9, true);
  view.setUint32(31, 120, true);
  view.setUint8(35, provinceBytes.length);
  bytes.set(provinceBytes, 36);
  return bytes;
}

describe('CareerSummary v3', () => {
  it('只保留今日字段，定长 18 字节', () => {
    expect(CAREER_VERSION).toBe(3);
    expect(CAREER_FIXED_BYTES).toBe(18);
    const encoded = encodeCareer(makeCareer());
    expect(encoded[0]).toBe(3);
    expect(encoded.length).toBe(CAREER_FIXED_BYTES + 6);
  });

  it('round-trip 保留全部今日字段与省份', () => {
    const career = makeCareer();
    expect(decodeCareer(encodeCareer(career))).toEqual(career);
  });

  it('钳制工时、如厕子集、步数与计数上限', () => {
    const safe = sanitizeCareer({
      ...EMPTY_CAREER,
      firstJoinDate: '2026-03-04',
      province: '  浙江  ',
      todayMinutes: MAX_DAY_MINUTES + 500,
      todayToiletMinutes: MAX_DAY_MINUTES + 900,
      todaySteps: MAX_STEPS + 1,
      todayKnockdown: -3,
      todayVented: MAX_COUNT + 10,
      todayOvertime: Number.NaN,
    });

    expect(safe.todayMinutes).toBe(MAX_DAY_MINUTES);
    expect(safe.todayToiletMinutes).toBe(MAX_DAY_MINUTES);
    expect(safe.todaySteps).toBe(MAX_STEPS);
    expect(safe.todayKnockdown).toBe(0);
    expect(safe.todayVented).toBe(MAX_COUNT);
    expect(safe.todayOvertime).toBe(0);
    expect(safe.province).toBe('浙江');
  });

  it('如厕时长永远不超过工时', () => {
    const safe = sanitizeCareer(
      makeCareer({ todayMinutes: 60, todayToiletMinutes: 120 }),
    );
    expect(safe.todayToiletMinutes).toBe(60);
  });

  it('省份截断后仍不超过最大载荷', () => {
    const encoded = encodeCareer(makeCareer({ province: '浙'.repeat(40) }));
    expect(encoded.length).toBeLessThanOrEqual(CAREER_MAX_BYTES);
  });

  it('老 v2 包只映射今日工时，历史累计不灌进今日字段', () => {
    const decoded = decodeCareer(encodeV2(361, '浙江'));
    expect(decoded).toMatchObject({
      firstJoinDate: expect.any(String),
      province: '浙江',
      todayMinutes: 361,
      todayToiletMinutes: 0,
      todaySteps: 0,
      todayKnockdown: 0,
      todayVented: 0,
      todayOvertime: 0,
    });
  });

  it('没有入职日期视为未上报', () => {
    expect(hasCareerReport(undefined)).toBe(false);
    expect(hasCareerReport({ ...EMPTY_CAREER })).toBe(false);
    expect(hasCareerReport(makeCareer())).toBe(true);
  });
});
